use serde::{Deserialize, Serialize};

/// An approval request from an agent (enriched with Phase 4 fields).
///
/// Phase 8 extension: `tool_name`, `tool_input_json`, `session_id` carry the
/// Claude Code PreToolUse context for pretool_use rows. These are `Option`
/// because write_access rows (Phase 4 protected-path trigger) don't have them.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: i64,
    pub agent_id: String,
    pub request_type: String,
    pub file_path: Option<String>,
    pub diff_content: Option<String>,
    pub status: String,
    pub urgency: String,
    pub response_note: Option<String>,
    pub edited_content: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input_json: Option<String>,
    pub session_id: Option<String>,
}

// `ChatMessage` was REMOVED in Phase 10 (D-21). The Phase 4 chat surface
// has been replaced by `chat_runtime::types::AgentEvent` — a unified
// transcript row that handles assistant_text, tool_use, tool_result,
// system_note, session_boundary, and user_text. Do not re-add without
// reverting Phase 10's architecture.

/// A protected path glob pattern that triggers synthetic approval requests.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedPath {
    pub id: i64,
    pub glob_pattern: String,
    pub created_at: String,
}

/// Serializable tree node for frontend consumption (VIZN-01, VIZN-05).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeIndexEntry {
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub depth: u32,
}
