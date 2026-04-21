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

## 12-03 (Wave 2)

### D-03: Pre-existing cargo build failure from Phase 17-03 scaffolding — RESOLVED 2026-04-21

- **Status:** RESOLVED via Phase 17 Plan 01 merge (commits `c02211c` + `5d9d279`,
  merged into main as `cf9dcff chore: merge Phase 17 Plan 01 executor worktree`).
  `src-tauri/src/agents/bash_paths.rs` now exists as a full 21KB implementation
  (verb dispatch + operator split + safelist + extract_target_paths). Phase 12
  Plan 03 Task 1 verification re-run 2026-04-21: `cargo build --lib` exits 0
  (13 pre-existing Phase 17 dead-code warnings, no errors); `cargo test --lib
  pipeline::ipc_bridges` = 17/17 passed; `cargo test --lib pipeline::commands`
  = 7/7 passed (including new V-12-13 `get_ipc_bridges_smoke_v_12_13`).
- **Discovered:** `cargo build --lib` during Plan 12-03 Task 1 verification.
- **Failing compile:**
  ```
  error[E0583]: file not found for module `bash_paths`
    --> src/agents/mod.rs:17:1
     |
  17 | pub mod bash_paths;
     | ^^^^^^^^^^^^^^^^^^^
  ```
- **Verification of pre-existence:** Stashed Plan 12-03 Task 1 edits and ran
  `cargo build --lib` on the clean tip (commit `eacf952`) — same failure
  reproduces. The introducing commit (`0e603fc feat(17-03): register
  bash_paths module in agents/mod.rs`) explicitly states in its message:
  *"cargo check will fail until Plan 01 lands bash_paths.rs — intentional
  Wave 1 scaffolding sequence. The module file is owned by Plan 01; this
  plan only wires the module-index entry."*
- **Scope:** Phase 17 (conflict-triggered PreToolUse gating) ownership. Phase
  17 Plan 01 owns `src-tauri/src/agents/bash_paths.rs` and is unexecuted on
  main. Phase 17-03 landed the module index entry before Phase 17-01 landed
  the file itself — an inverted Wave ordering.
- **Impact on Plan 12-03:** BLOCKS verification entirely. `cargo build`,
  `cargo test --lib`, and the `cargo build --bin aitc` + brief-run bindings
  regen gate (V-12-14) all fail at the missing-module error before Phase 12
  code is ever type-checked.
- **Recommendation:** Execute Phase 17 Plan 01 (lands `bash_paths.rs` with
  `extract_target_paths` + `BashParseResult`) before Plan 12-03 verification
  can run. Alternatively, a minimum-surface-area stub — `pub fn
  extract_target_paths(_cmd: &str, _cwd: &Path) -> BashParseResult {
  BashParseResult::ParseFailed }` — would unblock Plan 12-03 without
  claiming Phase 17 scope, but that is a user decision (touches another
  phase's owned file).
- **Per memory rule "only fix own bugs":** Plan 12-03 does NOT attempt to
  create the stub. Stopped at checkpoint for user direction.

## 12-02 (Wave 1)

### D-02: Pre-existing conflict::engine test failures (2 tests)

- **Discovered:** `cargo test --lib` (full backend suite) during Plan 12-02
  Task 3 verification.
- **Failing tests (2 total in 1 file):**
  - `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
  - `conflict::engine::tests::test_custom_window_duration`
  - Both panic at `src/conflict/engine.rs:415` with
    `assertion left == right failed: Should detect conflict within 10s window`
    — received 0, expected 1.
- **Verification of pre-existence:** Stashed Plan 12-02 Task 3 changes and ran
  `cargo test --lib conflict::engine` on the clean tip (commit `4cc570b`) —
  same 2 failures reproduce. Zero causation link to Phase 12 code; the failing
  tests never touch `pipeline::ipc_bridges`.
- **Scope:** Phase 03 (conflict engine) ownership — timing-based detection
  window test likely flaky under concurrent test execution or drifted after
  a Phase-03/later-phase refactor of the window semantics.
- **Impact on Phase 12 Plan 02:** None. Scoped run on
  `pipeline::ipc_bridges::*` reports 17/17 pass (12 V-12-XX witnesses).
- **Recommendation:** Investigate under Phase 03 ownership or a dedicated
  conflict-engine flake plan. Do NOT block Plan 12-03 / 12-04 execution.
