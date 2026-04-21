# Phase 10: Chat User Interface for Deployed Agents — Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 44 (29 create + 11 modify + 4 delete)
**Analogs found:** 38 / 40 creatable-or-modifiable (no-analog: 2)

Every file below has a single closest analog in the existing codebase (Phase 2-9). Planners MUST copy the excerpted patterns verbatim for shape, then mutate the domain specifics. All file paths are absolute.

---

## File Classification

### Backend (Rust) — new files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src-tauri/src/chat_runtime/mod.rs` | module-root + public API | module-root | `src-tauri/src/claude_resources/mod.rs` | exact |
| `src-tauri/src/chat_runtime/launcher.rs` | subprocess launcher | process-spawn | `src-tauri/src/agents/launcher.rs::launch_detached` | role-match (stdio redirected instead of null) |
| `src-tauri/src/chat_runtime/parser.rs` | stream-json NDJSON reader | streaming | `src-tauri/src/agents/launcher.rs::spawn_stdout_reader` | role-match (NDJSON parse vs raw ring-buffer) |
| `src-tauri/src/chat_runtime/outbound.rs` | FIFO mpsc stdin writer | streaming | `src-tauri/src/agents/hook_waiters.rs` (registry shape) + `tokio::sync::mpsc` precedent | role-match |
| `src-tauri/src/chat_runtime/supervisor.rs` | wait-for-exit + session_id capture | event-driven | `src-tauri/src/agents/launcher.rs::spawn_stdout_reader` exit-branch | role-match |
| `src-tauri/src/chat_runtime/session_registry.rs` | per-agent LiveSession registry | registry | `src-tauri/src/agents/hook_waiters.rs::WaiterRegistry` | exact |
| `src-tauri/src/chat_runtime/commands.rs` | Tauri commands | request-response | `src-tauri/src/comms/commands.rs` (approval commands section) | exact |
| `src-tauri/src/chat_runtime/types.rs` | serde + specta types | type-definition | `src-tauri/src/comms/types.rs` + `src-tauri/src/claude_resources/events.rs` | exact |
| `src-tauri/src/chat_runtime/auto_resume.rs` | `claude --resume --print` fallback | subprocess-spawn | `src-tauri/src/agents/launcher.rs::launch_detached` | partial (one-shot subprocess) |
| `src-tauri/src/chat_runtime/notifications.rs` | @user / needs_user_input dispatch | event-driven | `src-tauri/src/comms/commands.rs::dispatch_approval_notification` | exact |
| `src-tauri/src/mcp/mod.rs` | module-root | module-root | `src-tauri/src/claude_resources/mod.rs` | exact |
| `src-tauri/src/mcp/streamable_http.rs` | axum JSON-RPC handler | request-response | `src-tauri/src/agents/self_register.rs::hook_handler` | role-match |
| `src-tauri/src/mcp/tools.rs` | MCP tool impls | request-response | `src-tauri/src/agents/self_register.rs::hook_handler` (decision branch) | role-match |
| `src-tauri/src/mcp/session_config.rs` | per-session `.mcp.json` writer | file-I/O | `src-tauri/src/agents/hook_install.rs::install_aitc_hook` | exact |
| `src-tauri/src/mcp/types.rs` | JSON-RPC envelope types | type-definition | `src-tauri/src/agents/self_register.rs::HookRequest`/`AitcDecisionResponse` | exact |
| `src-tauri/src/db/events.rs` | CRUD helpers for `agent_events` | CRUD | `src-tauri/src/comms/commands.rs::create_approval_request_internal` + `list_approval_requests` | exact |
| `src-tauri/src/db/migrations/006_agent_events.sql` | schema migration + data migration | migration | `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` + `003_comms_chat.sql` | exact |

### Backend (Rust) — modified files

| Modified File | Change | Closest Analog (for the new lines) |
|----------------|--------|-----------------------------------|
| `src-tauri/src/agents/self_register.rs` | add `/mcp` POST/GET/DELETE routes + `Extension(McpState)` + `Extension(ChatRuntime)` layer | self-analog (lines 513-531 `build_router`) |
| `src-tauri/src/agents/claude_code.rs` | rewrite `launch()` to call `chat_runtime::launch_live_session` (stream-json, piped stdio), capture session_id, register LiveSession | self-analog (lines 60-143 current `launch`) |
| `src-tauri/src/agents/launcher.rs` | add `launch_live_session` variant with piped stdio + `--mcp-config` injection; keep `launch_detached` unchanged for Codex/OpenCode | self-analog (lines 37-71 current `launch_detached`) |
| `src-tauri/src/agents/adapter.rs` | add `capabilities()` method to `AgentAdapter` trait returning `{chat_duplex: bool}` — Codex/OpenCode/Generic return `{chat_duplex: false}` | `AgentAdapter` trait (existing file) |
| `src-tauri/src/agents/codex.rs`, `opencode.rs`, `generic.rs` | spawn raw stdout+stderr capture into `agent_events` as `raw_stdout`/`raw_stderr` rows | `src-tauri/src/agents/launcher.rs::spawn_stdout_reader` |
| `src-tauri/src/comms/commands.rs` | delete `send_chat_message`, `list_chat_messages`, `update_message_delivery_status` commands (lines 449-516) | — (pure deletion) |
| `src-tauri/src/comms/types.rs` | remove `ChatMessage` struct after migration ships; keep `ApprovalRequest` + `ProtectedPath` | — (pure deletion) |
| `src-tauri/src/lib.rs` | register new commands via `tauri-specta` collector; manage `ChatRuntimeState`, `McpState`; call `chat_runtime::init` + `mcp::start` on setup; call `dispatch_chat_notification` on @user hits | existing `.manage(...)` + `tauri_specta::collect_commands!(...)` invocations |

### Backend (Rust) — new tests

| New Test File | Closest Analog |
|----------------|----------------|
| `src-tauri/src/chat_runtime/parser.rs` unit tests | `src-tauri/src/agents/hook_waiters.rs` tests (in-module `#[cfg(test)]`) |
| `src-tauri/src/chat_runtime/outbound.rs` unit tests | `src-tauri/src/agents/hook_waiters.rs::register_then_signal_delivers_decision` |
| `src-tauri/src/chat_runtime/commands.rs` integration tests | `src-tauri/src/comms/commands.rs::tests::approve_signals_waiter_with_allow` |
| `src-tauri/src/mcp/streamable_http.rs` integration tests | `src-tauri/src/agents/self_register.rs::tests::hook_gates_edit_and_blocks_until_approved` (spawn_hook_server pattern) |
| `src-tauri/tests/chat_e2e_smoke.rs` | `src-tauri/tests/end_to_end_smoke.rs` |

### Frontend (TypeScript) — new files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/stores/chatStore.ts` | Zustand store | event-driven + CRUD | `src/stores/commsStore.ts` + `src/stores/claudeResourcesStore.ts` | exact (hybrid) |
| `src/hooks/useChatChannel.ts` | Tauri Channel lifecycle hook | streaming subscription | `src/hooks/useClaudeResourcesChannel.ts` | exact |
| `src/views/CommsHub/ChatView.tsx` | top-level tab view | request-response | `src/views/Arsenal/ArsenalView.tsx` | exact |
| `src/components/ui/CommsTabBar.tsx` | tab switcher | UI-only | `src/views/HistoryView.tsx` (lines 78-92 tab bar) | exact |
| `src/components/ui/UnreadBadge.tsx` | numeric badge | UI-only | `src/components/ui/PendingCountBadge.tsx` | exact |
| `src/components/chat/AgentChannelList.tsx` | virtualized list | list-render | `src/views/Arsenal/ResourceList.tsx` | exact |
| `src/components/chat/AgentChannelRow.tsx` | list row | UI-only | `src/views/Arsenal/ResourceRow.tsx` | exact |
| `src/components/chat/ChatTranscript.tsx` | virtualized reverse-scroll list | list-render | `src/views/CommsHub/ChatThread.tsx` (scroll-to-bottom) + `src/views/Arsenal/ResourceList.tsx` (TanStack Virtual) | role-match |
| `src/components/chat/EventCard.tsx` | discriminated-union dispatcher | UI-dispatcher | `src/views/CommsHub/ToolPreview/registry.ts` + `ToolPreview/index.tsx` | exact |
| `src/components/chat/UserMessageCard.tsx` | outbound bubble | UI-only | existing `ChatThread.tsx` inline bubble + `DeliveryStatus` | exact |
| `src/components/chat/AssistantTextCard.tsx` | inbound bubble + streaming | UI-only | existing `ChatThread.tsx` inline bubble | partial |
| `src/components/chat/ToolUseCard.tsx` | collapse/expand tool card | UI-interactive | `src/views/CommsHub/MiniChatCard.tsx` (motion layout expand) + `src/views/CommsHub/ToolPreview/index.tsx` | exact (hybrid) |
| `src/components/chat/ApprovalLinkCard.tsx` | deep-link pill | UI-only | `src/components/ui/ScopeChip.tsx` + `Sidebar.tsx` NavLink | partial |
| `src/components/chat/ToolResultCard.tsx` | nested tool result | UI-only | `src/views/CommsHub/ToolPreview/UnknownToolPreview.tsx` | role-match |
| `src/components/chat/SessionBoundary.tsx` | divider with label | UI-only | no direct analog — see "No Analog Found" |
| `src/components/chat/RawStreamCard.tsx` | terminal-tail line | UI-only | no direct analog — see "No Analog Found" |
| `src/components/chat/SystemNoteCard.tsx` | centered system label | UI-only | empty-state copy blocks in existing views (e.g. `CommsView.tsx` lines 94-113) |
| `src/components/chat/ChatInput.tsx` | sticky input (rewritten) | UI-interactive | `src/views/CommsHub/ChatInput.tsx` (delete after logic migration) | exact |
| `src/components/chat/StreamingCursor.tsx` | blinking cursor atom | UI-only | `src/views/CommsHub/RequestDetail.tsx` lines 45-48 (existing `blink-cursor` usage) | exact |
| `src/components/chat/ReadOnlyBadge.tsx` | tertiary pill | UI-only | `src/components/ui/ScopeChip.tsx` | exact |

### Frontend — modified files

| Modified File | Change | Closest Analog (for new lines) |
|----------------|--------|-----|
| `src/views/CommsView.tsx` | add `<CommsTabBar>` above existing 3-panel body; branch `?tab=chat` → `<ChatView />` | `src/views/HistoryView.tsx` (tab state + conditional body) |
| `src/components/layout/MasterDetailShell.tsx` | accept optional `railWidth?: number`, `detailWidth?: number \| 'flex'` props | self-analog (lines 11-66) |
| `src/components/layout/Sidebar.tsx` | add primary dot next to COMMS nav item when `chatStore.totalUnread > 0` | self-analog (lines 77-83 where `PendingCountBadge` is slotted) |
| `src/components/ui/DeliveryStatus.tsx` | add 4th variant `consumed` (Lucide `CheckCheck`, primary color) | self-analog (lines 9-16 `statusConfig` literal) |
| `src/stores/commsStore.ts` | remove `messages`, `sendMessage`, `fetchMessages`, `ChatMessage` type (kept only for transient migration reference) | — (pure deletion) |
| `src/views/CommsHub/RequestDetail.tsx` | remove `ChatThread` + `ChatInput` imports and render blocks (lines 125-132) | — (pure deletion) |
| `src/views/CommsHub/TelemetryPanel.tsx` | remove `AGENT_CHANNELS` section + `MiniChatCard` loop (lines 18-35) | — (pure deletion) |
| `src/bindings.ts` | regenerated by `tauri-specta` after command changes | build-time auto-gen |

### Frontend — deleted files (D-21)

| Deleted File | Reason |
|---------------|--------|
| `src/views/CommsHub/ChatThread.tsx` | Replaced by `src/components/chat/ChatTranscript.tsx` |
| `src/views/CommsHub/ChatInput.tsx` | Logic migrates into `src/components/chat/ChatInput.tsx` |
| `src/views/CommsHub/MiniChatCard.tsx` | No longer rendered after `AGENT_CHANNELS` removed |
| `src/views/CommsHub/__tests__/CommsComponents.test.tsx` (portions) | Delete `ChatThread`, `MiniChatCard`, `TelemetryPanel/AGENT_CHANNELS` describe blocks; `DeliveryStatus` block stays + adds `consumed` case |

### Frontend — new tests

| New Test File | Closest Analog |
|----------------|----------------|
| `src/stores/__tests__/chatStore.test.ts` | `src/stores/__tests__/commsStore.test.ts` |
| `src/hooks/__tests__/useChatChannel.test.ts` | `src/hooks/__tests__/useGraphLayout.test.ts` (structure) |
| `src/views/CommsHub/__tests__/ChatView.test.tsx` | `src/views/CommsHub/__tests__/CommsComponents.test.tsx` |
| `src/components/chat/__tests__/*.test.tsx` | `src/views/CommsHub/__tests__/ApprovalRequestCard.test.tsx` |

---

## Pattern Assignments

### `src-tauri/src/chat_runtime/session_registry.rs` (registry, registry)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/hook_waiters.rs`

**Registry shape** (lines 18-46):
```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub struct WaiterEntry {
    pub agent_id: String,
    pub tool_name: String,
    pub sender: oneshot::Sender<HookDecision>,
}

#[derive(Default)]
pub struct WaiterRegistry {
    waiters: Mutex<HashMap<i64, WaiterEntry>>,
    always_allow: Mutex<HashSet<(String, String)>>,
    session_agents: Mutex<HashMap<String, String>>,
}
```

Planner copies structure verbatim. For `chat_runtime`:
- Replace `waiters` with `sessions: Mutex<HashMap<String /* agent_id */, LiveSession>>`.
- `LiveSession` owns `Child`, `stdin_tx: mpsc::Sender<String>`, `session_id: Option<String>`, `parser_task`, `supervisor_task`.
- `new_arc() -> Arc<Self>` helper (line 53) for Tauri `State`/axum `Extension` dual wiring.

**Lock-order rule** (lines 12-14) — copy the comment literally for clarity:
```rust
//! Lock order (never held simultaneously):
//!   waiters  ->  always_allow  ->  session_agents
```

---

### `src-tauri/src/chat_runtime/launcher.rs` (subprocess, process-spawn)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/launcher.rs`

**Imports + Windows flags** (lines 1-22):
```rust
use crate::agents::registry::AgentRegistry;
use std::path::Path;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x00000008;
```

**Core spawn pattern** (lines 37-71 — `launch_detached` shape; MUTATE stdio to piped instead of null):
```rust
pub async fn launch_detached(
    program: &str,
    args: &[&str],
    cwd: &Path,
    env_vars: Option<Vec<(&str, &str)>>,
    aitc_port: u16,
) -> Result<(u32, tokio::process::Child), String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd.env("AITC_PORT", aitc_port.to_string());
    // ...
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    let child = cmd.spawn().map_err(|e| format!("Failed to spawn '{program}': {e}"))?;
    let pid = child.id().ok_or_else(|| "Spawned process has no PID".to_string())?;
    Ok((pid, child))
}
```

**Mutation for `launch_live_session`:** add `cmd.stdin(std::process::Stdio::piped())`, inject `--mcp-config <path>` + `--strict-mcp-config` into `args`, return `(pid, child)` with all three stdio handles still attached (caller calls `child.stdin.take()` + `child.stdout.take()`).

**Exit-detection branch for supervisor** (lines 186-196) — copy structure literally for the `Stop`-hook / clean-exit detection in `supervisor.rs`:
```rust
let (new_state, exit_summary) = match child.wait().await {
    Ok(status) if status.success() => (AgentState::Idle, "exit=0".to_string()),
    Ok(status) => {
        let code = status.code().map(|c| c.to_string())
            .unwrap_or_else(|| "signalled".to_string());
        (AgentState::Error, format!("exit={code}"))
    }
    Err(e) => (AgentState::Error, format!("wait failed: {e}")),
};
```

---

### `src-tauri/src/chat_runtime/parser.rs` (service, streaming)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/launcher.rs::spawn_stdout_reader` (lines 148-224)

**Line-by-line stdout reader pattern** (lines 153-178):
```rust
pub fn spawn_stdout_reader(
    mut child: tokio::process::Child,
    agent_id: String,
    registry: Arc<AgentRegistry>,
) -> tokio::task::JoinHandle<()> {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    tokio::spawn(async move {
        // stderr drained in parallel
        let stderr_task = stderr.map(|stderr| {
            let registry = registry.clone();
            let agent_id = agent_id.clone();
            tokio::spawn(async move {
                let reader = tokio::io::BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    push_log_line(&registry, &agent_id, format!("[stderr] {line}")).await;
                }
            })
        });
        if let Some(stdout) = stdout {
            let reader = tokio::io::BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                push_log_line(&registry, &agent_id, line).await;
            }
        }
        // ...
    })
}
```

**Mutation for stream-json parser:** replace `push_log_line(...)` body with:
1. `serde_json::from_str::<StreamJsonChunk>(&line)` — chunk enum tagged by `"type"` field (`"system"`, `"assistant"`, `"user"`, `"result"`, `"stream_event"`).
2. Dispatch by variant — `assistant_text` deltas buffer in a RAM accumulator and flush to `agent_events` on turn completion OR 250ms idle (use `tokio::time::timeout` wrapping `lines.next_line()` — D-17).
3. On `{type:"system", subtype:"init", session_id: ...}`, call `session_registry::bind_session_id(agent_id, session_id)` AND `app.emit("agent-session-started", ...)`.
4. Each decoded event inserts via `db::events::insert_agent_event(pool, agent_event).await` AND emits `app.emit("agent-event-appended", &event)`.
5. On malformed JSON: `tracing::warn!(line=..., error=..., "malformed stream-json chunk")` and continue; don't propagate.

---

### `src-tauri/src/chat_runtime/outbound.rs` (service, streaming)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/hook_waiters.rs` (mpsc/mutex pattern) + `tokio::sync::mpsc` precedent in `self_register.rs::oneshot`

**Pattern** — FIFO backlog via a dedicated `tokio::spawn` writer task per LiveSession. Stored on `LiveSession.stdin_tx: mpsc::Sender<OutboundFrame>`. Writer task drains and calls `child_stdin.write_all(frame.as_bytes()).await; child_stdin.write_all(b"\n").await; child_stdin.flush().await;`, then flips delivery status:

```rust
// Drain pattern mirroring claude_resources::commands::start_claude_resources_watch forwarder (lines 148-157).
let writer = tokio::spawn(async move {
    while let Some(frame) = rx.recv().await {
        let line = serde_json::to_string(&frame.payload).unwrap();
        if let Err(e) = child_stdin.write_all(line.as_bytes()).await {
            tracing::warn!(error = %e, "stdin write failed");
            break;
        }
        let _ = child_stdin.write_all(b"\n").await;
        let _ = child_stdin.flush().await;
        // D-10: flip user_text event row delivery_status queued -> delivered
        let _ = db::events::update_event_delivery(&pool, frame.event_id, "delivered").await;
        let _ = app.emit("agent-delivery-updated", &frame.event_id);
    }
});
```

---

### `src-tauri/src/chat_runtime/commands.rs` (controller, request-response)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/commands.rs`

**Tauri command signature pattern** (lines 191-250, `approve_request`):
```rust
#[tauri::command]
#[specta::specta]
pub async fn approve_request(
    id: i64,
    always_allow_for_session: Option<bool>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT tool_name, agent_id FROM approval_requests \
         WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("approve lookup: {e}"))?;
    // ... insert + emit + signal ...
    let _ = app_handle.emit("approval-resolved", id);
    Ok(())
}
```

**Mutation for new chat commands** — same shape for each:
- `send_chat_message_to_agent(agent_id, content, pool, sessions, app) -> Result<AgentEvent>` — (a) fetch agent capability from `sessions` registry; (b) if read-only: insert `user_text` row with `delivery_status='unsupported'` + emit + return; (c) else: insert `user_text` row with `queued`, push frame to `session.stdin_tx`, return the `AgentEvent`. Frontend optimistic-append is backstopped by the `agent-event-appended` emit.
- `list_agent_events(agent_id, before_id: Option<i64>, limit: i64, pool) -> Result<Vec<AgentEvent>>` — paginated (for D-18 upward infinite-scroll). Structure from `list_approval_requests` (lines 162-173).
- `clear_agent_thread(agent_id, pool, app) -> Result<()>` — `DELETE FROM agent_events WHERE agent_id = ?`; emit `agent-thread-cleared`.
- `mark_agent_events_read(agent_id) -> Result<()>` — in-memory only; updates `sessions.last_read[agent_id] = now`, emits `agent-events-marked-read`.
- `relaunch_agent_session(agent_id) -> Result<()>` — reactivates a terminated session (D-04).

**`create_approval_request_internal` row insert + event emit pattern** (lines 126-152) — copy verbatim for `db::events::insert_agent_event`:
```rust
let row = sqlx::query(
    "INSERT INTO approval_requests (agent_id, ...) VALUES (?, ...) \
     RETURNING id, agent_id, ..."
)
.bind(agent_id)
.bind(...)
.fetch_one(pool)
.await
.map_err(|e| format!("insert approval_request failed: {e}"))?;
let req = map_approval_row(&row);
let _ = app_handle.emit("approval-request-created", &req);
Ok(req)
```

---

### `src-tauri/src/chat_runtime/types.rs` (type-definitions)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/claude_resources/events.rs` (tagged-enum pattern) + `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/types.rs` (specta + camelCase)

**camelCase specta pattern** (comms/types.rs lines 8-25):
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: i64,
    pub agent_id: String,
    pub file_path: Option<String>,
    // ...
    pub session_id: Option<String>,
}
```

**Tagged-enum pattern for `EventType` / `AgentEventPayload`** (claude_resources/events.rs lines 49-100):
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResourceMetadata {
    #[serde(rename_all = "camelCase")]
    Skill { tools: Option<Vec<String>>, allowed_tools: Option<Vec<String>> },
    #[serde(rename_all = "camelCase")]
    Agent { tools: Option<Vec<String>>, model: Option<String> },
    // ...
}
```

**Mutation for Phase 10** — tagged by `event_type`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: i64,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub event_type: String,          // keep as String for D-13 forward-compat; enum parsed client-side
    pub payload_json: serde_json::Value, // raw JSON; frontend switches on event_type
    pub approval_request_id: Option<i64>,
    pub sequence_number: Option<i64>,
    pub created_at: String,
    pub delivery_status: Option<String>, // Some("queued"|"delivered"|"consumed"|"unsupported") for user_text only
}
```

Payload shapes (suggested baselines per CONTEXT.md):
- `user_text` → `{"content": string}`
- `assistant_text` → `{"content": string, "model": string?}`
- `tool_use` → `{"tool_name": string, "tool_input": object, "result": object?}`
- `approval_link` → `{"approval_request_id": number, "tool_name": string, "summary": string}`

---

### `src-tauri/src/db/migrations/006_agent_events.sql` (migration)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/db/migrations/003_comms_chat.sql` (chat_messages CREATE + index) + `/home/prannayag/pragnition/htx/aitc/src-tauri/src/db/migrations/005_pretool_use_hooks.sql` (ALTER + CREATE INDEX)

**CREATE + index pattern** (003 lines 9-21):
```sql
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    content TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'queued'
        CHECK(delivery_status IN ('delivered', 'queued', 'unsupported')),
    approval_request_id INTEGER REFERENCES approval_requests(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chat_messages_agent ON chat_messages(agent_id, created_at);
```

**Mutation for Phase 10** (D-14 schema):
```sql
CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    approval_request_id INTEGER REFERENCES approval_requests(id),
    sequence_number INTEGER,
    delivery_status TEXT,              -- only for event_type='user_text'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agent_events_agent_created ON agent_events(agent_id, created_at);
CREATE INDEX idx_agent_events_session_sequence ON agent_events(session_id, sequence_number);

-- D-21 one-shot data migration: chat_messages -> agent_events
INSERT INTO agent_events (agent_id, event_type, payload_json, approval_request_id, delivery_status, created_at)
SELECT
    agent_id,
    CASE direction WHEN 'outbound' THEN 'user_text' ELSE 'assistant_text' END,
    json_object('content', content),
    approval_request_id,
    CASE direction WHEN 'outbound' THEN delivery_status ELSE NULL END,
    created_at
FROM chat_messages;
-- Leave chat_messages table in place but empty for v1 (D-21 "later cleanup phase drops it").
DELETE FROM chat_messages;
```

---

### `src-tauri/src/mcp/session_config.rs` (utility, file-I/O)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/hook_install.rs::install_aitc_hook`

**Atomic-write + merge-safe pattern** (lines 26-67):
```rust
pub fn install_aitc_hook(cwd: &Path, sidecar_abs_path: &str) -> Result<(), String> {
    let dot_claude = cwd.join(".claude");
    std::fs::create_dir_all(&dot_claude).map_err(|e| format!("mkdir .claude: {e}"))?;
    let path = dot_claude.join("settings.local.json");

    let mut root: Value = if path.exists() {
        let contents = std::fs::read_to_string(&path).map_err(|e| format!("read: {e}"))?;
        if contents.trim().is_empty() { json!({}) } else { serde_json::from_str(&contents).map_err(|e| format!("parse: {e}"))? }
    } else { json!({}) };
    if !root.is_object() {
        return Err("settings.local.json top-level must be an object".into());
    }
    // ... merge logic ...
    let tmp = path.with_file_name("settings.local.json.tmp");
    let rendered = serde_json::to_string_pretty(&root).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, rendered).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("atomic rename: {e}"))?;
    Ok(())
}
```

**Mutation for Phase 10 per-session MCP config** (D-11 + RESEARCH.md recommends `--mcp-config <file>` + `--strict-mcp-config`):
- Write a **fresh per-session** file `{cwd}/.claude/aitc-mcp-{agent_id}.json` (not a merge into user's `.mcp.json` — `--strict-mcp-config` lets us hand Claude just ours without polluting the user's global `~/.claude.json`).
- File body: `{"mcpServers": {"aitc-chat": {"url": "http://127.0.0.1:{port}/mcp"}}}`.
- Same atomic tmp+rename.
- Return the absolute path so `chat_runtime::launcher` can push `--mcp-config <path>` into argv.
- Cleanup: on session terminate, `std::fs::remove_file(path).ok()` (best-effort, fire-and-forget).

Reuse `atomic_write` helper from `src-tauri/src/claude_resources/claude_md.rs` (lines 47-59) if preferred.

---

### `src-tauri/src/mcp/streamable_http.rs` (controller, request-response)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/self_register.rs::hook_handler` (lines 208-404)

**axum handler signature + Extension DI + long-held response pattern** (lines 208-267):
```rust
#[allow(clippy::too_many_arguments)]
async fn hook_handler<R: tauri::Runtime>(
    Extension(registry): Extension<Arc<AgentRegistry>>,
    Extension(rate_limiter): Extension<Arc<RateLimiter>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Extension(waiters): Extension<Arc<WaiterRegistry>>,
    Extension(app): Extension<tauri::AppHandle<R>>,
    Json(body): Json<HookRequest>,
) -> axum::response::Response {
    if !rate_limiter.check().await {
        return (StatusCode::TOO_MANY_REQUESTS, Json(AitcDecisionResponse::Deny { reason: "rate limited".into() })).into_response();
    }
    if !body.tool_input.is_object() && !body.tool_input.is_null() {
        return (StatusCode::BAD_REQUEST, Json(AitcDecisionResponse::Deny { reason: "tool_input must be object".into() })).into_response();
    }
    // ... resolve agent, register waiter, await oneshot::Receiver ...
}
```

**Mutation for `/mcp` JSON-RPC handler:**
- Accept `Json<JsonRpcRequest>` with `method`, `params`, `id`.
- Dispatch by method name:
  - `initialize` → return capabilities + protocol version.
  - `tools/list` → return static array describing `get_pending_user_messages`, `request_user_input`.
  - `tools/call` with `{name: "get_pending_user_messages", args: {agent_id}}` → consume FIFO from outbound mpsc OR long-poll via `oneshot::channel` registered in `ChatRuntimeState` (same waiter-registry pattern as `hook_waiters.rs::register` → `signal` — lines 57-69).
  - `tools/call` with `{name: "request_user_input", args: {agent_id, prompt}}` → dispatch OS notification (reuse `dispatch_approval_notification` pattern; see Shared Patterns).
- Return `Json<JsonRpcResponse>` with `result` or `error`.

**`build_router` extension layer pattern** (lines 513-531) — modify existing `self_register.rs::build_router` to add MCP routes:
```rust
pub fn build_router<R: tauri::Runtime>(...) -> Router {
    Router::new()
        .route("/register", post(register_agent))
        .route("/hook", post(hook_handler::<R>))
        .route("/mcp", post(mcp_post_handler::<R>))   // NEW
        .route("/mcp", get(mcp_sse_handler::<R>))     // NEW (SSE upgrade)
        .route("/mcp", delete(mcp_delete_handler::<R>)) // NEW (session teardown)
        .layer(DefaultBodyLimit::max(HOOK_BODY_MAX_BYTES))
        .layer(Extension(registry))
        .layer(Extension(rate_limiter))
        .layer(Extension(pool))
        .layer(Extension(waiters))
        .layer(Extension(app))
        .layer(Extension(chat_runtime))   // NEW
        .layer(Extension(mcp_state))      // NEW
}
```

**Test harness pattern** — `spawn_hook_server()` helper (lines 743-770) — clone verbatim into MCP integration tests as `spawn_mcp_server()`:
```rust
pub(crate) async fn spawn_hook_server() -> (String, Arc<AgentRegistry>, Arc<WaiterRegistry>, sqlx::SqlitePool) {
    let mut registry_inner = AgentRegistry::new();
    registry_inner.register_adapter(Arc::new(ClaudeCodeAdapter));
    let registry = Arc::new(registry_inner);
    let pool = make_hook_pool().await;
    let waiters = WaiterRegistry::new_arc();
    let app = tauri::test::mock_app();
    let app_handle = app.handle().clone();
    let rate_limiter = Arc::new(RateLimiter::new());
    let router = build_router(registry.clone(), pool.clone(), waiters.clone(), app_handle, rate_limiter);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { let _ = axum::serve(listener, router).await; });
    (format!("http://127.0.0.1:{port}"), registry, waiters, pool)
}
```

---

### `src-tauri/src/db/events.rs` (service, CRUD)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/commands.rs::create_approval_request_internal` + `list_approval_requests` + `map_approval_row`

**Row-mapper pattern** (lines 61-80):
```rust
fn map_approval_row(row: &sqlx::sqlite::SqliteRow) -> ApprovalRequest {
    ApprovalRequest {
        id: row.get("id"),
        agent_id: row.get::<Option<String>, _>("agent_id").unwrap_or_default(),
        // ...
        tool_name: row.try_get("tool_name").ok().flatten(),
        tool_input_json: row.try_get("tool_input_json").ok().flatten(),
        session_id: row.try_get("hook_session_id").ok().flatten(),
    }
}
```

**Insert + RETURNING + emit pattern** (lines 126-155) — use identically for `insert_agent_event`:
```rust
let row = sqlx::query(
    "INSERT INTO agent_events (agent_id, session_id, event_type, payload_json, approval_request_id, sequence_number, delivery_status) \
     VALUES (?, ?, ?, ?, ?, ?, ?) \
     RETURNING id, agent_id, session_id, event_type, payload_json, approval_request_id, sequence_number, delivery_status, created_at"
)
.bind(agent_id).bind(session_id).bind(event_type).bind(payload_json_str)
.bind(approval_request_id).bind(sequence_number).bind(delivery_status)
.fetch_one(pool)
.await
.map_err(|e| format!("insert agent_event failed: {e}"))?;
let ev = map_agent_event_row(&row);
let _ = app_handle.emit("agent-event-appended", &ev);
Ok(ev)
```

---

### `src/stores/chatStore.ts` (store, event-driven + CRUD)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/stores/commsStore.ts` (Tauri `listen` subscription pattern) + `/home/prannayag/pragnition/htx/aitc/src/stores/claudeResourcesStore.ts` (batched-event applyBatch shape)

**Interface + action signatures** (commsStore.ts lines 42-71):
```typescript
interface CommsStore {
  requests: ApprovalRequest[];
  selectedRequestId: number | null;
  messages: Record<string, ChatMessage[]>;
  isLoading: boolean;
  error: string | null;
  fetchRequests: () => Promise<void>;
  approveRequest: (id: number, opts?: { alwaysAllowForSession?: boolean }) => Promise<void>;
  sendMessage: (agentId: string, content: string) => Promise<void>;
  subscribeToApprovals: () => Promise<UnlistenFn>;
  pendingCount: () => number;
  reset: () => void;
}
```

**Tauri event subscription cleanup fan-out pattern** (lines 218-251):
```typescript
subscribeToApprovals: async () => {
  const [unCreated, unResolved, unUpdated] = await Promise.all([
    listen<ApprovalRequest>('approval-request-created', (event) => {
      const { editingRequestId, requests } = get();
      if (editingRequestId !== null && event.payload.id === editingRequestId) return;
      const existing = requests.find((r) => r.id === event.payload.id);
      if (existing) {
        set((s) => ({ requests: s.requests.map((r) => r.id === event.payload.id ? event.payload : r) }));
      } else {
        set((s) => ({ requests: [...s.requests, event.payload] }));
      }
    }),
    listen<number>('approval-resolved', () => { get().fetchRequests(); }),
    listen<number>('approval-updated', () => { get().fetchRequests(); }),
  ]);
  return () => { unCreated(); unResolved(); unUpdated(); };
},
```

**Per-domain batch-apply pattern** (claudeResourcesStore.ts lines 40-64):
```typescript
applyBatch: (batch) =>
  set((s) => {
    const next = { ...s.resourcesById };
    for (const ev of batch.events) {
      switch (ev.kind) {
        case 'added':
        case 'changed': next[ev.resource.id] = ev.resource; break;
        case 'removed': delete next[ev.id]; break;
        case 'externalEdit': ... break;
      }
    }
    return { resourcesById: next, ... };
  }),
```

**Mutation for Phase 10 chatStore** — hybrid of the two:
```typescript
interface ChatStore {
  eventsByAgent: Record<string, AgentEvent[]>;   // keyed by agent_id
  channels: ChatChannel[];                       // master-list rows, sorted by last-event desc
  selectedAgentId: string | null;
  unreadByAgent: Record<string, number>;
  archivedCollapsed: boolean;
  isLoading: boolean;
  error: string | null;
  fetchChannels: () => Promise<void>;
  loadInitialEvents: (agentId: string) => Promise<void>;
  loadOlder: (agentId: string) => Promise<void>;
  selectAgent: (id: string | null) => void;
  sendMessage: (agentId: string, content: string) => Promise<void>;
  clearThread: (agentId: string) => Promise<void>;
  markRead: (agentId: string) => Promise<void>;
  subscribeToChat: () => Promise<UnlistenFn>;
  totalUnread: () => number;
  reset: () => void;
}
```

`subscribeToChat` listens to five events: `agent-event-appended`, `agent-turn-started`, `agent-turn-complete`, `agent-session-started`, `agent-session-ended` (plus `agent-delivery-updated` for D-10 status flips). Fan-out unlisten pattern from lines 218-251 above.

**Selected-agent read-marking** — inside `agent-event-appended` handler, if `get().selectedAgentId === payload.agentId && document.visibilityState === 'visible'`, do NOT increment unread.

---

### `src/hooks/useChatChannel.ts` (hook, streaming subscription)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/hooks/useClaudeResourcesChannel.ts`

**Full hook shape** (lines 11-50 — near-verbatim for Phase 10):
```typescript
export function useClaudeResourcesChannel() {
  const channelRef = useRef<Channel<ResourceEventBatch> | null>(null);

  useEffect(() => {
    const channel = new Channel<ResourceEventBatch>();
    channel.onmessage = (batch) => {
      useClaudeResourcesStore.getState().applyBatch(batch);
    };
    channelRef.current = channel;
    return () => { channelRef.current = null; };
  }, []);

  const start = useCallback(async (cwd: string | null): Promise<Resource[]> => {
    if (!channelRef.current) throw new Error('useClaudeResourcesChannel: channel not ready');
    const initial = await invoke<Resource[]>('start_claude_resources_watch', {
      cwd, channel: channelRef.current,
    });
    useClaudeResourcesStore.getState().seed(initial);
    return initial;
  }, []);

  const stop = useCallback(async () => {
    await invoke('stop_claude_resources_watch');
    useClaudeResourcesStore.getState().reset();
  }, []);

  return { start, stop };
}
```

**Mutation for Phase 10** — chat capture is always-on (D-24), so `useChatChannel` can be simpler: just `subscribeToChat()` on mount (no `start`/`stop`). If a Channel is preferred over `listen()` for higher throughput, mirror exactly above with `AgentEventBatch`. Otherwise the chatStore's own `subscribeToChat` in a top-level `useEffect` is sufficient. Planner decides; favour `listen()`-in-store when event rate < 10/s (matches commsStore), Channel when streaming-token rate can exceed 50/s (matches pipelineStore).

---

### `src/views/CommsHub/ChatView.tsx` (view, top-level)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/Arsenal/ArsenalView.tsx` (closest master-detail shell consumer) — and directly: `MasterDetailShell` primitive.

**Shell usage pattern** (ArsenalView consumption — planner reads directly; structure is):
```typescript
<MasterDetailShell
  header={<ViewHeader title="COMMUNICATIONS_HUB" />}
  tabs={<CommsTabBar active="chat" />}
  rail={<AgentChannelList />}    // 280px (override prop)
  list={<ChatTranscript agentId={selectedAgentId} />}
  detail={<ChatInput agentId={selectedAgentId} />}  // OR merge list+detail into a single right pane; see D-20
/>
```

Per UI-SPEC D-20 the CHAT tab is a **two-pane** master/detail, not three. Options:
1. Pass the detail pane as the `list` slot and leave `rail` doing the master list; omit the old `detail` prop (needs new `detailWidth="flex"` mod to `MasterDetailShell`).
2. Use `rail` for master list with `railWidth={280}` override, and render transcript + sticky input stacked inside the `list` slot.

Planner picks — recommendation: option 2, simpler, doesn't require a detail-pane hide mode.

**Animation pattern** (existing views, e.g. CommsView.tsx line 117, HistoryView.tsx line 68):
```jsx
<div className="flex h-[calc(100vh-56px)] bg-surface"
     style={{ animation: 'phosphor-in 150ms ease' }}>
```

---

### `src/components/ui/CommsTabBar.tsx` (component, UI-only)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/HistoryView.tsx` (lines 77-92 tab bar)

**Tab bar pattern** (lines 77-92):
```jsx
<div className="flex h-11 items-end gap-0 px-6">
  {tabs.map((tab) => (
    <button
      key={tab}
      onClick={() => setTab(tab)}
      className={`px-4 pb-2 font-headline text-[11px] uppercase tracking-widest transition-colors duration-150 ${
        activeTab === tab
          ? 'border-b-2 border-primary text-primary'
          : 'border-b-2 border-transparent text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {tabLabels[tab]}
    </button>
  ))}
</div>
```

**Mutation** — wire `activeTab` to URL search params via `useSearchParams` (react-router-dom, already used by `Sidebar.tsx::NavLink`). Render a trailing `<UnreadBadge count={totalUnread} />` inside the CHAT button when applicable (per UI-SPEC).

---

### `src/components/ui/UnreadBadge.tsx` (component, UI-only)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/components/ui/PendingCountBadge.tsx`

**Full component pattern** (lines 10-43):
```jsx
export function PendingCountBadge() {
  const count = useCommsStore((s) => s.pendingCount());
  const prevCountRef = useRef(count);
  const isNew = count > prevCountRef.current;
  useEffect(() => { prevCountRef.current = count; }, [count]);
  if (count === 0) return null;
  return (
    <span className="relative inline-flex items-center gap-1" aria-live="polite">
      <motion.span
        className="font-mono text-[10px] font-bold text-primary"
        animate={isNew ? { scale: [1, 1.2, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        {count}
      </motion.span>
      <span className="relative inline-flex h-2 w-2">
        <motion.span className="absolute inset-0 rounded-full bg-primary/30" ... />
        <span className="relative h-2 w-2 rounded-full bg-primary" />
      </span>
    </span>
  );
}
```

**Mutation for `UnreadBadge`** — decouple from `commsStore`: accept `count: number` prop; same pulse animation; text copy `{n}` / `99+`. Per UI-SPEC: `min-w-[20px] h-5`, `bg-primary text-on-primary`, hidden when `count === 0`.

---

### `src/components/chat/EventCard.tsx` (dispatcher)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ToolPreview/registry.ts` + `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ToolPreview/index.tsx`

**Registry-then-dispatcher pattern** (registry.ts lines 32-54):
```typescript
const RENDERERS: Record<string, ToolRenderer> = {
  Edit: EditPreview,
  MultiEdit: EditPreview,
  Write: WritePreview,
  // ...
};
export function resolveRenderer(toolName: string | null | undefined): ToolRenderer {
  if (!toolName) return UnknownToolPreview;
  if (toolName.startsWith('mcp__')) return UnknownToolPreview;
  return RENDERERS[toolName] ?? UnknownToolPreview;
}
```

**Dispatcher usage** (index.tsx lines 1-11):
```typescript
export function ToolPreview(props: ToolPreviewProps) {
  const Renderer = resolveRenderer(props.toolName);
  return <Renderer {...props} />;
}
```

**Mutation for `EventCard`:**
```typescript
const RENDERERS: Record<string, FC<EventCardProps>> = {
  user_text: UserMessageCard,
  assistant_text: AssistantTextCard,
  tool_use: ToolUseCard,
  approval_link: ApprovalLinkCard,
  tool_result: ToolResultCard,
  session_boundary: SessionBoundary,
  raw_stdout: RawStreamCard,
  raw_stderr: RawStreamCard,
  system_note: SystemNoteCard,
};
export function EventCard({ event }: { event: AgentEvent }) {
  const Renderer = RENDERERS[event.event_type] ?? SystemNoteCard;  // D-13 forward-compat fallback
  return <Renderer event={event} />;
}
```

---

### `src/components/chat/ToolUseCard.tsx` (component, UI-interactive)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/MiniChatCard.tsx` (motion layout expand/collapse) + `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ToolPreview/index.tsx` (reuse verbatim for expanded body)

**Motion expand/collapse pattern** (MiniChatCard lines 19-24, 62-69):
```jsx
<motion.div layout
  className="bg-surface-container-low border border-outline-variant/10 overflow-hidden"
  style={{ minHeight: expanded ? 'auto' : '120px', maxHeight: expanded ? 'none' : '120px' }}
  transition={{ duration: 0.15, ease: 'easeOut' }}>
  <button onClick={() => setExpanded((prev) => !prev)}>
    {expanded ? <ChevronUp size={14} strokeWidth={1.5} /> : <ChevronDown size={14} strokeWidth={1.5} />}
  </button>
  <AnimatePresence>
    {expanded && (
      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}>
        {/* expanded content */}
      </motion.div>
    )}
  </AnimatePresence>
</motion.div>
```

**Mutation for Phase 10:**
- Collapsed row: `h-9 min-h-[36px]` (per UI-SPEC) instead of `120px`, showing `<ToolBadge toolName={...} />` + one-line summary + chevron + optional `→ APPROVAL_{id}` pill.
- Expanded body: `<ToolPreview requestId={event.approvalRequestId ?? 0} toolName={...} toolInputJson={...} filePath={...} />` — the Phase 8 registry handles the rest (D-16).

---

### `src/components/chat/ChatInput.tsx` (component, UI-interactive)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ChatInput.tsx` (delete after logic migration)

**Full component, near-verbatim** (all 71 lines are in scope):
```typescript
import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';   // changed import

interface ChatInputProps {
  agentId: string;
  disabled?: boolean;                  // NEW (D-02 read-only adapter)
  disabledTooltip?: string;            // NEW
  placeholder?: string;                // NEW (D-02)
}

export function ChatInput({ agentId, disabled, disabledTooltip, placeholder }: ChatInputProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    await sendMessage(agentId, trimmed);
    setContent('');
    if (textareaRef.current) textareaRef.current.style.height = '40px';
  }, [content, agentId, sendMessage, disabled]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // Auto-resize + caret blink treatment copied 1:1 from Phase 4 ChatInput.
  return (
    <div className="flex items-end gap-2 border border-outline-variant/10 bg-[#000000] p-2"
         title={disabled ? disabledTooltip : undefined}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => { setContent(e.target.value); e.target.style.height = '40px'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? `TYPE_MESSAGE_TO_${agentId}…`}
        disabled={disabled}
        aria-disabled={disabled}
        className="flex-1 resize-none bg-transparent font-mono text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ minHeight: '40px', maxHeight: '120px', caretColor: '#00cffc', animation: 'blink-cursor 1s step-end infinite' }}
        rows={1}
      />
      <button onClick={handleSend} disabled={disabled} aria-label={`Send message to ${agentId}`}
              className="shrink-0 p-2 text-on-surface-variant hover:text-primary disabled:hover:text-on-surface-variant/40 transition-colors">
        <Send size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
```

---

### `src/components/chat/UserMessageCard.tsx` (component, UI-only)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ChatThread.tsx` lines 43-68 (outbound-branch bubble)

**Outbound bubble pattern** (lines 43-68):
```jsx
<div className={`flex flex-col max-w-[80%] ${isOutbound ? 'self-end' : 'self-start'}`}>
  <div className={`px-3 py-2 ${isOutbound ? 'bg-surface-container' : 'bg-surface-container-low'}`}>
    <p className="font-mono text-sm text-on-surface">{msg.content}</p>
  </div>
  <div className="flex items-center gap-2 mt-1">
    <span className="font-mono text-on-surface-variant" style={{ fontSize: '10px' }}>
      {new Date(msg.createdAt).toLocaleTimeString()}
    </span>
    <DeliveryStatus status={msg.deliveryStatus} />
  </div>
</div>
```

**Mutation for Phase 10** — always `self-end` (UserMessageCard is outbound-only), surface becomes `bg-surface-container` per UI-SPEC, reads `event.payload_json.content` instead of `msg.content`, passes `event.deliveryStatus` to extended `DeliveryStatus` (with `consumed` variant).

---

### `src/components/ui/DeliveryStatus.tsx` (modification)

**Analog:** self (src/components/ui/DeliveryStatus.tsx)

**Current config** (lines 1-16):
```typescript
import { Check, Clock, X } from 'lucide-react';
type DeliveryStatusType = 'delivered' | 'queued' | 'unsupported';
const statusConfig: Record<DeliveryStatusType, { icon: typeof Check; color: string; label: string }> = {
  delivered: { icon: Check, color: '#8eff71', label: 'DELIVERED' },
  queued: { icon: Clock, color: '#ffd16f', label: 'QUEUED' },
  unsupported: { icon: X, color: '#ff7351', label: 'UNSUPPORTED' },
};
```

**Mutation** (add 4th variant, UI-SPEC D-10):
```typescript
import { Check, CheckCheck, Clock, X } from 'lucide-react';
type DeliveryStatusType = 'delivered' | 'queued' | 'consumed' | 'unsupported';
const statusConfig = {
  delivered: { icon: Check, color: '#8eff71', label: 'DELIVERED' },
  queued: { icon: Clock, color: '#ffd16f', label: 'QUEUED' },
  consumed: { icon: CheckCheck, color: '#8eff71', label: 'CONSUMED' },   // NEW
  unsupported: { icon: X, color: '#ff7351', label: 'UNSUPPORTED' },
};
```

---

### `src/components/chat/StreamingCursor.tsx` (component, UI-only)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/RequestDetail.tsx` lines 45-48

**Existing blink-cursor pattern** (verbatim):
```jsx
<div className="h-5 w-[2px] bg-secondary"
     style={{ animation: 'blink-cursor 1s step-end infinite' }} />
```

**Mutation for Phase 10** — swap `bg-secondary` for `bg-primary` (UI-SPEC explicitly picks primary for streaming cursor, reserves secondary for input caret), respect reduced-motion via `@media (prefers-reduced-motion: reduce) { animation: none; }` (add to `src/styles/animations.css`).

---

### `src/components/chat/AgentChannelList.tsx` (component, list-render)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/Arsenal/ResourceList.tsx`

Planner reads ResourceList directly for TanStack Virtual scaffolding. Mirror `useVirtualizer({ count, getScrollElement, estimateSize: 64, overscan: 10 })` loop with the row renderer being `<AgentChannelRow />`. Master-list sort: most-recent-activity descending (per Claude's Discretion, locked as default in UI-SPEC). Active + Archived sections implemented as two stacked virtualizers OR a single list with a section-header sentinel row type.

---

### `src/components/chat/ChatTranscript.tsx` (component, virtualized reverse-scroll)

**Analog:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ChatThread.tsx` (scroll-to-bottom + fetch-on-mount) + `/home/prannayag/pragnition/htx/aitc/src/views/Arsenal/ResourceList.tsx` (TanStack Virtual scaffolding).

**Mount + scroll-to-bottom pattern** (ChatThread.tsx lines 14-22):
```typescript
useEffect(() => {
  fetchMessages(agentId);
}, [agentId]);
useEffect(() => {
  endRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messages.length]);
```

**Mutation for Phase 10** (D-18 upward infinite-scroll):
- Replace direct DOM scroll with TanStack Virtual (`@tanstack/react-virtual`) configured in reverse mode (`orientation: 'vertical'`, but render list bottom-up).
- On mount, call `chatStore.loadInitialEvents(agentId)` (fetches the last N events).
- On `scrollTop === 0` (virtualizer's `scrollOffset === 0`), dispatch `chatStore.loadOlder(agentId)` which calls `invoke('list_agent_events', { agentId, beforeId: firstEvent.id, limit: 50 })`.
- Auto-scroll on new event only if user is already at bottom (compare `scrollOffset + clientHeight` vs `totalSize`). If scrolled up, render a floating `↓ {n}_NEW_MESSAGES` pill (UI-SPEC Interaction).

---

### `src/views/CommsView.tsx` (modification)

**Analog:** self + `/home/prannayag/pragnition/htx/aitc/src/views/HistoryView.tsx` (tab + conditional body pattern, lines 19-92)

**Tab-state + conditional-body pattern** (HistoryView lines 19-92, abridged):
```typescript
const activeTab = useHistoryStore((s) => s.activeTab);
const setTab = useHistoryStore((s) => s.setTab);
// ...
return (
  <div className="flex flex-col h-[calc(100vh-56px)] bg-surface" style={{ animation: 'phosphor-in 150ms ease' }}>
    <div className="px-6 pt-4 pb-0">
      <h1 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface">HISTORY</h1>
    </div>
    <div className="flex h-11 items-end gap-0 px-6">
      {tabs.map((tab) => ( <button ...>{tabLabels[tab]}</button> ))}
    </div>
    {/* body switches on activeTab */}
  </div>
);
```

**Mutation for CommsView** — read `activeTab` from URL (`useSearchParams`) rather than a store, so the `?tab=` deep-link convention is honoured (UI-SPEC D-19). Branch:
```jsx
{activeTab === 'requests' ? (
  <div className="flex ...">{/* existing 3-panel layout */}</div>
) : (
  <ChatView />
)}
```

---

### `src/views/CommsHub/RequestDetail.tsx` (modification — pure deletion)

**Change:** delete lines 5-6 (`ChatThread`, `ChatInput` imports) and lines 124-132 (chat thread + chat input render blocks). Nothing else changes.

---

### `src/views/CommsHub/TelemetryPanel.tsx` (modification — pure deletion)

**Change:** delete line 4 (`MiniChatCard` import), line 1 (`useAgentStore` import becomes unused), and the entire `AGENT_CHANNELS` section (lines 17-35). Keep `SystemLoad` + `TelemetryFeed`.

---

### `src/stores/commsStore.ts` (modification — pure deletion)

**Change:** delete `messages: Record<string, ChatMessage[]>` field, `sendMessage`, `fetchMessages` actions, and the `ChatMessage` interface export. Keep everything else. Delete test cases in `src/stores/__tests__/commsStore.test.ts` that reference `messages` / `sendMessage` / `fetchMessages`.

---

### `src/components/layout/MasterDetailShell.tsx` (modification)

**Analog:** self (lines 10-66).

**Current signature** (lines 14-29):
```typescript
export interface MasterDetailShellProps {
  header?: ReactNode;
  tabs?: ReactNode;
  rail: ReactNode;
  list: ReactNode;
  detail: ReactNode;
}
export function MasterDetailShell({ header, tabs, rail, list, detail }: MasterDetailShellProps) { ... }
```

**Mutation** — add optional width props (UI-SPEC: CHAT tab wants `railWidth={280}`, and possibly a two-pane mode):
```typescript
export interface MasterDetailShellProps {
  header?: ReactNode;
  tabs?: ReactNode;
  rail: ReactNode;
  list: ReactNode;
  detail?: ReactNode;           // optional — two-pane mode
  railWidth?: number;           // default 220
  detailWidth?: number | 'flex'; // default 520; 'flex' means no detail pane or detail takes flex-1
}
```

Apply via inline `style={{ width: railWidth }}` + conditional render of `<aside data-testid="detail" />`. Existing callers (Phase 9 Arsenal) continue to work with defaults.

---

### `src/components/layout/Sidebar.tsx` (modification)

**Analog:** self (lines 77-83 where `PendingCountBadge` is slotted)

**Existing slot pattern** (lines 77-83):
```jsx
{expanded && (
  <span className="ml-3 font-headline text-[14px] font-bold uppercase tracking-widest flex items-center gap-2">
    {label}
    {label === 'CONFLICTS' && <ConflictNavBadge />}
    {label === 'COMMS' && <PendingCountBadge />}
  </span>
)}
```

**Mutation** — add an `UnreadDot` beside `PendingCountBadge` when `chatStore.totalUnread() > 0` AND user is not on `?tab=chat`:
```jsx
{label === 'COMMS' && (
  <>
    <PendingCountBadge />
    <ChatUnreadDot />   {/* new inline component reading chatStore + current route */}
  </>
)}
```

---

### `src-tauri/src/agents/claude_code.rs` (modification — significant rewrite)

**Analog:** self (lines 60-143 current `launch`)

**Current launch body** (lines 60-143) captures:
- intent validation → prompt
- argv builder: `--print --output-format stream-json --verbose [perm flags] [prompt]`
- conditional hook install
- `launcher::launch_detached` call

**Mutation for Phase 10** (D-06):
1. Remove `--print` and the positional prompt (long-lived mode doesn't consume a prompt at launch).
2. Swap in `--input-format stream-json --output-format stream-json --verbose`.
3. Write the per-session MCP config via `mcp::session_config::write_mcp_config(cwd, agent_id, self_register_port)` and push `--mcp-config <path> --strict-mcp-config` into args.
4. Call `chat_runtime::launcher::launch_live_session(...)` (new function, analog to `launch_detached` but with piped stdin).
5. Register the `LiveSession` in `ChatRuntimeState` via `session_registry::register`.
6. Spawn parser + outbound writer + supervisor tasks on the returned `Child`.
7. Keep the Phase 8 hook install path (lines 109-132) — it's the sideband metadata source (D-07).

Return `(pid, child)` shape is preserved so `AgentAdapter::launch` signature is unchanged for the call site.

---

## Shared Patterns

### OS Notification Dispatch (D-23)

**Source:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/commands.rs::dispatch_approval_notification` (lines 23-55)

**Apply to:** `src-tauri/src/chat_runtime/notifications.rs`, `src-tauri/src/chat_runtime/parser.rs` (on `@user` match), `src-tauri/src/mcp/tools.rs` (on `request_user_input` call)

```rust
fn dispatch_approval_notification<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    agent_id: &str,
    file_path: Option<&str>,
    request_id: Option<i64>,
) {
    use tauri_plugin_notification::NotificationExt;
    let suffix = match request_id { Some(id) => format!(" [#{id}]"), None => String::new() };
    let body = match file_path {
        Some(fp) => format!("{agent_id} requests access to {fp}{suffix}"),
        None => format!("{agent_id} requests approval{suffix}"),
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app_handle.notification().builder()
            .title("APPROVAL_REQUIRED").body(&body).show()
    }));
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!("approval notification send failed: {e}"),
        Err(_) => tracing::debug!("notification plugin unavailable (likely test runtime)"),
    }
}
```

**Mutation for chat path:** rename to `dispatch_chat_notification`, title becomes `"AWAITING_USER — {agent_id}"`, body becomes `{truncated_text_80_chars}`. The `std::panic::catch_unwind` wrapper is NON-NEGOTIABLE — without it `tauri::test::mock_app` tests panic (Phase 8 learned this the hard way, see comment lines 38-42).

---

### Atomic-Tmp-Rename File Writes (D-11 MCP config)

**Source:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/hook_install.rs::install_aitc_hook` lines 61-65 + `/home/prannayag/pragnition/htx/aitc/src-tauri/src/claude_resources/claude_md.rs::atomic_write` lines 47-59

**Apply to:** `src-tauri/src/mcp/session_config.rs`

```rust
// Pattern A (hook_install.rs): serde_json::to_string_pretty + std::fs::write + std::fs::rename
let tmp = path.with_file_name("settings.local.json.tmp");
let rendered = serde_json::to_string_pretty(&root).map_err(|e| format!("serialize: {e}"))?;
std::fs::write(&tmp, rendered).map_err(|e| format!("write tmp: {e}"))?;
std::fs::rename(&tmp, &path).map_err(|e| format!("atomic rename: {e}"))?;

// Pattern B (claude_md.rs): tempfile::NamedTempFile::persist — kernel-level atomicity
let mut tmp = NamedTempFile::new_in(parent).map_err(|e| format!("tempfile: {e}"))?;
tmp.write_all(content.as_bytes()).map_err(|e| format!("write_all: {e}"))?;
tmp.flush().map_err(|e| format!("flush: {e}"))?;
tmp.persist(path).map_err(|e| format!("persist: {}", e.error))?;
```

**Planner recommendation:** use Pattern B for the MCP config write (already canonicalized helper in the repo; tempfile handles the cross-platform rename correctly).

---

### Tauri Command + specta + Emitter

**Source:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/commands.rs` (every command)

**Apply to:** every new command in `src-tauri/src/chat_runtime/commands.rs`

```rust
#[tauri::command]
#[specta::specta]
pub async fn command_name(
    arg1: String,
    arg2: Option<i64>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    some_state: tauri::State<'_, Arc<SomeRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<ReturnType, String> {
    // ... SQL + emit("event-name", &payload) ...
    Ok(result)
}
```

Commands are then registered in `src-tauri/src/lib.rs` via `tauri_specta::collect_commands!(...)` macro AND in the tauri runtime builder. Regenerating `src/bindings.ts` happens automatically on cargo build when specta is wired in.

---

### Zustand Store + Tauri `listen` Fan-Out Unlisten

**Source:** `/home/prannayag/pragnition/htx/aitc/src/stores/commsStore.ts` lines 218-251

**Apply to:** `src/stores/chatStore.ts::subscribeToChat`

```typescript
subscribeToChat: async () => {
  const [un1, un2, un3, un4, un5, un6] = await Promise.all([
    listen<AgentEvent>('agent-event-appended', (event) => { /* append + unread++ */ }),
    listen<string>('agent-turn-started', (event) => { /* flip streaming state */ }),
    listen<string>('agent-turn-complete', (event) => { /* finalize assistant_text, flip user_text -> consumed */ }),
    listen<SessionStarted>('agent-session-started', (event) => { /* insert session_boundary */ }),
    listen<SessionEnded>('agent-session-ended', (event) => { /* insert session_boundary(ended) */ }),
    listen<DeliveryUpdate>('agent-delivery-updated', (event) => { /* flip queued -> delivered */ }),
  ]);
  return () => { un1(); un2(); un3(); un4(); un5(); un6(); };
},
```

---

### Virtualized List (TanStack Virtual, already installed)

**Source:** `/home/prannayag/pragnition/htx/aitc/src/views/Arsenal/ResourceList.tsx`

**Apply to:** `src/components/chat/AgentChannelList.tsx`, `src/components/chat/ChatTranscript.tsx`

Planner reads ResourceList directly for `useVirtualizer` scaffolding. Key parameters:
- `AgentChannelList`: `estimateSize: 64`, `overscan: 10`.
- `ChatTranscript`: `estimateSize: 60` (variable, so rely on `measureElement` per-row), `overscan: 10`, reverse mode for upward infinite-scroll.

---

### In-module `#[cfg(test)] mod tests` Rust Test Pattern

**Source:** `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/hook_waiters.rs` lines 134-278

**Apply to:** every new Rust module (`chat_runtime/*.rs`, `mcp/*.rs`, `db/events.rs`)

Structure:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn smoke_test_one() { /* ... */ }

    #[tokio::test]
    async fn edge_case_foo() { /* ... */ }
}
```

For axum integration tests: copy `spawn_hook_server()` helper from `self_register.rs` lines 743-770 (already cited above under `streamable_http.rs`).

---

### Frontend Zustand Store Vitest Pattern

**Source:** `/home/prannayag/pragnition/htx/aitc/src/stores/__tests__/commsStore.test.ts` lines 1-66

**Apply to:** `src/stores/__tests__/chatStore.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCommsStore } from '../commsStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

describe('commsStore', () => {
  beforeEach(() => {
    useCommsStore.getState().reset();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetchRequests populates requests array', async () => {
    mockInvoke.mockResolvedValueOnce([mockRequest]);
    await useCommsStore.getState().fetchRequests();
    expect(mockInvoke).toHaveBeenCalledWith('list_approval_requests');
    expect(useCommsStore.getState().requests).toHaveLength(1);
  });
});
```

---

### Frontend Component Vitest Pattern with motion/react Mock

**Source:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/__tests__/CommsComponents.test.tsx` lines 40-53

**Apply to:** every `src/components/chat/__tests__/*.test.tsx`

```typescript
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props;
      return <div {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
```

---

### Phosphor-In Mount Animation

**Source:** `/home/prannayag/pragnition/htx/aitc/src/views/CommsView.tsx` line 117, `/home/prannayag/pragnition/htx/aitc/src/views/HistoryView.tsx` line 68

**Apply to:** `src/views/CommsHub/ChatView.tsx` root element

```jsx
<div className="flex h-[calc(100vh-56px)] bg-surface"
     style={{ animation: 'phosphor-in 150ms ease' }}>
```

`phosphor-in` is already declared in `src/styles/animations.css` (inherited from Phase 1).

---

## No Analog Found

These files have no close match in the existing codebase. Planner falls back to the design system (theme.css, UI-SPEC) and builds from scratch with no precedent pattern to copy.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/chat/SessionBoundary.tsx` | divider + label | UI-only | No horizontal-divider-with-centered-label primitive exists. Planner builds from theme tokens — `bg-surface-container-highest`, `outline-variant/20` hairline, `Label` font 10px tracking-widest. |
| `src/components/chat/RawStreamCard.tsx` | terminal-tail line | UI-only | No terminal-tail aesthetic component. Planner builds: `bg-surface-container-lowest`, `Data` font (JetBrains Mono 12px), no bubble chrome, stderr variant uses `text-error`. |

Both components are small (10-30 lines each), pure CSS styling, no behavior. Risk is low.

---

## Metadata

**Analog search scope:**
- `src-tauri/src/{agents,comms,claude_resources,pipeline,db}/`
- `src-tauri/src/db/migrations/*.sql`
- `src-tauri/tests/`
- `src/{stores,hooks,components,views}/`

**Files scanned (full read):** 25
**Directories listed:** 13
**Pattern extraction date:** 2026-04-17
