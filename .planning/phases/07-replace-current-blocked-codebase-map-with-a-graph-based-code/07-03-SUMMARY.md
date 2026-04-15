---
phase: 07
plan: 03
subsystem: radar-graph
tags: [force-simulation, d3-force, settle-then-freeze, radarStore-refactor, wave-2]
dependency_graph:
  requires:
    - 07-01 radarStore graph slots (graphNodes/graphEdges/settledAt/pinnedNodeIds/activeTrails)
    - 07-01 d3-force/d3-quadtree/d3-polygon deps installed
    - 07-01 bindings.ts exports DependencyEdgeDto + EdgeKind
  provides:
    - src/views/Radar/forceCluster.ts (D-11 custom force with linear depth-decay)
    - src/hooks/useGraphLayout.ts (D-03 settle-then-freeze + rewarm + quadtree)
    - src/stores/radarStore.ts fetchGraph/pinNode/unpinNode/commitSettledPositions actions
    - graphNodesToTreeEntries bridge in useTreemapLayout (keeps treemap UI alive until Plan 04)
  affects:
    - src/stores/radarStore.ts
    - src/hooks/useTreemapLayout.ts
    - src/views/Radar/RadarCanvas.tsx
    - src/views/Radar/RadarMinimap.tsx
    - src/views/Radar/AgentManifestRow.tsx
    - src/views/RadarView.tsx
    - src/providers/RepoSessionProvider.tsx
    - src/views/Radar/__tests__/RadarComponents.test.tsx
tech_stack:
  added: []
  patterns:
    - "d3-force simulation held in useRef (never in Zustand) — RESEARCH §Pitfall 5"
    - "Settle-then-freeze manual-tick loop bounded by MAX_TICKS=500 or alpha<alphaMin (D-03)"
    - "Per-tick centroid recomputation in forceCluster (RESEARCH §Pattern 2)"
    - "Node-id churn threshold gate for rewarm (≥5 OR ≥1%, RESEARCH §Pitfall 3)"
    - "Cleanup on unmount via useEffect return + sim.stop() (RESEARCH §Pitfall 2)"
    - "Best-effort fetchGraph swallows Tauri invoke failures (matches old fetchTreeIndex contract)"
    - "graphNodesToTreeEntries bridge — treemap consumers compile against graphNodes until Plan 04 rewrites them"
key_files:
  created:
    - src/views/Radar/forceCluster.ts
    - src/hooks/useGraphLayout.ts
  modified:
    - src/stores/radarStore.ts
    - src/stores/__tests__/radarStore.test.ts
    - src/views/Radar/__tests__/forceCluster.test.ts
    - src/hooks/__tests__/useGraphLayout.test.ts
    - src/hooks/useTreemapLayout.ts
    - src/views/RadarView.tsx
    - src/views/Radar/RadarCanvas.tsx
    - src/views/Radar/RadarMinimap.tsx
    - src/views/Radar/AgentManifestRow.tsx
    - src/providers/RepoSessionProvider.tsx
    - src/views/Radar/__tests__/RadarComponents.test.tsx
decisions:
  - "forceCluster exposes depthMultiplier as a pure function so the D-11 formula (1 + depth * 0.4) is unit-testable without running the full force loop"
  - "Moved TreeIndexEntry interface out of radarStore and into useTreemapLayout — the treemap hook is the sole remaining consumer (radarStore no longer stores flat tree entries)"
  - "Added graphNodesToTreeEntries bridge rather than deleting treemap UI outright — keeps Plan 03 non-destructive for Plan 04's wholesale rewrite"
  - "Determinism test asserts relative-property determinism (centroid-to-centroid < 50 units, per-node < 50) rather than byte-identical output — d3-force's internal jiggle() uses Math.random during collision resolution and is not seed-patchable without monkey-patching the d3-force module"
  - "Rewarm deps = [graphNodes, graphEdges] (not settledAt) — only mutations trigger rewarm; commitSettledPositions alone must not re-enter the rewarm branch"
  - "setStoreGraph (null settledAt) vs mutateStoreGraph (preserve settledAt) split in tests — mirrors the production pipeline: fetchGraph resets settledAt, threshold-gated mutations do not"
metrics:
  duration: 15min
  tasks: 2
  files: 11
  lines: 1412
  completed: "2026-04-15T13:07:30Z"
requirements: [VIZN-01, VIZN-05]
---

# Phase 7 Plan 3: Graph Layout Hook + radarStore Refactor Summary

Implemented the pure-data layer of the graph view: d3-forceSimulation wrapper with settle-then-freeze cadence, custom `forceCluster` with linear depth-decay directory gravity, and a `radarStore` refactor that replaces the treemap-era `treeData`/`fetchTreeIndex` with graph-shaped state (`graphNodes` + `graphEdges` + `settledAt` + `pinnedNodeIds`) plus `fetchGraph`/`pinNode`/`unpinNode`/`commitSettledPositions` actions. Unskipped 3 Wave 0 test files (forceCluster, useGraphLayout, radarStore) and migrated them to the new API with 37 tests green.

## Execution

### Task 1 — forceCluster + radarStore refactor (commit daa1c7d)

- **`src/views/Radar/forceCluster.ts`** (new, 80 LOC). Exports `forceCluster()`, `depthMultiplier(depth)`, `FORCE_CLUSTER_BASE_STRENGTH=0.08`, `FORCE_CLUSTER_DEPTH_WEIGHT=0.4`, `ClusterNode`, `ClusterForce` types. Per-tick centroid recomputation; strength scales as `base * (1 + depth * 0.4)` per D-11.
- **`src/stores/radarStore.ts`** refactored:
  - REMOVED: `treeData: TreeIndexEntry[]`, `fetchTreeIndex`, `TreeIndexEntry` interface (moved to useTreemapLayout).
  - ADDED: `fetchGraph` (parallel `get_tree_index` + `get_dependency_graph`, filters dirs, drops edges with unknown endpoints, resets settledAt), `commitSettledPositions` (writes x/y back + sets settledAt=Date.now), `pinNode(id,x,y)` (sets fx/fy + adds to pinnedNodeIds), `unpinNode(id)` (clears fx/fy + removes from set).
  - UNCHANGED: viewport, selectedAgentId, isManifestOpen, heatMapEnabled, contentionScores, setViewport, selectAgent, toggleManifest, toggleHeatMap, updateContentionScores, AGENT_DOT_PALETTE, getAgentColor. `reset()` clears graph slots alongside the existing fields.
  - `installRadarPipelineBridge` now calls `fetchGraph()` instead of `fetchTreeIndex()` on the 500ms debounce.
- **Tests:** `forceCluster.test.ts` unskipped with 4 tests (depth-weight pure fn, centroid convergence, strength getter/setter chaining, VIZN-05 10-node cluster <100 units). `radarStore.test.ts` rewritten with 24 tests: fetchGraph populates nodes + edges, filters dirs, drops orphan edges, best-effort on invoke failure; pinNode/unpinNode round-trip; commitSettledPositions writes x/y and sets settledAt; reset clears graph slots; viewport/agent/manifest actions still work; `installRadarPipelineBridge` calls fetchGraph (not fetchTreeIndex).
- **Deviation (Rule 3 blocking):** Treemap UI (RadarCanvas/Minimap/AgentManifestRow/RadarView) referenced the removed `treeData`/`fetchTreeIndex`. Created `graphNodesToTreeEntries(nodes)` adapter in `useTreemapLayout.ts` that synthesizes flat TreeIndexEntry rows from graph nodes. Consumers now call `graphNodesToTreeEntries(graphNodes)` then feed into `useTreemapLayout`. RadarView swapped `fetchTreeIndex` → `fetchGraph`, empty-state gate now checks `graphNodes.length === 0`. RadarComponents.test.tsx mock updated to use graphNodes + fetchGraph.

### Task 2 — useGraphLayout hook with settle-then-freeze + quadtree + rewarm (commit 5ad4f6e)

- **`src/hooks/useGraphLayout.ts`** (new, 214 LOC). Exports `useGraphLayout()` hook + tuning constants. Builds `d3.forceSimulation<SimNode>` with link (distance=40, strength=0.3), charge (strength=-80, theta=0.9, distanceMax=300), center (0,0 strength=0.05), collide (radius=6), cluster (forceCluster()), alphaDecay=0.04, velocityDecay=0.5. Manual-tick up to MAX_TICKS=500 or alpha<alphaMin. After settle, builds d3-quadtree from final positions and commits positions via `radarStore.commitSettledPositions`. Re-warm effect (deps `[graphNodes, graphEdges]`) runs when node-id churn >= 5 OR >= 1% of total. Cleanup via useEffect return calls `sim.stop()`. Simulation + quadtree held in `useRef` (RESEARCH §Pitfall 5).
- **Tests:** `useGraphLayout.test.ts` unskipped with 9 tests:
  1. Tuning constants match spec (D-03, RESEARCH §Pattern 1).
  2. Settle of 50 nodes commits finite positions + settledAt.
  3. Small graph (5 nodes) settles via alpha cooldown.
  4. Quadtree populated + `.find(0,0,R)` returns a node.
  5. Under-threshold mutation (4 new on base 1000) does NOT rewarm (settledAt unchanged).
  6. Over-threshold mutation (6 new on base 50) DOES rewarm (settledAt strictly greater).
  7. Cleanup on unmount does not throw.
  8. Seeded-RNG determinism — two runs land on the same island (centroid distance < 50, per-node delta < 50).
  9. VIZN-05 regression — 10 nodes with shared dirKey mean pairwise distance < 100 world units.

## Commits

- `daa1c7d` — feat(07-03): add forceCluster + refactor radarStore to graph-only state
- `5ad4f6e` — feat(07-03): add useGraphLayout hook with settle-then-freeze + rewarm

## Verification

- `npm test -- --run src/views/Radar/__tests__/forceCluster.test.ts src/stores/__tests__/radarStore.test.ts` — 28 tests pass.
- `npm test -- --run src/hooks/__tests__/useGraphLayout.test.ts` — 9 tests pass.
- `npm test -- --run src/views/Radar/ src/stores/ src/hooks/` — 82 pass, 1 pre-existing unrelated failure (`agentStore.test.ts > launchAgent` — deferred per Plan 01 summary).
- Acceptance grep checks:
  - `export function forceCluster` in `src/views/Radar/forceCluster.ts`
  - `FORCE_CLUSTER_BASE_STRENGTH = 0.08`, `FORCE_CLUSTER_DEPTH_WEIGHT = 0.4`
  - `function depthMultiplier`
  - `fetchGraph: async`, `pinNode:`, `unpinNode:`, `commitSettledPositions:` in `src/stores/radarStore.ts`
  - `get_dependency_graph` invoked in `src/stores/radarStore.ts`
  - `export function useGraphLayout`, `MAX_TICKS = 500`, `REWARM_NODE_COUNT_THRESHOLD = 5`, `REWARM_PERCENT_THRESHOLD = 0.01`, `CHARGE_DISTANCE_MAX = 300` in `src/hooks/useGraphLayout.ts`
- `grep -rn "treeData\|fetchTreeIndex" src/` — 7 remaining matches, ALL in comments documenting the replacement. Zero remaining identifier-use of the removed fields.
- Determinism (VIZN-05) regression test passes on seeded input.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Treemap UI still referenced removed store fields**
- **Found during:** Task 1 (after radarStore refactor broke compile)
- **Issue:** RadarCanvas, RadarMinimap, AgentManifestRow, RadarView, RepoSessionProvider, and RadarComponents.test.tsx all referenced `treeData` / `fetchTreeIndex` — pre-existing treemap-era consumers not scoped into Plan 03's `<files>` list but required to compile until Plan 04 rewrites them.
- **Fix:** Added `graphNodesToTreeEntries(nodes)` adapter in `useTreemapLayout.ts` (synthesizes flat `TreeIndexEntry[]` from graph node ids + depths). Treemap renderers now call the adapter as a view-model bridge. RadarView's empty-state gate reads `graphNodes.length`. RadarComponents.test.tsx mock updated to the new store shape.
- **Files modified:** `src/hooks/useTreemapLayout.ts`, `src/views/Radar/RadarCanvas.tsx`, `src/views/Radar/RadarMinimap.tsx`, `src/views/Radar/AgentManifestRow.tsx`, `src/views/RadarView.tsx`, `src/providers/RepoSessionProvider.tsx`, `src/views/Radar/__tests__/RadarComponents.test.tsx`.
- **Commit:** daa1c7d

**2. [Rule 1 — Bug] Determinism test assumed byte-identical output**
- **Found during:** Task 2 (test run, not implementation)
- **Issue:** First determinism test draft asserted `toBeCloseTo(_, 6)` (1e-6 tolerance). d3-force's internal `jiggle()` helper calls `Math.random()` during collision resolution on near-coincident nodes — this randomness is NOT seed-patchable without monkey-patching the d3-force module itself, which would leak across tests.
- **Fix:** Relaxed to "relative-property determinism" as explicitly allowed by RESEARCH §909: both runs must settle (finite positions), land on the same island (centroid distance < 50), and each node's position must be within 50 world units of its counterpart in the other run. This catches the real failure modes (simulation blew up, configuration drift) without demanding byte-identity.
- **Files modified:** `src/hooks/__tests__/useGraphLayout.test.ts`
- **Commit:** 5ad4f6e

**3. [Rule 1 — Bug] Rewarm under-threshold test accidentally reset settledAt**
- **Found during:** Task 2 (test run)
- **Issue:** Test helper `setStoreGraph` always passes `settledAt: null` in `useRadarStore.setState`. When the test mutated the graph post-settle to simulate an under-threshold add, it was inadvertently clearing settledAt — which fires the INITIAL settle effect, not the rewarm effect. Test assertion was correct but setup was wrong.
- **Fix:** Split into two test helpers: `setStoreGraph` (nulls settledAt — simulates `fetchGraph`) and `mutateStoreGraph` (preserves settledAt — simulates threshold-gated mutation). Rewarm tests use `mutateStoreGraph`.
- **Files modified:** `src/hooks/__tests__/useGraphLayout.test.ts`
- **Commit:** 5ad4f6e

### Adjusted Scope

None — all must_haves truths and artifacts delivered; all acceptance criteria grep checks pass.

## Deferred Issues

- **Pre-existing `agentStore.test.ts > launchAgent` failure** — 1 test fails because `launchAgent` now passes an `options: null` argument the test mock doesn't expect. Noted in 07-01-SUMMARY.md as existing on main before Phase 7. Out of scope.
- **Pre-existing `src/bindings.ts` TS errors** — TS6133 / TS2440 / TS6133 on lines 653 / 664 / 685. Noted in 07-01-SUMMARY.md. Out of scope.
- **act() warning on store mutations inside hook effects** — React 19 emits a non-fatal warning when `commitSettledPositions` is called inside a useEffect without a test-side `act()` wrapper. Tests pass; wrapping the hook's internal effect in act would require changing hook semantics. Deferred as cosmetic.

## Self-Check: PASSED

**Files created:**
- `src/views/Radar/forceCluster.ts` — FOUND
- `src/hooks/useGraphLayout.ts` — FOUND
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-03-SUMMARY.md` — FOUND (this file)

**Commits verified in `git log --oneline`:**
- `daa1c7d` — FOUND (Task 1)
- `5ad4f6e` — FOUND (Task 2)

**Acceptance criteria:**
- All grep checks PASS (forceCluster exports, constants, depthMultiplier, fetchGraph/pinNode/unpinNode/commitSettledPositions actions, get_dependency_graph invoke, useGraphLayout exports, tuning constants).
- `npm test -- --run` on all three target files exits 0 (37 tests passing).
- No identifier-level references to `treeData` or `fetchTreeIndex` outside bindings.ts — remaining matches are comments documenting the replacement.
