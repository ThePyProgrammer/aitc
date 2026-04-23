---
task_id: 260422-dqu
mode: quick
phase: 12
description: "Fix Phase 12 boundary layer so it only activates on repos with a Tauri IPC surface"
completed: 2026-04-22
commits:
  - 6b9f1bb: "fix(12): gate boundary line + FRONTEND/BACKEND labels + BOUNDARY slider on bridges-present"
  - e7fe5b8: "fix(12): gate forceBoundary on classifiable-nodes presence + regression tests"
files_modified:
  - src/views/Radar/BridgeRenderer.ts
  - src/views/Radar/RadarCanvas.tsx
  - src/views/Radar/ForceConfigPanel.tsx
  - src/workers/forces/forceBoundary.ts
  - src/views/Radar/__tests__/BoundaryLine.test.ts
  - src/views/Radar/__tests__/forceBoundary.test.ts
files_created:
  - src/views/Radar/__tests__/ForceConfigPanel.test.tsx
witnesses_touched:
  - V-12-17 (forceBoundary TS convergence — amended fixture with rust anchor; assertion skips anchor)
  - V-12-18 (forceBoundary Rust convergence — amended fixture with ts anchor; assertion skips anchor)
  - V-12-19 (bridge fy=0 pinned — unchanged, still green)
  - V-12-22 (boundary line + FRONTEND/BACKEND labels — extended with no-bridges gate assertions)
---

# Quick Task 260422-dqu — Gate Phase 12 boundary layer on bridges-present

## Commits

1. **`6b9f1bb`** — `fix(12): gate boundary line + FRONTEND/BACKEND labels + BOUNDARY slider on bridges-present`
   - 5 files changed (+244 / −35)
   - `src/views/Radar/BridgeRenderer.ts` — `drawBoundaryLine` + `drawBoundaryAnchorLabels` accept `bridges: GraphNode[]` as the second positional arg and early-return on `bridges.length === 0`.
   - `src/views/Radar/RadarCanvas.tsx` — lifts `bridgeNodes` filter above the boundary-line draw step; gates both the world-space line (step 3) and the screen-space anchor-labels pass (steps 22-24) on `bridgeNodes.length > 0` (belt-and-braces).
   - `src/views/Radar/ForceConfigPanel.tsx` — adds a `useRadarStore` selector for `hasBridges` and wraps the BOUNDARY slider JSX in `{hasBridges && (…)}`.
   - `src/views/Radar/__tests__/BoundaryLine.test.ts` — all 9 existing tests amended to pass `BRIDGES_FIXTURE` as the new positional arg; adds 3 no-bridges gate tests.
   - `src/views/Radar/__tests__/ForceConfigPanel.test.tsx` — NEW file, 3 tests covering hidden-on-no-bridges, visible-when-at-least-one-bridge, and other-sliders-still-render.

2. **`e7fe5b8`** — `fix(12): gate forceBoundary on classifiable-nodes presence + regression tests`
   - 2 files changed (+159 / −26)
   - `src/workers/forces/forceBoundary.ts` — adds `inactive` flag computed once in `initialize()` via `hasBridge / hasTs / hasRust` short-circuit scan; `force(alpha)` early-returns when inactive. Activation rule: `!(hasBridge || (hasTs && hasRust))`.
   - `src/views/Radar/__tests__/forceBoundary.test.ts` — V-12-17 + V-12-18 fixtures prepend a single counter-language anchor; deadband test adds a rust anchor to exercise the deadband path rather than the inactive gate. Adds 5 new gate tests (bridges-only no-op, TS-only no-op, Rust-only no-op, bridge-activates-TS, ts+rust activates both).

## Green Test Counts

| File | Total | Pre-quick | New | Status |
|------|-------|-----------|-----|--------|
| `BridgeRender.test.ts` | 11 | 11 | 0 | V-12-21 regression baseline green |
| `BoundaryLine.test.ts` | 12 | 9 | 3 | 9 amended (pass `BRIDGES_FIXTURE`) + 3 new no-bridges gate assertions |
| `BridgeSelection.test.tsx` | 8 | 8 | 0 | V-12-23 baseline green |
| `BridgeTooltip.test.tsx` | 8 | 8 | 0 | V-12-24 baseline green |
| `forceBoundary.test.ts` | 12 | 7 | 5 | V-12-17/V-12-18 amended; V-12-19 + aux untouched; 5 new gate tests |
| `ForceConfigPanel.test.tsx` | 3 | 0 (new file) | 3 | slider hidden/visible conditional render |
| `useGraphLayout.test.ts` | 17 | 17 | 0 | Phase 11 regression — 17/17 (known pre-existing flake passed this run) |
| `radarStore.test.ts` | 36 | 36 | 0 | Phase 7 + V-12-15/V-12-16 regression baseline green |
| `forceCluster.test.ts` | n/a | (n/a — was in sweep) | 0 | Phase 11 regression baseline |

**Sweep totals (all 9 files):** 111/111 passing. No new regressions; "only fix own bugs" pre-existing failures (Phase 12 deferred-items D-01 / D-02) are out of the executed sweep and untouched.

**`npm run build`** — exits 0. TS clean. 8.67s (Task 1) / 9.89s (Task 2).

**Acceptance grep counts (all met):**
- `if (bridges.length === 0) return` in BridgeRenderer.ts → 2 (exactly)
- `bridges: GraphNode[]` in BridgeRenderer.ts → 4 (drawBoundaryLine + drawBoundaryAnchorLabels + the pre-existing drawBridgeNodes + drawBridgeLabels; ≥ 2 new additions)
- `if (bridgeNodes.length > 0)` in RadarCanvas.tsx → 2 (exactly)
- `{hasBridges &&` in ForceConfigPanel.tsx → 1
- `const hasBridges` in ForceConfigPanel.tsx → 1
- `inactive` in forceBoundary.ts → 3 (≥ 3)
- `hasBridge|hasTs|hasRust` in forceBoundary.ts → 8 (≥ 3)
- `if (inactive) return` in forceBoundary.ts → 1

## UAT Impact

**Phase 12 `12-05-CHECKPOINT.md` UAT scenarios are UNAFFECTED.** The 10-step Tauri-repo smoke test from 2026-04-21 continues to exercise the bridges-present path exactly as before — boundary line, FRONTEND/BACKEND labels, `forceBoundary` pull, BOUNDARY slider, and bridge diamonds all render and behave as today on the aitc repo itself (which has a Tauri binary and a full `#[tauri::command]` handler surface).

**Additional manual smoke recommended on the user's "2 TS frontends + Python backend" repo (out of scope for automated validation):**

1. `npm run tauri dev` with the no-bridges repo loaded.
2. Confirm NO boundary line is drawn across the canvas.
3. Confirm NO `FRONTEND` / `BACKEND` labels appear at the screen's left edge.
4. Confirm TS files do NOT drift upward toward y=-300; they cluster freely per Phase 7's dep-graph forces only.
5. Open the FORCES panel; confirm the BOUNDARY slider is NOT present (LINKS, PROXIMITY, REPULSION, CENTER still visible).

## Deviations from Plan

### None.

The plan was executed exactly as written. The V-12-17 / V-12-18 fixture amendments and the deadband-test anchor addition were anticipated by the plan's `<action>` text and implemented accordingly. No Rule 1-3 auto-fixes were required beyond the planned fixture amendments.

## Known Stubs

None. All new tests assert real observable invariants against the production code paths. No placeholder data flows to the UI.

## Self-Check: PASSED

- Files — all created/modified files exist:
  - `src/views/Radar/BridgeRenderer.ts` — FOUND; `bridges: GraphNode[]` positional arg + early-return on empty in `drawBoundaryLine` + `drawBoundaryAnchorLabels`.
  - `src/views/Radar/RadarCanvas.tsx` — FOUND; `bridgeNodes` lifted above step 3; guard on `bridgeNodes.length > 0` wraps both draw calls.
  - `src/views/Radar/ForceConfigPanel.tsx` — FOUND; `hasBridges` selector + `{hasBridges && …}` wrap on BOUNDARY slider.
  - `src/workers/forces/forceBoundary.ts` — FOUND; `inactive` flag + per-init compute + `if (inactive) return` gate.
  - `src/views/Radar/__tests__/BoundaryLine.test.ts` — MODIFIED; 12 passing (9 amended + 3 new).
  - `src/views/Radar/__tests__/forceBoundary.test.ts` — MODIFIED; 12 passing (7 amended/preserved + 5 new).
  - `src/views/Radar/__tests__/ForceConfigPanel.test.tsx` — NEW; 3 passing.

- Commits:
  - `6b9f1bb` — FOUND (Task 1).
  - `e7fe5b8` — FOUND (Task 2).

- Verification gates:
  - Phase 12 sweep (5 test files) — 42/42 green.
  - forceBoundary + useGraphLayout + radarStore + forceCluster (full regression sweep, 9 files) — 111/111 green.
  - `npm run build` — exits 0.

All regression-budget criteria from the plan constraints section met.
