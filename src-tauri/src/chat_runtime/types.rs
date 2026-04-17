//! Phase 10: chat_runtime type surface.
//!
//! Scaffolds exposed to callers (db::events, chat_runtime::commands, lib.rs).
//! Wave 0 (Plan 01) freezes the public shape; Plans 02-04 fill in logic.
//!
//! All DTO structs use `#[serde(rename_all = "camelCase")]` + `specta::Type`
//! so tauri-specta regenerates matching TypeScript in `src/bindings.ts`.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use specta::Type;

/// Maximum outbound user message size at the Tauri command boundary. Oversized
/// payloads are rejected with Err before any DB write (T-10-09 mitigation).
pub const MAX_CHAT_MESSAGE_BYTES: usize = 256 * 1024;

/// Maximum per-line cap for stream-json parser. Lines longer than this are
/// skipped with a `tracing::warn!` (T-10-07 DoS mitigation).
pub const MAX_STREAM_JSON_LINE_BYTES: usize = 1_048_576;

/// A single row out of the `agent_events` table (D-14). `payload_json` holds
/// the shape keyed by `event_type` — see PATTERNS.md "payload_json shapes"
/// for the per-event schema. Stored as `serde_json::Value` on the wire so
/// specta maps it to an `unknown` TypeScript alias; the frontend switches
/// on `event_type` to narrow.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: i64,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub event_type: String,
    pub payload_json: serde_json::Value,
    pub approval_request_id: Option<i64>,
    pub sequence_number: Option<i64>,
    pub created_at: String,
    /// Only populated on `user_text` outbound rows. NULL otherwise per D-10.
    pub delivery_status: Option<String>,
}

/// A single outbound frame queued for the stdin writer (Plan 02).
#[derive(Debug, Clone)]
pub struct OutboundFrame {
    pub event_id: i64,
    pub content: String,
}

/// Per-row delivery-status update; emitted on the `agent-delivery-updated`
/// Tauri event as the stdin writer / MCP sink mutate outbound rows (D-10).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryUpdate {
    pub event_id: i64,
    pub status: String,
}

/// Payload for `agent-session-started` — wired in Plan 02 when the parser
/// captures the stream-json `init` envelope's `session_id`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartedPayload {
    pub agent_id: String,
    pub session_id: String,
}

/// Payload for `agent-session-ended` — emitted when the long-lived subprocess
/// exits (via terminate, crash, or `{type:"result"}` terminal envelope).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionEndedPayload {
    pub agent_id: String,
    pub session_id: Option<String>,
    /// "completed" | "crashed" | "terminated" | "error"
    pub reason: String,
    pub exit_code: Option<i32>,
}

/// Rich master-list payload for the CHAT tab rail. Computed by
/// `list_chat_channels` — Wave 0 just declares the shape.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatChannel {
    pub agent_id: String,
    pub adapter_type: String,
    pub status: String,
    pub archived: bool,
    pub chat_duplex: bool,
    pub last_event: Option<AgentEvent>,
    pub unread_count: i64,
    pub current_session_id: Option<String>,
}

/// Tagged enum emitted by the stream-json parser task (Plan 02). Downstream
/// consumers fan each variant into the appropriate `agent_events` row type
/// and, where relevant, Tauri events.
#[derive(Debug, Clone)]
pub enum StreamEvent {
    SessionStarted { session_id: String },
    AssistantDelta { delta: String },
    AssistantText { content: String, model: Option<String> },
    ToolUse {
        tool_name: String,
        tool_input: serde_json::Value,
        tool_use_id: String,
        approval_request_id: Option<i64>,
    },
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        is_error: bool,
    },
    TurnComplete {
        terminal_reason: String,
        is_error: bool,
    },
    RawStdout { line: String },
    RawStderr { line: String },
    SystemNote { text: String },
    StdoutClosed,
}
