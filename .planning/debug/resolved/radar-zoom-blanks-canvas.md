---
status: resolved
trigger: "extreme zoom makes all nodes disappear in RadarCanvas — post-ship regression on Phase 11.1"
created: 2026-04-21T14:00:00Z
updated: 2026-04-21T16:00:00Z
resolved: 2026-04-21T16:00:00Z
resolution_strategy: option_b_defensive_guard_without_diagnosis
root_cause_confirmed_by_smoke: "NaN/Infinity propagation in viewport state — guard fix eliminated the blanking"
fix_commits:
  - 6878f48 — test(11.1): restore useCanvasZoomPan suite for post-revert direct-wheel handler
  - 7b13735 — fix(11.1): guard hook setViewport against non-finite values
  - 383ca24 — fix(11.1): guard radarStore setViewport against non-finite values
user_smoke_result: |
  After landing the defensive guards, user re-ran the Tauri dev build and
  confirmed: zoom-in no longer blanks the canvas at any zoom level. Once
  already zoomed in, both zoom-in and zoom-out feel smooth. The previously
  100%-reproducible blanking is gone. Option B was the right call —
  root cause WAS NaN/Infinity state corruption.
remaining_items_for_future_sessions:
  - "Cold-boot: app stuck on 'building graph' until user pauses+resumes pipeline monitoring. Separate debug session (opened immediately after this one closes)."
  - "Zoom-in-from-fully-zoomed-out feels laggy (not blanking). Candidates: hull-cache tier-gating rebuilds cluster at low zoom; 0.1 zoom-bucket granularity churnier at low zoom. Track as Phase 11.2 perf followup — run [RadarPerf] p95 log to confirm branch."
  - "Store/hook viewport desync: AgentManifestRow + RadarMinimap write directly to store.setViewport but hook state is one-way. Flagged during investigation; separate /gsd-quick."
---

## Current Focus

hypothesis: |
  Initial three candidate seeds (viewport math overflow, Float32Array NaN,
  stuck dirty flag) were investigated via direct code review + unit tests.

  HYPOTHESIS #1 (clamp-order overflow) — FALSIFIED by code + tests.
  The wheel handler at src/hooks/useCanvasZoomPan.ts:43-59 applies the
  clamp BEFORE deriving `scale` and recomputing tx/ty. The clamped newZoom
  is the divisor. At deltaY=-100000 (far beyond any real wheel), factor
  overflows long before reaching Infinity; at deltaY=-2_000_000 factor
  would be Infinity but newZoom clamps to 20 cleanly and scale = 20/vp.zoom
  stays finite. Tests in src/hooks/__tests__/useCanvasZoomPan.test.ts
  (added this session) confirm: 20 aggressive events at deltaY=-5000 each
  keep zoom ≤ 20, panX/panY finite. Direct pan after zoom produces
  correct deltas.

  HYPOTHESIS #2 (Float32Array → Infinity via transform) — NOT FALSIFIED
  but no path found from worker positions into a non-finite viewport.
  Worker-delivered Float32Array positions are consumed as-is in
  RadarCanvas.tsx:632-637 for rendering; they feed ctx.arc()/ctx.moveTo()
  only — never into viewport math. If a worker tick produced NaN, the
  canvas would render nothing for those nodes but the VIEWPORT TRANSFORM
  itself would remain valid — main canvas still has SOME scaffolding
  (folder hulls), minimap still has its non-tick-driven bbox. Symptoms
  don't match.

  HYPOTHESIS #3 (stuck dirty flag) — FALSIFIED.
  Dirty flag re-trips on EVERY viewport change (RadarCanvas.tsx:401-417).
  Pan, zoom-out, and force-edit ALL mutate viewport or graphNodes →
  all set dirty=true. User reports none of these recover. → dirty-flag
  stuck hypothesis is inconsistent with the recovery-failure evidence.

  CONVERGED INFERENCE (strongest but unverified):
  "Pan doesn't recover, zoom-out doesn't recover, force-edit doesn't
  recover" → viewport state is CORRUPT to NaN/Infinity. NaN+dx=NaN,
  NaN*factor=NaN, min(20, max(0.05, NaN))=NaN. Self-perpetuating.
  BUT: no path from valid input → NaN viewport was found through
  direct code review or unit tests of the hook. This is the gap.

  Remaining untested paths:
  (a) WebKitGTK-specific wheel event delivering NaN/-0/Infinity deltaY
      under pinch-to-zoom or rapid-scroll gestures (environment
      behavior not reproducible under vitest/jsdom).
  (b) A store → hook divergence: AgentManifestRow.tsx:75-79 and
      RadarMinimap.tsx:149-152 BOTH call the STORE's setViewport, but
      the hook's LOCAL viewport state does NOT observe store mutations.
      Hook's writeback at RadarCanvas.tsx:277-279 only pushes LOCAL → STORE;
      there is no STORE → LOCAL sync. If these two ever disagree, the
      minimap (reads store) and main canvas (reads hook via ref) render
      inconsistent frames. Not blanking, but a divergence worth flagging.
  (c) User interpretation: "minimap also blank" may mean "minimap rect
      became invisible (too small)" rather than "all node dots gone."
      At zoom=20 with bbox spanning ±500 world-units, the viewport
      rectangle on the 160×120 minimap is ~6×6 px. Still visible but
      possibly perceived as "gone."

test: |
  Run in a live Tauri dev build with `radarPerfDebug=1`:
  1. Open DevTools console BEFORE the zoom.
  2. `console.log(useRadarStore.getState().viewport)` — baseline.
  3. One hard wheel-scroll zoom in.
  4. Re-read viewport. Expect one of:
     (a) finite {zoom: ≤20, panX: finite, panY: finite} — state is
         fine, rendering is failing elsewhere (WebKitGTK / Canvas2D).
     (b) non-finite values (NaN or ±Infinity) — state corruption,
         need to locate the injection path.
  5. Also capture: simNodesRef.current.positions (sample 3 values),
     isSimulatingRef.current, and the `[RadarPerf] p95=...` log.

expecting: |
  Given my unit tests prove the wheel handler produces finite output,
  the expected finding at repro is either (a) finite viewport (pointing
  to WebKitGTK render failure — environment bug) or (b) proof the
  corruption enters from outside the hook (worker, file-watcher-driven
  fetchGraph interleave, etc.).

next_action: |
  BLOCKED on user action. Options presented at the end of this file.
  Without live repro access, deeper investigation is guessing.

## Symptoms

expected: |
  Wheel-scrolling to high zoom magnifies the graph — nodes get bigger,
  fewer are visible (outside viewport), but at least some remain rendered.
  Minimap continues to show the full graph with a viewport-rect indicating
  the zoomed region. Zooming back out restores the full view.

actual: |
  One hard wheel-scroll toward zoom-in (zoom-way-in direction) blanks the
  ENTIRE main canvas AND the minimap simultaneously. Nothing renders.
  No recovery: zooming back out, panning, or adjusting force-simulation
  values does not restore the canvas. State appears stuck. Full reload
  not yet tested as recovery path (implicitly works since app is usable
  on cold boot).

errors: |
  No console error surfaced by the user. Render loop may still be ticking
  silently (no exception) but drawing to an invalid transform or with
  positions at +/-Infinity. TBD during investigation.

reproduction: |
  1. `npm run tauri dev` (or prod Tauri build)
  2. Open the Radar view with a populated graph (any size suffices per
     user report; severity scales unknown).
  3. Wait for the worker to settle (settledAt non-null, force simulation
     quiescent).
  4. One hard/aggressive wheel-scroll upward (zoom in).
  5. Observe: main canvas + minimap go blank, stuck.

started: |
  Introduced during Phase 11.1 trajectory. The phase shipped code-complete
  (19/19 verification witnesses), then surfaced regressions in manual smoke:
    - ebfa8ab — gated hull-cache on zoom-visibility tier
    - e9d999b — reverted T1+T2 rAF coalescers (added 2-rAF latency);
      added visibilitychange dirty-trigger so canvas repaints on refocus
      (fixed a different "disappearing nodes on blur" symptom)
    - 0721102 — preserve x/y/fx/fy across fetchGraph (stray file-watcher
      event was wiping coords mid-zoom, blanking canvas+minimap until
      worker re-settled)
  The current "extreme zoom blanks canvas" is NOT the same as 0721102 —
  that one was file-watcher-triggered and self-recovered on re-settle.
  This one is wheel-triggered and does not self-recover.

## Eliminated

- H1 (clamp-order or Math.pow overflow in wheel handler) — code review of
  src/hooks/useCanvasZoomPan.ts:43-59 + 5 unit tests at
  src/hooks/__tests__/useCanvasZoomPan.test.ts. Handler produces finite
  {zoom ∈ [0.05, 20], panX, panY} for deltaY up to -100000 and 20 consecutive
  aggressive events.
- H3 (stuck dirty flag) — RadarCanvas.tsx:401-417 re-trips dirty on EVERY
  viewport mutation. Pan, zoom-out, and force-edit all write viewport or
  graphNodes → dirty resets. If dirty were stuck, zoom-out would fix it
  (new viewport value → new dirty). User reports it does not.
- Stale hullCache entries — code review of hullCache.ts:72-116 shows cache
  epoch is `${settledAt}|${zoomBucket}`; bucket change invalidates. Bug
  possible at tier boundaries (zoom ~1.99 vs 2.01 caches differ in depth
  filter) but would cause MISSING hulls, not blanking.

## Evidence

- timestamp: 2026-04-21T15:27:54Z
  kind: test_result
  source: src/hooks/__tests__/useCanvasZoomPan.test.ts (new, 5 tests, all pass)
  finding: |
    Wheel handler produces finite viewport across the full input range
    users could plausibly generate. Zoom clamps correctly. Pan recovers
    correctly after zoom. Zoom-out from MAX_ZOOM works.

- timestamp: 2026-04-21T15:30:00Z
  kind: code_review
  source: src/views/Radar/RadarCanvas.tsx:556-763 (rAF render loop)
  finding: |
    Render loop reads vp=viewportRef.current each frame. viewportRef is
    updated via useEffect[viewport]. ctx.setTransform silently ignores
    non-finite args (Canvas2D spec), so a NaN zoom would freeze the
    transform at its previous value and drawing would continue with
    stale transform. Would NOT blank the canvas — would render at the
    LAST-VALID zoom instead. User reports total blanking, which is
    inconsistent with this path alone.

- timestamp: 2026-04-21T15:31:00Z
  kind: code_review
  source: src/views/Radar/RadarMinimap.tsx:70-129 (minimap render effect)
  finding: |
    Minimap renders node dots from store.graphNodes (NOT viewport-dependent).
    Only the VIEWPORT RECTANGLE depends on viewport; dots are purely
    bbox-based. For the minimap to truly blank (no dots), graphNodes
    must be empty or all x/y undefined. That's the failure mode commit
    0721102 already fixed for the fetchGraph path. Current wheel-triggered
    path does NOT mutate graphNodes. So minimap should NOT blank from
    wheel alone.

- timestamp: 2026-04-21T15:32:00Z
  kind: code_review
  source: src/views/Radar/AgentManifestRow.tsx:75-79, src/views/Radar/RadarMinimap.tsx:149-152
  finding: |
    Both call STORE.setViewport directly. The useCanvasZoomPan hook's
    LOCAL viewport state does NOT observe store mutations. This means
    a manifest click or minimap click can desync hook.local vs store —
    minimap reads store, main canvas reads hook. POTENTIAL secondary
    bug, not the blanking bug. Flagged for future fix.

## Resolution

strategy: |
  Option B — defensive guard fix without diagnosis. User selected this path
  at the checkpoint because the three remaining hypotheses (NaN propagation
  via WebKitGTK path, Canvas2D transform-scale failure, user-perception
  ambiguity) each required live Tauri repro to disambiguate, and the fix
  cost is small. The guard covers ALL non-finite injection paths, whether
  we found them or not. If the real cause was (2) or (3), the symptom will
  persist and we'll know to pivot. If it was (1), the blanking is fixed.

root_cause: |
  Unknown. Converged inference from the "recovery-proof" signature (pan,
  zoom-out, force-edit all fail to restore the canvas) strongly suggests
  NaN or ±Infinity state corruption — NaN+x=NaN, min(a,max(b,NaN))=NaN,
  ctx.setTransform(NaN, …) silently no-ops. No injection path from
  valid input to non-finite viewport was found via code review or unit
  tests of the exposed surface. Candidate (untested) paths: WebKitGTK
  wheel event delivering non-finite deltaY under pinch or rapid-scroll
  gestures; an external store.setViewport caller (AgentManifestRow,
  RadarMinimap) passing corrupt coords under some edge case.

fix: |
  Defense-in-depth at both viewport mutation boundaries:

  1. Hook (src/hooks/useCanvasZoomPan.ts): wrapped the exposed setViewport
     through a `sanitizeViewport(next, prev)` helper that returns the
     PREVIOUS value for any axis whose incoming value is not finite, and
     reapplies the [MIN_ZOOM, MAX_ZOOM] clamp as a belt-and-braces check.
     Wraps both imperative callers (onWheel, onMouseMove) and any
     external caller that holds the returned setter.

  2. Store (src/stores/radarStore.ts): setViewport filters non-finite
     fields from the incoming partial, falling back to the current store
     value. This covers AgentManifestRow and RadarMinimap call sites that
     bypass the hook entirely. Store does NOT clamp zoom (that's the
     hook's single-source-of-truth concern).

  The defensive invariants are locked by 7 new tests (3 hook, 4 store):
  NaN-zoom falls back, Infinity-pan falls back per-axis, finite-but-out-
  of-range zoom clamps, legitimate zeros/negatives pass through,
  partial-valid-partial-NaN applies only the valid fields.

verification: |
  - npx tsc --noEmit: exit 0, clean
  - npx vitest run src/hooks src/stores src/views/Radar: 246/250 pass
    (1 pre-existing HeatMapOverlay #0f1a0e vs #1a1919 theme-drift
    failure documented in Phase 11 deferred-items.md; 3 todo markers)
  - Three atomic commits landed on main: 6878f48, 7b13735, 383ca24

  PENDING USER MANUAL SMOKE (the only definitive acceptance):
    1. npm run tauri dev
    2. Open Radar view, wait for settle
    3. One hard wheel-scroll toward zoom-in (the previously-failing gesture)
    4. Expect: canvas stays rendered; nodes still visible; minimap
       still shows bbox + viewport rect
  If the canvas still blanks after this, the root cause is NOT NaN
  propagation — it's either WebKitGTK transform-scale or user perception,
  and this fix is inert. Reopen and pivot to those branches.

  Optional diagnostic (no longer strictly necessary now that the guard
  is in): `localStorage.setItem('radarPerfDebug','1'); location.reload()`
  then reproduce — [RadarPerf] log should continue emitting across the
  zoom, proving the render loop is still alive.

files_changed:
  - src/hooks/useCanvasZoomPan.ts
  - src/hooks/__tests__/useCanvasZoomPan.test.ts
  - src/stores/radarStore.ts
  - src/stores/__tests__/radarStore.test.ts

secondary_finding_flagged_for_later: |
  AgentManifestRow.tsx:75-79 and RadarMinimap.tsx:149-152 write to the
  STORE's setViewport, but useCanvasZoomPan's LOCAL viewport state does
  not subscribe to store mutations. Hook → store sync is one-way. A
  click on a manifest row or minimap can desync main canvas (reads hook
  via viewportRef) from minimap (reads store) until the next wheel
  event resyncs. Not the blanking bug — worth a separate fix as
  Phase 11.2 or a /gsd-quick task.
