//! Phase 10: long-lived subprocess supervisor.
//!
//! Owns the `tokio::process::Child` for a chattable Claude session, pumps
//! `StreamEvent`s from the parser into `agent_events` rows + Tauri events,
//! flushes partial assistant turns on idle, and emits the
//! `agent-session-ended` signal when the subprocess exits (D-04, D-09).
//!
//! Wave 0 (Plan 01) declares the spawn function. Plan 02 provides the body.

#![allow(dead_code)]

use std::sync::Arc;
use tokio::process::Child;

use super::session_registry::LiveSessionRegistry;

/// Spawn the supervisor task for a newly-launched live session. Retains the
/// `Child` handle so `child.wait()` drives the `SESSION_ENDED` boundary.
pub fn spawn_supervisor<R: tauri::Runtime>(
    _child: Child,
    _agent_id: String,
    _registry: Arc<LiveSessionRegistry>,
    _app_handle: tauri::AppHandle<R>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move { todo!("Plan 02 — drain StreamEvents, persist rows, wait(child)") })
}
