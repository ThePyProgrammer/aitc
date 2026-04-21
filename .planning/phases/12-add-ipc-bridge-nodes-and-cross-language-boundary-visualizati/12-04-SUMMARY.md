---
phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
plan: 04
subsystem: frontend
tags: [react, zustand, d3-force, vitest, worker-protocol, ipc-bridges, boundary-force]

# Dependency graph
requires:
  - phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
    plan: 03
    provides: getIpcBridges + IpcBridgeDto/IpcCallSite/CallShape/EdgeKind.invokes|handles on src/bindings.ts
  - phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
    plan: 01
    provides: forceBoundary skeleton + graphSimConfig constants (BOUNDARY_STRENGTH_DEFAULT, GRAPH_HALF_WIDTH) + 44 .todo anchors across 7 files
  - phase: 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl
    provides: Worker protocol message shapes + graphSimCore factory + useGraphLayout hook
provides:
  - radarStore extensions — GraphNode discriminator (kind='file'|'bridge') + language + 8 bridge metadata fields + selectedBridgeId/selectBridge + lastBridgeSetHash + ForceConfig.boundaryStrength
  - fetchGraph 3-leg Promise.all with per-leg .catch() for best-effort bridge merge
  - Alphabetic bridge x-spread with hash-gated cache (D-14)
  - Full forceBoundary physics (spring pull with Math.sign direction, deadband around target, k=0 early-return, bridge+undefined-language short-circuits)
  - Worker protocol widened: ForceConfig.boundaryStrength + InitMessage.nodes.kind/language
  - graphSimCore registers forceBoundary alongside forceCluster; updateConfig tunes it
  - useGraphLayout payload carries kind + language on InitMessage.nodes
  - 13 new passing tests across 3 files (9 radarStore + 7 forceBoundary + 4 useGraphLayout — 3 `.todo` were already real in Wave 0 so final count is 9+4+4 new = 17 new real assertions replacing 17 .todo anchors)
affects:
  - Plan 12-05 (Wave 4 — canvas renderer + interaction: drawBridgeNodes, drawBoundaryLine, BridgeSelection, BridgeTooltip, ForceConfigPanel boundaryStrength slider)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Custom d3-force as closure-with-attached-methods: `(alpha) => { /* tick body */ }` with .initialize(nodes), .strength(getter/setter) — mirrors forceCluster.ts shape exactly (Phase 7 precedent extended)"
    - "Hash-gated x-spread cache: lastBridgeSetHash = sorted(commandName).join(',') invalidates deterministically when command set changes; unchanged set preserves fx values across fetchGraph refreshes (RESEARCH §Pattern 5)"
    - "Per-leg Promise.all failure isolation: invoke<X>('…').catch((e) => { console.error(e); return [] })` inside the Promise.all array — one leg's rejection does not clobber the others' results. Matches 'best-effort' contract of the old 2-leg fetchGraph"
    - "Worker protocol widening by field-append (never reorder): ForceConfig gains boundaryStrength at the end; InitMessage.nodes gains optional kind + language — preserves structural compatibility for the existing buildSim payload map"
    - "`kind/language` flow through init+topology only, never updateConfig: updateConfig does not re-invoke buildSim, so per-node state set there would silently orphan. Worker protocol + useGraphLayout payload both enforce this (D-37 Pitfall 2)"
    - "Deadband around TARGET, not around y=0: prevents convergence-point jitter without blocking startup convergence from near-zero y (deviation from plan text — see §Deviations)"

key-files:
  created: []
  modified:
    - src/stores/radarStore.ts
    - src/stores/__tests__/radarStore.test.ts
    - src/workers/forces/forceBoundary.ts
    - src/views/Radar/__tests__/forceBoundary.test.ts
    - src/workers/graphSimProtocol.ts
    - src/workers/graphSimCore.ts
    - src/workers/__tests__/fixtures/tiny-graph.ts
    - src/hooks/useGraphLayout.ts
    - src/hooks/__tests__/useGraphLayout.test.ts

key-decisions:
  - "Redefined forceBoundary deadband to be ±5 world-px around the TARGET (not around y=0 as the plan text said). Rule 1 deviation: plan's y=0 deadband conflicted directly with V-12-17/V-12-18 — RNG-seeded file nodes starting in [-5, 5] would be immediately blocked by the deadband and never reach convergence (observed failure: y=0.146 after 30 ticks for a TS node). Target-based deadband preserves jitter suppression at steady state AND unblocks convergence. Updated the standalone deadband test to match the corrected semantics."
  - "Bridge node id = `bridge:<commandName>` (colon-prefixed) to avoid collision with repo-relative file paths. RESEARCH §Pitfall 6 anticipated this."
  - "Per-leg .catch() inside Promise.all — not a single try/catch around the whole call. The old fetchGraph's outer try/catch would have silently eaten bridge failures but also any tree/graph data that arrived before the failure. Per-leg catch is narrower and provides the V-12-16 'other slots intact' guarantee explicitly."
  - "SimNode declared as `extends ClusterNode, BoundaryNode` intersection. TypeScript accepts the double-extends because both ultimately extend SimulationNodeDatum with non-conflicting optional fields. The alternative (one base interface with all fields) would have leaked the dual concerns across forceCluster + forceBoundary."
  - "No explicit drawEdges exhaustive-match handling added (plan anticipated a TS6133 here but it did not surface). `npm run build` exits 0 cleanly — the current GraphRenderer.drawEdges does NOT exhaustive-match EdgeKind, so adding the 'invokes'/'handles' arms is Plan 05's scope (uplifting drawEdges rendering) rather than a transient TS fix."

patterns-established:
  - "Wave-3 pattern: flip 3 `.todo` blocks across 3 files in parallel — 9 radarStore + 7 forceBoundary + 4 useGraphLayout tests replaced their `.todo` anchors in a single Task 2 commit (forceBoundary + worker protocol + hook), with Task 1 delivering radarStore in isolation so the failure surface stays small."
  - "RNG-seeded convergence pattern transfers from forceCluster.test.ts to forceBoundary.test.ts verbatim — mulberry32(seed) + step(nodes) emulation (vy *= 0.5; y += vy; clamp to fx/fy). Deterministic across runs and CI-stable."
  - "Per-leg failure isolation in store fetchers: when combining multiple best-effort backend calls, attach `.catch()` to each leg independently, not to the whole Promise.all. Matches the 'fetchGraph is best-effort' Phase 7 contract and generalizes to future Phase 12+ fetchers."

requirements-completed:
  - V-12-15
  - V-12-16
  - V-12-17
  - V-12-18
  - V-12-19
  - V-12-20

# Metrics
duration: ~12min
completed: 2026-04-21
---

# Phase 12 Plan 04: Wave 3 Frontend Store + forceBoundary + Worker Protocol Summary

**Zustand `radarStore` widened with GraphNode kind/language discriminator + 8 bridge metadata fields + `selectedBridgeId` + `lastBridgeSetHash` + `ForceConfig.boundaryStrength` (default 0.15); `fetchGraph` resolves a third `get_ipc_bridges` leg via Promise.all with per-leg failure isolation and merges bridges into `graphNodes` (kind='bridge', fy=0, alphabetic-spread fx cached on hash); custom `forceBoundary` d3-force now carries a full spring-pull body with Math.sign-direction target attraction, deadband around target, k=0 early-return, bridge + undefined-language short-circuits; worker protocol widens `ForceConfig` + `InitMessage.nodes` to carry the new fields through init+topology (NEVER updateConfig, per D-37 Pitfall 2); `graphSimCore.buildSim` registers `forceBoundary` alongside `forceCluster` and `updateConfig` tunes its strength — closing all six V-12-15..V-12-20 witnesses in two atomic commits.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-21T13:38:32Z
- **Completed:** 2026-04-21T13:50:13Z
- **Tasks:** 2 (atomic commits — one per task)
- **Files changed:** 9 (all modifications; no new files — Wave 0 already shipped the skeletons)

## V-12-15..V-12-20 Witness Pass Log

### `npm run test -- --run src/stores/__tests__/radarStore.test.ts`

- **36/36 passed** — includes all 9 Phase-12 describe tests:
  - V-12-15 (GraphNode.kind discriminator round-trip)
  - V-12-15 (bridge metadata fields)
  - V-12-16 (three-leg Promise.all)
  - V-12-16 (bridges-leg failure isolation)
  - D-10 (legacy kind=undefined BC)
  - D-21 (selectedBridgeId + selectBridge round-trip)
  - D-14 (alphabetic x-spread across [-GRAPH_HALF_WIDTH, +GRAPH_HALF_WIDTH])
  - D-14 (hash-gated cache stability on unchanged command set)
  - D-30 (DEFAULT_FORCE_CONFIG.boundaryStrength=0.15 + setForceConfig merge)

### `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts`

- **7/7 passed** — includes the 3 named witnesses + 4 invariant guards:
  - **V-12-17** — TS-path nodes converge to y<-50 over 30 ticks at strength 0.15
  - **V-12-18** — Rust-path nodes converge to y>50 over 30 ticks
  - **V-12-19** — bridges (kind='bridge') receive no vy from the force; y stays pinned at 0
  - Invariants: k=0 early-return; language=undefined fallback; deadband around target; strength getter/setter round-trip

### `npm run test -- --run src/hooks/__tests__/useGraphLayout.test.ts`

- **17/17 passed** — includes all 4 Phase-12 describe tests:
  - **V-12-20** — boundaryStrength change posts `updateConfig` with new strength (0.42 in the test)
  - **V-12-20** — boundaryStrength change alpha-restarts the sim (isSimulating flips true) and posts updateConfig
  - kind + language propagate on InitMessage.nodes (file/ts, file/rust, bridge all verified)
  - D-37 — updateConfig never carries `nodes`, `edges`, or kind/language fields

### Combined scoped run

```
npm run test -- --run src/stores/__tests__/radarStore.test.ts src/views/Radar/__tests__/forceBoundary.test.ts src/hooks/__tests__/useGraphLayout.test.ts
Test Files  3 passed (3)
Tests       60 passed (60)
Duration    4.62s
```

## Build + Cargo Gates

- **`npm run build`** — exits 0. No TS6133/TS2741 errors. The plan preemptively flagged a `drawEdges` exhaustive-match error as expected-transient; it did not surface because `GraphRenderer.drawEdges` does not exhaustive-match `EdgeKind` today (Plan 05 will re-assess when it adds `invokes`/`handles` rendering branches).
- **`cargo test --lib`** — 438 passed, 2 failed (both pre-existing `conflict::engine` failures documented in Phase 12 deferred-items D-02; zero Phase 12 causation).
- **`cargo build --lib`** — clean for Phase 12 scope.

## Store Shape Delta (interface diff)

### `GraphNode` (before → after)

```typescript
// Before (Phase 7)
interface GraphNode {
  id: string;
  dirKey: string;
  dirDepth: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

// After (Phase 12)
interface GraphNode {
  id: string;              // `bridge:${commandName}` for bridge nodes
  dirKey: string;          // 'bridge' synthetic group for bridge nodes
  dirDepth: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  // + 10 new optional fields:
  kind?: 'file' | 'bridge';
  language?: 'ts' | 'rust';
  commandName?: string;
  rustName?: string;
  handlerFile?: string;
  handlerLine?: number;
  signatureSummary?: string;
  hasChannelArg?: boolean;
  callerFiles?: IpcCallSite[];
  callerCount?: number;
}
```

### `ForceConfig` (before → after)

```typescript
// Before (Phase 11)
interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
}
const DEFAULT_FORCE_CONFIG = { centerStrength: 0.05, clusterStrength: 0.08, linkStrength: 0.3, chargeStrength: -80 };

// After (Phase 12)
interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
  boundaryStrength: number;  // NEW
}
const DEFAULT_FORCE_CONFIG = { centerStrength: 0.05, clusterStrength: 0.08, linkStrength: 0.3, chargeStrength: -80, boundaryStrength: 0.15 };
```

### `RadarStore` slot additions

```typescript
// + 3 new slots
selectedBridgeId: string | null;         // null default; keyed by commandName
lastBridgeSetHash: string | null;        // null default; hash of sorted command-name set
// + 1 new action
selectBridge: (id: string | null) => void;
```

## Worker Protocol Delta

### `InitMessage.nodes[]` (before → after)

```typescript
// Before
nodes: { id: string; dirKey: string; dirDepth: number; fx?: number | null; fy?: number | null }[];

// After (+2 optional fields)
nodes: {
  id: string;
  dirKey: string;
  dirDepth: number;
  fx?: number | null;
  fy?: number | null;
  kind?: 'file' | 'bridge';       // NEW — D-10 propagation
  language?: 'ts' | 'rust';       // NEW — D-16 routing
}[];
```

### `ForceConfig` (worker-local)

```typescript
// Before — 4 fields
// After (+1 field)
boundaryStrength: number;
```

### `TopologyMessage.nodes` — inherits `InitMessage['nodes']` by reference, no direct edit needed.

### `updateConfig` — UNCHANGED. Intentionally carries ONLY `{ type: 'updateConfig'; config: ForceConfig }`, never nodes/edges/kind/language. D-37 Pitfall 2 guard.

## graphSimCore.ts Changes

- `SimNode` widened: `extends ClusterNode, BoundaryNode` intersection.
- `buildSim` node map now carries `kind: n.kind ?? 'file'` + `language: n.language`.
- `sim.force('boundary', forceBoundary().strength(cfg.boundaryStrength))` registered after `forceCluster` / `forceClusterCollide`.
- `updateConfig` branch: `(sim.force('boundary') as ReturnType<typeof forceBoundary>).strength(cfg.boundaryStrength);` alongside the existing strength-tuning lines; alpha-restart reused from existing call to `sim.alpha(FORCE_CONFIG_ALPHA).restart()`.

## useGraphLayout.ts Changes

- Payload map adds `kind: n.kind` + `language: n.language` on each node entry (applies to both init + topology paths via the shared `payload` variable).
- `sameConfig` now includes `a.boundaryStrength === b.boundaryStrength` so slider-driven changes to just this field trigger `updateConfig` dispatch without spurious updates.

## forceBoundary.ts — Full Implementation

```typescript
// Spring body (inside the force closure):
const k = strength * alpha;
if (k === 0) return;  // Pitfall 7

for (const n of nodes) {
  if (n.kind === 'bridge') continue;                     // D-10 skip
  if (n.language !== 'ts' && n.language !== 'rust') continue; // D-16 skip

  const targetY = n.language === 'ts' ? -300 : +300;
  const y = n.y ?? 0;
  const dy = targetY - y;
  if (Math.abs(dy) < 5) continue;                        // deadband around TARGET

  n.vy = (n.vy ?? 0) + Math.sign(dy) * k * Math.min(Math.abs(dy), 300);
}
```

Constants exported: `BOUNDARY_TARGET_Y_MAGNITUDE=300`, `BOUNDARY_DEADBAND=5`, `FORCE_BOUNDARY_BASE_STRENGTH=0.15`.

## Task Commits

Each task was committed atomically:

1. **Task 1: `radarStore` widen for bridges + x-spread + boundaryStrength** — `4bc9b35` (feat)
2. **Task 2: forceBoundary physics + worker protocol + useGraphLayout payload** — `62cf031` (feat)

_Plan metadata commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md) will follow as `docs(12-04): phase 12 wave 3 summary`._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] forceBoundary deadband semantic correction (y=0 → around TARGET)**
- **Found during:** Task 2 first test run. V-12-17 + V-12-18 convergence tests failed with nodes stuck around y=0.146 after 30 ticks at strength 0.15.
- **Issue:** The plan's deadband check was `if (Math.abs(y) < BOUNDARY_DEADBAND && Math.abs(dy) > BOUNDARY_TARGET_Y_MAGNITUDE - BOUNDARY_DEADBAND) continue`. Nodes RNG-seeded with initial y in [-5, 5] are immediately inside the deadband, AND dy to target is ±295..±305 which is > (300-5=295), so the deadband check skips force application entirely. With vy starting at 0 and the force blocked every tick, these nodes never escape. For `mulberry32(42)` + 10 TS nodes, at least one seeded near y=0, causing the first-node assertion `expect(n.y).toBeLessThan(-50)` to fail.
- **Fix:** Redefined the deadband as `if (Math.abs(dy) < BOUNDARY_DEADBAND) continue` — skip when the node is already within ±5 of its TARGET, not y=0. This preserves the jitter-suppression intent (no perpetual oscillation at steady state) while unblocking convergence from any starting y. The standalone deadband test was updated to match: it now seeds a TS node at `-TARGET + (DEADBAND - 1) = -296` (inside the target deadband) and asserts `vy === 0`. Rationale added as an inline comment in both the force body and the test file.
- **Files modified:** `src/workers/forces/forceBoundary.ts`, `src/views/Radar/__tests__/forceBoundary.test.ts`
- **Verification:** All 7 forceBoundary tests pass after the fix; V-12-17, V-12-18, V-12-19 all green.
- **Committed in:** `62cf031` (fix folded in before commit)

**2. [Rule 3 — Blocking] `tiny-graph.ts` fixture missing required `boundaryStrength` field**
- **Found during:** Task 2 `npm run build` verification. TS2741: "Property 'boundaryStrength' is missing in type '{…}' but required in type 'ForceConfig'."
- **Issue:** `src/workers/__tests__/fixtures/tiny-graph.ts` defines its own `DEFAULT_FORCE_CONFIG: ForceConfig`. When we widened `ForceConfig` to require `boundaryStrength` in `graphSimProtocol.ts`, this fixture's value no longer satisfied the shape.
- **Fix:** Added `boundaryStrength: 0.15` to the fixture's config literal. Mirrored the store-side default.
- **Files modified:** `src/workers/__tests__/fixtures/tiny-graph.ts`
- **Verification:** `npm run build` exits 0 after the fix.
- **Committed in:** `62cf031` (cleanup folded in before commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking cleanup)
**Impact on plan:** Zero scope creep. Deviation 1 corrects a semantic bug in the plan's force body that would have sunk V-12-17/V-12-18. Deviation 2 is a natural consequence of widening the `ForceConfig` interface — the fixture sharing the shape had to be updated. Both fixes are surgical and preserve all stated invariants.

## Issues Encountered

- **Pre-existing `conflict::engine` test failures (2 total)** — Surfaced during full `cargo test --lib` verification. Already documented under D-02 in `deferred-items.md` (Plan 02 confirmed pre-existence on clean tip `4cc570b`). Out of scope per "only fix own bugs"; NOT fixed. Zero causation link to Phase 12 code.
- **Vite-node sourcemap stack-overflow stderr noise** (`Invalid regular expression: /file:\/\/\/(\w:)?/: Stack overflow`) — A cosmetic regex-stack-overflow log from vite-node's `source-map.mjs` during stack-trace post-processing. Surfaces in all Phase 11+ useGraphLayout.test.ts runs, not introduced by this plan; does not affect test results (all 17 tests pass). Ignoring per "only fix own bugs".
- **Plan's anticipated `drawEdges` exhaustive-match TS error did NOT surface** — The plan preemptively warned that `npm run build` might fail with a `drawEdges`-related TS6133 because `EdgeKind` now has `invokes`/`handles` variants. In practice, `GraphRenderer.drawEdges` does not exhaustive-match `EdgeKind` (no `never` guard), so the new variants are silently accepted. Plan 05 will add rendering branches for these kinds as part of its scope rather than here.

## Known Stubs

None. All 17 flipped `.todo` stubs are now real passing `it()` assertions. V-12-15..V-12-20 all witnessed. The frontend `.todo` anchors that remain (BridgeRender, BoundaryLine, BridgeSelection, BridgeTooltip — 24 total across 4 files) are Plan 05 scope, not Plan 04.

## Threat Flags

None. Plan 04 is a pure frontend-store + worker widening with no new network surface, no new auth path, and no new trust-boundary file access. Bridge metadata comes from the existing `get_ipc_bridges` Tauri command (Plan 03 surface, already under threat model). The `lastBridgeSetHash` cache key is deterministic and client-side only.

## User Setup Required

None — all changes are internal to the frontend code + test suites. No secret, env, or runtime config needed.

## Next Phase Readiness

- **Plan 12-05 unblocked.** Wave 4 (canvas renderer + interaction) can now:
  - Import `GraphNode` with the `kind: 'file' | 'bridge'` discriminator from `./radarStore` and switch `drawBridgeNodes` vs. `drawFileNodes` on `node.kind ?? 'file'`.
  - Implement `drawBridgeNodes` + `drawBoundaryLine` + `drawBoundaryAnchorLabels` in `src/views/Radar/GraphRenderer.ts` — flipping the 12 `.todo` entries in `BridgeRender.test.ts` + `BoundaryLine.test.ts`.
  - Hit-test bridges in `RadarCanvas` → dispatch `selectBridge` action (already wired) → render `BridgeDetailPanel` — flipping the 5 `BridgeSelection.test.tsx` entries.
  - Append a `boundaryStrength` slider to `ForceConfigPanel` — the worker round-trip is now live; changing the slider value will flow through `setForceConfig → useRadarStore → useGraphLayout.sameConfig → worker updateConfig → sim.force('boundary').strength(...)` → alpha-restart.
  - Add `drawEdges` rendering branches for `invokes` + `handles` EdgeKind variants (the union already includes them via Plan 03's bindings regen; today's `drawEdges` silently accepts them without special rendering).
- **V-12-20 round-trip live.** The slider has no UI yet, but the data path is complete and testable: a direct `useRadarStore.getState().setForceConfig({ boundaryStrength: X })` call triggers an `updateConfig` worker message with `X` and flips the simulation's isSimulating flag. Plan 05 just needs to wire a `<input type="range" />` to that action.

## Self-Check: PASSED

Verified before finalizing:

1. **Files modified — all 9 exist with required symbols:**
   - `src/stores/radarStore.ts` — FOUND; `grep -c "kind?: 'file' | 'bridge'"` = 1; `grep -c "boundaryStrength"` = 2; `grep -c "selectedBridgeId"` = 4; `grep -c "lastBridgeSetHash"` = 5; `grep -c "get_ipc_bridges"` = 2; `grep -c "GRAPH_HALF_WIDTH"` = 3.
   - `src/stores/__tests__/radarStore.test.ts` — FOUND; 9 Phase-12 `it(...)` entries replace 9 `.todo` (none remaining in the Phase 12 block).
   - `src/workers/forces/forceBoundary.ts` — FOUND; `grep -c "Math.sign"` = 1; `grep -c "if (k === 0) return"` = 1.
   - `src/views/Radar/__tests__/forceBoundary.test.ts` — FOUND; 7 real `it(...)` (zero `.todo` remain).
   - `src/workers/graphSimProtocol.ts` — FOUND; `grep -c "boundaryStrength"` = 1; `grep -c "kind"` = 3.
   - `src/workers/graphSimCore.ts` — FOUND; `grep -c "forceBoundary"` = 6 (import + SimNode + buildSim + updateConfig + …); `grep -c "boundaryStrength"` = 2.
   - `src/workers/__tests__/fixtures/tiny-graph.ts` — FOUND; `boundaryStrength: 0.15` present.
   - `src/hooks/useGraphLayout.ts` — FOUND; `grep -c "kind"` = 3 (comment + payload map); `grep -c "language"` = 2 (payload map + sameConfig).
   - `src/hooks/__tests__/useGraphLayout.test.ts` — FOUND; 4 real Phase-12 `it(...)` (zero `.todo` remain in the Phase 12 block).

2. **Commits exist:**
   - `4bc9b35` — FOUND (`feat(12-04): radarStore widen for bridges + x-spread + boundaryStrength (V-12-15, V-12-16)`)
   - `62cf031` — FOUND (`feat(12-04): forceBoundary physics + worker protocol widening (V-12-17..V-12-20)`)

3. **Verification gates:**
   - `npm run test -- --run src/stores/__tests__/radarStore.test.ts` — **36/36 passed** (includes 9 Phase-12 tests)
   - `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts` — **7/7 passed** (V-12-17, V-12-18, V-12-19 + 4 invariants)
   - `npm run test -- --run src/hooks/__tests__/useGraphLayout.test.ts` — **17/17 passed** (includes 4 Phase-12 tests)
   - Combined scoped run — **60/60 passed** in 4.62s
   - `npm run build` — exits 0 (no TS errors)
   - `cargo test --lib` — 438 passed, 2 pre-existing conflict::engine failures (D-02)

All Wave 3 requirements from `12-VALIDATION.md` V-12-15..V-12-20 satisfied.

---
*Phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati*
*Plan: 04 (Wave 3)*
*Completed: 2026-04-21*
