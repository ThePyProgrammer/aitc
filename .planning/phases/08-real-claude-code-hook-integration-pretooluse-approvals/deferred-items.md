# Phase 8 — Deferred Items (out-of-scope findings)

Items discovered while executing Phase 8 that are outside this phase's scope.

## Plan 08-01 (2026-04-15)

### 1. `aitc` lib test build broken by Phase 9 Plan 1 scaffolding

- **Symptom:** `cargo test --lib ...` fails with:
  ```
  error[E0583]: file not found for module `fixtures`
   --> src/claude_resources/mod.rs:25:1
     |
  25 | pub mod fixtures;
  ```
- **Root cause:** Commit `291acb4 feat(09-01): scaffold claude_resources module + add backend deps` declares `#[cfg(test)] pub mod fixtures;` but does not create `src/claude_resources/fixtures.rs` or `src/claude_resources/fixtures/mod.rs`.
- **Scope:** Pre-existing on the worktree base commit; not introduced by Plan 08-01.
- **Workaround used in Plan 08-01:** Verified Plan 08-01 stubs compile via `cargo check --workspace` (lib-only, not `--tests`). Could not run `cargo test --lib agents::hook_waiters ...` directly. The sidecar crate `aitc-hook` tests run cleanly (verified RED state).
- **Owner:** Phase 9 — to be addressed by Phase 9 Plan 2 (which introduces the fixtures module) or a targeted fix to un-gate the empty module declaration.

### 2. Pre-existing `tsc --noEmit` errors in `src/views/Radar/forceCluster.ts` + its tests

- **Symptom:** `npx tsc --noEmit` reports 59 errors rooted in `d3-force` typings and `ClusterNode` missing `x`/`y`/`vx`/`vy` simulation fields.
- **Scope:** Pre-existing (63 errors on base commit `fb5d5a9`, reduced to 59 after Plan 08-01 which adds zero errors).
- **Owner:** Phase 7 — Plan 07-05 introduced the `forceCluster` module; fixing the d3-force typings is out of scope for Phase 8.

## Plan 08-02 (2026-04-15)

### 4. Pre-existing `conflict::engine` test failures

- **Symptom:** `cargo test --lib` reports 2 failing tests:
  - `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
  - `conflict::engine::tests::test_custom_window_duration`
- **Root cause:** Tests assert `left == right` with `left: 0, right: 1` at `src/conflict/engine.rs:415`. The engine's window-tracking logic does not detect conflicts in the narrow window cases.
- **Scope:** Pre-existing on the worktree base commit `925cff3`. Reproduced with `git stash` isolating Plan 08-02 changes — failures persist on unmodified base. Not introduced by Plan 08-02.
- **Owner:** Phase 3 — `conflict::engine` is Phase 3 territory; Phase 8 does not touch this module.

### 5. `create_approval_request_persists_tool_fields` unit test replaced by map-row coverage

- **Symptom:** Plan 08-02 Task 1 specifies a unit test calling `create_approval_request_internal` directly to assert DB round-trip of `tool_name` / `tool_input_json` / `session_id`.
- **Root cause:** `create_approval_request_internal` takes a `&tauri::AppHandle`, which requires a Tauri MockRuntime fixture that is not available in this codebase (no MockRuntime plumbing exists anywhere in `src-tauri/src`).
- **Workaround used in Plan 08-02:** Added two `map_approval_row` unit tests (`map_approval_row_populates_phase8_fields`, `map_approval_row_defaults_phase8_fields_to_none`) that exercise the SELECT direction of the round-trip on an in-memory pool. The INSERT direction is exercised by the integration tests in Task 2 (`hook_gates_edit_and_blocks_until_approved`) and Task 3 (`hook_approve_resolves_handler`), which go through `create_approval_request_internal` against a real AppHandle via `tauri::test::mock_app`.
- **Owner:** Phase 8 Plan 02 — documented here for traceability; acceptance criteria in the plan ("tool_name/tool_input_json/session_id round-trip through DB") is met by the integration smokes even though the specific unit-test name differs.

### 3. Non-root `[profile.release]` in `aitc-hook/Cargo.toml` ignored

- **Symptom:** `cargo check --workspace` emits:
  ```
  warning: profiles for the non root package will be ignored, specify profiles at the workspace root
  ```
- **Scope:** Plan 08-01 explicitly specifies the profile block in `aitc-hook/Cargo.toml`. Moving it to the workspace root is a structural change that could affect other crates' release builds.
- **Disposition:** Leave as-is for Wave 0 (profile is effectively a no-op, not breaking). A later plan (08-04 or bundle prep) can migrate the release profile to the workspace root once multiple release profiles are needed.
