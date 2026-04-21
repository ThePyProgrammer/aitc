---
phase: 07-replace-current-blocked-codebase-map-with-a-graph-based-code
verified: 2026-04-15T15:32:00Z
status: human_needed
score: 9/10
overrides_applied: 0
human_verification:
  - test: "Run `npm run tauri dev` against the AITC-self repo and walk the 14-step visual checklist in Plan 07-06 Task 3"
    expected: "Force-directed graph renders with folder hulls, directed edges, comet trails, heat map toggle, minimap shift at manifest open, conflict pulse on contended nodes, 60fps pan/zoom per D-23"
    why_human: "Visual, real-time, and performance behaviors (hull formation, comet trails, 60fps) cannot be verified programmatically. Plan 07-06 Task 3 is a blocking checkpoint:human-verify gate by design."
---

# Phase 7: Graph-Based Codebase Map — Verification Report

**Phase Goal:** Replace squarified-treemap codebase map with force-directed graph (nodes=files, edges=imports from tree-sitter, folder-island gravity, per-agent comet trails). Full replacement of treemap (D-04). Targets: 5k nodes @ 60fps (D-23), <2s dep-graph build for 10k files (D-24). Carry-over: heat map (D-19), minimap (D-20), agent manifest panel (D-21), conflict pulse (D-22).

**Verified:** 2026-04-15T15:32:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Treemap fully replaced; no squarify imports or useTreemapLayout | VERIFIED | `useTreemapLayout.ts` absent; no functional squarify import; only comments reference the word |
| 2 | tree-sitter parses imports; `get_dependency_graph` returns real edges | VERIFIED | `src-tauri/src/pipeline/deps/` module exists with `extract.rs` + `resolve.rs`; command registered in `lib.rs` and `commands.rs`; `bindings.ts` exposes `getDependencyGraph()` |
| 3 | D3-force layout with per-directory cluster gravity | VERIFIED | `forceCluster.ts` implements centroid-pull with depth-multiplier (D-11); `useGraphLayout.ts` drives simulation; `radarStore.graphNodes` caches settled positions |
| 4 | Folder hulls rendered as labeled bounded regions (D-12) | VERIFIED | `GraphRenderer.ts` uses `polygonHull`/`polygonCentroid` from `d3-polygon`; progressive zoom tiers at 0.6/2× |
| 5 | Per-agent comet trails fade over 10s, capped at 10/agent (D-16, D-18) | VERIFIED | `CometTrail.ts`: `TRAIL_FULL_OPACITY_MS=2000`, `TRAIL_FADE_DURATION_MS=8000`, `TRAIL_TOTAL_LIFESPAN_MS=10000`, `MAX_TRAILS_PER_AGENT=10`; `radarStore.pushTrail` enforces FIFO cap |
| 6 | Heat map (D-19/FMON-05): node fill tint via `heatTintForNode` | VERIFIED | `HeatMapOverlay.ts` delegates to `GraphRenderer.heatColor`; legacy `drawHeatMap(treemapRects)` deleted; `RadarMinimap` uses `heatTintIfActive` |
| 7 | Minimap shifts right=292/12px on manifest open/close (D-20, e62272d) | VERIFIED | `RadarMinimap.tsx`: `MANIFEST_OPEN_RIGHT=292`, `MANIFEST_CLOSED_RIGHT=12`; `isManifestOpen` ternary on `right` style; 200ms transition preserved |
| 8 | Conflict pulse ring + badge on contended nodes (D-22) | VERIFIED | `RadarCanvas.tsx`: `drawConflictPulses`/`drawConflictBadges` at z-order steps 12-13; `CONFLICT_PULSE_CYCLE_MS=1600`; `useConflictStore` subscribes to `alerts`; `#ff7351` color |
| 9 | D-24 benchmark: dep-graph <2s for 10k files | VERIFIED | `dep_graph_bench.rs` asserts `elapsed < 2000ms`; ran in **0.67s** on this machine |
| 10 | Visual/runtime behaviors: hulls, trails, 60fps, drag-to-pin | HUMAN NEEDED | Cannot verify programmatically — see Human Verification section |

**Score:** 9/10 truths verified (1 pending human)

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src-tauri/src/pipeline/deps/mod.rs` | VERIFIED | MAX_EDGES_PER_NODE=200, MAX_TOTAL_EDGES=100_000 |
| `src-tauri/src/pipeline/deps/extract.rs` | VERIFIED | MAX_FILE_SIZE_BYTES=1_048_576 (T-07-A) |
| `src-tauri/src/pipeline/deps/resolve.rs` | VERIFIED | canonicalize + starts_with repo-root check (T-07-B) |
| `src-tauri/src/pipeline/commands.rs` | VERIFIED | `get_dependency_graph` command present |
| `src-tauri/Cargo.toml` | VERIFIED | Pinned with `=`: tree-sitter=0.26.8, tree-sitter-typescript=0.23.2, tree-sitter-javascript=0.25.0, tree-sitter-rust=0.24.2, tree-sitter-python=0.25.0 (D-06) |
| `src-tauri/tests/dep_graph_bench.rs` | VERIFIED | Asserts <2000ms; passed in 0.67s |
| `src/views/Radar/RadarCanvas.tsx` | VERIFIED | Graph render pipeline, conflict pulse, comet trail integration |
| `src/views/Radar/GraphRenderer.ts` | VERIFIED | drawHulls/drawEdges/drawNodes; `lineWidth = 1/zoom` (D-13); polygon hull rendering |
| `src/views/Radar/CometTrail.ts` | VERIFIED | All D-16/D-18 constants present; `pruneTrails` FIFO cap |
| `src/views/Radar/HeatMapOverlay.ts` | VERIFIED | `heatTintForNode` delegates to GraphRenderer; no treemap-rect code |
| `src/views/Radar/RadarMinimap.tsx` | VERIFIED | Canvas 2D extents, manifest shift, viewport rect, click-to-pan |
| `src/views/Radar/forceCluster.ts` | VERIFIED | Centroid-pull force with depth decay (D-11) |
| `src/hooks/useGraphLayout.ts` | VERIFIED | d3-force simulation, settle-then-freeze, rewarm API |
| `src/hooks/useTreemapLayout.ts` | VERIFIED (deleted) | File absent — D-04 full replacement confirmed |
| `src/stores/radarStore.ts` | VERIFIED | `graphNodes: GraphNode[]`, `pushTrail`, `contentionScores` |
| `src/bindings.ts` | VERIFIED | `getDependencyGraph()` exported; pre-existing TS errors from Plan 09-01 scaffold (not Phase 7, deferred) |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `RadarCanvas.tsx` | `useGraphLayout.ts` | `const { quadtreeRef, rewarm } = useGraphLayout()` | WIRED |
| `RadarCanvas.tsx` | `GraphRenderer.ts` | drawHulls/drawEdges/drawArrows/drawNodes imports | WIRED |
| `RadarCanvas.tsx` | `CometTrail.ts` | `drawCometTrails`, `drawAgentDots` imports | WIRED |
| `RadarCanvas.tsx` | `conflictStore.ts` | `useConflictStore(s => s.alerts)` | WIRED |
| `RadarMinimap.tsx` | `radarStore.ts` | `useRadarStore(s => s.graphNodes/viewport/isManifestOpen)` | WIRED |
| `HeatMapOverlay.ts` | `GraphRenderer.ts` | `import { heatColor } from './GraphRenderer'` | WIRED |
| `radarStore.ts` | `commands.rs` | `getDependencyGraph()` via bindings in `fetchGraphIndex` | WIRED |
| `lib.rs` | `commands.rs` | `get_dependency_graph` registered in specta builder | WIRED |

### Locked Decisions Spot-Check (D-01..D-24)

| Decision | Check | Status |
|----------|-------|--------|
| D-04: Full treemap replacement | `useTreemapLayout.ts` absent; no functional squarify imports | PASS |
| D-06: Grammar versions pinned with `=` | Cargo.toml: `tree-sitter = "=0.26.8"` etc. | PASS |
| D-13: 1px uniform edges | `GraphRenderer.ts:210: ctx.lineWidth = 1 / zoom` | PASS |
| D-16: 10s trail (2s full + 8s fade) | `TRAIL_FULL_OPACITY_MS=2000`, `TRAIL_FADE_DURATION_MS=8000` | PASS |
| D-18: FIFO cap 10 trails/agent | `MAX_TRAILS_PER_AGENT=10` in CometTrail + radarStore | PASS |
| D-20: Minimap manifest shift | `MANIFEST_OPEN_RIGHT=292`, `MANIFEST_CLOSED_RIGHT=12` | PASS |
| D-22: Conflict pulse | `drawConflictPulses`/`drawConflictBadges`, 1600ms cycle, #ff7351 | PASS |

### Threat Model Verification (T-07-A..D)

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-07-A: Parser DoS (large files) | `MAX_FILE_SIZE_BYTES = 1_048_576` in `extract.rs` | PASS |
| T-07-B: Path traversal | `canonicalize` + `starts_with(&canonical_root)` in `resolve.rs` | PASS |
| T-07-C: Graph flood (barrel exports) | `MAX_EDGES_PER_NODE=200`, `MAX_TOTAL_EDGES=100_000` in `mod.rs` | PASS |
| T-07-D: Supply-chain (grammar crates) | tree-sitter crates pinned with `=` in Cargo.toml | PASS |

### Test Results

| Suite | Result | Notes |
|-------|--------|-------|
| `npm test -- --run` (all) | 250 passed, 1 failed, 4 todo | 1 failure is pre-existing `agentStore.launchAgent` (deferred-items.md) |
| Phase 7 specific suites (7 files, 88 tests) | 88/88 passed | GraphRenderer, HeatMapOverlay, RadarCanvas, RadarMinimap, CometTrail, forceCluster, useGraphLayout |
| `cargo test` | 223 passed, 2 failed | 2 failures are `conflict::engine` from Plan 03 (deferred-items.md) — Phase 7 adds no Rust test regressions |
| `cargo test --test dep_graph_bench -- --ignored` | PASSED in 0.67s | D-24 target <2000ms met with 3× margin |

**Note:** `d3-force`, `d3-polygon`, `d3-quadtree` were absent from `node_modules` at verification start (163 packages installed vs expected 228). `npm install` restored them — Phase 7 test suite then went from 6 failing files to 0. This is a node_modules hygiene issue, not a code defect. The packages are declared in `package.json` and `package-lock.json` correctly.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|---------|
| VIZN-01: Spatial radar, Canvas 2D, force-directed graph | VERIFIED | `RadarCanvas.tsx` drives full graph render via `GraphRenderer` + `d3-force` simulation |
| VIZN-02: Agent trajectories (comet trails on file events) | VERIFIED | `RadarCanvas.tsx` spawns trails in `pipelineEvents` effect; `CometTrail.ts` renders them |
| VIZN-04: 10k+ file perf, viewport culling | VERIFIED (programmatic) + HUMAN for 60fps | `GraphRenderer.ts` culls with `shouldRenderHullAtZoom`; 60fps claim needs visual confirmation |
| VIZN-05: File tree spatial layout, folder islands | VERIFIED (programmatic) + HUMAN for visual | `forceCluster.ts` gravity + `GraphRenderer` hulls with `d3-polygon`; visual quality needs human |
| FMON-05: Heat map on graph nodes | VERIFIED | `HeatMapOverlay.ts` + `RadarMinimap.tsx` both use `heatTintForNode`/`heatTintIfActive` |
| EMON-01: Dependency-graph codebase map | VERIFIED | tree-sitter pipeline in `deps/` module; `getDependencyGraph` command; `radarStore` consumes edges |

### Anti-Patterns Found

None blocking. The `npm run build` failure is pre-existing (Plan 09-01 bindings.ts TS errors, documented in `deferred-items.md`) — not introduced by Phase 7.

### Human Verification Required

#### 1. Full Visual and Runtime Verification (Plan 07-06 Task 3)

**Test:** Run `npm run tauri dev` from repo root. Open `/home/prannayag/pragnition/htx/aitc` (AITC-self repo). Walk all 14 steps in the Plan 07-06 Task 3 checklist:
1. Layout: folder islands with labeled hulls (SRC, SRC-TAURI, VIEWS/RADAR)
2. Edges: 1px uniform arrows at zoom ≥ 0.6×
3. Heat map toggle: node tint toward #ff7351 when contention > 0
4. Minimap: visible at right:12px, shifts to right:292px on manifest open, click-to-pan works
5. Comet trails: agent file touches spawn colored comets, tails fade over 10s, cap of 10/agent
6. Agent dot: pulses at current file, stops after inactivity
7. Conflict pulse: red ring + badge on contended node, tooltip shows CONFLICT_ACTIVE
8. Pan/zoom: wheel zoom cursor-anchored 0.3-20×, drag to pan, double-click fits extents
9. Drag-to-pin: node stays pinned with lock badge, shift+click to unpin
10. Performance banner: check if repo triggers INFO_DEGRADED/GRAPH_OVERLOAD banners
11. Capture DevTools Performance tab: confirm >55fps sustained during 5s pan/zoom (D-23)
12. No regressions: Tower, Comms, Conflicts/History views unaffected

**Expected:** All 14 checks pass. Type "approved" to complete Task 3 and close Phase 7.

**Why human:** Visual rendering quality (hull shape, label legibility), animation smoothness (60fps), real-time comet trail behavior, and drag interaction cannot be asserted programmatically.

---

_Verified: 2026-04-15T15:32:00Z_
_Verifier: Claude (gsd-verifier)_
