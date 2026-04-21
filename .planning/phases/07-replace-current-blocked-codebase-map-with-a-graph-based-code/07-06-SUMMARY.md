---
phase: 07
plan: 06
subsystem: radar-visualization
tags: [heat-map, minimap, conflict-pulse, graph-radar, D-19, D-20, D-22, FMON-05]
dependency_graph:
  requires:
    - 07-04 (GraphRenderer.heatColor, RadarCanvas rAF loop)
    - 07-05 (CometTrail + agent-dot pipeline wiring)
    - "commit e62272d (manifest-shift behavior, preserved verbatim)"
  provides:
    - "heatTintForNode / heatTintIfActive — node-tint helpers for graph overlays"
    - "RadarMinimap (graph-extents Canvas 2D, MANIFEST_OPEN_RIGHT=292 / MANIFEST_CLOSED_RIGHT=12)"
    - "drawConflictPulses + drawConflictBadges — z-order steps 12-13 in RadarCanvas"
    - "conflictStore.alerts subscription pattern on the radar"
  affects:
    - "src/views/RadarView.tsx (passes canvasWidth/canvasHeight into RadarMinimap)"
    - "src/views/Radar/__tests__/RadarComponents.test.tsx (updated to new RadarMinimap props)"
tech_stack:
  added: []
  patterns:
    - "conflictStore.alerts filter → Set<filePath> projection via useMemo"
    - "Pure draw helpers (drawConflictPulses / drawConflictBadges) kept local to RadarCanvas but symmetrical to GraphRenderer API"
    - "RadarMinimap: one <canvas> element instead of per-node <div> (scales to 10k+ nodes)"
key_files:
  created:
    - src/views/Radar/HeatMapOverlay.ts
  modified:
    - src/views/Radar/RadarMinimap.tsx
    - src/views/Radar/RadarCanvas.tsx
    - src/views/RadarView.tsx
    - src/views/Radar/__tests__/HeatMapOverlay.test.ts
    - src/views/Radar/__tests__/RadarMinimap.test.tsx
    - src/views/Radar/__tests__/RadarCanvas.test.tsx
    - src/views/Radar/__tests__/RadarComponents.test.tsx
decisions:
  - "Implement conflict-pulse draw helpers inline in RadarCanvas (not in GraphRenderer). GraphRenderer is strictly structural (hulls/edges/arrows/nodes); signaling overlays (comet trails, conflict pulse) belong with the rAF subscriber so store wiring stays co-located."
  - "Derive active conflict paths from conflictStore.alerts via useMemo instead of referencing the plan's non-existent `activeConflicts` accessor. Store exposes `alerts` + `activeCount()`, not `activeConflicts` — filtering in-place matches TowerControl/ConflictBanner pattern."
  - "RadarMinimap now requires canvasWidth/canvasHeight props so the viewport rectangle can project precisely. Previous 400/300 hardcode lived in a Plan 04 comment as a deferred fix."
  - "HeatMapOverlay keeps two exports: heatTintForNode (raw delegate) + heatTintIfActive (enable-gated). RadarMinimap uses the gated variant to match main canvas branching."
metrics:
  duration: "~22 minutes (continuous execution)"
  completed: "2026-04-15T07:24:59Z"
---

# Phase 7 Plan 06: Heat Map Refactor + Minimap Rewrite + Conflict Pulse Summary

One-liner: HeatMapOverlay refactored to delegate tint to `GraphRenderer.heatColor`; RadarMinimap rewritten as Canvas 2D graph-extents viewer with preserved manifest shift and click-to-pan; conflict pulse (1.6s ring) + badge dots wired into RadarCanvas z-order steps 12-13 subscribed to `conflictStore.alerts`.

## What Was Built

### Task 1 — HeatMapOverlay + RadarMinimap (TDD cycle)

**RED commit:** `8e63907` — test(07-06): failing tests for tint helpers + graph-extents minimap.

**GREEN commit:** `b060f87` — feat(07-06): HeatMapOverlay.ts recreated as thin wrapper over `GraphRenderer.heatColor`. Exports `heatTintForNode` (raw delegate, returns `#1a1919` for score 0 and `#ff7351` for score 1) and `heatTintIfActive` (enable-gated variant returning baseline when toggle off). Legacy `drawHeatMap(treemapRects)` code path remains deleted (Plan 04 already removed RadarCanvas call sites).

RadarMinimap.tsx completely rewritten:
- Canvas 2D element (160×120 CSS px, HiDPI-scaled to devicePixelRatio).
- Computes graph bounding box from settled nodes, pads 2px, scales into 156×116 inner area.
- Node dots drawn as 2×2 `fillRect` calls. Tint honors `heatMapEnabled` + `contentionScores` via `heatTintIfActive`.
- Viewport rectangle (`strokeRect` in `#8eff71`, 1px) projects the main canvas' visible world region onto the minimap.
- Click-to-pan: projects click coords back to world space and calls `setViewport({ panX, panY })` to center the main canvas.
- `MANIFEST_OPEN_RIGHT = 292`, `MANIFEST_CLOSED_RIGHT = 12` constants; container `right` inline style toggled by `isManifestOpen` (preserves commit `e62272d`).
- 200ms `right` transition unchanged.

RadarView.tsx now passes `canvasWidth={containerRect?.width ?? 800}` / `canvasHeight={containerRect?.height ?? 600}` so the viewport rect maps precisely to the live container.

RadarComponents.test.tsx updated (two cases) to the new props-taking signature; the old `minimap-viewport-indicator` div assertion replaced with a `canvas` element assertion.

### Task 2 — Conflict pulse + badge

**Commit:** `3296bec` — feat(07-06): conflict pulse ring + badge into RadarCanvas (D-22).

Changes in `src/views/Radar/RadarCanvas.tsx`:
- Import `useConflictStore`. Subscribe to `alerts` and derive `activeConflictPaths` (a `Set<string>` of non-dismissed `filePath` values) via `useMemo`.
- Add `activeConflictPaths` to stateRef mirror + dirty-flag effect list.
- Dedicated rAF tick effect keeps `dirtyRef` set while any conflict is active so the ring animates through idle frames.
- `drawConflictPulses` (z-order step 12): single expanding ring per contended node, 6px → 15px world-space radius / zoom over `CONFLICT_PULSE_CYCLE_MS = 1600`, opacity 1 → 0 via `t * (2 - t)` cubic-bezier(0,0,0.2,1) approximation, stroke `#ff7351`.
- `drawConflictBadges` (z-order step 13): 4px/zoom dot at `+CONFLICT_BADGE_OFFSET / zoom`, `-CONFLICT_BADGE_OFFSET / zoom` offset. Always visible regardless of zoom (UI-SPEC §Sizing).
- New tests:
  - "renders conflict pulse ring on contended nodes (D-22)" — asserts `strokeStyle=#ff7351` was assigned and an arc draws at the node's world position.
  - "skips conflict pulse for dismissed alerts (D-22)" — asserts no `#ff7351` stroke when the alert is dismissed.

### Task 3 — Visual verification checkpoint (deferred to orchestrator)

This is a `checkpoint:human-verify` gate. The executor does not execute it — the orchestrator owns it and returns a structured CHECKPOINT message to the user. See the final section of this summary for the verification checklist.

## Test Results

Frontend suite: `npm test -- --run src/`
- **209 passed**, 1 failed, 4 todo.
- The single failure is `src/stores/__tests__/agentStore.test.ts launchAgent` — pre-existing (since commit `1aeadc6` / Plan 05), called out in Plan 06 success criteria as acceptable.

Targeted suites (100%):
- `src/views/Radar/__tests__/HeatMapOverlay.test.ts` → 6/6 passed
- `src/views/Radar/__tests__/RadarMinimap.test.tsx` → 5/5 passed
- `src/views/Radar/__tests__/RadarCanvas.test.tsx` → 10/10 passed
- `src/views/Radar/__tests__/RadarComponents.test.tsx` → 8/8 passed

Rust suite: `cargo test --manifest-path src-tauri/Cargo.toml`
- 179 passed, 2 failed, 3 ignored.
- Both failures are in `conflict::engine::tests` (`test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`). `src-tauri/src/conflict/engine.rs` was last modified in commit `ec769ba` (Plan 03). Plan 06 does not touch Rust code — these failures are unrelated. Logged to `deferred-items.md`.

Benchmark: `cargo test --test dep_graph_bench -- --ignored`
- `bench_dep_graph_10k` → ok. Finished in 0.91s, well under the 2s D-24 target.

## Deviations from Plan

### Rule 3 (Blocking) — npm install required
- **Found during:** Task 1 (test run)
- **Issue:** Worktree's `node_modules` was empty after the branch fast-forward; `d3-polygon` import failed.
- **Fix:** `npm install` (added 227 packages; no lockfile changes).
- **Files modified:** none (restored working state).
- **Commit:** integrated into Task 1 RED.

### Rule 1 (Bug) — Plan referenced `conflictStore.activeConflicts`, actual store exposes `alerts`
- **Found during:** Task 2 (grep for `activeConflicts`)
- **Issue:** Only `TowerControl.tsx` uses a similar name, and it's `useConflictStore(s => s.activeCount())` (a number, not a list). The store exposes `alerts` and a derived count accessor; there is no `activeConflicts` selector.
- **Fix:** Subscribe to `alerts`, derive `Set<filePath>` via `useMemo(() => new Set(alerts.filter(a => !a.dismissed).map(a => a.filePath)))`. Matches pattern in `ConflictBanner.tsx`.
- **Files modified:** `src/views/Radar/RadarCanvas.tsx`.
- **Commit:** `3296bec`.

### Rule 3 (Blocking) — Callers of RadarMinimap needed props update
- **Found during:** Task 1 GREEN (new signature RadarMinimap(canvasWidth, canvasHeight))
- **Issue:** `RadarView.tsx` (production caller) and `RadarComponents.test.tsx` (two test cases) used the old prop-less signature.
- **Fix:** RadarView now passes `containerRect?.width ?? 800` / `height ?? 600`; RadarComponents.test.tsx updated both test cases including the viewport-indicator test that now asserts a `canvas` element (the `minimap-viewport-indicator` div no longer exists — viewport is drawn via `strokeRect`).
- **Commit:** `b060f87`.

## Deferred Issues (out-of-scope pre-existing failures)

Logged to `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/deferred-items.md`:

1. `src/bindings.ts` TypeScript errors from Plan 09-01 (break `npm run build`). Not caused by Plan 06.
2. `conflict::engine` Rust test failures from Plan 03 history. Not touched by Plan 06.
3. `agentStore.launchAgent` options arg drift. Pre-existing, explicitly acceptable per plan success criteria.

## Acceptance Criteria Check

- [x] `grep -q "export function heatTintForNode" src/views/Radar/HeatMapOverlay.ts`
- [x] `grep -q "import.*heatColor.*from.*GraphRenderer" src/views/Radar/HeatMapOverlay.ts`
- [x] No legacy `drawHeatMap.*rects`/`TreemapRect` references in HeatMapOverlay.ts
- [x] `MANIFEST_OPEN_RIGHT = 292` constant in RadarMinimap.tsx
- [x] `MANIFEST_CLOSED_RIGHT = 12` constant in RadarMinimap.tsx
- [x] `isManifestOpen ?` ternary applied to `right` style
- [x] `graphNodes` referenced in RadarMinimap.tsx
- [x] `#8eff71` / `VIEWPORT_STROKE` present in RadarMinimap.tsx
- [x] `setViewport` called for click-to-pan
- [x] Tests pass (`HeatMapOverlay.test.ts`, `RadarMinimap.test.tsx`)
- [x] `drawConflictPulses` / `drawConflictBadges` implemented in RadarCanvas.tsx
- [x] `CONFLICT_PULSE_CYCLE_MS = 1600` constant
- [x] `useConflictStore` subscription
- [x] `#ff7351` / `CONFLICT_COLOR` in RadarCanvas.tsx
- [x] TS test suite green (209/209 excluding pre-existing agentStore)
- [x] Rust test suite stable (179 pass; 2 pre-existing failures deferred)
- [x] `dep_graph_bench_10k` passes (<2s)
- [ ] `npm run build` exits 0 — blocked by pre-existing Plan 09-01 bindings.ts TS errors, deferred.

## Known Stubs

None. All surfaces wired end-to-end.

## Threat Flags

None. Per plan frontmatter, Plan 06 touches only render/overlay code with no security-relevant surface.

## Self-Check: PASSED

Files:
- FOUND: src/views/Radar/HeatMapOverlay.ts
- FOUND: src/views/Radar/RadarMinimap.tsx
- FOUND: src/views/Radar/RadarCanvas.tsx
- FOUND: src/views/Radar/__tests__/HeatMapOverlay.test.ts
- FOUND: src/views/Radar/__tests__/RadarMinimap.test.tsx
- FOUND: src/views/Radar/__tests__/RadarCanvas.test.tsx

Commits:
- FOUND: 8e63907 (Task 1 RED)
- FOUND: b060f87 (Task 1 GREEN)
- FOUND: 3296bec (Task 2)
- FOUND: 12b7617 (deferred-items log)

## Visual Verification Checkpoint (Task 3, owner: orchestrator)

A CHECKPOINT message has been returned to the orchestrator/user. The executor does NOT run `npm run tauri dev` or attempt interactive verification. The 14-step checklist from the plan is forwarded unchanged. Task 3 will be marked complete when the user types "approved" or describes issues.
