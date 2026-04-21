# Phase 18 Deferred Items

Out-of-scope issues discovered during execution. Logged for future phases
per MEMORY.md ("Only fix own bugs") and the GSD executor SCOPE BOUNDARY.

## Pre-existing bugs in `src-tauri/src/conflict/engine.rs`

**Discovered during:** Phase 18-01 execution (full `cargo test --lib` post-check).

**Failing tests:**
- `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
- `conflict::engine::tests::test_custom_window_duration`

**Symptom:** Both tests assert `alerts.len() == 1` after processing two
writes with fixed synthetic `timestamp_ms` values (e.g., 1000 then 3000).
They actually get 0 alerts.

**Root cause:** Commit `ec769ba` ("fix(03): WR-01 evict stale conflict
records using wall-clock time in process_batch") changed the eviction
logic to use wall-clock time. The tests seed events at `timestamp_ms =
1000` (1s since Unix epoch in the test's integer model), but the engine's
current wall-clock "now" is billions of ms into the year 2026 — well
outside any sane window — so the first event is evicted before the
second event can conflict with it.

**Why deferred:** Not caused by Phase 18 changes. Phase 18's scope is
`src-tauri/src/pipeline/passive_bridge.rs` only; `conflict/engine.rs`
has been broken since commit `ec769ba` (pre-dates Phase 18). Per
MEMORY.md, only fix bugs caused by current-session work.

**Proof it's not mine:**
- `git diff --name-only 7355a3f^..HEAD` shows only `passive_bridge.rs`
  was modified in this plan's commits.
- `git log --oneline src-tauri/src/conflict/engine.rs` shows last
  touch was `ec769ba`, predating Phase 18.

**Recommended fix (for a future phase):** Either (a) revert to
event-timestamp-based eviction in `ConflictEngine::process_batch`, or
(b) update the tests to use wall-clock-relative timestamps (e.g., seed
events at `now_ms - 2000` and `now_ms`). Option (b) is probably
preferred since the WR-01 fix was intentional for live operation.

All 12 `pipeline::passive_bridge::tests` pass (7 existing + 5 new).
All 9 `agents::registry::tests` pass. Phase 18-01's own work has zero
regressions.
