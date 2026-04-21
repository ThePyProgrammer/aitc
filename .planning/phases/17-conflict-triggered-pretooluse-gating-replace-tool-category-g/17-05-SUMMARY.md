---
phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g
plan: 05
subsystem: api
tags: [rust, tauri, axum, hook, conflict-engine, phase17, gating, approval-workflow]

# Dependency graph
requires:
  - phase: 17-01
    provides: agents::bash_paths::extract_target_paths + BashParseResult (Safelisted | Targets | ParseFailed)
  - phase: 17-02
    provides: ConflictEngine::could_conflict_with + conflict::canonicalize::canonicalize_for_conflict + GateReason enum
  - phase: 17-03
    provides: migration 007 (conflict_with_agent_id + gate_reason columns; pretool_gated_tools emptied)
  - phase: 17-04
    provides: Arc<tokio::sync::Mutex<ConflictEngine>> threaded through build_router / start_registration_server / spawn_hook_server as a 5-tuple; hook_handler Extension<Arc<…>> already plumbed; ConflictState seeded on the mock AppHandle in tests
provides:
  - hook_handler gate-decision branch rewritten from tool-category allowlist to file-conflict predicate (D-18)
  - resolve_or_create_agent split into outer-wrapper + inner-resolver; D-15b wire-up calls engine.lock().await.update_pid_mapping(pid, agent_id.clone()) after resolution
  - create_approval_request_internal signature +2 params (conflict_with_agent_id, gate_reason) + INSERT/RETURNING column list extended
  - map_approval_row reads the two new columns via try_get(...).ok().flatten()
  - dispatch_approval_notification payload +1 param (conflict_agent_id); body prefixes `⚠ CONFLICT: ` when Some (D-23)
  - ApprovalRequest struct +2 Option<String> fields (conflict_with_agent_id, gate_reason); serde rename_all="camelCase" auto-maps to conflictWithAgentId + gateReason at the JSON boundary
  - Tracing contract emitted per VALIDATION: kind="hook_gate" (info), kind="hook_allow" (debug with reason), kind="hook_lock_wait" (debug with elapsed_us)
  - agents::self_register::tests::phase17 submodule with 7 new integration tests covering every D-0X decision
  - 4 existing hook tests pivoted for new semantics (hook_allows_passthrough_tools_without_row extended, hook_gates_edit_and_blocks_until_approved reseeded, hook_gates_protected_path_even_on_read extended with row-metadata assertions, hook_creates_passive_stub_when_no_agent_matches row-wait removed)
  - get_pretool_gated_tools + set_pretool_gated_tools in comms/app_settings.rs marked #[allow(dead_code)] (D-19 — kept alive for future power-user revival)
affects:
  - 17-06 (frontend bindings regen: conflictWithAgentId + gateReason now on ApprovalRequest; ApprovalRequestCard can render the D-22 conflict line; notification body already prefixes ⚠ CONFLICT per D-23)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compose-then-decide gate pattern: all signal inputs (canonical_path, path_gated, conflict_other) computed first, then a single match expression produces the tuple (should_gate, gate_reason, conflict_with) — both-or-neither invariant (T-17-07) is enforced at one site, no DB CHECK needed"
    - "Tight-lock scoping with timing: `let t0 = Instant::now(); let raw = { let eng = engine.lock().await; eng.could_conflict_with(...) }; tracing::debug!(kind=\"hook_lock_wait\", elapsed_us=…);` — observability instrumented at the same place the guard is dropped"
    - "Split-resolver wrapper pattern for post-processing: outer `resolve_or_create_agent` calls `resolve_or_create_agent_inner` then runs a single side-effect (engine.update_pid_mapping) — avoids restructuring the 3-branch inner body while adding a new post-hook"
    - "Fresh-per-request window read: hook handler reads `app.state::<ConflictState>().get_window_ms()` on every request instead of relying on the engine's self.window, routing around the pipeline-side staleness (RESEARCH §1)"

key-files:
  created:
    - .planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-05-SUMMARY.md
  modified:
    - src-tauri/src/agents/self_register.rs  # hook_handler gate branch rewrite (~100 lines new), resolve_or_create_agent split + D-15b wire-up, phase17 submodule (~510 lines of tests), 4 existing tests pivoted, get_pretool_gated_tools import removed
    - src-tauri/src/comms/commands.rs  # create_approval_request_internal signature + INSERT/RETURNING + map_approval_row + dispatch_approval_notification prefix
    - src-tauri/src/comms/types.rs  # ApprovalRequest struct +2 Option<String> fields
    - src-tauri/src/comms/protected_path_trigger.rs  # caller swept to None, None
    - src-tauri/src/comms/app_settings.rs  # #[allow(dead_code)] on get_pretool_gated_tools (D-19)

key-decisions:
  - "Kept Option<String> for conflict_with_agent_id / gate_reason instead of typing them as Option<GateReason>. Rationale: minimal blast radius (the typed enum would require every call site + test to type-adapt); a future refactor can tighten it. The DB layer persists a string in either case, so the Rust-side type is an internal detail that Plan 06's frontend bindings won't see anyway (serde would already render either shape as a JSON string at the camelCase boundary)."
  - "Protected_paths OR-branch runs against the RAW tool_input.file_path string, not the canonicalized form. Rationale: D-06 explicitly preserves Read/LS/Grep as pass-through for conflict purposes but CONTEXT says Read on a protected glob still gates. My first rewrite canonicalized only for write-class tools and broke the pre-existing hook_gates_protected_path_even_on_read test. Fix: a separate raw_file_path_for_glob that falls back to the JSON string so glob matching still fires for non-write tools. Caught during the test pivot; counts as an inline Rule 1 fix within Task 2's scope."
  - "Approval row's file_path column uses the canonical form when available (file_conflict gates), raw otherwise (protected_path gates on Read). Rationale: the canonical form must match the engine's HashMap key so the frontend can later cross-reference the row with engine records; but when the gate is protected_path on a non-write tool, the canonical form was never computed, so fall back gracefully to what the user's tool_input actually contained."
  - "hook_creates_passive_stub_when_no_agent_matches (Phase 8 test) pivoted to drop the pending-row wait-point entirely. Rationale: under Phase 17 Bash `echo hi` is safelisted → instant Allow → no row. The test's name is 'creates_passive_stub', and the stub is created in resolve_or_create_agent regardless of gate outcome. Polling for a row that will never exist caused the test to hang for 30min in the default cargo-test timeout. Direct `reg.get_agent('PASSIVE-{pid}').is_some()` after a 200 OK is semantically equivalent and runs in ms."
  - "D-23 CONFLICT notification body prefix is exercised via unit path (the prefix logic is a pure function of `conflict_agent_id.is_some()`) but not via a full OS-notification test. Rationale: `dispatch_approval_notification`'s `catch_unwind` + OS-dispatch is the same pattern Phase 19 Plan 02 flagged as not-unit-testable. The prefix-building branch is covered by code review + the row-metadata tests that confirm conflict_with_agent_id is `Some(_)` on file_conflict gates — if those pass, the prefix must also render. Full end-to-end coverage stays on Plan 06's Scenario 6 UAT per VALIDATION §Manual-Only."

patterns-established:
  - "Gate-branch composition match: `match (conflict_other.as_deref(), path_gated) { (Some(id), _) => file_conflict, (None, true) => protected_path, _ => no-gate }` — tuple-matching makes the decision table explicit at a single site and lets the compiler enforce the both-or-neither invariant on (conflict_with, gate_reason)"
  - "Canonical-in-row, raw-in-glob pattern: when a column must match a HashMap key elsewhere in the system (conflict engine's recent_writes), insert the canonical form; but still use the raw form for glob matching so protected_paths user-configured patterns work against what the user typed"
  - "D-15b update_pid_mapping placement: side-effect into the engine happens at the 'canonical id was just resolved' site (inside the outer wrapper), not at every upsert_agent call — keeps engine↔registry sync in one place"

requirements-completed:
  - CNFL-01
  - CNFL-02
  - CNFL-06
  - COMM-01
  - COMM-02
  - COMM-06

# Metrics
duration: 50min
completed: 2026-04-21
---

# Phase 17 Plan 05: Rewrite hook_handler gate predicate — conflict + protected_path dispatch

**Swap the PreToolUse gating branch from tool-category allowlist to shared-engine conflict query + D-15b update_pid_mapping wire-up + approval-row metadata columns persisted + 7 new phase17 integration tests covering every D-0X decision.**

## Performance

- **Duration:** ~50 min (includes Task 1 through Task 3 + SUMMARY)
- **Started:** 2026-04-21T14:50Z (worktree reset + context load)
- **Completed:** 2026-04-21T15:39Z (after final phase17 test pass)
- **Tasks:** 3 (plus 4 atomic commits per "commit after every change" rule)
- **Files modified:** 5 (self_register.rs, commands.rs, types.rs, protected_path_trigger.rs, app_settings.rs)

## Accomplishments

- **Core behavioral swap:** hook_handler gate branch (~100 LOC rewritten) now drives off `engine.lock().await.could_conflict_with(path, &agent_id, now_ms, window_ms)` instead of `get_pretool_gated_tools`. Always-allow fast path (D-08) preserved, protected_paths OR-branch (D-07) preserved, Read/LS/Grep pass-through (D-06) preserved.
- **D-15b amendment wired:** `resolve_or_create_agent` split into an outer wrapper + inner 3-branch resolver. Outer calls `engine.lock().await.update_pid_mapping(pid, agent_id.clone())` post-resolution, so process_batch write records carry canonical `KAGENT-*` / `PASSIVE-*` IDs (not `PID-{pid}`). This is the fix that makes the D-04 liveness gate work end-to-end.
- **D-21 approval-row metadata:** `create_approval_request_internal` signature, INSERT/RETURNING, and map_approval_row all extended with `conflict_with_agent_id` + `gate_reason`. ApprovalRequest struct gains two Option<String> fields; serde rename_all="camelCase" auto-maps to camelCase at the JSON boundary for Plan 06's frontend bindings.
- **D-23 notification prefix:** `dispatch_approval_notification` body prefixes `⚠ CONFLICT: ` when `conflict_agent_id.is_some()`.
- **Tracing contract complete:** `kind="hook_gate"` (info), `kind="hook_allow"` (debug with `no_conflict` / `safelisted_or_parse_fail` / `passthrough` reason), `kind="hook_lock_wait"` (debug with elapsed_us around every engine lock acquire).
- **7 new integration tests + 4 pivots:** full coverage of D-03 (window), D-04 (liveness), D-05 (self-exclusion), D-10 (parse-failure), D-14/D-15 (two-agent), D-15b (update_pid_mapping wired), D-21 (row metadata).
- **T-17-04 opt-in perf test verified:** `lock_contention_under_burst` p99 = **6.259µs** — three orders of magnitude below the 10ms SLO.
- **D-19 helpers preserved:** `#[allow(dead_code)]` on `get_pretool_gated_tools` / `set_pretool_gated_tools` in app_settings.rs so a future power-user "strict mode" settings surface can revive tool-category gating without any backend changes.

## Task Commits

1. **Task 1: ApprovalRequest + create_approval_request_internal signature + INSERT + map_approval_row + dispatch_approval_notification prefix** — `703ac65` (feat)
2. **Task 2: hook_handler gate predicate rewrite + resolve_or_create_agent split + update_pid_mapping wire-up + dead_code on pretool_gated_tools helpers** — `edc9220` (feat)
3. **Task 3a: Pivot existing hook tests for conflict-gated semantics** — `3c6f6de` (test)
4. **Task 3b: phase17 submodule with 7 integration tests** — `2a4de8d` (test)

_The plan allows 6-8 commits; this batching combines Task 1's four logical sub-steps into one atomic feat commit (the signature + prefix changes have to land together to keep the compiler happy — separating them would leave the crate half-broken mid-commit) and splits Task 3 into pivot vs. new-tests so the pivot diff is reviewable on its own._

**Plan metadata:** (this SUMMARY.md) — committed separately as `docs(17-05): complete plan`.

## Files Created/Modified

- `src-tauri/src/agents/self_register.rs` — hook_handler gate-decision branch rewrite (~100 LOC replaced with structured dispatch), resolve_or_create_agent split into outer+inner with D-15b call site (~2 LOC in outer), 4 existing tests pivoted (~128 LOC +/- ), new phase17 submodule (~510 LOC), `use crate::comms::app_settings::get_pretool_gated_tools` line removed.
- `src-tauri/src/comms/commands.rs` — create_approval_request_internal +2 params, INSERT/RETURNING +2 columns, map_approval_row +2 fields, dispatch_approval_notification +1 param with `⚠ CONFLICT: ` prefix logic.
- `src-tauri/src/comms/types.rs` — ApprovalRequest struct +2 Option<String> fields with doc comments.
- `src-tauri/src/comms/protected_path_trigger.rs` — `check_protected_paths` caller swept to `None, None, None, None` (extra two args for the new conflict-metadata params; the Phase 4 write_access path never has a conflict peer).
- `src-tauri/src/comms/app_settings.rs` — `#[allow(dead_code)]` + doc comment on `get_pretool_gated_tools` (D-19); `set_pretool_gated_tools` already had one from Phase 8.

## Decisions Made

See `key-decisions` in frontmatter — 5 decisions captured, each with rationale linked back to CONTEXT decisions or discovered during implementation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Protected-paths OR-branch stopped firing for Read/LS when gate_file_path_str was None**
- **Found during:** Task 2 (running existing self_register tests post-rewrite)
- **Issue:** My first rewrite only populated `gate_file_path_str` for write-class tools (Edit/MultiEdit/Write/NotebookEdit/Bash-with-target). Read tools then had None, which skipped the protected_path_matches call. This broke `hook_gates_protected_path_even_on_read` with a hang (test polled for a pending row that never materialized). CONTEXT D-06 explicitly preserves "Read on protected glob still gates" — this was a rewrite-introduced regression.
- **Fix:** Added a `raw_file_path_for_glob` that falls back to `body.tool_input.get("file_path")` as a raw string when `gate_file_path_str` is None. The protected_path_matches check runs against this raw value. Row's `file_path` column prefers canonical (for HashMap-key parity) but falls back to raw (so Read gates still show a file in the approval card).
- **Files modified:** src-tauri/src/agents/self_register.rs (~15 LOC added)
- **Verification:** hook_gates_protected_path_even_on_read passes; hook_allows_passthrough_tools_without_row still returns Allow with no row for Read on non-protected path.
- **Committed in:** `edc9220` (part of Task 2 commit)

**2. [Rule 3 - Blocking] aitc-hook binary symlink missing from worktree**
- **Found during:** Task 1 verification (first cargo build)
- **Issue:** `src-tauri/build.rs` checks for `binaries/aitc-hook-x86_64-unknown-linux-gnu`; this file exists in the main repo but not in the worktree (git worktrees don't copy non-tracked files from the parent repo's binaries/ directory).
- **Fix:** Created `src-tauri/binaries/` directory and symlinked `aitc-hook-x86_64-unknown-linux-gnu` from the main repo. Standard worktree bootstrap, documented in the plan's scope reminders as "the binary symlink workaround if pre-existing issue appears".
- **Files modified:** (filesystem only — the symlink is in `.gitignore`-equivalent scope and not tracked)
- **Verification:** Subsequent builds succeed; all tests compile and run.
- **Not committed** (filesystem side-effect only, not a tracked change).

**3. [Rule 1 - Bug] hook_creates_passive_stub_when_no_agent_matches hung under Phase 17 semantics**
- **Found during:** Task 2 verification (post-rewrite test run timeout at 1800s)
- **Issue:** The test used Bash `echo hi` + polled for a pending row. Under Phase 17 Bash-echo is safelisted → instant Allow → no row, so the polling loop runs forever. Test name "creates_passive_stub" refers to what `resolve_or_create_agent` does regardless of gate outcome; the old row-polling was a convenient wait-point, not the actual assertion.
- **Fix:** Removed the row-polling + signal machinery; kept the PASSIVE-{pid} stub assertion. Test now verifies the stub exists right after a 200 OK response.
- **Files modified:** src-tauri/src/agents/self_register.rs (test body rewritten in Task 3a)
- **Verification:** Test passes in <1s instead of hanging.
- **Committed in:** `3c6f6de` (Task 3a commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking)
**Impact on plan:** All three fixes were correctness-preserving adaptations to the behavioral rewrite — no scope creep. The protected-path regression and the hook_creates_passive_stub pivot are both direct consequences of the D-18 gate-branch rewrite; fixing them inline kept Task 2's scope coherent. The binary symlink is standard worktree setup.

## Issues Encountered

**Pre-existing conflict::engine test failures (out-of-scope, per "only fix own bugs" project memory):**
- `conflict::engine::tests::test_conflict_detected_different_pids_within_window` — FAILS on base commit `4f9bebc` (verified via `git stash` + rerun)
- `conflict::engine::tests::test_custom_window_duration` — FAILS on base commit `4f9bebc`

Root cause: these tests use synthetic `timestamp_ms` values (1000, 3000, 8000) that, when combined with the engine's `evict_expired(now_ms=SystemTime::now_millis())` at the top of `process_batch`, are evicted before the conflict check runs (they're trillions of ms older than `now`). Not a Plan 05 regression; leaving in place per project memory rule.

**T-17-04 latency observation:** Opt-in perf test ran successfully once with `cargo test -- --ignored` — observed p99 = **6.259µs**, well below the 10ms VALIDATION SLO. No real-world contention at the engine's synchronous HashMap level even under the 100-concurrent-call burst against a background `process_batch` loop.

## Verification Evidence

Grep-based success-criteria confirmation:

```
grep -c "get_pretool_gated_tools" src-tauri/src/agents/self_register.rs        → 0   (D-18: removed from /hook path)
grep -c "could_conflict_with(" src-tauri/src/agents/self_register.rs            → ≥1 (gate branch + test helpers)
grep -c "extract_target_paths(" src-tauri/src/agents/self_register.rs           → 1  (Bash dispatch)
grep -c "canonicalize_for_conflict" src-tauri/src/agents/self_register.rs       → 6  (gate branch + tests)
grep -c "update_pid_mapping" src-tauri/src/agents/self_register.rs              → 8  (production outer wrapper + test helpers)
grep -c "kind = \"hook_gate\""     src-tauri/src/agents/self_register.rs        → 1  (info level)
grep -c "kind = \"hook_allow\""    src-tauri/src/agents/self_register.rs        → 1  (debug level)
grep -c "kind = \"hook_lock_wait\"" src-tauri/src/agents/self_register.rs       → 1  (debug level with elapsed_us)
grep -c "conflict_with_agent_id: Option<&str>" src-tauri/src/comms/commands.rs  → 1  (signature)
grep -c "gate_reason: Option<&str>" src-tauri/src/comms/commands.rs             → 1  (signature)
grep -c "⚠ CONFLICT"              src-tauri/src/comms/commands.rs              → 3  (prefix literal + 2 doc lines)
grep "#\[allow(dead_code)\]" src-tauri/src/comms/app_settings.rs                → 2  (D-19: both helpers preserved)
```

Test counts:

```
cargo test agents::self_register::tests::phase17        → 7 passed, 1 ignored placeholder  (7 new phase17 tests)
cargo test agents::self_register::tests::hook_          → 8 passed                           (8 hook tests incl. 3 pivots)
cargo test agents::self_register                        → 23 passed, 1 ignored              (full mod)
cargo test --lib                                        → 445 passed, 2 failed (pre-existing, both on base 4f9bebc), 5 ignored
cargo test lock_contention_under_burst --ignored         → p99 = 6.259µs  (T-17-04 SLO: <10ms)
```

## Self-Check: PASSED

Commit hashes verified:
- `703ac65` feat(17-05): ApprovalRequest + create_approval_request_internal
- `edc9220` feat(17-05): rewrite hook_handler gate predicate
- `3c6f6de` test(17-05): pivot existing hook tests
- `2a4de8d` test(17-05): phase17 submodule

Files created/modified verified via grep success criteria above.

## Threat Coverage Confirmed

| Threat | Disposition | Evidence |
|--------|-------------|----------|
| T-17-02 (liveness false-negative from ghost KAGENTs) | mitigate | `hook_allows_when_conflicting_agent_was_removed` test asserts under-gate fail-safe; `registry.get_agent(&id).await.is_some()` filters ghost records post-`could_conflict_with` |
| T-17-03 (hook-vs-process_batch race) | accept | D-17 accepted race preserved; no code mitigation. Filesystem watcher re-converges on actual write. |
| T-17-04 (lock contention observability + burst) | mitigate | `kind="hook_lock_wait"` with elapsed_us emitted per request; `lock_contention_under_burst` opt-in perf test measures p99 under 100-concurrent-call burst; observed p99 = 6.259µs (SLO <10ms). Source mitigation shipped in Plan 04 (tight lock scoping in conflict_task). |
| T-17-07 (approval row missing conflict_with on file_conflict) | mitigate | Both-or-neither invariant enforced at the gate-composition match expression; `gate_row_carries_conflict_with_agent_id` test asserts the row's columns match the tuple shape. |

## Next Phase Readiness

**Plan 06 (frontend) is unblocked.** The `ApprovalRequest` type now carries `conflictWithAgentId?` + `gateReason?` fields at the camelCase boundary — Plan 06's `bindings.ts` regen will pick them up automatically. `ApprovalRequestCard.tsx` can conditionally render the D-22 conflict line (`⚠ CONFLICT with {agentId}`) whenever `gateReason === 'file_conflict'`. OS notifications already prefix `⚠ CONFLICT: ` when the gate fires (D-23).

Known limitations (preserved from upstream):
- D-17 accepted race: two agents hitting /hook for the same file within ms of each other, before either has a write record in the engine, will both Allow. Filesystem watcher re-converges on actual write. Revisit only if UAT surfaces this pattern.
- Engine's `self.window` staleness on the pipeline path: fresh-read in hook handler routes around it; pipeline `conflict_task` still bakes the window at task start. Out-of-scope for Plan 05 per RESEARCH §1.
- D-23 CONFLICT notification prefix is covered by unit-path review; full end-to-end OS-notification test deferred to Plan 06 Scenario 6 UAT per VALIDATION §Manual-Only.

---
*Phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g*
*Completed: 2026-04-21*
