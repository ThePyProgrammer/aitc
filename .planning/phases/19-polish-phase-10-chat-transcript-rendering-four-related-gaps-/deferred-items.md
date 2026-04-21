# Phase 19 — Deferred Items

Pre-existing issues surfaced during Phase 19 execution but out of scope per
"only fix own bugs" memory rule. Each entry names the discovering plan.

## 19-01 (Wave 0)

### D-01: `tests/end_to_end_smoke.rs` missing `LaunchOptions.agent_id` + `aitc_port`

- **Discovered:** `cargo check --tests` during Task 2 verification.
- **File:** `src-tauri/tests/end_to_end_smoke.rs` (L586, L611, L628).
- **Error:** `E0063: missing fields `agent_id` and `aitc_port` in initializer of `LaunchOptions``
- **Root cause:** Phase 10 Plan 04 widened the `LaunchOptions` struct (STATE.md
  entry: "Plan 04: LaunchOptions.agent_id minted UP FRONT via uuid::Uuid::new_v4()"),
  but `end_to_end_smoke.rs` wasn't updated in the same commit. Also an `E0061`
  arg-count error on the same struct construction site.
- **Scope:** NOT introduced by Phase 19 work (my Task 2 only added 3 JSONL
  fixture files under `tests/fixtures/stream_json/` — no Rust source touched).
- **Impact on Phase 19:** None. Lib tests (`cargo test --lib`) compile and run
  clean — that is the surface Wave 1 (Plan 02) will exercise. The broken
  integration test binary is a separate target.
- **Recommendation:** File as a standalone quick-task or pick up in a future
  Phase-10 follow-up plan; supply the two missing fields and re-run the smoke.
  Not urgent — CI hasn't been gating on it.

### D-02: Pre-existing vitest failures (HeatMapOverlay + MasterDetailShell)

- **Discovered:** `npm run test` full-suite run during Task 3 verification.
- **Failing tests (3 total across 2 files):**
  - `src/views/Radar/__tests__/HeatMapOverlay.test.ts` — `heatTintForNode(0)
    returns the default surface-container color (#1a1919)` — received
    `#0f1a0e`. Test expectation drift against current implementation.
  - `src/__tests__/arsenal/MasterDetailShell.test.tsx` — `rail region has
    w-[220px] shrink-0 classes` and `detail region has 2xl:w-[520px]
    xl:w-[480px] shrink-0 classes`. Tailwind v4 arbitrary-value class
    formatting drift (likely related to the typography plugin install
    side-effect on class generation) or pre-existing selector mismatch.
- **Verification of pre-existence:** Two-layer check:
  1. Stashed Task 3 changes → ran on HEAD (commit 566c247, post-Task-2).
     Identical 3 failures reproduced.
  2. Checked out commit 2c5b54d (BEFORE Task 1 — pre-typography-plugin
     install). Same 3 failures reproduced. Rules out the `@plugin
     "@tailwindcss/typography"` wiring as a cause.
  Confirmed NOT introduced by any Plan 19-01 work.
- **Scope:** Unrelated to Phase 19 (HeatMap is Phase 06 radar; MasterDetail
  is app shell — neither consumes markdown or chat code).
- **Impact on Phase 19:** None — Plan 19-01's two targeted test files
  (MarkdownBody + chatStore) both pass (`Test Files 1 passed | 1 skipped`,
  `Tests 21 passed | 10 todo`).
- **Recommendation:** File as a quick-task; both look like expectation drift
  after upstream changes (e.g., HeatMapOverlay was likely re-tuned without
  updating the default-tint test). Two-minute fixes.

## 19-02 (Wave 1)

### D-03: Pre-existing `conflict::engine::tests` failures

- **Discovered:** `cargo test --lib` full-suite run during Plan 19-02
  verification.
- **Failing tests (2 total in one file):**
  - `src-tauri/src/conflict/engine.rs::tests::test_conflict_detected_different_pids_within_window`
  - `src-tauri/src/conflict/engine.rs::tests::test_custom_window_duration`
  - Both assert `left == right` failures (got `0`, expected `1`) —
    "Should detect conflict within 10s window". Looks like a timing /
    window-computation bug in the engine, unrelated to chat_runtime.
- **Verification of pre-existence:** `git stash` + `cargo test --lib
  conflict::engine::tests` on commit `339549d` (Plan 19-02 refactor
  commit, before test additions). Same 2 failures reproduce. Confirmed
  NOT introduced by any Plan 19-02 work (Plan 19-02 touches only
  `src-tauri/src/chat_runtime/parser.rs`; `conflict::engine` is a
  separate module).
- **Scope:** Unrelated to Phase 19 (conflict engine is Phase 03 scope).
- **Impact on Phase 19:** None — `cargo test --lib chat_runtime::parser::tests`
  exits 0 with 17 passed, which is the surface Plan 19-02 owns.
- **Recommendation:** File as a quick-task or Phase-03 follow-up; the
  engine's conflict-window predicate or test setup looks stale.

## 19-03 (Wave 2)

### D-04: Flaky `useGraphLayout.test.ts` "posts pin/unpin" test under full-suite load

- **Discovered:** `npm run test` full-suite run during Plan 19-03 Task 3
  verification.
- **Failing test:** `src/hooks/__tests__/useGraphLayout.test.ts > useGraphLayout
  — Phase 11 Worker client > posts pin/unpin when pinnedNodeIds Set diff
  changes`. Timeout/race during 6168ms run (see stack trace in
  `MockWorker.postMessage` → zustand `setState` → Set iteration).
- **Verification of pre-existence / non-causation:**
  1. `git stash` → `npm run test -- src/hooks/__tests__/useGraphLayout.test.ts`
     in isolation → **13/13 passed** (commit `dce6c43`, Plan 19-03 Task 2).
  2. Re-ran in isolation WITH Plan 19-03 Task 3 changes applied → **13/13
     passed** (same file, same command, 9.64s total).
  3. Failure only manifests inside the full-suite run (concurrent vitest
     pool of 65 files) — classic resource-contention flake on the Phase-11
     D3 worker mock. Plan 19-03 touches ZERO files under `src/hooks/` or
     `src/views/Radar/` — the only overlap is shared vitest pool pressure.
- **Scope:** Unrelated to Phase 19 (Phase 11 Radar graph worker).
- **Impact on Phase 19:** None — Plan 19-03's targeted suites
  (`MarkdownBody.test.tsx` 7/7, `AssistantTextCard.test.tsx` 6/6) pass in
  isolation AND as part of the full suite.
- **Recommendation:** File as a Phase-11 flake; either add an explicit
  timeout override on the pin/unpin test or stabilize MockWorker
  message-ordering assumptions. Not a blocker.

