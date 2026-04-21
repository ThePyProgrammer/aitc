---
phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s
plan: 02
subsystem: infra
tags: [stream-json, tokio-process, sqlx, mpsc, fifo, bufreader, claude-resume, tauri-specta, uuidv4, serde-json]

requires:
  - phase: 10
    plan: 01
    provides: agent_events schema, db/events CRUD skeleton, chat_runtime module tree with todo!("Plan 02") markers, 7 stream-json fixtures, LiveSessionRegistry scaffold, six Tauri command scaffolds

provides:
  - Working stream-json NDJSON parser that never panics on malformed input
  - FIFO serial stdin writer with BrokenPipe → unsupported lifecycle
  - launch_live_session builder/spawner with piped stdio (attached mode)
  - Long-lived subprocess supervisor emitting session_boundary + agent-session-ended
  - Auto-resume fallback path with UUIDv4 argv validation (T-10-11) + 256 KiB cap (T-10-09)
  - Complete LiveSessionRegistry implementation (register, get_stdin_tx, mark_archived, bind_session_id, mark_read)
  - db::events CRUD with sequence_number auto-computation and defensive user_text-only delivery updates
  - Six real Tauri command bodies (send_chat_message_to_agent, list_agent_events, list_chat_channels, clear_agent_thread, mark_agent_events_read, relaunch_agent_session stub)
  - adapter_chat_duplex capability rule (claude-code only for v1)
  - 50 backend tests across parser, outbound, launcher, supervisor, auto_resume, session_registry, db::events, commands

affects:
  - Plan 03 (MCP /mcp routes will read from the same LiveSessionRegistry)
  - Plan 04 (agents/claude_code.rs adapter will call launch_live_session + spawn_supervisor + spawn_outbound_writer)
  - Plan 05 (frontend consumes agent-event-appended / agent-delivery-updated / agent-session-started / agent-session-ended / agent-turn-complete / agent-thread-cleared / agent-events-marked-read emissions from these modules)
  - Plan 06 (CommsView integration calls send_chat_message_to_agent / list_chat_channels / clear_agent_thread / mark_agent_events_read / relaunch_agent_session through the bindings)

tech-stack:
  added:
    - tokio dev-features "test-util" + "io-util" (for tokio::time::advance + start_paused + duplex in parser idle-flush tests)
  patterns:
    - "Factored-out inner function pattern for Tauri commands: `send_chat_message_to_agent_inner` takes plain refs; the `#[tauri::command]` wrapper is a thin forwarder. Unit tests exercise the inner function without constructing Tauri State."
    - "Generic reader body pattern: `drive_stream_json_reader<R: AsyncRead>` accepts both real `ChildStdout` and `tokio::io::DuplexStream` so the parser can be fuzz-tested against fixture bytes without a child process."
    - "serde_json-envelope never-format! pattern: outbound JSONL frames use `serde_json::json!(...)` + `to_string` exclusively. Content escaping is handled by the JSON encoder; tests cover quote/backslash/newline round-trips (T-10-06)."
    - "Defensive WHERE filter pattern: `UPDATE agent_events SET delivery_status = ? WHERE id = ? AND event_type = 'user_text'` refuses to flip status on assistant/tool rows. Caller's event_id being wrong silently becomes a no-op."
    - "Conservative default on LiveSessionRegistry::is_archived — unknown agent_id ⇒ archived=true. Callers always route through auto_resume when in doubt."
    - "Explicit Option<T> decode pattern on nullable sqlx columns: `row.try_get::<Option<String>, _>(...).unwrap_or(None)`. Default String decode silently yields \"\" for NULL, which was the Task 1 bug."

key-files:
  created: []
  modified:
    - src-tauri/src/chat_runtime/types.rs (MAX_CHAT_MESSAGE_BYTES + MAX_STREAM_JSON_LINE_BYTES constants)
    - src-tauri/src/chat_runtime/session_registry.rs (full LiveSessionRegistry impl + 8 tests)
    - src-tauri/src/chat_runtime/parser.rs (stream-json reader + dispatcher + stderr reader + 8 fixture tests)
    - src-tauri/src/chat_runtime/outbound.rs (FIFO writer + 4 tests)
    - src-tauri/src/chat_runtime/launcher.rs (launch_live_session + build_argv + 4 tests)
    - src-tauri/src/chat_runtime/supervisor.rs (wait + mark_archived + session_boundary row + 2 tests)
    - src-tauri/src/chat_runtime/auto_resume.rs (one-shot --resume + UUIDv4 validator + 4 tests)
    - src-tauri/src/chat_runtime/commands.rs (6 Tauri commands + adapter_chat_duplex + 10 tests)
    - src-tauri/src/db/events.rs (insert/list/update/delete + find_last_user_text_id + 8 tests)
    - src-tauri/Cargo.toml (dev tokio features test-util + io-util)
    - src/bindings.ts (clearAgentThread return type auto-regen: Result<null,...> → Result<number,...>)

key-decisions:
  - "adapter_chat_duplex is a Plan-02-local rule: `matches!(adapter_type, \"claude-code\")`. Plan 04 may widen this when the AgentAdapter trait grows a capability API; until then, the inline match keeps Codex/OpenCode read-only honestly (D-02)."
  - "Parser uses an aggregator-style `mpsc::Sender<StreamEvent>` sink rather than performing inline DB writes. The reader task is pure-logic; a downstream aggregator (Plan 04 supervisor-side) owns `insert_agent_event` + `app.emit`. Keeps the parser testable against byte streams without pool/app plumbing."
  - "ToolUse events carry `approval_request_id: None` for Plan 02; the hook-waiter-registry lookup for correlating tool_use → pending approval is deferred to Plan 04. UI renders the tool card either way (D-15 tolerates nullable FK)."
  - "is_valid_uuidv4 accepts the classic 8-4-4-4-12 hyphenated shape without enforcing the v4-specific bit pattern. Auto-resume accepts whatever session_id Claude gave us on init, as long as it's UUID-shaped — this matches observed Claude Code behaviour from the fixture captures."
  - "build_argv factored out of launch_live_session as a pure function — enables argv-assertion tests without spawning any subprocess. Three argv tests verify: stream-json flag ordering, --mcp-config pair inclusion, flag-pair omission when path is None."
  - "Returning `Result<u64, String>` (rows_affected) from clear_agent_thread instead of `Result<(), String>` — frontend will show a UI toast with \"Cleared N events\". Plan 01's empty default was a scaffold; this plan is authoritative and bindings.ts regenerates automatically."
  - "250ms idle-flush uses `tokio::time::sleep_until(idle_deadline)` in the select! loop; idle_deadline is re-armed only when a text_delta actually accumulates, so the timer is effectively off when there's no pending text. Alternative (`tokio::time::timeout` wrapping next_line) would fire constantly."
  - "Parser's `text_delta_seen` return from `dispatch_line` plumbs the re-arm signal back to the select! loop. Cleaner than making `dispatch_line` mutate the deadline directly."

patterns-established:
  - "Generic reader body (`drive_stream_json_reader<R: AsyncRead + Unpin>`) enables both production use with `ChildStdout` and test use with `tokio::io::duplex` byte streams. Plan 04's claude_code adapter re-uses this by calling `spawn_stream_json_reader(child.stdout.take()?, ...)`."
  - "Inner-function pattern for Tauri commands: `*_inner(pool: &SqlitePool, sessions: &Arc<...>, ...)` lets `#[cfg(test)] mod tests` drive the business logic without `tauri::State<'_, T>`. Tauri wrapper is a 3-line forwarder."
  - "Dev-only tokio feature opt-in (test-util + io-util) via [dev-dependencies] block. Keeps the runtime binary free of test-mode APIs while enabling advance/pause in tests."
  - "Build-argv pure function — any subprocess launcher with multi-branch argv should extract `fn build_argv(...) -> Vec<String>` so the exact argv shape is unit-testable without spawning."

requirements-completed: []

duration: 60 min
completed: 2026-04-17
---

# Phase 10 Plan 02: Chat Runtime Backend Summary

**Long-lived Claude Code stream-json runtime wired end-to-end: parser never panics on malformed input, FIFO outbound writer with BrokenPipe→unsupported lifecycle, supervisor-driven session_boundary row on exit, and auto-resume fallback with UUIDv4 argv validation**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-04-17T10:00Z (approx.)
- **Completed:** 2026-04-17T11:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 11 (10 Rust source + 1 bindings.ts auto-regen) + Cargo.toml dev-deps

## Accomplishments

- Stream-json parser parses all 7 Plan 01 fixtures deterministically: single_turn_text, multi_turn_persistent (session_id preserved across turns), tool_use_edit (ToolUse before TurnComplete), tool_result, hook_started_response (SystemNote, NOT AssistantText — Pitfall 2), result_completed, and malformed (zero panics, zero spurious events).
- FIFO outbound writer preserves strict order under 3-frame contention; BrokenPipe promotes delivery status to "unsupported" within 100ms and exits the writer task cleanly; JSON escaping round-trips backslash + newline + quote inside the content string.
- launch_live_session produces the exact argv shape per RESEARCH.md Pattern 1, including positional intent last; Windows process-detach flags deliberately NOT set (piped stdio needs attached parent).
- Supervisor emits `agent-session-ended` + inserts `session_boundary` row with `{kind:"ended", reason, exit_code, session_id}` on child.wait() return. Verified against /bin/true (completed, exit=0) and /bin/false (crashed, exit=1).
- Auto-resume validates content size (T-10-09, 256 KiB max) and session_id shape (T-10-11, UUIDv4 hyphenated) BEFORE spawning `claude --resume`. All argv via .arg() — never shell interpolation.
- send_chat_message_to_agent enforces the 256 KiB cap BEFORE any DB write; zero rows are persisted on oversize reject. Read-only adapters (codex) insert a `delivery_status='unsupported'` row; duplex adapters with a live session insert `'queued'` and enqueue an OutboundFrame; duplex adapters without a live session fall through to auto_resume.
- 50 backend tests green: 8 parser + 4 outbound + 4 launcher + 2 supervisor + 4 auto_resume + 8 session_registry + 8 db::events + 10 commands + 1 chat_runtime_smoke carryover + 1 hidden `send_to_unknown_agent_returns_err`.
- Zero `todo!` macros remaining in `src-tauri/src/chat_runtime/` and `src-tauri/src/db/events.rs`; `mcp/` still carries 3 `todo!("Plan 03")` markers (expected).
- bindings.ts auto-regenerated with `clearAgentThread: Promise<Result<number, string>>` (was Result<null, ...> in Plan 01's scaffold).

## Task Commits

1. **Task 1: session_registry + events.rs CRUD + size caps** — `af8efee` (feat)
2. **Task 2: stream-json parser + outbound writer + launcher + supervisor + auto_resume** — `9df20f4` (feat)
3. **Task 3: real Tauri command bodies for chat_runtime** — `632a945` (feat)

_Plan metadata + SUMMARY.md to be committed alongside STATE.md / ROADMAP.md updates._

## Files Created/Modified

### Backend (Rust)

- `src-tauri/src/chat_runtime/types.rs` — Added `MAX_CHAT_MESSAGE_BYTES = 256 KiB` (T-10-09) and `MAX_STREAM_JSON_LINE_BYTES = 1 MiB` (T-10-07) public constants. Other type bodies untouched.
- `src-tauri/src/chat_runtime/session_registry.rs` — Full `LiveSessionRegistry` impl: `register` (replaces; drops prior sender), `get_stdin_tx` (returns None when archived), `mark_archived`, `is_archived` (defaults true for unknown agent_id), `bind_session_id`, `session_id_for`, `mark_read` (RFC3339), `last_read_for`, `remove`. 8 tests including a 1000-iteration no-deadlock stress test.
- `src-tauri/src/chat_runtime/parser.rs` — `spawn_stream_json_reader` + `drive_stream_json_reader<R: AsyncRead>` generic body + per-top-type dispatchers (`dispatch_system`, `dispatch_stream_event`, `dispatch_assistant`, `dispatch_user`, `dispatch_result`) + `spawn_raw_stderr_reader`. 250ms idle-flush via re-armed `sleep_until`. 8 fixture tests.
- `src-tauri/src/chat_runtime/outbound.rs` — `spawn_outbound_writer` + `drive_outbound_writer<W: AsyncWrite>` generic body. JSONL envelope built via `serde_json::json!` + `to_string` (T-10-06). 4 tests covering single-frame, FIFO ordering, BrokenPipe promotion, and JSON special-char escaping.
- `src-tauri/src/chat_runtime/launcher.rs` — `build_argv` pure function + `launch_live_session` spawning with `Stdio::piped()` on all three pipes. Windows process-detach flags intentionally omitted. 4 tests (three argv shape + one error-on-missing-program).
- `src-tauri/src/chat_runtime/supervisor.rs` — `spawn_supervisor<R: Runtime>` / `run_supervisor` consuming `Child`, waiting, inserting session_boundary row, emitting SessionEndedPayload via `app_handle.emit`. Signature added `pool: SqlitePool` argument (Plan 01's sig was missing it). 2 tests against /bin/true + /bin/false.
- `src-tauri/src/chat_runtime/auto_resume.rs` — `auto_resume_send<R: Runtime>(agent_id, content, session_id, cwd, pool, app_handle)` using refs (plan pseudocode) instead of Plan 01's by-value signature. `is_valid_uuidv4` classic-shape validator. 4 tests (UUID accepts+rejects, oversize rejected, invalid sid rejected, missing sid rejected).
- `src-tauri/src/chat_runtime/commands.rs` — Six full Tauri command bodies + inner helpers (`send_chat_message_to_agent_inner`, `list_chat_channels_inner`) + `adapter_chat_duplex`. Signature additions: `registry: State<Arc<AgentRegistry>>` on `send_chat_message_to_agent` and `list_chat_channels`; `clear_agent_thread` now returns `Result<u64, String>`. 10 tests.
- `src-tauri/src/db/events.rs` — Full CRUD: `insert_agent_event` with sequence_number auto-computation scoped to session_id, `list_events_for_agent` with paginated before_id cursor + limit clamp[1,200], `update_event_delivery_status` with defensive `AND event_type='user_text'` filter, `delete_events_for_agent` returning rows_affected, `find_last_user_text_id` for the consumed-flip path. `map_agent_event_row` rewritten with explicit `Option<T>` decodes to avoid the sqlx-sqlite NULL→"" String quirk. 8 tests including the 006-migration-body idempotency check.
- `src-tauri/Cargo.toml` — `[dev-dependencies] tokio = { ..., features = ["time", "sync", "rt-multi-thread", "macros", "process", "test-util", "io-util"] }` for the parser idle-flush test. Runtime feature set unchanged.

### Frontend (TS — auto-regen only)

- `src/bindings.ts` — tauri-specta regenerated `clearAgentThread` from `Result<null, string>` to `Result<number, string>` (reflects the u64 rows_affected return). No consumer exists yet; Plan 06 wires it.

## Tauri Emit Event Names (ready for frontend subscription)

The following Tauri emit event names are wired by this plan (Plan 05 chatStore will subscribe):

- `agent-event-appended` — payload `AgentEvent`. Emitted by `send_chat_message_to_agent` on every row insert (duplex + readonly paths) AND by `auto_resume_send` on the user_text insert. (Plan 04 supervisor-aggregator path will also emit on parser-originated rows.)
- `agent-session-ended` — payload `SessionEndedPayload`. Emitted by `supervisor::run_supervisor` after `child.wait()`.
- `agent-thread-cleared` — payload `String` (agent_id). Emitted by `clear_agent_thread`.
- `agent-events-marked-read` — payload `String` (agent_id). Emitted by `mark_agent_events_read`.

The following are declared by the parser's StreamEvent surface and will be emitted by Plan 04's aggregator (which consumes `StreamEvent`s and writes rows + emits):

- `agent-session-started` — payload `SessionStartedPayload` (emitted on first `{type:"system", subtype:"init"}`).
- `agent-turn-started` — (emitted on first AssistantDelta of a turn).
- `agent-turn-complete` — (emitted on `{type:"result"}`).
- `agent-delivery-updated` — payload `DeliveryUpdate` (emitted by the outbound writer on delivered/unsupported transitions).

## Decisions Made

See `key-decisions` in the frontmatter. Core decisions:

1. **Aggregator-style parser**: the stdout reader is pure-logic and emits `StreamEvent`s onto an `mpsc::Sender`. A downstream aggregator (Plan 04's supervisor-side) owns the DB + emit side effects. This keeps the parser driver-testable against pure byte streams with zero pool / app plumbing. The trade-off: turn-complete → consumed status flip is deferred to the aggregator (tested via `find_last_user_text_id` which is ready).
2. **adapter_chat_duplex inline match**: Plan 02 hard-codes `"claude-code" ⇒ duplex` because the AgentAdapter trait doesn't yet expose a capability API. Plan 04 can widen this by adding `fn chat_capability(&self) -> ChatCapability` on the trait; for now, Codex/OpenCode/Generic honestly report read-only (D-02), which is the only behavior we ship in v1 anyway.
3. **Auto-resume uses argv-only `.arg()` calls, never shell**: T-10-11 mitigation is enforced structurally by the Tokio Command API — there is no `.shell()` equivalent, every `.arg()` escapes — plus the UUIDv4 regex-equivalent shape check as defense in depth.
4. **Supervisor signature extended with `pool: SqlitePool`**: Plan 01's scaffold lacked the pool arg. Rule 3 blocker auto-fix: the session_boundary row on exit requires a pool. The `agents/claude_code.rs` adapter (Plan 04) owns the pool-threading at call site.
5. **auto_resume takes refs, not owned values**: the plan pseudocode shows `&str` / `&SqlitePool` / `&AppHandle`; Plan 01's stub took owned types. Task 2 switched to refs to avoid pointless clones in the commands.rs caller. No public API break because Plan 01's auto_resume was still a `todo!`.
6. **Explicit `Option<T>` decodes in `map_agent_event_row`**: the Plan 01 scaffold used `try_get(...).ok()` with type inferred as `String`; on NULL columns sqlx-sqlite silently decodes NULL as `""`, which made the Plan 02 update_event_delivery_status test fail (user_text row showed `Some("")` after an assistant row got a (no-op) update applied). Switched all nullable columns to `try_get::<Option<T>, _>(...).unwrap_or(None)`. Documented as a patterns-established entry.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explicit `Option<T>` decodes in `map_agent_event_row` for NULL columns**
- **Found during:** Task 1 (db::events::tests::update_event_delivery_status_only_touches_user_text)
- **Issue:** Plan 01 scaffolded `map_agent_event_row` with `row.try_get("delivery_status").ok()`. The type inference landed on `T = String`, and sqlx-sqlite silently decodes NULL text columns as `""` — so `Some("")` leaked instead of `None`. The test expected the assistant_text row's `delivery_status` to be `None` (defensive UPDATE no-op), but saw `Some("")`.
- **Fix:** Rewrote `map_agent_event_row` with explicit `try_get::<Option<T>, _>(...).unwrap_or(None)` for every nullable column (session_id, approval_request_id, sequence_number, delivery_status). `None` now correctly propagates for NULL columns.
- **Files modified:** `src-tauri/src/db/events.rs` (map_agent_event_row)
- **Verification:** 8/8 db::events tests pass, including the migration 006 body idempotency test which exercises multiple NULL columns.
- **Committed in:** `af8efee` (Task 1 commit).

**2. [Rule 3 - Blocker] Add `[dev-dependencies] tokio` with test-util + io-util features**
- **Found during:** Task 2, first `cargo build --tests` after writing `parser.rs::idle_flush_after_250ms_delta_gap` + `outbound.rs::broken_pipe_emits_unsupported_and_breaks`
- **Issue:** `tokio::time::advance` and `Builder::start_paused` (for the parser idle-flush test) require `features = ["test-util"]`; `tokio::io::duplex` requires `features = ["io-util"]`. Both are used in tests but weren't enabled in dev-dependencies.
- **Fix:** Added `tokio = { version = "1", features = ["time", "sync", "rt-multi-thread", "macros", "process", "test-util", "io-util"] }` under `[dev-dependencies]`. Runtime binary feature set unchanged.
- **Files modified:** `src-tauri/Cargo.toml`
- **Verification:** `cargo build --tests` clean, parser idle-flush + outbound broken-pipe tests pass.
- **Committed in:** `9df20f4` (Task 2 commit).

**3. [Rule 3 - Blocker] Supervisor signature: add `pool: SqlitePool` argument**
- **Found during:** Task 2 (writing supervisor.rs)
- **Issue:** Plan 01's `spawn_supervisor` signature was `(child, agent_id, registry, app_handle)` — no pool arg. Plan 02 requires inserting a `session_boundary` row on wait-return (D-03). No pool ⇒ no insert.
- **Fix:** Added `pool: sqlx::SqlitePool` as the 4th arg; the claude_code adapter (Plan 04) will thread this through at its call site, same way it does for the existing `/hook` handler.
- **Files modified:** `src-tauri/src/chat_runtime/supervisor.rs`
- **Verification:** chat_runtime_smoke test still passes (that test only imports `LiveSessionRegistry` + `AgentEvent`, not `spawn_supervisor`).
- **Committed in:** `9df20f4` (Task 2 commit).

**4. [Rule 3 - Blocker] Drop generic `<R: tauri::Runtime>` on #[tauri::command] send_chat_message_to_agent / clear_agent_thread / mark_agent_events_read**
- **Found during:** Task 3, first `cargo build --tests`
- **Issue:** `#[tauri::command]` + `#[specta::specta]` + generic `<R: Runtime>` on the command function produced three `E0283: type annotations needed` errors. The comms/commands.rs precedent uses concrete `tauri::AppHandle` (not `tauri::AppHandle<R>`), and the `tauri_specta::Builder::<tauri::Wry>::new()` instantiation at the call site ties the Runtime anyway.
- **Fix:** Removed `<R: Runtime>` and made the three commands take concrete `tauri::AppHandle`. The inner helper functions (`send_chat_message_to_agent_inner`, `list_chat_channels_inner`) stay generic `<R: Runtime>` so tests can drive them with `tauri::test::mock_app`'s MockRuntime handle.
- **Files modified:** `src-tauri/src/chat_runtime/commands.rs`
- **Verification:** cargo build clean, tests green.
- **Committed in:** `632a945` (Task 3 commit).

**5. [Rule 3 - Blocker] clear_agent_thread return type change: `Result<(), String>` → `Result<u64, String>`**
- **Found during:** Task 3 (writing clear_agent_thread body)
- **Issue:** Plan 01 scaffolded `-> Result<(), String>` returning `Ok(())`. Plan 02 pseudocode specifies `-> Result<u64, String>` returning `rows_affected`. The frontend consumer doesn't exist yet (Plan 06 wires it); changing the signature regenerates bindings.ts cleanly.
- **Fix:** Return type changed to `Result<u64, String>`. `src/bindings.ts` auto-regenerated during cargo build — `clearAgentThread: Promise<Result<number, string>>`.
- **Files modified:** `src-tauri/src/chat_runtime/commands.rs`, `src/bindings.ts` (auto-regen)
- **Verification:** `grep -rn clearAgentThread src/` confirms only bindings.ts references it — no stale consumer.
- **Committed in:** `632a945` (Task 3 commit).

---

**Total deviations:** 5 auto-fixed (1 bug, 4 blockers)
**Impact on plan:** All five fixes tighten compile/behavior safety at task boundaries. The NULL-decode bug (Rule 1) would have leaked to every read path; all four blockers were purely compile-level (generic-command Rust type inference, dev-deps feature gate, Plan 01 scaffold signature mismatches). No scope creep, no downstream API break — `auto_resume_send` is called only from `send_chat_message_to_agent` (defined in this plan), and `spawn_supervisor` is called only by Plan 04's claude_code adapter (which doesn't exist yet).

## Remaining `todo!` Markers by File / Line

All in `mcp/` — intentional, Plan 03's scope:

- `src-tauri/src/mcp/tools.rs:22` — `todo!("Plan 03 — drain FIFO outbound queue; return list of pending text frames")`
- `src-tauri/src/mcp/tools.rs:30` — `todo!("Plan 03 / 04 — dispatch_chat_notification + register pending-input waiter")`
- `src-tauri/src/mcp/session_config.rs:19` — `todo!("Plan 03 — tempfile + atomic persist into <cwd>/.claude/mcp-<agent>.json")`

Plan 04 will leave `chat_runtime/notifications.rs::dispatch_chat_notification` body as a no-op and fill in the claude_code adapter path that calls `launch_live_session` + `spawn_supervisor` + `spawn_outbound_writer`. No Plan 04 markers remain in Plan 02 scope.

## Authentication Gates

None.

## Known Stubs

- `chat_runtime::commands::relaunch_agent_session` returns `Err("relaunch_agent_session: Plan 04 wires this via agents::commands::launch_agent".into())`. Registered with tauri-specta so the TS shim stays stable; Plan 04 replaces the body.
- `chat_runtime::commands::send_chat_message_to_agent` routes to `auto_resume_send` on the archived/no-session branch — which itself currently returns `Err("no session_id available for auto-resume")` when `session_id_for(agent_id)` is None. This is the *correct* behavior for v1: without a prior live session that captured session_id from the init envelope, there's nothing to resume against. Plan 04's adapter wires `launch_live_session` → parser → `bind_session_id` on init, so after first launch the session_id is known and auto-resume works.
- `parser.rs::dispatch_assistant` for `tool_use` blocks emits `StreamEvent::ToolUse { approval_request_id: None, ... }`. Plan 04 may wire the WaiterRegistry lookup (`waiters.find_pending_by_tool_name_and_session`) to correlate tool_use with a pending /hook approval row. For v1, the frontend uses `event.approval_request_id.filter(Some)` to render an approval link when present and plain tool card otherwise — both code paths work.

## Issues Encountered

None unresolved. The 5 deviations above were diagnosed + fixed in-session; all caught by the test suite (not by code review). The `tokio::time::advance` failure was a particularly cheap catch — cargo build errored with "private field, not a method" on `start_paused`, which directly pointed at the missing `test-util` feature.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 03 (MCP on self_register):** Unblocked. `LiveSessionRegistry::get_stdin_tx` is the exact fast-path the MCP `get_pending_user_messages` handler will call. `MAX_CHAT_MESSAGE_BYTES` can be shared between the Tauri command + the MCP request body cap. Plan 03 adds three more todo!("Plan 03") → real bodies in `mcp/tools.rs` + `mcp/session_config.rs` + `mcp/streamable_http.rs`.
- **Plan 04 (claude_code adapter + notifications):** Unblocked. The adapter just needs to call `launch_live_session`, take the returned `Child`, hand `child.stdin.take()` to `spawn_outbound_writer`, `child.stdout.take()` to `spawn_stream_json_reader`, `child.stderr.take()` to `spawn_raw_stderr_reader`, then wrap the remaining `Child` in `spawn_supervisor` with the same `agent_id`. Plan 04 also writes the aggregator that consumes `StreamEvent` and emits Tauri events / inserts DB rows.
- **Plan 05 (frontend polish):** Unblocked. `chatStore.subscribe()` listens for the 8 emit-event names documented above. The bindings.ts regen ship all six commands' TS shims.
- **Plan 06 (URL routing + Phase 4 chat deletion):** Unblocked. No backend surface changes remaining in Plan 02 affect the routing/deletion work.

No blockers or concerns carried forward.

## Self-Check: PASSED

Verified items:

- **File existence:**
  - `src-tauri/src/chat_runtime/session_registry.rs` (230 lines) — FOUND
  - `src-tauri/src/chat_runtime/types.rs` (121 lines, with MAX_CHAT_MESSAGE_BYTES + MAX_STREAM_JSON_LINE_BYTES) — FOUND
  - `src-tauri/src/chat_runtime/parser.rs` (666 lines) — FOUND
  - `src-tauri/src/chat_runtime/outbound.rs` (302 lines) — FOUND
  - `src-tauri/src/chat_runtime/launcher.rs` (195 lines) — FOUND
  - `src-tauri/src/chat_runtime/supervisor.rs` (187 lines) — FOUND
  - `src-tauri/src/chat_runtime/auto_resume.rs` (247 lines) — FOUND
  - `src-tauri/src/chat_runtime/commands.rs` (627 lines) — FOUND
  - `src-tauri/src/db/events.rs` (504 lines) — FOUND
- **Commits exist in git log:**
  - `af8efee` (Task 1) — FOUND
  - `9df20f4` (Task 2) — FOUND
  - `632a945` (Task 3) — FOUND
- **Final verification run:**
  - `cargo test --lib chat_runtime::` — 41 passed, 0 failed
  - `cargo test --lib db::events::tests` — 8 passed, 0 failed
  - `cargo test --test chat_runtime_smoke` — 1 passed, 0 failed
  - Grand total: 50 tests green across Plan 02's surface
- **Acceptance-criteria greps:**
  - `grep -c 'todo!' src/chat_runtime/{session_registry,parser,outbound,launcher,supervisor,auto_resume,commands}.rs src/db/events.rs` → all 0
  - `grep -n 'CREATE_NEW_PROCESS_GROUP' src/chat_runtime/launcher.rs` → 0 matches (flag intentionally omitted)
  - `grep -n 'is_valid_uuidv4' src/chat_runtime/auto_resume.rs` → 10 matches (fn def + tests + callsite)
  - `grep -n 'MAX_CHAT_MESSAGE_BYTES' src/chat_runtime/commands.rs` → confirmed inside `send_chat_message_to_agent_inner`
  - `grep -n '"type":"user"' src/chat_runtime/outbound.rs` + `grep -n '"content":\[{"type":"text","text"' src/chat_runtime/outbound.rs` → confirmed (canonical envelope docstring)

---

*Phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s*
*Completed: 2026-04-17*
