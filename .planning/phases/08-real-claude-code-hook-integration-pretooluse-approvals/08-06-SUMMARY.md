---
phase: 08-real-claude-code-hook-integration-pretooluse-approvals
plan: 06
wave: 3
subsystem: "integration-verification"
tags: [phase-8, e2e, uat, sidecar, visual-verification]
status: complete
completed: 2026-04-15
requirements: [COMM-01, COMM-02, COMM-03, COMM-05, COMM-06, AGNT-03]
dependency_graph:
  requires:
    - "08-02 — /hook handler + WaiterRegistry + AbandonGuard"
    - "08-03 — aitc-hook sidecar binary (stdin → POST → stdout/exit)"
    - "08-04 — hook_install + bundle config + passive consent"
    - "08-05 — frontend per-tool previews + don't-ask-again + passive dialog"
  provides:
    - "Cross-crate e2e guard: `cargo test --test hook_e2e_with_real_sidecar` (4 tests)"
    - "Manual UAT checklist: `tests/manual/phase-08-uat.md` (62 items across §A-M)"
    - "Phase 8 sidecar build + rebuild docs: `docs/README.md`"
  affects:
    - "Phase 8 Wave 3 completion gate — this plan is the last CI guard for the whole phase"
tech-stack:
  added: []
  patterns:
    - "Integration test binary walks up from current_exe() to target/ to locate cross-crate binary (env!(CARGO_BIN_EXE_...) only works for the owning crate)"
    - "Hand-rolled schema in tests (mirror end_to_end_smoke pattern) instead of sqlx::migrate! — keeps the e2e test hermetic from the migration sequence and avoids column-redefinition traps"
    - "tokio::task::spawn_blocking for sync std::process::Command so wait_with_output doesn't stall the async runtime"
key-files:
  created:
    - "src-tauri/tests/hook_e2e_with_real_sidecar.rs (307 lines, 4 tests)"
    - "tests/manual/phase-08-uat.md (228 lines, 62 checklist items)"
    - "docs/README.md (66 lines, Phase 8 Hook Testing section)"
  modified: []
decisions:
  - "Sidecar binary lookup via current_exe() walk-up rather than a shared test-support feature flag — simpler, zero source-code changes in aitc_lib, no risk of feature-flag leakage into release builds"
  - "Hand-rolled schema in setup_server() rather than sqlx::migrate! — matches the existing Plan 02 end_to_end_smoke pattern and sidesteps a latent conflict between migration 001's INTEGER session_id and migration 005's TEXT session_id"
  - "Task 2 (checkpoint:human-verify) produces the UAT artifact and auto-completes under --auto mode; the human checklist is a deferred gate, not a blocking checkpoint in auto-chain"
metrics:
  tasks_completed: 2
  tests_added: 4
  files_created: 3
  files_modified: 0
---

# Phase 8 Plan 6: Real-Sidecar E2E + Manual UAT Summary

One-liner: Cross-crate integration test runs the compiled `aitc-hook` sidecar against the real `start_registration_server` + SQLite + WaiterRegistry to lock the allow / allow_with_edits / deny / abandon paths, and a 62-item manual UAT checklist covers the visual + platform-specific behaviors CI cannot verify.

## What this plan delivered

Plans 02/03/04/05 each shipped unit + component tests for their slice of the Phase 8 stack. Plan 06 is the **integration glue** — one `cargo test` binary that spins up the entire stack from a real compiled sidecar executable through the axum server, the SQLite approval_requests table, the WaiterRegistry, the AbandonGuard drop path, and back out through the sidecar's envelope translation. If any of those layers regress together, this test catches it.

### 1. `src-tauri/tests/hook_e2e_with_real_sidecar.rs`

Four tests, each running the full stack end-to-end:

| Test                                              | Path                | Exit code | Stdout shape                                          | Stderr shape         |
|---------------------------------------------------|---------------------|-----------|-------------------------------------------------------|----------------------|
| `e2e_allow_roundtrip_with_real_sidecar`           | allow               | 0         | `hookSpecificOutput.permissionDecision = "allow"`     | empty                |
| `e2e_allow_with_edits_roundtrip_with_real_sidecar`| allow_with_edits    | 0         | `hookSpecificOutput.updatedInput.new_string = "…"`    | empty                |
| `e2e_deny_roundtrip_with_real_sidecar`            | deny                | 2         | empty (Claude would misread any JSON as allow)        | contains deny reason |
| `e2e_abandon_when_sidecar_killed`                 | client disconnect   | N/A       | N/A (sidecar killed mid-POST)                         | N/A                  |

The allow / allow_with_edits / deny tests drive the sidecar via `tokio::task::spawn_blocking` (because `std::process::Command` is sync) and signal the waiter from the async task. The abandon test keeps the child handle, kills it mid-POST, and polls the DB for up to 2s for the row to transition to `abandoned` — proves the `AbandonGuard` drop path fires when the TCP connection drops.

### 2. `tests/manual/phase-08-uat.md`

62 checklist items across sections A-M, covering:

- **A.** End-to-end hook integration (Edit + Bash happy paths)
- **B.** Deny path + two-step CONFIRM_DENY flow
- **C.** `approve_with_edits` — user-edited payload round-trips to Claude
- **D.** Don't-ask-again-this-session (per-agent scoping, cleared on terminate)
- **E.** `--accept-edits` / `--dangerously-skip-permissions` chips are opt-out
- **F.** Passive-detection consent (dedup, accept → install, decline → never re-prompt)
- **G.** Client-disconnect → abandoned (D-09 OS-kill path)
- **H.** Terminate force-deny ordering (D-10 — signal BEFORE OS kill, no EPIPE)
- **I.** Deep-link OS notification — tray click focuses window + routes to Comms
- **J.** Windows-specific paths (taskkill ordering, `.exe` resolution)
- **K.** Abandoned row sorts below pending + is non-interactive
- **L.** Visual verification against `08-UI-SPEC.md` §Color, §Typography, §Spacing, §Copywriting (10 items)
- **M.** Documentation sign-off

Sign-off table at the end captures tester, date, Linux outcome, Windows outcome, and notes. Any failure must file a gap-closure row in `08-VALIDATION.md`.

### 3. `docs/README.md`

New Phase 8 Hook Testing section explaining:
- Quick run (just the e2e guard)
- Full Phase 8 suite (backend + frontend + tsc)
- Rebuilding the sidecar after source changes (dev + release paths)
- Regenerating tauri-specta bindings
- Port file convention (`~/.aitc/port`) + override env vars
- Pointer to the manual UAT checklist

## E2E Coverage Matrix

| Decision variant | Transport layer        | Assertion                                                | Locked by                |
|------------------|------------------------|----------------------------------------------------------|--------------------------|
| allow            | sidecar stdin→HTTP→stdout | Modern envelope, no deprecated `decision` field         | `e2e_allow_*`            |
| allow_with_edits | sidecar stdin→HTTP→stdout | `updatedInput` carries user-edited payload              | `e2e_allow_with_edits_*` |
| deny             | sidecar stdin→HTTP→stderr+exit 2 | Exit 2, reason on stderr, empty stdout            | `e2e_deny_*`             |
| abandon          | sidecar kill mid-POST    | DB row → `abandoned` via `AbandonGuard` within 2s       | `e2e_abandon_*`          |

## Verification results

- `cargo build -p aitc-hook` — clean build, binary at `target/debug/aitc-hook` (1.41s).
- `cargo test --test hook_e2e_with_real_sidecar` — **4 passed, 0 failed** (0.30s runtime).
- Acceptance-criteria greps (sidecar_binary_path, start_registration_server, waiters.signal) — 11 matches, expected ≥ 3.
- `grep -c '\[ \]' tests/manual/phase-08-uat.md` — **62** (plan requires ≥ 30).
- `grep "Phase 8 Hook Testing" docs/README.md` — match.

### Out-of-scope test failures (unchanged from prior waves)

`cargo test --workspace` surfaces the two pre-existing `conflict::engine` failures already logged in `deferred-items.md` item 4 (Plan 08-02):

- `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
- `conflict::engine::tests::test_custom_window_duration`

These are Phase 3 territory, pre-existing on the worktree base, not introduced by Plan 08-06. No new failures.

## Checkpoint: human-verify

Task 2 is a `checkpoint:human-verify` gate. Under the current `--auto` execution mode the plan auto-completes after producing the artifact, but the **manual UAT checklist is still an explicit human action** — it cannot be automated. Before Phase 8 is promoted to "done" on ROADMAP:

1. A tester must run `tests/manual/phase-08-uat.md` on Linux.
2. A tester must run the Windows-only sections (§J) on a Windows build.
3. Any failures → file gap-closure rows in `08-VALIDATION.md` and re-run `/gsd-plan-phase 8 --gaps`.
4. Sign-off table at the bottom of the UAT file gets filled in.

**What the orchestrator should surface to the user:**

> Phase 8 Plan 06 is committed: the cross-crate e2e test is green (4/4), and the UAT checklist is ready. Before marking Phase 8 complete, run `tests/manual/phase-08-uat.md` on Linux + Windows and record sign-off in the table at the bottom of that file. If any section fails, use `/gsd-plan-phase 8 --gaps`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Removed unused `AgentInfo`/`AgentState` imports**
- **Found during:** Task 1 (initial write)
- **Issue:** Imported `aitc_lib::agents::adapter::{AgentInfo, AgentState}` to match the plan's reference snippet but never needed them — `resolve_or_create_agent` auto-creates a PASSIVE agent for the sidecar's own PID, so no pre-registration is required.
- **Fix:** Dropped the unused import.
- **Files modified:** `src-tauri/tests/hook_e2e_with_real_sidecar.rs`
- **Commit:** fb3ed26 (same commit as task 1, pre-commit cleanup)

### Design deviations from the plan's reference snippet

**2. Schema setup**
- **Plan suggested:** `sqlx::migrate!("./src/db/migrations").run(&pool).await.unwrap()`
- **Actual implementation:** Hand-rolled `CREATE TABLE approval_requests ...` matching Plan 02's `end_to_end_smoke::spawn_hook_test_server`.
- **Why:** Migration 001 defines `session_id INTEGER`; migration 005 `ALTER TABLE ADD COLUMN session_id TEXT`. The runner may tolerate this on an empty DB (since the column already exists), but hand-rolling the terminal schema is safer, hermetic from the migration sequence, and consistent with the other smoke test.

**3. Pre-register KAGENT for sidecar PID**
- **Plan suggested:** Spawn `sleep 10` subprocess and pre-register a KAGENT-<pid> entry so `resolve_or_create_agent` finds it.
- **Actual implementation:** Skip the pre-register. The sidecar's own PID (from `std::process::id()`) isn't in the registry; `resolve_or_create_agent` auto-creates `PASSIVE-{pid}` and proceeds. The tests don't assert on agent type, only on the row status + envelope — this simplification doesn't weaken the guard.
- **Why:** Removes two lines of test setup per test and an `Arc<AgentRegistry>` + `upsert_agent` chain. The plan's pre-register was defensive (in case the auto-create path was missing a field for the create_approval_request insert); auto-create works fine in practice.

## Threat Flags

None. This plan adds an integration test + docs + manual checklist; no new runtime surface, no new trust boundaries.

## Known Stubs

None. All deliverables are fully wired: the test actually runs against the compiled sidecar, the UAT checklist is complete (no `TODO`/`FIXME` placeholders), and the docs section covers all four dev flows (quick run, full suite, rebuild, bindings regen).

## Deferred Issues

None introduced by this plan. Pre-existing failures tracked in
`.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/deferred-items.md`:
- Item 1: `claude_resources::fixtures` module declared but file missing (Phase 9).
- Item 2: `src/views/Radar/forceCluster.ts` tsc errors (Phase 7).
- Item 4: `conflict::engine` test failures (Phase 3).
- Item 6: `agentStore.test.ts` `launch_agent` options-field mismatch (Phase 9).
- Item 7: `src/bindings.ts` tauri-specta duplicate imports.

## Self-Check: PASSED

- **File exists:** `src-tauri/tests/hook_e2e_with_real_sidecar.rs` — FOUND
- **File exists:** `tests/manual/phase-08-uat.md` — FOUND
- **File exists:** `docs/README.md` — FOUND
- **Commit exists:** fb3ed26 (Task 1) — FOUND
- **Commit exists:** 812729e (Task 2) — FOUND
- **Tests green:** 4 passed, 0 failed in `cargo test --test hook_e2e_with_real_sidecar`
- **No STATE.md / ROADMAP.md edits from executor:** confirmed (those are orchestrator-owned per executor prompt)
- **No src/** edits:** confirmed (only src-tauri/ + tests/ + docs/)
