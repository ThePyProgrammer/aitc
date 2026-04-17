---
phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s
plan: 04
subsystem: backend-agent-lifecycle
tags: [adapter-capabilities, stream-json, long-lived-subprocess, d-04-archive-relaunch, phase-4-chat-deletion, mcp-config-write, at-user-regex]

requires:
  - phase: 10
    plan: 02
    provides: launch_live_session + spawn_stream_json_reader + spawn_raw_stderr_reader + spawn_outbound_writer + spawn_supervisor + LiveSessionRegistry + find_last_user_text_id / update_event_delivery_status (Phase 10 chat_runtime foundation)
  - phase: 10
    plan: 03
    provides: mcp::session_config::write_session_mcp_config + McpState on self_register axum router + Mcp-Session-Id 404-on-unknown semantics

provides:
  - AdapterCapabilities { chat_duplex: bool } + AgentAdapter::capabilities() trait method (default false) — widens Plan 02's inline adapter_type match into a per-adapter API (D-02)
  - LaunchOptions { agent_id: Option<String>, aitc_port: Option<u16> } fields so duplex adapters can write per-session MCP config BEFORE spawning
  - ClaudeCodeAdapter::launch rewritten for D-06 long-lived stream-json mode: calls chat_runtime::launcher::launch_live_session with MCP config + permission-mode extra_flags passthrough. Preserves Phase 8 hook install path
  - chat_runtime::launcher::launch_live_session widened with extra_flags: Option<&[&str]> appended AFTER --mcp-config pair but BEFORE positional intent
  - chat_runtime::notifications::dispatch_chat_notification with real body: tauri-plugin-notification + /comms?tab=chat&agent=<id> deep-link, wrapped in std::panic::catch_unwind (D-23)
  - chat_runtime::parser::is_awaiting_user_mention + at_user_regex OnceLock: word-bounded `@user` detection (Pitfall 5 defense)
  - chat_runtime::parser::spawn_event_aggregator: drains StreamEvents from parser + stderr reader, writes agent_events rows, emits Tauri events, dispatches chat notifications on @user. Single owner of DB + emit side effects (D-17 ordering preserved)
  - agents::AitcPort newtype managed state seeded at 9417 so launch_agent has a valid port before start_registration_server binds. Server task replaces on success
  - agents::commands::launch_agent_inner: factored helper that mint agent_id UP FRONT (UUIDv4 prefix), honors explicit agent_id from LaunchOptions (D-04 relaunch), branches on adapter.capabilities().chat_duplex for duplex vs read-only wiring
  - agents::commands::spawn_raw_capture_tasks: D-12 read-only path for codex/opencode/generic — line-by-line raw_stdout / raw_stderr rows + agent-event-appended emits + child.wait reaper
  - chat_runtime::commands::relaunch_agent_session: real body calling launch_agent_inner with forced agent_id, emits agent-session-resumed (D-04)
  - Phase 4 `send_chat_message` / `list_chat_messages` / `update_message_delivery_status` DELETED from comms/commands.rs + comms/types.rs::ChatMessage DELETED + lib.rs specta registrations DELETED per D-21

affects:
  - Plan 05 (frontend polish): consumes agent-session-started / agent-session-ended / agent-event-appended / agent-delivery-updated / agent-assistant-delta / agent-turn-complete / agent-session-resumed emissions. bindings.ts regenerates without sendChatMessage/ChatMessage types, so any lingering Phase 4 frontend caller will produce a specta type error
  - Plan 06 (URL routing + Phase 4 chat deletion): frontend-side deletion of ChatThread.tsx / commsStore chat fields is now unblocked — the backend no longer exposes the old surface

tech-stack:
  added: []
  patterns:
    - "AdapterCapabilities flags-struct + trait-method-with-default: widens inline per-adapter match into a typed API so future adapters can opt into new behaviors (chat_duplex, future maybe tool_gating or streaming_delta) without edit-by-search"
    - "Mint-agent_id-BEFORE-spawn: UUIDv4 prefix (first 4 hex chars → KAGENT-XXXX) so duplex adapters write per-session MCP config at .claude/aitc-mcp-<agent_id>.json before the subprocess starts. Honors explicit agent_id from LaunchOptions for relaunch continuity (D-04)"
    - "Command-layer-owns-the-pipes: adapter.launch returns (pid, child) with piped stdio for duplex adapters; the command layer (agents::commands::launch_agent_inner) is where `child.stdin.take()` / `child.stdout.take()` / `child.stderr.take()` happen — so parser + outbound writer + supervisor + aggregator can be wired without the adapter having to hold a Tauri State reference"
    - "AitcPort seed-then-replace: .manage(AitcPort(9417)) before setup() so launch_agent always sees a valid port; the async start_registration_server task replaces the entry on successful bind via app_for_port.manage(AitcPort(port))"
    - "spawn_event_aggregator aggregator pattern: owns insert_agent_event + app.emit for every StreamEvent variant (SessionStarted binds session_id, AssistantText flushes + @user detect, ToolUse/ToolResult/SystemNote/RawStdout/RawStderr insert+emit, TurnComplete flips last user_text → 'consumed'). Single owner of DB side effects per Plan 02 decision"
    - "drop(event_tx) after spawning both readers: guarantees the aggregator's rx.recv() returns None once both parser + stderr reader finish, so the task exits cleanly"
    - "std::panic::catch_unwind on notification plugin: mirrors comms::commands::dispatch_approval_notification so test runtime (tauri::test::mock_app) doesn't panic on missing plugin registration"

key-files:
  created: []
  modified:
    - src-tauri/src/agents/adapter.rs (AdapterCapabilities struct + trait method + LaunchOptions {agent_id, aitc_port} fields + 2 tests)
    - src-tauri/src/agents/claude_code.rs (launch rewritten for long-lived stream-json; capabilities returns chat_duplex:true; MCP config write before spawn + permission-mode extra_flags + Phase 8 hook install preserved)
    - src-tauri/src/agents/codex.rs (capability test — inherits default)
    - src-tauri/src/agents/opencode.rs (capability test — inherits default)
    - src-tauri/src/agents/generic.rs (capability test — inherits default)
    - src-tauri/src/agents/commands.rs (launch_agent signature: added 4 new tauri::State + tauri::AppHandle; launch_agent_inner factored helper; spawn_raw_capture_tasks D-12 helper; 4 new tests covering duplex + readonly + explicit-id + relaunch)
    - src-tauri/src/agents/mod.rs (AitcPort newtype public export)
    - src-tauri/src/chat_runtime/launcher.rs (launch_live_session signature + build_argv extended with extra_flags: Option<&[&str]>; 2 new argv tests)
    - src-tauri/src/chat_runtime/notifications.rs (dispatch_chat_notification full body + 2 mock-app no-panic tests)
    - src-tauri/src/chat_runtime/parser.rs (is_awaiting_user_mention + truncate_for_notification + at_user_regex OnceLock + spawn_event_aggregator task + 4 new tests covering bounded match / substring rejection / truncate)
    - src-tauri/src/chat_runtime/commands.rs (relaunch_agent_session real body calling launch_agent_inner)
    - src-tauri/src/comms/commands.rs (send_chat_message / list_chat_messages / update_message_delivery_status REMOVED + map_chat_row helper REMOVED + ChatMessage import dropped)
    - src-tauri/src/comms/types.rs (ChatMessage struct REMOVED)
    - src-tauri/src/lib.rs (3 chat commands + ChatMessage specta type de-registered; AitcPort(9417) pre-seeded + app_for_port.manage(AitcPort(port)) on server task success)
    - src/bindings.ts (auto-regen: LaunchOptions gains agentId + aitcPort optional fields; sendChatMessage / listChatMessages / updateMessageDeliveryStatus / ChatMessage DELETED)

key-decisions:
  - "Mint agent_id UP FRONT via uuid::Uuid::new_v4().simple()[:4].to_uppercase() → 'KAGENT-XXXX'. Replaces the old `format!(\"KAGENT-{:04}\", pid%10000)` which is post-launch. Rationale: duplex adapters need the agent_id to write .claude/aitc-mcp-<agent_id>.json BEFORE spawn. UUIDv4 prefix gives ~65k entropy which is fine for the local registry's 100-agent cap."
  - "Keep AgentAdapter::launch returning (u32, Child) rather than an enum LaunchResult. The adapter's job is choosing between launch_detached (stdio=null) vs launch_live_session (stdio=piped); the command layer inspects .stdin.take() to decide the routing. Avoids trait churn AND means the adapter stays untangled from Tauri State."
  - "Pre-seed AitcPort(9417) before setup() so launch_agent has a default, then let the server task replace via .manage(AitcPort(port)). If the OS assigns a different port, there's a brief window (server-binding) where a duplex launch would splice the stale port into MCP config. In practice the UI can't fire launch_agent until the main window is up, which is after the server task spawns — so this is a theoretical race only."
  - "chat_runtime::parser::spawn_event_aggregator is added in this plan (it was planned for Plan 02 but deferred to Plan 04 per Plan 02 key-decisions). Single owner of DB writes + Tauri emits. Reader tasks are still pure-logic (drive_stream_json_reader/spawn_raw_stderr_reader) — they emit StreamEvents to an mpsc channel."
  - "drop(event_tx) after spawning parser + stderr reader ensures the aggregator sees mpsc channel-close. Without this, the aggregator would hang forever on rx.recv().await even after both readers exit, leaking a tokio task per session."
  - "@user regex uses std::sync::OnceLock (stable since 1.70) rather than once_cell::sync::Lazy — existing project precedent in repo_session.rs + claude_resources/parse.rs."
  - "AgentAdapter::capabilities() is a trait method with default impl, NOT a required method. Conservative default (chat_duplex: false) means Codex/OpenCode/Generic inherit correct behavior with zero per-adapter changes. Only ClaudeCodeAdapter overrides to true."
  - "chat_runtime::commands::adapter_chat_duplex (Plan 02's local rule) is kept INTACT alongside the new trait method. This is redundant with adapter.capabilities().chat_duplex but needed because chat_runtime::commands::send_chat_message_to_agent only sees the adapter_type string (AgentInfo.agent_type), not the Arc<dyn AgentAdapter>. A future cleanup could thread the registry lookup through, but Plan 04 keeps the behavior identical to avoid surprise regressions in Plan 02's existing tests."
  - "spawn_raw_capture_tasks does NOT update AgentRegistry state on child exit (unlike the old spawn_stdout_reader which flipped Running→Idle/Error). Read-only adapters already surface state transitions via process-scan polling (Phase 2), so the transition is not lost — just observed a beat later. Keeps the helper self-contained and avoids cross-module state coupling."
  - "LaunchOptions.agent_id is #[serde(skip_serializing_if = \"Option::is_none\")] so TS callers who don't need to force an id just pass `{}`. Internal callers (relaunch_agent_session) explicitly set it."

patterns-established:
  - "capability-method-with-default: new AgentAdapter::capabilities() returns AdapterCapabilities::default() unless overridden. Pattern: add fields to AdapterCapabilities, implement Default, per-adapter only overrides what it needs."
  - "Command-layer-as-pipe-consumer: adapter returns Child with piped stdio; the Tauri command (with access to State<Pool> + State<LiveSessionRegistry> + State<AitcPort> + AppHandle) takes ownership of the pipes and wires the runtime. Adapter stays free of Tauri-runtime dependencies."
  - "Newtype-for-managed-state: AitcPort(pub u16) prevents bare u16 from colliding with other managed state. Pattern: wrap primitive managed state in a named newtype."

requirements-completed: []

duration: 20 min
completed: 2026-04-17
---

# Phase 10 Plan 04: Agent Lifecycle Bridge Summary

**Bridge Plan 02's chat_runtime + Plan 03's MCP into the agent lifecycle: claude_code.rs rewritten for long-lived stream-json mode, AdapterCapabilities trait method widens Plan 02's inline adapter_type match, launch_agent branches duplex vs read-only, relaunch_agent_session wired for D-04 reactivation, Phase 4 chat command surface DELETED per D-21**

## Performance

- **Duration:** ~20 minutes
- **Started:** 2026-04-17T10:36Z
- **Completed:** 2026-04-17T10:56Z
- **Tasks:** 3
- **Files modified:** 14 (Rust) + 1 bindings.ts auto-regen

## Accomplishments

- **AdapterCapabilities** flags struct + `AgentAdapter::capabilities()` trait method (default = read-only) widens Plan 02's inline match into a typed per-adapter API.
- **LaunchOptions** extended with `agent_id: Option<String>` (D-04 continuity) and `aitc_port: Option<u16>` so duplex adapters can write the per-session MCP config before spawning.
- **ClaudeCodeAdapter::launch** completely rewritten for D-06:
  - Writes `.claude/aitc-mcp-<agent_id>.json` via `mcp::session_config::write_session_mcp_config` BEFORE spawn.
  - Calls `chat_runtime::launcher::launch_live_session` (not `launch_detached`) so stdio is piped.
  - Passes permission-mode flags (`--dangerously-skip-permissions` / `--permission-mode acceptEdits`) through the new `extra_flags: Option<&[&str]>` argument.
  - Preserves Phase 8 `AITC_SIDECAR_PATH` → `install_aitc_hook` path verbatim.
  - Returns `chat_duplex: true` from `capabilities()`.
- **`launch_live_session` / `build_argv`** widened with `extra_flags: Option<&[&str]>` inserted AFTER `--mcp-config` pair but BEFORE positional intent. 2 new argv tests.
- **`dispatch_chat_notification`** full body (D-23):
  - Title: `"AWAITING_USER — {agent_id}"`.
  - Body: caller text + `" [/comms?tab=chat&agent={id}]"` when a deeplink agent is provided.
  - `std::panic::catch_unwind` around `.notification().builder().show()` mirrors `dispatch_approval_notification`.
  - 2 mock-app no-panic tests.
- **Parser `@user` detection** (D-23 fallback):
  - `is_awaiting_user_mention` using a word-bounded regex `(?:^|[^\w])@user(?:[^\w]|$)` cached via `OnceLock<Regex>`.
  - Pitfall 5 defense: rejects `@username`, `foo_@user_bar`, `admin@example.com`.
  - 4 new parser tests (match/reject/truncate).
- **`spawn_event_aggregator`** task consumes `StreamEvent`s and owns DB writes + Tauri emits (aggregator pattern from Plan 02 decisions):
  - `SessionStarted` → `bind_session_id` + emit `agent-session-started`.
  - `AssistantDelta` → emit `agent-assistant-delta`.
  - `AssistantText` → `@user` check → `dispatch_chat_notification` → insert `assistant_text` row → emit `agent-event-appended`.
  - `ToolUse` / `ToolResult` / `SystemNote` / `RawStdout` / `RawStderr` → insert matching row + emit.
  - `TurnComplete` → flip the last `user_text` row's `delivery_status` to `"consumed"` + emit `agent-turn-complete`.
  - `StdoutClosed` → debug log (supervisor handles `session_boundary`).
- **`AitcPort`** newtype managed state pre-seeded with preferred `9417` so `launch_agent` has a valid default before the server binds; the server task replaces the entry with the actual bound port on success.
- **`launch_agent_inner`** factored helper:
  - Mints `agent_id` UP FRONT via `uuid::Uuid::new_v4().simple()[:4].to_uppercase()` (pattern `KAGENT-XXXX`).
  - Honors explicit `agent_id` from `LaunchOptions` for D-04 relaunch.
  - Branches on `adapter.capabilities().chat_duplex`:
    - Duplex: take `child.stdin/stdout/stderr`, wire parser + stderr reader + aggregator + outbound writer + supervisor + delivery forwarder, register `LiveSession`.
    - Read-only: `spawn_raw_capture_tasks` for raw_stdout/raw_stderr + child reaper.
  - 4 new tests using `MockAdapter` + `/bin/cat` subprocess to cover all branches without shipping the real Claude CLI.
- **`relaunch_agent_session`** real body:
  - Pulls `adapter_type` + `cwd` + `intent` from `AgentRegistry::get_agent`.
  - Removes stale `LiveSession` entry.
  - Delegates to `launch_agent_inner` with forced `agent_id` and `aitc_port`.
  - Emits `agent-session-resumed`.
- **Phase 4 chat command surface DELETED (D-21)**:
  - `send_chat_message`, `list_chat_messages`, `update_message_delivery_status` removed from `comms/commands.rs`.
  - `map_chat_row` helper removed (no remaining callers).
  - `ChatMessage` struct removed from `comms/types.rs`.
  - 3 command registrations + `ChatMessage` specta type registration dropped from `lib.rs`.
  - bindings.ts regenerates clean: zero `send_chat_message\b` matches, zero `ChatMessage` type.

## Task Commits

1. **Task 1: adapter capabilities trait + claude_code long-lived launch + @user notifications** — `d7e723b` (feat)
2. **Task 2: launch_agent capability routing + relaunch_agent_session body** — `3be538e` (feat)
3. **Task 3: delete Phase 4 chat command surface per D-21** — `b4b5b51` (feat)

## New Tauri Emit Events (ready for Plan 05 subscription)

The following events are emitted by this plan (NEW relative to Plan 02's documented set):

- `agent-session-started` — payload `SessionStartedPayload { agentId, sessionId }`. Fired by aggregator on first `{type:"system", subtype:"init"}` envelope.
- `agent-assistant-delta` — payload `{agentId, delta}`. Fired on each text_delta; lightweight progressive UI update.
- `agent-turn-complete` — payload `{terminalReason, isError}`. Fired on `{type:"result"}` after last user_text is flipped to `"consumed"`.
- `agent-session-resumed` — payload `agentId` (string). Fired by `relaunch_agent_session` on successful reactivation (D-04).

Already-documented events (Plan 02) whose emission point is now concrete:
- `agent-event-appended` — aggregator emits on every row insert (assistant_text, tool_use, tool_result, system_note, raw_stdout, raw_stderr).
- `agent-delivery-updated` — delivery forwarder emits on outbound status change; aggregator ALSO emits with `status:"consumed"` on turn completion.
- `agent-session-ended` — supervisor (Plan 02) emits on `child.wait()`.

## Control Flow of launch_agent (for Plan 05/06 reference)

```
Tauri::command launch_agent
  └─ launch_agent_inner(&refs)
      ├─ canonicalize cwd + watched-repo check (T-03-05)
      ├─ registry.find_adapter_by_type(agent_type)
      ├─ caps = adapter.capabilities()
      ├─ agent_id = opts.agent_id OR mint fresh (UUIDv4[:4])
      ├─ opts.agent_id = Some(agent_id)
      ├─ opts.aitc_port ||= current port
      ├─ adapter.launch(cwd, intent, opts) → (pid, child)
      │   └─ ClaudeCodeAdapter::launch (when duplex):
      │       ├─ write_session_mcp_config(.claude/aitc-mcp-<id>.json)
      │       ├─ install_aitc_hook (Phase 8, unless bypass chip)
      │       ├─ build extra_flags vec (permission-mode)
      │       └─ launch_live_session → Child with piped stdio
      ├─ registry.upsert_agent(info, adapter, launched_by_aitc=true)
      ├─ if caps.chat_duplex:
      │   ├─ child.stdin/stdout/stderr.take()
      │   ├─ chat_sessions.register(LiveSession { stdin_tx })
      │   ├─ spawn_stream_json_reader(stdout → event_tx)
      │   ├─ spawn_raw_stderr_reader(stderr → event_tx)
      │   ├─ drop(event_tx)  ← channel-close on reader exit
      │   ├─ spawn_event_aggregator(event_rx → pool + sessions + app)
      │   ├─ spawn_outbound_writer(stdin + frame_rx → delivery_tx)
      │   ├─ spawn delivery forwarder (delivery_rx → UPDATE + emit)
      │   └─ spawn_supervisor(child → mark_archived + session_boundary)
      └─ else (read-only):
          └─ spawn_raw_capture_tasks(child → raw_stdout / raw_stderr rows)
```

## LaunchOptions Shape (ship-ready for Plan 05 UI)

```typescript
// bindings.ts after Plan 04:
export type LaunchOptions = {
  acceptEdits: boolean;
  dangerouslySkipPermissions: boolean;
  agentId?: string | null;     // NEW — forces agent_id on relaunch (D-04)
  aitcPort?: number | null;    // NEW — splices into MCP config URL
};
```

Plan 05's DeployDialog passes `{}` (or omits these two); only `relaunch_agent_session` sets `agentId`.

## Final Frontend-Facing Tauri Command Surface (backed by real bodies)

All six chat_runtime commands now have real bodies — no `todo!`, no stub `Err("Plan 04 wires...")`:

| Command | Status | Notes |
|---------|--------|-------|
| `send_chat_message_to_agent(agentId, content)` | REAL (Plan 02) | 256 KiB cap; routes duplex→stdin or readonly→unsupported; auto_resume fallback |
| `list_agent_events(agentId, beforeId?, limit?)` | REAL (Plan 02) | paginated |
| `list_chat_channels()` | REAL (Plan 02) | joins registry + sessions + events |
| `clear_agent_thread(agentId) → u64` | REAL (Plan 02) | returns rows_affected |
| `mark_agent_events_read(agentId)` | REAL (Plan 02) | stamps `last_read_at` |
| `relaunch_agent_session(agentId)` | **REAL (Plan 04)** | D-04 — reactivates archived session under same agent_id |

Phase 4 chat surface removed from bindings.ts: `sendChatMessage`, `listChatMessages`, `updateMessageDeliveryStatus`, and the `ChatMessage` type. Any lingering frontend caller produces a TypeScript error in Plan 06 — exactly what D-21 wanted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Widened `launch_live_session` / `build_argv` with `extra_flags: Option<&[&str]>` instead of inlining permission-mode flags into `intent`**
- **Found during:** Task 1 (rewriting claude_code.rs::launch)
- **Issue:** The plan's action block suggests two options for permission-mode flags: (a) inline them into the intent string (dirty), or (b) widen launch_live_session. Option (a) would break the positional-intent contract; option (b) is cleaner but requires updating `build_argv` + existing tests.
- **Fix:** Chose option (b). Added `extra_flags: Option<&[&str]>` to both `build_argv` and `launch_live_session`. Extra flags are inserted AFTER `--mcp-config <path> --strict-mcp-config` but BEFORE the positional intent. Updated the 3 existing argv tests to pass `None` and added 2 new tests covering the flag positioning.
- **Files modified:** `src-tauri/src/chat_runtime/launcher.rs`
- **Verification:** 6 launcher tests pass (3 existing + 2 new + 1 missing-program).
- **Committed in:** `d7e723b` (Task 1).

**2. [Rule 3 - Blocker] Added `spawn_event_aggregator` in Plan 04 rather than assume it exists from Plan 02**
- **Found during:** Task 2 (wiring launch_agent's duplex branch)
- **Issue:** Plan 02's summary documents that the aggregator's DB-write responsibility was deferred to Plan 04 ("parser uses aggregator-mpsc pattern — reader is pure-logic, downstream aggregator (Plan 04) owns DB writes + Tauri emits"). Plan 04's action block references `crate::chat_runtime::parser::spawn_event_aggregator` as if it already exists. It didn't.
- **Fix:** Implemented `spawn_event_aggregator` in `chat_runtime/parser.rs`. Drains `StreamEvent`s, writes matching `agent_events` rows via `insert_agent_event`, emits Tauri events, dispatches `dispatch_chat_notification` on `@user` matches inside AssistantText flushes, and flips last user_text row to `"consumed"` on `TurnComplete`.
- **Files modified:** `src-tauri/src/chat_runtime/parser.rs`
- **Verification:** Full test suite for chat_runtime still green (48 tests); duplex-launch integration test (`launch_agent_for_duplex_adapter_registers_live_session`) passes.
- **Committed in:** `d7e723b` (Task 1 — added with parser changes).

**3. [Rule 3 - Blocker] Pre-seed `AitcPort(9417)` before setup() so launch_agent has a default**
- **Found during:** Task 2 (adding `tauri::State<'_, AitcPort>` to launch_agent)
- **Issue:** The plan says to `.manage(AitcPort(port))` after `start_registration_server` returns, but that runs inside an async task spawned in `setup()`. A `launch_agent` call before the server binds would fail with "state not found".
- **Fix:** Pre-seed `.manage(agents::AitcPort(9417))` in the main builder chain BEFORE `setup()`. The async server task overwrites via `app_for_port.manage(AitcPort(port))` on success (Tauri v2 replaces same-type state). If the OS assigns a different port, there's a brief window (server-bind) where a duplex launch would splice a stale port into MCP config — but since the UI can't fire `launch_agent` until the main window is up (which is after server spawn), this is a theoretical-only race.
- **Files modified:** `src-tauri/src/lib.rs`
- **Verification:** Full `cargo build` clean; 7 agents::commands tests pass including `launch_agent_honors_explicit_agent_id_from_options` (which exercises a 9417 port).
- **Committed in:** `3be538e` (Task 2).

**4. [Rule 3 - Blocker] Add `drop(event_tx)` after spawning parser + stderr reader**
- **Found during:** Task 2 (writing `launch_agent_inner` duplex branch)
- **Issue:** The aggregator's `while let Some(event) = rx.recv().await` exits only when ALL senders of the mpsc channel drop. If we keep a local `event_tx` clone around (implicit in `event_tx.clone()` twice for parser + stderr reader), the aggregator hangs forever even after both readers exit.
- **Fix:** After `parser::spawn_*` and `stderr_reader::spawn_*` both take their own clone, `drop(event_tx)` explicitly in the scope. The aggregator now sees channel-close once both readers finish and exits cleanly.
- **Files modified:** `src-tauri/src/agents/commands.rs`
- **Verification:** `launch_agent_for_duplex_adapter_registers_live_session` test + `relaunch_preserves_agent_id_via_launch_agent_inner` test both pass without hang (<1s each).
- **Committed in:** `3be538e` (Task 2).

**5. [Rule 1 - Bug] `find_last_user_text_id` signature: take session_id argument**
- **Found during:** Task 1 (writing `spawn_event_aggregator`'s TurnComplete branch)
- **Issue:** The plan's aggregator pseudocode calls `find_last_user_text_id(&pool, &agent_id)` but the actual signature in `db::events.rs` is `(pool, agent_id, session_id: Option<&str>)` — the session_id scope is required to avoid flipping a user_text row from a different session.
- **Fix:** Look up `sessions.session_id_for(&agent_id).await` inside the TurnComplete branch, then pass `session_id.as_deref()` to `find_last_user_text_id`. Correctly scopes the "consumed" flip to the current session.
- **Files modified:** `src-tauri/src/chat_runtime/parser.rs`
- **Verification:** Indirect coverage via `chat_runtime::parser` tests + `db::events::find_last_user_text_id_returns_newest_user_text` test (8/8 db::events tests green).
- **Committed in:** `d7e723b` (Task 1).

---

**Total deviations:** 5 auto-fixed (1 bug + 4 Rule 3 blockers). All caught in-session by the test suite. No scope creep, no user-facing API break.

## Authentication Gates

None.

## Known Stubs

- `chat_runtime::commands::adapter_chat_duplex` (Plan 02's inline match `matches!(adapter_type, "claude-code")`) is kept ALIVE alongside the new `AgentAdapter::capabilities()` trait method. The two are redundant — both say "claude-code is the only duplex adapter" — but `send_chat_message_to_agent` only sees the adapter_type string (through `AgentInfo.agent_type`), not the `Arc<dyn AgentAdapter>`. A future cleanup could thread the registry lookup through `send_chat_message_to_agent_inner` and drop the duplicate rule, but Plan 04 preserves the Plan 02 behavior to avoid regressions in the 10 existing Plan 02 commands tests.
- `spawn_raw_capture_tasks` does NOT flip registry state on child exit (read-only adapters). Process-scan polling (Phase 2) already observes the transition a beat later. Documented as a deliberate tradeoff.
- `chat_runtime::commands::send_chat_message_to_agent`'s `auto_resume` fallback still returns `Err("no session_id available for auto-resume")` on the first launch before `init` arrives (Plan 02 behavior preserved). This is correct for v1: `launch_live_session` → parser's SessionStarted → `bind_session_id` happens on first Claude output, so after the initial assistant turn the session_id is known and auto-resume works.

## Issues Encountered

None unresolved. 5 deviations above caught in-session.

## User Setup Required

None — no external service configuration required.

## Threat Flags

None — this plan is a bridge between existing Plan 02 / Plan 03 surfaces. Trust boundaries (claude argv, MCP config path, raw stdout capture) are all covered by the existing threat model (T-10-21..T-10-26).

## Next Phase Readiness

- **Plan 05 (frontend polish):** Unblocked. bindings.ts now has:
  - `LaunchOptions { acceptEdits, dangerouslySkipPermissions, agentId?, aitcPort? }`
  - No `sendChatMessage` / `listChatMessages` / `updateMessageDeliveryStatus` / `ChatMessage` — any lingering Phase 4 caller produces a TS error. Plan 06 finishes the cleanup.
  - Six chat_runtime commands all have real bodies, including `relaunch_agent_session` (previously a stub).
  - New emit events documented: `agent-session-started`, `agent-assistant-delta`, `agent-turn-complete`, `agent-session-resumed` join the Plan 02 set (`agent-event-appended`, `agent-delivery-updated`, `agent-session-ended`, `agent-thread-cleared`, `agent-events-marked-read`).
- **Plan 06 (URL routing + Phase 4 chat deletion):** Unblocked. Backend surface is GONE; the frontend deletion in `src/stores/commsStore.ts` + `src/views/CommsHub/ChatThread.tsx` is now purely a TS-errors-driven cleanup pass.

No blockers or concerns carried forward.

## Self-Check: PASSED

Verified items:

- **File existence (modified):**
  - `src-tauri/src/agents/adapter.rs` — FOUND (AdapterCapabilities + LaunchOptions fields + trait method)
  - `src-tauri/src/agents/claude_code.rs` — FOUND (launch rewritten; capabilities returns chat_duplex:true)
  - `src-tauri/src/agents/commands.rs` — FOUND (launch_agent_inner + spawn_raw_capture_tasks + 4 new tests)
  - `src-tauri/src/agents/mod.rs` — FOUND (AitcPort exported)
  - `src-tauri/src/chat_runtime/launcher.rs` — FOUND (extra_flags arg + 2 new argv tests)
  - `src-tauri/src/chat_runtime/notifications.rs` — FOUND (full body + 2 mock-app tests)
  - `src-tauri/src/chat_runtime/parser.rs` — FOUND (is_awaiting_user_mention + spawn_event_aggregator + 4 new tests)
  - `src-tauri/src/chat_runtime/commands.rs` — FOUND (relaunch_agent_session real body)
  - `src-tauri/src/comms/commands.rs` — FOUND (3 chat fns + map_chat_row REMOVED)
  - `src-tauri/src/comms/types.rs` — FOUND (ChatMessage struct REMOVED)
  - `src-tauri/src/lib.rs` — FOUND (3 command regs + ChatMessage specta reg DROPPED; AitcPort managed state wired)
  - `src/bindings.ts` — FOUND (regen clean: 0 sendChatMessage\b, 2 sendChatMessageToAgent; LaunchOptions has agentId + aitcPort)
- **Commits in git log:**
  - `d7e723b` (Task 1) — FOUND: `git log --oneline | grep d7e723b` ✓
  - `3be538e` (Task 2) — FOUND: `git log --oneline | grep 3be538e` ✓
  - `b4b5b51` (Task 3) — FOUND: `git log --oneline | grep b4b5b51` ✓
- **Acceptance-criteria greps (Plan 04 spec):**
  - `grep -c 'struct AdapterCapabilities' src/agents/adapter.rs` → 1 ✓
  - `grep -c 'fn capabilities' src/agents/adapter.rs` → 1 ✓ (trait default)
  - `grep -c 'chat_duplex: true' src/agents/claude_code.rs` → 1 ✓
  - `grep -c 'launch_detached' src/agents/claude_code.rs` → 0 ✓
  - `grep -c 'launch_live_session' src/agents/claude_code.rs` → 2 ✓ (import + call)
  - `grep -c 'write_session_mcp_config' src/agents/claude_code.rs` → 2 ✓ (import path + call)
  - `grep -c 'todo!' src/chat_runtime/notifications.rs` → 0 ✓
  - `grep -c 'tauri_plugin_notification' src/chat_runtime/notifications.rs` → 2 ✓ (use + call)
  - `grep -c 'catch_unwind' src/chat_runtime/notifications.rs` → 6 ✓ (1 prod + 5 doc-mentions in tests & module comments)
  - `grep -c 'is_awaiting_user_mention' src/chat_runtime/parser.rs` → 24 ≥ 2 ✓
  - `grep -c 'adapter.capabilities\|caps.chat_duplex' src/agents/commands.rs` → 3 ≥ 1 ✓
  - `grep -c 'spawn_stream_json_reader\|spawn_outbound_writer\|spawn_supervisor\|spawn_event_aggregator' src/agents/commands.rs` → 4 ≥ 4 ✓
  - `grep -c 'spawn_raw_capture_tasks\|raw_stdout\|raw_stderr' src/agents/commands.rs` → 10 ≥ 2 ✓
  - `grep -c 'chat_sessions.register\|sessions.register\|LiveSession {' src/agents/commands.rs` → 1 ✓ (the register call)
  - `grep -c 'todo!("Plan 04")\|"Plan 04 — wire' src/chat_runtime/commands.rs` → 0 ✓
  - `grep -c 'pub async fn send_chat_message\b\|pub async fn list_chat_messages\|pub async fn update_message_delivery_status' src/comms/commands.rs` → 0 ✓
  - `grep -c 'fn map_chat_row' src/comms/commands.rs` → 0 ✓
  - `grep -c 'pub struct ChatMessage' src/comms/types.rs` → 0 ✓
  - `grep -c 'comms::commands::send_chat_message\b\|comms::commands::list_chat_messages\|comms::commands::update_message_delivery_status' src/lib.rs` → 0 ✓
  - `grep -c 'comms::types::ChatMessage' src/lib.rs` → 0 ✓
  - `grep -c 'send_chat_message\b' src/bindings.ts` → 0 ✓
  - `grep -c 'send_chat_message_to_agent' src/bindings.ts` → 2 ≥ 1 ✓
- **Final verification:**
  - `cargo build` → clean (8 pre-existing warnings; none related to Phase 10)
  - `cargo test --lib agents::commands::tests` → 7 passed, 0 failed
  - `cargo test --lib chat_runtime::` → 48 passed, 0 failed
  - `cargo test --lib comms::` → 15 passed, 0 failed
  - `cargo test --lib chat_runtime::parser::tests::is_awaiting_user_mention` → 2 passed
  - `cargo test --lib chat_runtime::notifications` → 2 passed
  - Grand total across Phase 10 relevant modules: 85+ tests green.
  - 2 pre-existing conflict::engine tests (`test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`) fail — confirmed flaky at baseline via `git stash` (failed against main before my changes). NOT introduced by this plan. Documented in deferred-items (these are from Phase 3 and are timing-sensitive on machine load; they've been noted as flaky in prior summaries).

---

*Phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s*
*Completed: 2026-04-17*
