//! Phase 10: MCP tool dispatch.
//!
//! Exposes two tools to Claude Code sessions:
//!   - `get_pending_user_messages` — drains queued outbound frames when the
//!     stdin JSONL primary path is not available.
//!   - `request_user_input` — signals the @user / awaiting-user notification
//!     path (D-23). Optional Plan 04 tool.
//!
//! Wave 0 (Plan 01) declares the dispatcher signatures. Plan 03 wires the
//! bodies.

#![allow(dead_code, unused_variables)]

use std::sync::Arc;

use crate::chat_runtime::session_registry::LiveSessionRegistry;

pub async fn call_get_pending_user_messages(
    _agent_id: String,
    _sessions: Arc<LiveSessionRegistry>,
) -> Result<serde_json::Value, String> {
    todo!("Plan 03 — drain FIFO outbound queue; return list of pending text frames")
}

pub async fn call_request_user_input<R: tauri::Runtime>(
    _agent_id: String,
    _prompt: String,
    _app_handle: tauri::AppHandle<R>,
) -> Result<serde_json::Value, String> {
    todo!("Plan 03 / 04 — dispatch_chat_notification + register pending-input waiter")
}
