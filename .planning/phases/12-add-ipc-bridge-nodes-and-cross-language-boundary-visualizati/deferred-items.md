# Phase 12 — Deferred Items

Pre-existing issues surfaced during Phase 12 execution but out of scope per
"only fix own bugs" memory rule. Each entry names the discovering plan.

## 12-01 (Wave 0)

### D-01: Pre-existing vitest failures (4 total across 3 files)

- **Discovered:** `npm run test -- --run` full-suite run during Plan 12-01
  Task 2 verification.
- **Failing tests (4 total across 3 files):**
  - `src/views/Radar/__tests__/HeatMapOverlay.test.ts` —
    `heatTintForNode(0) returns the default surface-container color (#1a1919)`
    — received `#0f1a0e`. Expectation drift.
  - `src/__tests__/arsenal/MasterDetailShell.test.tsx` — `rail region has
    w-[220px] shrink-0 classes` (L36) and `detail region has 2xl:w-[520px]
    xl:w-[480px] shrink-0 classes` (L49). Tailwind v4 arbitrary-value class
    drift.
  - `src/hooks/__tests__/useGraphLayout.test.ts > posts pin/unpin when
    pinnedNodeIds Set diff changes` — passes 13/13 in isolation; surfaces
    only in full-suite concurrent vitest pool (known flake per Phase 19 D-04).
- **Verification of pre-existence:** All four failures are already documented
  in
  `.planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md`
  D-02 (HeatMap + MasterDetailShell x2) and D-04 (useGraphLayout flake). Both
  predate Phase 12 work; Phase 12 Plan 01 creates only new test files + a new
  module + test fixtures and appends `.todo` blocks to existing tests without
  touching the failing code paths (HeatMapOverlay, MasterDetailShell, or the
  Phase-11 worker mock).
- **Scope:** Unrelated to Phase 12 — all three failing files live in Phase
  06/07 (HeatMap), app shell (MasterDetail), or Phase 11 (Radar worker).
- **Impact on Phase 12 Plan 01:** None. Scoped run on the seven files this
  plan touches/creates (forceBoundary + 4 new Bridge*.test.* + radarStore +
  useGraphLayout) reports `2 passed | 5 skipped | 40 passed | 44 todo` with
  zero Phase 12 failures.
- **Recommendation:** Follow Phase 19 D-02 + D-04 recommendations — file as
  quick-tasks or Phase-11 flake remediation. Do NOT let them block Phase 12
  Wave 1/2/3 execution.
