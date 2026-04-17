//! Phase 10: per-agent live-session registry.
//!
//! Wraps the set of long-lived Claude Code subprocesses currently attached to
//! AITC. Each entry holds the outbound stdin sender, the captured session_id
//! (set by the parser on the `init` envelope), and archived / read flags.
//!
//! Wave 0 (Plan 01) declares the public surface. Plan 02 provides real
//! bodies.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use super::types::OutboundFrame;

/// A single chattable Claude Code agent's live-session record. One entry per
/// `agent_id`; the same agent_id survives `--resume` reattachments because
/// `session_id` moves independently of agent identity (D-03 / D-04).
pub struct LiveSession {
    pub agent_id: String,
    pub session_id: Option<String>,
    pub stdin_tx: mpsc::Sender<OutboundFrame>,
    pub archived: bool,
    pub last_read_at: Option<String>,
}

/// Registry shared between the chat_runtime supervisor, Tauri commands (as
/// `State<Arc<LiveSessionRegistry>>`), and the MCP handler (as
/// `Extension<Arc<LiveSessionRegistry>>`). Not Clone; share via `Arc`.
#[derive(Default)]
pub struct LiveSessionRegistry {
    #[allow(dead_code)]
    sessions: Mutex<HashMap<String, LiveSession>>,
}

impl LiveSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn register(&self, _session: LiveSession) {
        todo!("Plan 02 — insert into self.sessions keyed by agent_id")
    }

    /// Fast path used by `send_chat_message_to_agent` to push an outbound
    /// frame. Returns `None` when there's no live session (archived or never
    /// launched) — caller falls back to `auto_resume::auto_resume_send`.
    pub async fn get_stdin_tx(&self, _agent_id: &str) -> Option<mpsc::Sender<OutboundFrame>> {
        None
    }

    pub async fn mark_archived(&self, _agent_id: &str) {
        todo!("Plan 02 — set entry.archived = true without dropping the row")
    }

    /// Conservative default — Plan 02 tests will force the archived/live path.
    pub async fn is_archived(&self, _agent_id: &str) -> bool {
        true
    }

    pub async fn bind_session_id(&self, _agent_id: &str, _session_id: String) {
        todo!("Plan 02 — stamp session_id when stream-json init envelope arrives")
    }

    pub async fn session_id_for(&self, _agent_id: &str) -> Option<String> {
        None
    }

    pub async fn mark_read(&self, _agent_id: &str) {
        todo!("Plan 02 — set last_read_at = Utc::now() for unread count reset")
    }
}
