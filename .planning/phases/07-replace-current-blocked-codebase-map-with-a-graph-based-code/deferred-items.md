# Deferred items (Phase 7)

## From Plan 06

### Pre-existing TS errors in src/bindings.ts (from Plan 09-01 scaffold)

- `src/bindings.ts(695,26): error TS6133: 'TSend' is declared but its value is never read.`
- `src/bindings.ts(706,2): error TS2440: Import declaration conflicts with local declaration of 'TAURI_CHANNEL'.`
- `src/bindings.ts(727,10): error TS6133: '__makeEvents__' is declared but its value is never read.`

These conflicts were introduced in commit `188a80c` (Plan 09-01 Wave 0 scaffold) and are not
caused by this plan's changes. They break `npm run build` but not `npm test`. Defer to Plan 09
owner or a dedicated `/gsd-quick` cleanup.

### Pre-existing Rust test failures in conflict::engine

- `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
- `conflict::engine::tests::test_custom_window_duration`

`src-tauri/src/conflict/engine.rs` was last modified in commit `ec769ba` (Plan 03 fix).
Plan 06 does not touch Rust code — these failures are unrelated. 179 Rust tests still pass.
Flag for a dedicated debug pass.

### Pre-existing failure: src/stores/__tests__/agentStore.test.ts launchAgent call
- The mock `launch_agent` invocation now includes `options: null` that the test does not expect.
- Noted as acceptable in Plan 06 success criteria and from Plan 05 summary.
