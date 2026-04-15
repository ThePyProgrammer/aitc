---
phase: 08-real-claude-code-hook-integration-pretooluse-approvals
plan: 02
subsystem: backend-hook-wiring
tags: [axum, long-held-http, waiter-registry, abandon-guard, pretool-use, pitfall-8, tdd-green]
dependency_graph:
  requires:
    - 08-01 (WaiterRegistry stub + port_file stub + DB migration 005 + ApprovalRequest struct lock)
  provides:
    - POST /hook axum route with long-held response + AbandonGuard disconnect handling
    - Full WaiterRegistry body (register/signal/signal_for_agent/always_allow/session bindings)
    - port_file write + Drop guard cleanup (~/.aitc/port)
    - Phase 8 ApprovalRequest fields populated through create_approval_request_internal
    - Extended approve_request / deny_request / approve_with_edits Tauri commands that signal waiters
    - terminate_agent force-deny (D-10) — fires Deny BEFORE OS kill, avoids EPIPE race
    - comms/app_settings get/set_pretool_gated_tools with D-19 default bootstrap
    - Integration smokes (tests/end_to_end_smoke.rs) proving the approve/disconnect/terminate/always-allow paths
  affects:
    - 08-03 sidecar: HTTP contract locked — POST body shape + response envelope shape match aitc_hook types
    - 08-04 hook_install: resolves port file produced by this plan
    - 08-05 frontend: new Tauri command signatures (always_allow_for_session, reason, waiters State) ready for invoke-rewrite; regenerated bindings.ts surfaces on next debug run
tech_stack:
  added:
    - "reqwest 0.12 (json, no default features) — integration test client"
    - "tauri feature `test` (MockRuntime) — drives hook_handler under cargo test"
  patterns:
    - "Long-held HTTP on axum with oneshot::channel + Drop-based AbandonGuard"
    - "Pitfall 8 race guard: UPDATE ... WHERE status='pending' + rows_affected==0 skip-signal"
    - "Runtime-generic Tauri APIs — build_router, start_registration_server, hook_handler, create_approval_request_internal all take `R: tauri::Runtime` so MockRuntime tests work"
    - "RateLimiter shared across /register + /hook (10 rps hard cap)"
key_files:
  created:
    - src-tauri/src/comms/app_settings.rs
  modified:
    - src-tauri/src/agents/hook_waiters.rs (full WaiterRegistry body + 7 GREEN tests)
    - src-tauri/src/pipeline/port_file.rs (write_port + Drop + 3 GREEN tests)
    - src-tauri/src/comms/types.rs (ApprovalRequest += tool_name/tool_input_json/session_id)
    - src-tauri/src/comms/commands.rs (create_approval_request_internal ext, approve/deny/approve_with_edits wiring, 8 new tests)
    - src-tauri/src/comms/protected_path_trigger.rs (pass None/None/None for Phase 8 fields)
    - src-tauri/src/comms/mod.rs (+ app_settings)
    - src-tauri/src/agents/self_register.rs (HookRequest/AitcDecisionResponse types, hook_handler, AbandonGuard, generic over Runtime, 9 new integration tests)
    - src-tauri/src/agents/commands.rs (terminate_agent force-deny)
    - src-tauri/src/lib.rs (manage WaiterRegistry, new start_registration_server signature, port_file::write_port wiring)
    - src-tauri/Cargo.toml (reqwest + tauri test feature as dev-deps)
    - src-tauri/tests/end_to_end_smoke.rs (4 GREEN Phase 8 smokes)
    - .planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/deferred-items.md (Plan 02 pre-existing items logged)
decisions:
  - "dispatch_approval_notification wraps the notification plugin call in std::panic::catch_unwind so MockRuntime-driven tests don't panic when the plugin isn't registered. Production AppHandle always has it (registered in lib.rs run())."
  - "build_router is parameterised over tauri::Runtime so cargo test can compose the same Router with MockRuntime while production Wry path is unchanged. Alternative (build_router uses a type-erased AppHandle box) adds an allocation per request — rejected."
  - "create_approval_request_persists_tool_fields unit test replaced by 2 map_approval_row tests + 3 integration smokes that exercise INSERT via create_approval_request_internal end-to-end. Tauri MockRuntime does not expose an ergonomic AppHandle<Wry> substitute, and plumbing Wry test runtime was disproportionate effort for a row-mapping test."
  - "Rate limiter test uses direct RateLimiter::check invocation rather than an HTTP burst — timing-based burst assertions are flaky across the second-boundary. The Extension-layered RateLimiter is the same instance, so the pass-through integration test transitively covers the handler wiring."
  - "src/bindings.ts NOT regenerated in this plan. tauri-specta regenerates at .setup() time with #[cfg(debug_assertions)]; Plan 05 picks up the fresh bindings on next dev-run. Avoids committing a stale mid-phase bindings.ts if Plan 05 adds further commands."
metrics:
  duration: "~2h"
  completed_date: "2026-04-15"
  tasks: 3
  files_created: 1
  files_modified: 13
  tests_added: 35 (16 Task 1 lib + 9 Task 2 self_register integration + 6 Task 3 comms::commands + 4 Task 3 end_to_end_smoke)
---

# Phase 8 Plan 02: Backend Wiring (Waiters + /hook + Tauri Commands) Summary

Wire the backend half of Phase 8 end-to-end. Plan 02 added the `/hook` axum route onto the existing self-registration server, connected approve/deny/approve_with_edits Tauri commands to the waiter registry, force-denied waiters on terminate, extended `approval_requests` row creation to carry `tool_name`/`tool_input_json`/`session_id`, implemented the `~/.aitc/port` writer with Drop cleanup, bootstrapped `pretool_gated_tools` default allowlist, and landed the integration smoke tests that flip every RED stub test from Plan 01 to GREEN.

## Task Summary

| Task | Commit   | What                                                                                                                                   |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | e3ce4b3  | WaiterRegistry body + port_file write/Drop + app_settings (D-19 default) + ApprovalRequest Phase 8 fields + create_approval_request_internal signature ext |
| 2    | 51b9f9f  | POST /hook axum route + AbandonGuard + protected_path_matches + resolve_or_create_agent + lib.rs bootstrap + runtime-generic router    |
| 3    | d4ae86d  | approve/deny/approve_with_edits wired to waiters (Pitfall 8 guards) + terminate_agent force-deny (D-10) + 4 GREEN e2e smokes           |

## /hook Pipeline (What Plan 03's Sidecar Will POST Against)

```
Claude PreToolUse stdin
        │
        ▼
┌──────────────────────┐
│ aitc-hook sidecar    │  Plan 03: parses Claude stdin, reads ~/.aitc/port,
│  (Plan 03 — separate)│           POSTs HookRequest JSON to /hook
└──────────┬───────────┘
           │  HTTP POST /hook (long-held)
           ▼
┌───────────────────────────────────────────────────────────┐
│ hook_handler (this plan)                                  │
│  1. rate_limit (T-08-Rate)       → 429 if exceeded        │
│  2. tool_input is_object? (T-08-05) → 400 if not          │
│  3. PID live? (T-08-03)           → 400 if dead           │
│  4. resolve_or_create_agent (D-12)                        │
│  5. is_always_allowed? (D-22)     → {kind:"allow"}  FAST  │
│  6. tool OR protected-path gated? (D-19/D-20/D-21)        │
│     if NOT → {kind:"allow"} FAST                          │
│  7. INSERT approval_requests(status='pending', ...)       │
│  8. register waiter + AbandonGuard (T-08-02)              │
│  9. await rx (LONG-HOLD)                                  │
│       on Ok(d) → return decision                          │
│       on Err    → Deny("waiter channel closed") (D-11)    │
│       on drop   → AbandonGuard: row='abandoned' + remove  │
└───────────────────────────────────────────────────────────┘
```

## WaiterRegistry Lock Order

**Never held simultaneously:** `waiters` → `always_allow` → `session_agents`. Each method takes at most one lock at a time; `signal_for_agent` collects matching ids under one lock, drops it, then re-acquires per-id to send. `clear_*_for_agent` holds only `always_allow` OR `session_agents` for a single `retain()` sweep.

## Pitfall 8 Race Handling

**The race:** `approve_request` and the AbandonGuard (triggered by client disconnect) can fire concurrently against the same row. Without a guard the approve could clobber an abandoned row and then signal a waiter that the Drop path already removed.

**The fix:**
1. `approve_request` / `deny_request` / `approve_with_edits` use `UPDATE ... WHERE id = ? AND status = 'pending'`.
2. Inspect `rows_affected()` — if 0, the AbandonGuard (or a prior resolve) already won. Skip `waiters.signal()`, just re-emit `approval-resolved` so the UI re-syncs.
3. AbandonGuard also uses `WHERE status = 'pending'`, so if approve wins first the abandon UPDATE is a no-op too.

**Covered by:** `approve_is_idempotent_when_row_already_abandoned` unit test + `hook_disconnect_abandons` e2e smoke.

## HTTP Wire Contract (for Plan 03)

Plan 03's sidecar MUST POST exactly this JSON shape to `/hook` (all field names snake_case):

```json
{
  "pid": 12345,
  "session_id": "claude-session-abc",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file",
    "old_string": "...",
    "new_string": "..."
  },
  "cwd": "/project/root"
}
```

AITC responds with one of three envelope shapes (tagged union, `kind` discriminator):

```json
// Allow
{"kind": "allow"}

// Allow with edits (Edit/MultiEdit/Write/NotebookEdit only in v1)
{"kind": "allow_with_edits", "updated_input": {"file_path": "...", "new_string": "replaced-content"}}

// Deny
{"kind": "deny", "reason": "user rejected"}
```

Matches `aitc_hook::AitcDecision` variant shapes from Plan 01 exactly. Plan 03's `main.rs` deserializes with `#[serde(tag = "kind", rename_all = "snake_case")]`.

## How Plan 04's hook_install Finds the Sidecar

Plan 04 writes `~/.claude/settings.local.json` merging a `PreToolUse` hook entry whose `command` path resolves to the Tauri-bundled sidecar binary. AITC writes the port file in `lib.rs` setup post-bind; Plan 03's sidecar reads it (see `aitc_hook::resolve_port` stub from Plan 01, to be filled in Plan 03).

## D-19 Default Tool Allowlist

Bootstrapped by `comms::app_settings::get_pretool_gated_tools` on first read: `["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"]`. Read, LS, Grep, Glob, WebFetch, WebSearch, Task pass through unless a protected_paths glob catches them (D-21 OR semantics).

## RED Tests Flipped to GREEN

All three `#[should_panic(expected = "plan 02")]` contract locks from Plan 01 are now real tests that verify the implemented behaviour:

| Plan 01 Contract Lock                                             | Plan 02 GREEN Test                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `hook_waiters::register_then_signal_delivers_decision`            | Same name; now actually awaits rx end and asserts Allow delivered          |
| `hook_waiters::signal_for_agent_fires_all_waiters_for_that_agent` | Same name; asserts KAGENT-9 waiters get Deny, KAGENT-OTHER is untouched    |
| `hook_waiters::always_allow_roundtrip`                            | Same name; asserts add/is_always_allowed/miss semantics                    |
| `port_file::write_port_creates_file_with_port_only`               | Same name; uses AITC_PORT_FILE_OVERRIDE for tempdir isolation              |
| `port_file::drop_guard_removes_file`                              | Same name; asserts removal after `{ let _g = ... }` scope exit             |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Sidecar binary needed recompile + copy after soft-reset**

- **Found during:** worktree-branch-check step (start of execution).
- **Issue:** `git reset --soft` back to the expected base commit `925cff3` put the working tree into a state where `src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu` was missing, blocking `cargo check --workspace` via tauri-build's externalBin verification.
- **Fix:** Re-ran `cargo build -p aitc-hook`, copied `target/debug/aitc-hook` to `src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu`. The `binaries/` dir is already gitignored (Plan 01 deviation).
- **Files modified:** none tracked (binary lives under gitignored `src-tauri/binaries/`).

**2. [Rule 2 — Critical] Made Tauri plumbing generic over Runtime**

- **Found during:** Task 2 first test run.
- **Issue:** `tauri::test::mock_app()` returns `App<MockRuntime>`, but `build_router` / `hook_handler` / `create_approval_request_internal` / `dispatch_approval_notification` all took `tauri::AppHandle` (defaulted to `Wry`). Tests couldn't compose the router under MockRuntime → E0308 mismatched types.
- **Fix:** Parameterised all five functions over `<R: tauri::Runtime>`. Production `Wry` path is unchanged (type inference fills `R = Wry`); tests now compile with `MockRuntime`. Zero-cost abstraction — no runtime boxing.
- **Files modified:** src-tauri/src/agents/self_register.rs, src-tauri/src/comms/commands.rs.

**3. [Rule 1 — Bug] Notification plugin panic under MockRuntime**

- **Found during:** Task 2 integration test run.
- **Issue:** `tauri_plugin_notification::NotificationExt::notification()` panics with `state() called before manage()` when the plugin isn't registered — which is always true under `tauri::test::mock_app()`. This crashed 4 of the 9 hook integration tests.
- **Fix:** Wrapped the `app_handle.notification().builder().show()` call in `std::panic::catch_unwind(AssertUnwindSafe(|| ...))`. Production AppHandle always has the plugin registered (lib.rs run() path), so catch is a dev-test safety net, not a production branch.
- **Files modified:** src-tauri/src/comms/commands.rs.

**4. [Rule 3 — Blocking] Rate-limiter test flakiness across second boundary**

- **Found during:** Task 2 initial test run.
- **Issue:** HTTP burst assertion (issue 15 concurrent requests, expect at least one 429) sporadically missed the 10-rps window because tokio::spawn scheduling plus axum accept stretched the burst across the 1-second boundary.
- **Fix:** Replaced the HTTP burst with a direct `RateLimiter::check()` invocation test. The Extension-layered RateLimiter is the SAME instance wired into both routes, so the end-to-end `hook_allows_passthrough_tools_without_row` test transitively confirms the handler wiring. Rate-limit semantics are deterministically covered.
- **Files modified:** src-tauri/src/agents/self_register.rs (test only).

### Out-of-Scope Deferrals

Logged to `.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/deferred-items.md`:

1. **Pre-existing `conflict::engine` test failures** (Phase 3 territory) — confirmed pre-existing by stashing Plan 02 work and re-running on raw base `925cff3`. Not introduced by this plan.
2. **`create_approval_request_persists_tool_fields` unit test** replaced by `map_approval_row` tests + e2e integration smokes (noted under Decisions above).

## Authentication Gates

None — Phase 8 Plan 02 is pure backend plumbing and touches no external auth surface.

## Known Stubs

None remaining in Plan 02 files. All Plan 01 stubs owned by this plan (`WaiterRegistry::*`, `port_file::*`) are now fully implemented. Stubs owned by other plans (sidecar `aitc_hook::*` for Plan 03, `hook_install::*` for Plan 04, frontend renderer registry for Plan 05) are unchanged.

## Verification Evidence

- `cd src-tauri && cargo test --lib -- agents::hook_waiters agents::self_register comms::commands comms::app_settings pipeline::port_file` → **35 passed, 0 failed**
- `cd src-tauri && cargo test --test end_to_end_smoke` → **4 passed, 1 ignored (pre-existing Phase 6), 0 failed**
- `cd src-tauri && cargo check --workspace --tests` → exits 0 (8 pre-existing lib warnings)
- `grep -c "async fn hook_handler" src-tauri/src/agents/self_register.rs` → 1
- `grep -c 'route("/hook"' src-tauri/src/agents/self_register.rs` → 1
- `grep -c "AbandonGuard" src-tauri/src/agents/self_register.rs` → 3 (struct def + var decl + Drop impl)
- `grep -c "DefaultBodyLimit::max" src-tauri/src/agents/self_register.rs` → 1 (T-08-04)
- `grep -c "is_always_allowed" src-tauri/src/agents/self_register.rs` → 1
- `grep -c "protected_path_matches" src-tauri/src/agents/self_register.rs` → 2
- `grep -c "resolve_or_create_agent" src-tauri/src/agents/self_register.rs` → 2
- `grep -c "write_port" src-tauri/src/lib.rs` → 1
- `grep -q "always_allow_for_session: Option<bool>" src-tauri/src/comms/commands.rs` → match
- `grep -q "waiters: tauri::State" src-tauri/src/comms/commands.rs` → match
- `grep -c "waiters.signal(id, HookDecision::" src-tauri/src/comms/commands.rs` → 3 (approve, approve_with_edits, deny)
- `grep -q "HookDecision::AllowWithEdits(updated_input)" src-tauri/src/comms/commands.rs` → match
- `grep -q "signal_for_agent" src-tauri/src/agents/commands.rs` → match
- `grep -q "clear_always_allow_for_agent" src-tauri/src/agents/commands.rs` → match
- `grep -q "AND status = 'pending'" src-tauri/src/comms/commands.rs` → match (Pitfall 8)

## Next Steps

- **Plan 08-03 (sidecar main.rs + envelope translation):** fill `aitc_hook::resolve_port`, `build_allow_envelope`, `build_allow_with_edits_envelope`, and `main()` so the sidecar reads Claude PreToolUse stdin → POSTs `/hook` → emits the PermissionDecision JSON Claude expects on stdout. Envelope tests in `aitc-hook/tests/envelope_shapes.rs` go RED→GREEN.
- **Plan 08-04 (hook install):** fill `install_aitc_hook` + `upsert_pretool_entry` to merge the sidecar command into `~/.claude/settings.local.json` idempotently. Uses the bundled sidecar path.
- **Plan 08-05 (frontend):** consume the regenerated `bindings.ts` (new `alwaysAllowForSession` param, `reason` on deny, `waiters` State threaded through), fill the stub renderer registry (`EditPreview`, `BashPreview`, etc.), wire `opts.alwaysAllowForSession` into `commsStore.approveRequest` / `approveWithEdits` invokes.
- **Plan 08-06 (e2e integration):** end-to-end test that actually shells out to the built `aitc-hook` binary with Claude-shaped stdin and verifies the PermissionDecision stdout matches.

## Self-Check: PASSED

- [x] `src-tauri/src/comms/app_settings.rs` — FOUND
- [x] `src-tauri/src/agents/hook_waiters.rs` — FOUND (full body, no todo!)
- [x] `src-tauri/src/pipeline/port_file.rs` — FOUND (full body, no todo!)
- [x] `src-tauri/src/comms/types.rs` — FOUND (tool_name/tool_input_json/session_id present)
- [x] `src-tauri/src/comms/commands.rs` — FOUND (extended create_approval_request_internal + waiter-wired approve/deny/approve_with_edits)
- [x] `src-tauri/src/agents/self_register.rs` — FOUND (HookRequest, AitcDecisionResponse, hook_handler, AbandonGuard, build_router generic over R: Runtime)
- [x] `src-tauri/src/agents/commands.rs` — FOUND (terminate_agent force-deny)
- [x] `src-tauri/src/lib.rs` — FOUND (WaiterRegistry managed, new start_registration_server signature, write_port wired)
- [x] `src-tauri/tests/end_to_end_smoke.rs` — FOUND (4 Phase 8 smokes)
- [x] `src-tauri/Cargo.toml` — reqwest + tauri test feature present as dev-deps
- [x] Commit `e3ce4b3` — FOUND in `git log`
- [x] Commit `51b9f9f` — FOUND in `git log`
- [x] Commit `d4ae86d` — FOUND in `git log`
- [x] No edits to `src-tauri/aitc-hook/*` (Plan 03's scope)
- [x] No STATE.md or ROADMAP.md edits (orchestrator-owned per execution_context)
