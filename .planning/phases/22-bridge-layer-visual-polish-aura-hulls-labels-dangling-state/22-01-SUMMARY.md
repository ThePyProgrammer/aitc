---
phase: 22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state
plan: 01
subsystem: ui
tags: [radar, bridge, visual-polish, render-composition, hull-cache, canvas-2d, vitest]

# Dependency graph
requires:
  - phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
    provides: "GraphNode.kind discriminator ('file' | 'bridge'); bridgeNodes snapshot pattern in RadarCanvas; drawBridgeNodes/drawBridgeLabels/drawBoundaryAnchorLabels draw functions; Phase 12 V-12-15..V-12-24 witness baseline"
  - phase: 11.1-fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin
    provides: "hullCache module with (settledAt|zoomBucket) epoch key; getHullCache + _resetHullCacheForTest public surface; Phase 11.1 D-08 cache-key invariant"
provides:
  - "filterRenderableFileNodes — pure, exported helper in RadarCanvas.tsx that strips kind==='bridge' before drawNodes/drawFileLabels"
  - "fileNodes sibling snapshot to bridgeNodes in the per-frame RAF closure"
  - "hullCache kind-skip guard excluding bridges from folder-hull membership across all zoom buckets"
  - "W-22-01..W-22-03 Vitest witnesses + hullCache module-doc invariant note"
affects: [22-02-bridge-renderer-visual-tokens, future-bridge-layer-polish, future-render-composition-changes]

# Tech tracking
tech-stack:
  added: []  # no new deps; polish-only
  patterns:
    - "kind-aware draw-loop composition — orchestrator filters, draw functions stay pure (D-01..D-03)"
    - "cache-layer membership authority — getHullCache owns hull membership; no downstream kind filters (D-04..D-06)"
    - "TDD RED→GREEN cycle with co-located __tests__/{component}.{concern}.test.ts naming"

key-files:
  created:
    - "src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts — W-22-01/02 witnesses (4 cases; pure-helper unit tests; no React mount)"
    - "src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts — W-22-03 witnesses (3 cases; parametrized over 4 zoom buckets)"
  modified:
    - "src/views/Radar/RadarCanvas.tsx — exported filterRenderableFileNodes; fileNodes sibling; drawNodes/drawFileLabels arg swap"
    - "src/views/Radar/hullCache.ts — kind-skip guard inside group-by-dirKey loop; module-header invariant doc line"

key-decisions:
  - "Filter upstream in orchestrator (D-01) not inside draw functions — draw functions remain pure"
  - "No useMemo around fileNodes (D-02) — filter cost is negligible, memoization adds React-dep-graph complexity for zero measurable win"
  - "drawFolderHulls continues to receive liveNodes (D-03) — Fix 2 handles hull membership authoritatively at the cache layer; duplicate filtering would mask bugs"
  - "Single-line continue guard inside existing for-loop (D-04) — matches existing n.dirKey==='' + n.x===undefined guard idiom; cache epoch untouched"
  - "One-line module invariant doc (D-06) — no phase number reference per memory rule; terse statement prevents reintroduction during refactors"
  - "Test fixture dirDepth=0 — keeps shouldBuildHullAtZoom(0, 0.5) true so the zoom-bucket parametrization covers all 4 sampled zooms cleanly"

patterns-established:
  - "Pure-helper unit test for render-loop filters: extract the filter into a named export, test the export directly, skip React mount"
  - "Production change + test-fixture correction in the same commit: avoids a momentary-red state when a RED test fixture needs tuning"

requirements-completed: []  # phase is polish-only; no REQ-IDs

# Metrics
duration: 6m 4s
completed: 2026-04-23
---

# Phase 22 Plan 01: Render-layer composition fixes Summary

**Phantom aura circle under bridge diamonds eliminated and folder-hull centroids freed from bridge drag — via one exported filter in RadarCanvas orchestration + one-line kind-skip guard in hullCache.**

## Performance

- **Duration:** 6m 4s
- **Started:** 2026-04-23T06:32:53Z
- **Completed:** 2026-04-23T06:38:57Z
- **Tasks:** 2 (1 RED + 1 GREEN-with-two-atomic-commits)
- **Files modified:** 2 production + 2 new tests = 4 total
- **Commits:** 3 atomic (test → feat Fix 1 → feat Fix 2)

## Accomplishments

- **Fix 1 (Aura removal):** Bridge nodes no longer reach `drawNodes` / `drawFileLabels`. The phantom 5px file-node circle that rendered underneath every bridge diamond is gone. `filterRenderableFileNodes` is now a tested, exported pure helper — future render-loop filters can follow the same idiom.
- **Fix 2 (Hull membership):** `getHullCache` skips `kind === 'bridge'` in its group-by-dirKey loop. Folder hull centroids are no longer dragged toward `y=0` by co-dirKey bridges. Cache-epoch math (`settledAt|zoomBucket`) is untouched — Phase 11.1 D-08 invariant preserved.
- **Witness coverage:** 7 new Vitest cases (W-22-01 ×2, W-22-02 ×2, W-22-03 ×3) all GREEN. 6 Phase 11.1 hullCache regression cases remain GREEN. 37 GraphRenderer cases remain GREEN.
- **TypeScript clean:** `npm run build` passes; no `filterRenderableFileNodes` type drift, no new unused-export warnings.

## Task Commits

Each commit was atomic per the user's "commit after every change" memory rule:

1. **Task 1 RED — failing witness tests** — `510d6a4` (test)
   - `test(22-01): add failing aura-filter + bridge-exclusion witnesses (W-22-01..W-22-03)`
   - Both new test files created; verified RED against current production code.

2. **Task 2 Commit 1 — Fix 1 (aura removal)** — `a730a0b` (feat)
   - `feat(22-01): Fix 1 — filter bridges from drawNodes + drawFileLabels (aura removal)`
   - W-22-01 + W-22-02 flipped to GREEN.

3. **Task 2 Commit 2 — Fix 2 (hullCache bridge exclusion)** — `84eadbb` (feat)
   - `feat(22-01): Fix 2 — exclude kind==="bridge" from hullCache group-by-dirKey loop`
   - W-22-03 flipped to GREEN. Includes one test-fixture tweak (dirDepth 1→0) documented below.

**Plan metadata commit:** pending (this SUMMARY.md will be committed by the worktree finalizer before handoff to the orchestrator).

## Files Created/Modified

### Created
- `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` (78 lines, 4 test cases) — pure-helper unit tests; no React mount, no canvas mock. Covers W-22-01 (mixed array), W-22-02 (pure-file identity + undefined-kind backward-compat), and an all-bridges edge case.
- `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` (84 lines, 3 test cases) — mirrors `hullCache.test.ts` harness (Path2D polyfill, `vi.mock('d3-polygon')` with hullSpy/centroidSpy, `_resetHullCacheForTest` in beforeEach). Covers W-22-03 centroid invariant, zoom-bucket parametrization, and bridge-only-dirKey drop.

### Modified
- `src/views/Radar/RadarCanvas.tsx` — added exported `filterRenderableFileNodes` helper (line 81); added `fileNodes = filterRenderableFileNodes(liveNodes)` sibling next to `bridgeNodes` (line 711); swapped `liveNodes` → `fileNodes` at `drawNodes` (line 740) and `drawFileLabels` (line 751). `drawFolderHulls`, `drawEdges`, `drawBridgeNodes`, `drawBridgeLabels`, `drawBoundaryAnchorLabels` unchanged.
- `src/views/Radar/hullCache.ts` — added one-line module-header invariant doc (line 17); added `if (n.kind === 'bridge') continue;` inside the `for (const n of nodes)` loop (line 93). Cache-epoch expression, `shouldBuildHullAtZoom`, `paddedHullPoints`, hull-build branch all untouched.

## Decisions Made

Plan executed as specified. No architectural decisions needed; all four implementation decisions (D-01..D-06 relevant to this plan) were locked in CONTEXT.md and applied verbatim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture used dirDepth=1, which prevented hull build at zoom=0.5**
- **Found during:** Task 2 Commit 2 verification run (after Fix 2 production change landed)
- **Issue:** The W-22-03 zoom-bucket-parametrization test used `dirDepth: 1` in its fixture. `hullCache.ts::shouldBuildHullAtZoom` returns `true` only for `dirDepth === 0` when `zoom < 0.6`. At `zoom=0.5`, the `src` hull was legitimately skipped, causing `expect(entry).toBeDefined()` to fail with `undefined`. This was not a production bug — production correctly skipped deep-nested hulls at low zoom per Phase 11.1 `shouldBuildHullAtZoom` tier — it was a test-fixture defect in the RED commit this task itself authored.
- **Fix:** Changed fixture `dirDepth: 1` → `dirDepth: 0` in both `getHullCache excludes...` and `invariant holds across zoom buckets...` cases. The centroid invariant (`cy > 11`) is unchanged — only the hull-build gating coverage is what the fixture now accurately targets. Added a comment citing the `shouldBuildHullAtZoom` gate.
- **Files modified:** `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts`
- **Verification:** Re-ran the quick command; all 3 W-22-03 cases GREEN across all 4 zoom buckets (0.5, 1.0, 2.0, 5.0).
- **Committed in:** `84eadbb` (same commit as the Fix 2 production change, per RESEARCH §5.3 guidance: ship production change + required test updates in the same diff to avoid a momentary-red suite state).

---

**Total deviations:** 1 auto-fixed (1 bug, scoped to this plan's own RED-commit test fixture)
**Impact on plan:** No scope creep. Fix was local to the new W-22-03 test file, within this plan's file-owned scope. Production-code path is correct as authored and verified across 4 zoom buckets.

## Issues Encountered

- **Pre-existing test failure surfaced during radar-suite regression run (NOT this plan's scope):** `HeatMapOverlay.test.ts > heatTintForNode(0) returns the default surface-container color (#1a1919)` fails with `expected '#0f1a0e' to be '#1a1919'`. This is the Phase 12 deferred `HeatMapOverlay expectation drift` failure logged in `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md`. Per the user's "only fix own bugs" memory rule and the plan's explicit deferred-failure allowlist in VALIDATION.md, **this failure was NOT fixed by this plan**. It predates Plan 22-01 and remains deferred.

## User Setup Required

None — no external service configuration required; polish-only render fixes.

## Next Phase Readiness

- **Plan 22-02 (BridgeRenderer visual tokens)** — completely disjoint file surface (`BridgeRenderer.ts`); can execute in parallel with or after this plan. This plan touches zero Plan 22-02 files.
- **Phase 12 V-12-15..V-12-24 witness baseline** — all Phase 12 radar witnesses that were green pre-Plan-22-01 remain green (188/189 radar-suite pass; the 1 failure is the pre-existing Phase 12 deferred `HeatMapOverlay` drift, not touched by this plan).
- **Phase 11.1 invariants** — wheel-event/RAF coalescing hot-path unchanged (no new Zustand writebacks, no new useMemo/useRef); `hullCache` cache-epoch key `${settledAt ?? 'null'}|${zoomBucket}` untouched; `shouldBuildHullAtZoom` three-tier gate untouched. Cache hit-rate strictly unchanged; cache rebuild cost strictly decreases (fewer bridge points enter `paddedHullPoints` / `polygonHull` / `polygonCentroid`).
- **No schema / protocol / DTO / dependency change** — review surface is exclusively the 2 production files + 2 new tests; no `src/bindings.ts` regen, no Tauri command added, no worker-protocol change.

## Self-Check: PASSED

All acceptance criteria verified:

- [x] File exists: `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` — FOUND
- [x] File exists: `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` — FOUND
- [x] Commit `510d6a4` (test) — FOUND in git log
- [x] Commit `a730a0b` (Fix 1) — FOUND in git log
- [x] Commit `84eadbb` (Fix 2) — FOUND in git log
- [x] `filterRenderableFileNodes` exported from RadarCanvas.tsx line 81 — VERIFIED via grep
- [x] `const fileNodes = filterRenderableFileNodes(liveNodes)` at line 711 — VERIFIED
- [x] `drawNodes(ctx, fileNodes, ...)` at line 738–740 — VERIFIED
- [x] `drawFileLabels(ctx, fileNodes, ...)` at line 751 — VERIFIED
- [x] `if (n.kind === 'bridge') continue;` in hullCache.ts line 93 — VERIFIED
- [x] Module invariant doc at hullCache.ts line 17 — VERIFIED
- [x] Cache epoch expression untouched at hullCache.ts line 82 — VERIFIED
- [x] Plan-level gate passes: 13/13 tests GREEN — VERIFIED
- [x] `npm run build` clean — VERIFIED (no new warnings)

---
*Phase: 22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state*
*Plan: 01*
*Completed: 2026-04-23*
