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

