---
phase: 06
plan: 04
subsystem: pipeline-activation
tags: [passive-bridge, session-recording, forwarder, agent-registry, wave-3]
requirements: [AGNT-03, FMON-02, HIST-01]
dependency_graph:
  requires:
    - 06-03 Wave 2 (ensure_open_session, record_session_file_internal, find_agent_by_pid, reap_passive_agents)
    - 06-02 Wave 1 (pipeline state already wired; repo-session provider mounted)
  provides:
    - spawn_passive_bridge + bridge_tick (ProcessSnapshot -> AgentRegistry bridge)
    - persist_attributed_batch (forwarder-side session_files persistence)
    - passive_sentinel_adapter (view-only GenericAdapter sentinel)
    - ProcessSnapshot::from_candidates_for_test (deterministic test seeding)
  affects:
    - src-tauri/src/pipeline/commands.rs (start_watch lifecycle; forwarder now persists)
    - src-tauri/src/pipeline/pipeline_state.rs (ActiveWatch.bridge_task + Drop abort)
tech_stack:
  added: []
  patterns:
    - "Tick-based bridge task (tokio::time::interval) that reaps first, upserts second (D-07 dedup)"
    - "Forwarder side-effect pattern: fan-out to broadcast -> persist -> forward to frontend Channel"
    - "Sentinel adapter with non-matching process_names to make passive entries view-only (06-RESEARCH.md Q1)"
key_files:
  created:
    - src-tauri/src/pipeline/passive_bridge.rs
  modified:
    - src-tauri/src/pipeline/mod.rs
    - src-tauri/src/pipeline/commands.rs
    - src-tauri/src/pipeline/pipeline_state.rs
    - src-tauri/src/pipeline/process_snapshot.rs
    - src-tauri/src/pipeline/smoke_tests.rs
    - src-tauri/src/agents/generic.rs
decisions:
  - "Used real CandidateProc (internal) rather than inventing a new Candidate struct; exposed test seed via #[cfg(test)] impl ProcessSnapshot::from_candidates_for_test"
  - "Passive sentinel built from existing GenericAdapter::from_toml with a __passive__never_matches__ pattern (no new adapter trait impl needed)"
  - "Persistence runs after broadcast fan-out but before Channel send, so a slow DB cannot stall conflict detection or the refresher"
  - "bridge_task abort added to ActiveWatch::drop; no separate stop_watch change needed since stop_watch drops the struct"
  - "Pre-existing conflict::engine test failures documented in deferred-items.md — confirmed unchanged by this plan"
metrics:
  duration: ~30m
  completed: 2026-04-14
  commits: 3
---

# Phase 06 Plan 04: Wave 3 — Passive Bridge + Session Recording Activation Summary

Activated the two new pipeline behaviors that Phase 6's foundation work had been scaffolding for: passive PID discovery (AGNT-03) wired into `start_watch`, and forwarder-side session_files persistence (HIST-01, D-09). With this plan, any allowlisted agent process running while the watch is active appears on the Tower as a `PASSIVE-{pid}` entry within one bridge tick, and every `Attribution::Pid(p)` file event is recorded against the correct `agent_sessions` row.

## What Shipped

### Task 1: `pipeline/passive_bridge.rs` module + sentinel adapter (commit `9194126`)

- New file `src-tauri/src/pipeline/passive_bridge.rs`:
  - `pub const BRIDGE_INTERVAL_MS: u64 = 2000`
  - `pub fn spawn_passive_bridge(registry, snapshot, interval) -> JoinHandle<()>` — skips the first immediate tick, then loops on `bridge_tick`
  - `pub async fn bridge_tick(registry, snapshot) -> Result<(), String>` — reap first, then upsert; skip PIDs already owned by non-PASSIVE entries
- `src-tauri/src/agents/generic.rs` grows a `passive_sentinel_adapter()` helper that wraps a `GenericAdapter` with process_names `["__passive__never_matches__"]` — view-only by construction.
- `src-tauri/src/pipeline/process_snapshot.rs` grows `#[cfg(test)] impl ProcessSnapshot::from_candidates_for_test(Vec<CandidateProc>)` so sibling modules (`passive_bridge`, `smoke_tests`) can seed deterministic candidate lists.
- `src-tauri/src/pipeline/mod.rs` registers `pub mod passive_bridge;`.
- 3 tests pass:
  - `passive_scan_bridge_upserts_passive_entries_for_live_pids`
  - `passive_scan_bridge_does_not_overwrite_kagent_with_same_pid`
  - `passive_scan_bridge_reaps_passives_whose_pids_disappear`

### Task 2: Wire `start_watch` + `persist_attributed_batch` (commit `d98af4f`)

- `start_watch` now pulls `Arc<AgentRegistry>` and `SqlitePool` into local bindings after the snapshot refresher is spawned, then spawns `passive_bridge::spawn_passive_bridge` with `BRIDGE_INTERVAL_MS`.
- Forwarder loop was extended:
  ```rust
  let _ = conflict_tx_clone.send(batch.clone());
  persist_attributed_batch(&batch, &registry_for_forwarder, &pool_for_forwarder).await;
  channel_clone.send(batch)?;
  ```
- New `pub(crate) async fn persist_attributed_batch(batch, registry, pool)`:
  - Iterates events, skips non-`Attribution::Pid(p)` variants
  - Resolves PID via `registry.find_agent_by_pid(p)`
  - Calls `ensure_open_session(agent_id, agent_type, pool)` → session_id
  - Calls `record_session_file_internal(session_id, path, pool)`
  - Every error is logged via `tracing::warn!` and skipped — never blocks frontend delivery
- `ActiveWatch` gets a `bridge_task: JoinHandle<()>` field, with `self.bridge_task.abort()` added to the `Drop` impl.
- 4 tests pass:
  - `forwarder_persist_attributed_batch_records_files_for_matched_pid` (also asserts a session row is created)
  - `forwarder_persist_attributed_batch_skips_unattributed`
  - `forwarder_persist_attributed_batch_skips_ambiguous`
  - `forwarder_persist_attributed_batch_skips_pid_with_no_registry_match`

### Task 3: Backend end-to-end smoke (commit `d5eaceb`)

- `src-tauri/src/pipeline/smoke_tests.rs` grows `bridge_populates_registry_and_records_session_file`:
  1. Build in-memory SQLite pool with Phase 6 schema subset.
  2. Seed `AgentRegistry` + a seeded `ProcessSnapshot` with `CandidateProc { pid: 4242, ... }`.
  3. Run `bridge_tick` → assert `PASSIVE-4242` appears.
  4. Build an `Attribution::Pid(4242)` batch.
  5. Call `commands::persist_attributed_batch` → assert `session_files` has 1 row joined to `agent_sessions.agent_id = "PASSIVE-4242"`.

## Verification Results

| Check | Result |
|-------|--------|
| `cargo test --lib passive_scan_bridge` | 3 passed, 0 failed |
| `cargo test --lib forwarder_persist` | 4 passed, 0 failed |
| `cargo test --lib smoke_tests::bridge_populates_registry_and_records_session_file` | 1 passed |
| `grep -c "pub fn spawn_passive_bridge" pipeline/passive_bridge.rs` | 1 |
| `grep -c "pub mod passive_bridge;" pipeline/mod.rs` | 1 |
| `grep -c "passive_sentinel_adapter" agents/generic.rs` | 2 (definition + TOML reference) |
| `grep -c "from_candidates_for_test" pipeline/process_snapshot.rs` | 1 |
| `grep -c "persist_attributed_batch" pipeline/commands.rs` | 10 (definition + forwarder call + 4 tests × 2 references) |
| `grep -c "spawn_passive_bridge" pipeline/commands.rs` | 1 |
| `grep -c "bridge_task" pipeline/commands.rs` | 2 (init + struct field) |
| `grep -c "bridge_populates_registry_and_records_session_file" pipeline/smoke_tests.rs` | 1 |

## Deviations from Plan

### Rule 3 — blocking API mismatches (auto-fixed)

The plan's pseudocode referenced struct/field names that do not exist in the real code. All substitutions preserve behavior; no intent changed.

**1. `Candidate` type does not exist — used `CandidateProc` (internal) + `ProcessInfo` (public).**
- **Found during:** Task 1 read-first of `process_snapshot.rs`
- **Issue:** Plan pseudocode imported `crate::pipeline::process_snapshot::Candidate`, but the real struct is `CandidateProc` (internal to the pipeline module) and the public accessor is `candidates() -> Vec<ProcessInfo>`.
- **Fix:** `bridge_tick` iterates the `Vec<ProcessInfo>` returned by `candidates()` directly (has `pid`, `cwd: Option<PathBuf>` which match the needs). The `#[cfg(test)]` seed helper takes `Vec<CandidateProc>` and inserts into the internal map — this is the minimal-surface-area change that works because `passive_bridge.rs` is a sibling module within `pipeline` so `#[cfg(test)]` visibility is enough.
- **Commit:** `9194126`

**2. `GenericAdapter::from_config(AgentConfig { ... })` does not exist.**
- **Found during:** Task 1 Step B
- **Issue:** Plan assumed a `from_config` constructor with an `AgentConfig { name, process_matcher, launch_command, .. }` shape that does not match the real `GenericAgentConfig` (fields `name`, `process_names`, `launch_command: String`, `launch_args: Vec<String>`, …) and `from_toml` constructor.
- **Fix:** `passive_sentinel_adapter()` builds a minimal TOML string and calls `GenericAdapter::from_toml(...)`. Intent preserved — a `GenericAdapter` keyed by name `"passive-scan"` with a process-names pattern that never matches any real process.
- **Commit:** `9194126`

**3. `use crate::agents::AgentInfo` (not `adapter::AgentInfo`) in one place.**
- **Found during:** Task 2 import resolution
- **Issue:** Minor — two valid paths exist. Chose to `use crate::agents::{AgentRegistry, AgentState}` in `commands.rs` for consistency with the rest of that file.
- **Commit:** `d98af4f`

No Rule 1 (bug) or Rule 2 (missing critical functionality) triggers. No Rule 4 (architectural change) triggers — all substitutions are local and preserve the plan's data flow and threat mitigations.

## Authentication Gates

None.

## Known Stubs

None introduced by this plan. Wave 0 scaffolding stubs (in `tests/common/mod.rs`) remain and are resolved by Plan 05 per 06-01 SUMMARY.

## Deferred Issues

**Pre-existing conflict::engine test failures** (out of scope — NOT caused by Plan 04):
- `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
- `conflict::engine::tests::test_custom_window_duration`

Verified by `git stash` on the worktree and rerunning `cargo test --lib conflict::engine::tests::test_conflict_detected_different_pids_within_window` at the Wave 2 base (fff9d235): both still fail. Logged in `.planning/phases/06-pipeline-activation-integration-wiring/deferred-items.md` for a future regression plan. Per the GSD scope-boundary rule, these are outside this plan's blast radius — `passive_bridge.rs` and `persist_attributed_batch` both pass all their own tests and none of the Phase 6 integration paths touch conflict/engine.rs.

## Threat Flags

No new security-relevant surface beyond what the plan's `<threat_model>` already catalogues.

- T-06-04-01 (name spoof) — accepted; inherited from Phase 2 allowlist.
- T-06-04-02 (session_files path tampering) — mitigated; all paths come from `notify`-reported events inside the canonicalised `repo_root`, stored via sqlx `.bind()`.
- T-06-04-03 (registry DoS via PID churn) — mitigated; reap runs before upsert each tick; MAX_AGENTS cap in registry; 2s tick cadence.
- T-06-04-04 (unbounded session rows) — mitigated; `ensure_open_session` returns existing id for any open row; `UNIQUE(session_id, file_path)` caps session_files per session.
- T-06-04-05 (repudiation) — accepted; informational, not an audit log.
- T-06-04-06 (cwd leak) — accepted; single-user scope.
- T-06-04-07 (passive privilege escalation) — mitigated; `passive_sentinel_adapter` uses a never-matching process-names pattern, and `terminate` via the sentinel has no reliable effect (UI already disables terminate for `agent_type == "unknown"` per Q1 resolution).

## Commits

- `9194126` — feat(06-04): add passive_bridge ProcessSnapshot -> AgentRegistry (AGNT-03, D-06, D-07)
- `d98af4f` — feat(06-04): wire passive_bridge + session-file forwarder into start_watch (D-09, HIST-01)
- `d5eaceb` — test(06-04): add end-to-end backend smoke chaining bridge + forwarder persist

## Self-Check: PASSED

- FOUND: src-tauri/src/pipeline/passive_bridge.rs (creates spawn_passive_bridge + 3 tests)
- FOUND: src-tauri/src/pipeline/commands.rs (persist_attributed_batch + bridge_task wiring + 4 tests)
- FOUND: src-tauri/src/pipeline/pipeline_state.rs (bridge_task field + Drop abort)
- FOUND: src-tauri/src/pipeline/smoke_tests.rs (bridge_populates smoke)
- FOUND: src-tauri/src/agents/generic.rs (passive_sentinel_adapter)
- FOUND: src-tauri/src/pipeline/process_snapshot.rs (from_candidates_for_test)
- FOUND: src-tauri/src/pipeline/mod.rs (pub mod passive_bridge;)
- FOUND: commit 9194126
- FOUND: commit d98af4f
- FOUND: commit d5eaceb
