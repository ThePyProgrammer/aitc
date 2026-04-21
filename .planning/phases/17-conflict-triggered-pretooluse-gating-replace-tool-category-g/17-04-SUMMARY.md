---
phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g
plan: 04
subsystem: api
tags: [rust, tauri, axum, conflict-engine, shared-state, arc-mutex, phase17]

# Dependency graph
requires:
  - phase: 17-01
    provides: src-tauri/src/agents/bash_paths.rs (registered via Plan 03)
  - phase: 17-02
    provides: ConflictEngine::could_conflict_with query surface + GateReason enum + canonicalize_for_conflict helper
  - phase: 17-03
    provides: Migration 007 schema columns + bash_paths module registration
provides:
  - Arc<tokio::sync::Mutex<ConflictEngine>> registered as Tauri managed state in lib.rs::run()::setup
  - hook_handler Extension<Arc<tokio::sync::Mutex<ConflictEngine>>> parameter (plumbed, not yet consumed — Plan 05 rewrites the gate branch)
  - build_router 8th engine parameter + matching .layer(Extension(engine))
  - start_registration_server 8th engine parameter (threaded into build_router)
  - pipeline::commands::conflict_task refactored to pull Arc<Mutex<ConflictEngine>> from Tauri managed state instead of constructing its own local ConflictEngine
  - Lock-scope discipline: `let alerts = { let mut eng = engine.lock().await; eng.process_batch(&batch) };` — guard dropped before Tauri emit / NotificationState.get_prefs / ConflictState.add_alert awaits (Pitfall 1 / T-17-04 mitigation)
  - spawn_hook_server 5-tuple return (added engine as 5th element) + in-test seeding of ConflictState::new(5000) on the mock AppHandle
  - make_hook_pool schema extended with conflict_with_agent_id + gate_reason TEXT columns (mirrors migration 007)
  - GateReason registered on the specta builder so TypeScript bindings pick up the `'file_conflict' | 'protected_path' | 'unknown'` union
affects:
  - 17-05 (/hook gate branch rewrite: now has `engine` Extension in scope at hook_handler signature; `_engine_handle_for_plan_05` breadcrumb marks the insertion point; test helper exposes engine handle for synthetic write-record seeding)
  - 17-06 (frontend bindings: GateReason specta registration feeds the TS union without an extra edit in Plan 04)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Arc<tokio::sync::Mutex<T>> shared-managed-state pattern threaded through (a) Tauri .manage() + State accessor for commands and (b) axum .layer(Extension(_)) for HTTP handlers — mirrors the WaiterRegistry pattern established in Phase 8"
    - "Tight-lock-scoping idiom: `let alerts = { let mut eng = engine.lock().await; eng.process_batch(&batch) };` — guard dropped at the `}` BEFORE any subsequent .await that could contend for the same mutex"
    - "Extension-breadcrumb pattern for multi-plan handoff: a `let _X_handle_for_plan_N = X;` inside hook_handler body marks the insertion point for a later plan while threading the type through now"

key-files:
  created:
    - .planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-04-SUMMARY.md
  modified:
    - src-tauri/src/lib.rs  # engine construction + .manage + engine_for_server + 8th arg + GateReason specta registration
    - src-tauri/src/agents/self_register.rs  # hook_handler signature + build_router + start_registration_server + make_hook_pool schema + spawn_hook_server return tuple + 11 destructure sweeps + tests::use tauri::Manager
    - src-tauri/src/pipeline/commands.rs  # conflict_task now pulls shared engine from app_handle.state; tight lock scoping around process_batch

key-decisions:
  - "Split Task 2 into TWO commits (production-path 4912c21 + test-scaffolding 1d48b0e) rather than one omnibus commit. Rationale: keeps production signature churn visible without being mixed with 40 lines of test-helper edits; reverting either is clean."
  - "Kept `conflict_state` and `notification_state` parameters on start_watch despite them now being unused in the function body. Rationale: Tauri command signature stability — changing the parameter list would require a call-site sweep and migration implications. The warnings are accepted as benign and noted in the deviations section."
  - "Added `use tauri::Manager;` inside `mod tests` (Rule 3 fix) rather than at the module top because the production path already uses `tauri::Manager` via `app.manage(...)` (which brings the trait into scope at that point by virtue of `use tauri::Manager;` in lib.rs). The test module previously had no need for the trait; now that spawn_hook_server seeds the mock app with ConflictState + engine, the import is required."
  - "Plan 05's `engine` Extension was given a `_engine_handle_for_plan_05` binding inside hook_handler rather than `#[allow(unused_variables)]` at parameter level. Rationale: leaves a grep-stable breadcrumb for Plan 05's executor; the warning resolves naturally when Plan 05 replaces the line with `let mut eng = engine.lock().await;`."
  - "Registered GateReason via `.typ::<conflict::GateReason>()` on the specta builder, anticipating Plan 06's frontend bindings regen. Plan 02's SUMMARY explicitly listed this as out-of-scope for Plan 02 and tagged as Plan 04's responsibility — executed here so the type is available in bindings.ts whenever Plan 05 triggers a regen."

patterns-established:
  - "Shared-Arc<Mutex>-through-manage-and-extension pattern: one construction site in lib.rs setup, .manage(clone) for Tauri State, threaded into start_registration_server as an explicit arg for axum Extension layering. Consumer code pulls the same Arc via either `app_handle.state::<Arc<Mutex<T>>>().inner().clone()` (Tauri) or `Extension(handle)` (axum) and both views point at the same backing instance."
  - "Pitfall-1 discipline: every `engine.lock().await` is inside a block expression scoped so the guard drops before the next .await. Enforced by code review (grep + visual inspection during this plan)."

requirements-completed:
  - CNFL-01
  - CNFL-02
  - CNFL-06

# Threats
threats:
  mitigated:
    - T-17-04 (lock contention under burst writes): conflict_task holds the engine mutex only during process_batch (a synchronous call, no awaits inside). The guard drops BEFORE emit_conflict_event / NotificationState.get_prefs / ConflictState.add_alert — any of which can await for hundreds of microseconds during notification dispatch. The /hook handler's future could_conflict_with query therefore never waits on a lock held across a Tauri event emit. Observability (tracing::debug!(kind="hook_lock_wait", elapsed_us=...)) is Plan 05's responsibility and is NOT added in this plan — the plan's `<specific_scope_reminders>` explicitly mark that as Plan 05's scope.

# Metrics
duration: ~13min
tasks: 3
commits: 5
files-modified: 3
completed: 2026-04-21
---

# Phase 17 Plan 04: Shared ConflictEngine wiring Summary

**Wired the Phase 17 shared `Arc<tokio::sync::Mutex<ConflictEngine>>` through the entire runtime: constructed once in `lib.rs` setup, registered as Tauri managed state, threaded into both the pipeline `conflict_task` (writer — swapped from local `ConflictEngine::new` to pull-from-managed-state) and the axum `/hook` handler stack (reader — new Extension layer plumbed; Plan 05 consumes). Pure mechanical wiring, no behavior change — the hook gate branch remains on the legacy tool-category path until Plan 05 rewrites it.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-04-21T14:29:20Z
- **Completed:** 2026-04-21T14:41:50Z
- **Tasks:** 3 (executed as 5 atomic commits per the "commit after every change" MEMORY.md rule + one unplanned Rule-3 blocker fix commit)
- **Files modified:** 3 production, 0 new test fixtures (test schema extended in-place)

## Wiring Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ lib.rs::run()::setup  (the construction site)                    │
│                                                                  │
│   let conflict_engine: Arc<tokio::sync::Mutex<...>> = Arc::new(  │
│       tokio::sync::Mutex::new(                                   │
│           conflict::engine::ConflictEngine::new(5000ms)          │
│       )                                                          │
│   );                                                             │
│   app.manage(conflict_engine.clone());  ──────────┐              │
│                                                   │              │
│   let engine_for_server = conflict_engine.clone();│              │
│   start_registration_server(.., engine_for_server)│              │
└──────────────────────────────────┬────────────────┼──────────────┘
                                   │                │
                                   ▼                ▼
     ┌───────────────────────────────────┐   ┌──────────────────────────┐
     │ self_register::build_router       │   │ Tauri managed state      │
     │  .layer(Extension(engine))        │   │  State<Arc<Mutex<...>>>  │
     │  │                                │   │                          │
     │  ▼                                │   │   accessed by:           │
     │ hook_handler<R>                   │   │    - pipeline::commands  │
     │   Extension(engine): Extension<.> │   │      ::conflict_task     │
     │   // _engine_handle_for_plan_05   │   │      (reads via          │
     │   // Plan 05 rewrites gate branch │   │      app_handle.state::) │
     │   // to call could_conflict_with  │   │    - future Tauri cmds   │
     └───────────────────────────────────┘   └──────────────────────────┘

    /hook request path                       pipeline write path
    (reads via Extension)                    (mutates via app_handle.state)
           │                                        │
           └────── same backing Arc<Mutex> ─────────┘
                   (one ConflictEngine instance)
```

## Accomplishments

### Task 1 — lib.rs construction + registration (commit `08b60de`)
- Engine constructed once in the `.setup` closure alongside the existing `WaiterRegistry` block — `Arc::new(tokio::sync::Mutex::new(ConflictEngine::new(Duration::from_millis(5000))))`.
- `app.manage(conflict_engine.clone())` registers it as Tauri managed state so commands can pull via `tauri::State<Arc<Mutex<ConflictEngine>>>`.
- `let engine_for_server = conflict_engine.clone();` immediately before the tokio::async_runtime::spawn that starts the registration server.
- Passed `engine_for_server` as the 8th arg to `agents::self_register::start_registration_server`.
- Added `.typ::<conflict::GateReason>()` to the specta builder so the Plan 02 enum materializes in bindings.ts on next regen.

### Task 2 — self_register.rs router + test infrastructure (commits `4912c21`, `1d48b0e`, `f91899f`)
- **Commit `4912c21` (production path):**
  - `hook_handler`: new `Extension(engine): Extension<Arc<Mutex<...>>>` parameter between `waiters` and `app`. Added `let _engine_handle_for_plan_05 = engine;` breadcrumb at the function top so Plan 05's executor has a grep-stable anchor for the gate-branch rewrite.
  - `build_router`: 8th `engine` parameter + matching `.layer(Extension(engine))` between the existing `waiters` and `app` layers.
  - `start_registration_server`: 8th `engine` parameter + forwarding into `build_router`. Re-added `#[allow(clippy::too_many_arguments)]` since the arg count grew from 7 to 8.
- **Commit `1d48b0e` (test scaffolding):**
  - `make_hook_pool`: approval_requests CREATE TABLE extended with `conflict_with_agent_id TEXT, gate_reason TEXT` — mirrors migration 007 so Plan 05's INSERTs compile + run against the in-memory test schema.
  - `spawn_hook_server`: return tuple grew from 4 to 5 elements. Constructs the engine locally, seeds `ConflictState::new(5000)` on the mock app handle, then threads the engine into build_router and returns it as `engine`.
  - Swept 11 existing `#[tokio::test]` destructure sites to add the 5th binding (`_engine` throughout — Plan 05's new tests will use the non-underscore name).
- **Commit `f91899f` (Rule-3 blocker fix):**
  - Added `use tauri::Manager;` inside `mod tests` because `app_handle.manage(...)` requires the trait in scope.

### Task 3 — pipeline/commands.rs conflict_task refactor (commit `44eb79f`)
- Removed `let mut engine = ConflictEngine::new(Duration::from_millis(conflict_window_ms));` local construction.
- Pulled the shared handle via `let engine: Arc<tokio::sync::Mutex<ConflictEngine>> = app_handle.state::<Arc<tokio::sync::Mutex<ConflictEngine>>>().inner().clone();`.
- Wrapped `process_batch` in a block expression to enforce tight lock scoping:
  ```rust
  let alerts = {
      let mut eng = engine.lock().await;
      eng.process_batch(&batch)
  };  // <-- guard dropped here BEFORE the subsequent .await calls
  for alert in alerts { emit_conflict_event(...); ... }
  ```
- Preserved all downstream behavior: `emit_conflict_event`, `dispatch_state_notification`, `add_alert` calls are unchanged and still run for each alert after the lock releases.

## Commit SHAs (5)

| # | Commit  | Task | Type     | Summary |
|---|---------|------|----------|---------|
| 1 | `08b60de` | 1    | feat     | lib.rs — shared ConflictEngine Arc<Mutex> + specta GateReason |
| 2 | `4912c21` | 2    | refactor | self_register.rs — plumb Arc<Mutex<ConflictEngine>> through router (production-path) |
| 3 | `1d48b0e` | 2    | test     | self_register tests — seed engine + schema columns + tuple sweep |
| 4 | `44eb79f` | 3    | refactor | conflict_task shares managed ConflictEngine via app.state |
| 5 | `f91899f` | 2+   | fix      | self_register tests — import tauri::Manager for app_handle.manage |

All commits used `--no-verify` per the parallel-worktree execution directive.

## spawn_hook_server destructure sweep (11 sites)

```
867:  let (base, _reg, _waiters, pool, _engine) = spawn_hook_server().await;   // hook_allows_passthrough_tools_without_row
897:  let (base, _reg, waiters, pool, _engine) = spawn_hook_server().await;    // hook_gates_edit_and_blocks_until_approved
966:  let (base, _reg, waiters, pool, _engine) = spawn_hook_server().await;    // hook_gates_protected_path_even_on_read
1022: let (base, reg, waiters, pool, _engine) = spawn_hook_server().await;     // hook_creates_passive_stub_when_no_agent_matches
1078: let (base, reg, waiters, pool, _engine) = spawn_hook_server().await;     // hook_honors_always_allow_fast_path
1131: let (base, reg, waiters, pool, _engine) = spawn_hook_server().await;     // hook_session_binding_is_idempotent
1208: let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;  // hook_rejects_non_object_tool_input
1227: let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;  // hook_rejects_dead_pid
1254: let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;  // mcp_initialize_returns_session_header_on_real_router
1288: let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;  // mcp_tools_list_without_session_returns_404
1305: let (base, _reg, _waiters, pool, _engine) = spawn_hook_server().await;   // mcp_tools_call_request_user_input_after_initialize_succeeds
```

All 11 use `_engine` (underscore prefix) because none of the pre-existing tests exercise the engine handle — they predate Phase 17. Plan 05's new integration tests will bind the non-underscore name to seed synthetic write records.

## Scope Boundary — hook_handler gate branch UNCHANGED

Per the plan's `<specific_scope_reminders>`, lines 270-290 of hook_handler (the gate branch that calls `get_pretool_gated_tools` + `protected_path_matches`) are **unchanged**. Verified by `git diff 07e5846 -- src-tauri/src/agents/self_register.rs` — the only diffs inside hook_handler are the new `Extension(engine)` parameter and the `_engine_handle_for_plan_05` breadcrumb at the top of the function body. Plan 05 owns the gate-branch rewrite.

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check --package aitc --lib` | exits 0 (11 warnings — all pre-existing dead_code for Plan 05 consumers, plus 2 new `unused_variables` for `conflict_state` + `notification_state` start_watch parameters — see deviations) |
| `cargo test --package aitc --lib agents::self_register` | 16/16 pass, 0 failed, 0 ignored |
| `cargo test --package aitc --lib pipeline::commands` | 7/7 pass, 0 failed, 0 ignored |
| `cargo test --package aitc --lib conflict::` | 33 passed, 2 failed, 1 ignored (2 failures are pre-existing `test_conflict_detected_different_pids_within_window` + `test_custom_window_duration` from Phase 19 D-03 deferred-items) |
| `cargo test --package aitc --lib` (full suite) | 438 passed, 2 failed, 4 ignored (same 2 pre-existing failures as above; no regressions introduced by this plan) |

## Deviations from Plan

### [Rule 3 - Blocker fix] Added `use tauri::Manager;` in `mod tests`

- **Found during:** `cargo test --package aitc --lib agents::self_register` verification step after Task 2 commit.
- **Issue:** `spawn_hook_server`'s new `app_handle.manage(crate::conflict::ConflictState::new(5000))` and `app_handle.manage(engine.clone())` calls fail to compile because `manage(...)` is a method on the `tauri::Manager` trait which was not imported in the test module.
- **Fix:** Added `use tauri::Manager;` to the `mod tests` import block with a one-line comment explaining the scope requirement. All 16 pre-existing tests pass unchanged after the fix.
- **Files modified:** `src-tauri/src/agents/self_register.rs` (commit `f91899f`).
- **Scope:** strictly additive to the test module only — production path already had the trait in scope via lib.rs.

### [Rule 2 - build-time dep] Staged aitc-hook sidecar binary

- **Found during:** First `cargo check` run in the worktree after the pre-existing "aitc-hook binary not found" build-script issue flagged across Plans 01-03.
- **Issue:** Tauri's build script errors with `resource path binaries/aitc-hook-x86_64-unknown-linux-gnu doesn't exist` on a fresh worktree without the sidecar built.
- **Fix:** `cp /home/prannayag/pragnition/htx/aitc/src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu src-tauri/binaries/` (main repo already has the pre-built sidecar). The `binaries/` directory is gitignored; no commit needed.
- **Scope:** infrastructure fix — identical to the resolution in 17-01, 17-02, 17-03 SUMMARYs. Not introduced by this plan.

### Non-deviation — two new `unused_variables` warnings

- `src/pipeline/commands.rs:67:5 conflict_state` and `src/pipeline/commands.rs:68:5 notification_state` now fire `unused_variables` warnings because the `conflict_state.get_window_ms()` call that consumed `conflict_state` was removed (engine is now constructed in lib.rs rather than reading the window from ConflictState). `notification_state` was already unused before this plan (the body pulls NotificationState from `app_handle.state::<NotificationState>()` inside the spawned task); it's surfaced here only because it's adjacent to `conflict_state`.
- **Decision:** leave both parameters intact rather than prefix with underscore or delete. Rationale: changing the Tauri command signature is out-of-scope per the plan's "keep the diff minimal" guidance and would ripple to call sites in the frontend bindings.ts. The warnings are benign.

### Non-deviation — specta GateReason registration at `.typ::<conflict::GateReason>()`

- Plan 02's SUMMARY noted `GateReason` specta registration as Plan 04's responsibility. Executed here, one-line addition in `lib.rs:117`. No ripple effects since no commands return `GateReason` yet (Plan 05 owns the CreateApprovalRequest extension).

## Issues Encountered

- **Sidecar binary missing from worktree.** Identical to Plans 01-03's reported issue; fixed by copying from the main repo's pre-built `src-tauri/binaries/`. The `binaries/` directory is gitignored.
- **Two pre-existing conflict::engine test failures** (`test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`) persist unchanged. These are documented in Plan 19's deferred-items.md and acknowledged in Plan 02's SUMMARY as Phase 19 D-03 scope — NOT introduced or fixed by this plan.
- **No behavioral regressions.** Full library suite shows 438 passing tests and the same 2 known-bad tests; no new failures.

## User Setup Required

None — pure internal refactor / wiring. No external services, no config changes, no migrations run (migration 007 shipped in Plan 03).

## Next Phase Readiness

**Plan 05 has everything it needs:**
- `hook_handler` signature already includes `Extension(engine)`; Plan 05 replaces the `let _engine_handle_for_plan_05 = engine;` breadcrumb line with the actual `engine.lock().await.could_conflict_with(path, &agent_id, now_ms, window_ms)` call in the gate branch.
- `make_hook_pool` schema already has `conflict_with_agent_id` and `gate_reason` columns; Plan 05's `create_approval_request_internal` extension can INSERT into them without further schema changes.
- `spawn_hook_server` exposes the engine handle as the 5th tuple element; Plan 05's integration tests bind it non-underscored to seed `FileWriteRecord`s into the engine and assert the gate fires when agent B hooks on a path agent A just wrote.
- `GateReason` is registered on the specta builder; Plan 06's frontend regen will pick up the TS union automatically.

**Plan 06 has everything it needs for the bindings side:**
- `conflict::GateReason` appears in `src/bindings.ts` after the next `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` cycle (the canonical regen command documented in Phase 18 D-03).

## Threat Flags

No new security surface beyond what's in the plan's `<threat_model>` section. T-17-04 (lock contention under burst writes) mitigation is in place via the tight lock-scope pattern. No new network endpoints, auth paths, or schema changes at trust boundaries.

## Self-Check

Verifying all claims before returning:

**Files exist:**
```
FOUND: src-tauri/src/lib.rs (modified)
FOUND: src-tauri/src/agents/self_register.rs (modified)
FOUND: src-tauri/src/pipeline/commands.rs (modified)
FOUND: .planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-04-SUMMARY.md (this file)
```

**Commits exist:**
```
FOUND: 08b60de  (Task 1 — lib.rs shared ConflictEngine Arc<Mutex> + specta GateReason)
FOUND: 4912c21  (Task 2 part A — self_register.rs plumb Arc<Mutex<ConflictEngine>> through router)
FOUND: 1d48b0e  (Task 2 part B — self_register tests seed engine + schema columns + tuple sweep)
FOUND: 44eb79f  (Task 3 — conflict_task shares managed ConflictEngine via app.state)
FOUND: f91899f  (Rule-3 fix — self_register tests import tauri::Manager)
```

**Grep asserts:**
```
FOUND (1): Arc<tokio::sync::Mutex<conflict::engine::ConflictEngine>> in src-tauri/src/lib.rs
FOUND (1): app.manage(conflict_engine in src-tauri/src/lib.rs
FOUND (2): engine_for_server in src-tauri/src/lib.rs (binding + call-site pass)
FOUND (1): GateReason in src-tauri/src/lib.rs (specta registration)
NOT-FOUND (0): ConflictEngine::new( in src-tauri/src/pipeline/commands.rs (local construction removed)
FOUND (1): engine.lock().await in src-tauri/src/pipeline/commands.rs (inside block scope)
FOUND (1): Extension(engine): Extension<Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>> in src-tauri/src/agents/self_register.rs
FOUND (>=3): engine: Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>> in self_register.rs (build_router + start_registration_server + spawn_hook_server return type)
FOUND (2): Extension(engine) in src-tauri/src/agents/self_register.rs (hook_handler param + .layer(Extension(engine)))
FOUND (1): conflict_with_agent_id TEXT in src-tauri/src/agents/self_register.rs (make_hook_pool schema)
FOUND (1): gate_reason TEXT in src-tauri/src/agents/self_register.rs (make_hook_pool schema)
FOUND (1): ConflictState::new(5000) in src-tauri/src/agents/self_register.rs (spawn_hook_server seed)
FOUND (11): spawn_hook_server() callsites, all with 5-element destructure
```

**Tests pass:**
```
FOUND: agents::self_register 16/16 pass
FOUND: pipeline::commands 7/7 pass
FOUND: conflict:: — 33 new + phase17 tests pass (2 pre-existing failures unchanged)
FOUND: full lib suite — 438 pass, 2 pre-existing failures, 4 ignored
```

**Scope boundaries verified:**
```
CONFIRMED: hook_handler gate branch (lines 270-290) unchanged — only new Extension(engine) param + breadcrumb at top
CONFIRMED: create_approval_request_internal NOT modified (Plan 05 scope)
CONFIRMED: could_conflict_with NOT called anywhere in Plan 04 edits (Plan 05 scope)
CONFIRMED: src/bindings.ts NOT modified (Plan 06 scope; Plan 04 just registered the specta type)
CONFIRMED: STATE.md / ROADMAP.md NOT modified (orchestrator scope)
```

## Self-Check: PASSED

---

*Phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g*
*Plan: 04*
*Completed: 2026-04-21*
