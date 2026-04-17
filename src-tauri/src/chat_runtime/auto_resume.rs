//! Phase 10: auto-resume fallback for archived Claude sessions.
//!
//! When `send_chat_message_to_agent` targets an agent whose long-lived
//! subprocess has exited, fall back to a one-shot
//! `claude --resume <session_id> --print "<msg>" --output-format stream-json
//! --verbose` invocation (D-08 fallback path). The captured result flushes
//! back into the same `agent_id` thread, prefixed with a
//! `SESSION_RESUMED · via --resume` boundary event.
//!
//! Wave 0 (Plan 01) declares the symbol. Plan 02 wires the tokio::process
//! one-shot + re-uses the parser to persist the resumed turn's events.

#![allow(dead_code)]

use sqlx::SqlitePool;

use super::types::AgentEvent;

pub async fn auto_resume_send<R: tauri::Runtime>(
    _agent_id: String,
    _content: String,
    _session_id: Option<String>,
    _app_handle: tauri::AppHandle<R>,
    _pool: SqlitePool,
) -> Result<AgentEvent, String> {
    todo!("Plan 02 — one-shot `claude --resume` subprocess + stream-json parse")
}
