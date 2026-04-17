//! Phase 10: Tauri command surface for the CHAT tab.
//!
//! Six commands drive the chat UI; all are registered in lib.rs via
//! `collect_commands!` so `tauri-specta` regenerates matching TS bindings.
//! Wave 0 (Plan 01) provides minimal bodies returning empty defaults so the
//! frontend compiles against the real command surface from day 1.
//!
//! Plan 02 fills in the real bodies.

#![allow(dead_code, unused_variables)]

use std::sync::Arc;

use super::session_registry::LiveSessionRegistry;
use super::types::{AgentEvent, ChatChannel};

#[tauri::command]
#[specta::specta]
pub async fn send_chat_message_to_agent(
    agent_id: String,
    content: String,
    pool: tauri::State<'_, sqlx::SqlitePool>,
    sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<AgentEvent, String> {
    let _ = (agent_id, content, pool, sessions, app_handle);
    Err("not implemented".into())
}

#[tauri::command]
#[specta::specta]
pub async fn list_agent_events(
    agent_id: String,
    before_id: Option<i64>,
    limit: Option<i64>,
    pool: tauri::State<'_, sqlx::SqlitePool>,
) -> Result<Vec<AgentEvent>, String> {
    let _ = (agent_id, before_id, limit, pool);
    Ok(vec![])
}

#[tauri::command]
#[specta::specta]
pub async fn list_chat_channels(
    pool: tauri::State<'_, sqlx::SqlitePool>,
) -> Result<Vec<ChatChannel>, String> {
    let _ = pool;
    Ok(vec![])
}

#[tauri::command]
#[specta::specta]
pub async fn clear_agent_thread(
    agent_id: String,
    pool: tauri::State<'_, sqlx::SqlitePool>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let _ = (agent_id, pool, app_handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn mark_agent_events_read(
    agent_id: String,
    sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let _ = (agent_id, sessions, app_handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn relaunch_agent_session(agent_id: String) -> Result<(), String> {
    let _ = agent_id;
    Ok(())
}
