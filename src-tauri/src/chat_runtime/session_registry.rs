//! Phase 10: per-agent live-session registry.
//!
//! Wraps the set of long-lived Claude Code subprocesses currently attached to
//! AITC. Each entry holds the outbound stdin sender, the captured session_id
//! (set by the parser on the `init` envelope), and archived / read flags.
//!
//! Plan 02: real implementation. Double-register replaces the prior entry
//! (which drops the old mpsc sender; its writer task exits when the receiver
//! drops). `is_archived` returns `true` conservatively for unknown agent_ids
//! so commands fall through to auto_resume.

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
    sessions: Mutex<HashMap<String, LiveSession>>,
}

impl LiveSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Insert or replace the entry keyed by `session.agent_id`. Replacing an
    /// entry drops the previous `stdin_tx`, which in turn causes the writer
    /// task draining that `mpsc::Receiver` to exit cleanly.
    pub async fn register(&self, session: LiveSession) {
        let mut g = self.sessions.lock().await;
        g.insert(session.agent_id.clone(), session);
    }

    /// Fast path used by `send_chat_message_to_agent` to push an outbound
    /// frame. Returns `None` when there's no live session (archived or never
    /// launched) — caller falls back to `auto_resume::auto_resume_send`.
    pub async fn get_stdin_tx(&self, agent_id: &str) -> Option<mpsc::Sender<OutboundFrame>> {
        let g = self.sessions.lock().await;
        g.get(agent_id)
            .filter(|s| !s.archived)
            .map(|s| s.stdin_tx.clone())
    }

    /// Idempotent. If no entry exists the call is a no-op (the caller will
    /// already hit the archived-default path via `is_archived`).
    pub async fn mark_archived(&self, agent_id: &str) {
        let mut g = self.sessions.lock().await;
        if let Some(s) = g.get_mut(agent_id) {
            s.archived = true;
        }
    }

    /// Conservative default — unknown agent_id reports archived=true so
    /// callers fall through to the `auto_resume` fallback.
    pub async fn is_archived(&self, agent_id: &str) -> bool {
        let g = self.sessions.lock().await;
        match g.get(agent_id) {
            Some(s) => s.archived,
            None => true,
        }
    }

    /// Stamp `session_id` on the live entry — typically called once the
    /// stream-json `init` envelope arrives. Overwrites on reconnect.
    pub async fn bind_session_id(&self, agent_id: &str, session_id: String) {
        let mut g = self.sessions.lock().await;
        if let Some(s) = g.get_mut(agent_id) {
            s.session_id = Some(session_id);
        }
    }

    pub async fn session_id_for(&self, agent_id: &str) -> Option<String> {
        let g = self.sessions.lock().await;
        g.get(agent_id).and_then(|s| s.session_id.clone())
    }

    /// Stamp `last_read_at` = now (RFC3339) for unread-count reset.
    pub async fn mark_read(&self, agent_id: &str) {
        let ts = chrono::Utc::now().to_rfc3339();
        let mut g = self.sessions.lock().await;
        if let Some(s) = g.get_mut(agent_id) {
            s.last_read_at = Some(ts);
        }
    }

    pub async fn last_read_for(&self, agent_id: &str) -> Option<String> {
        let g = self.sessions.lock().await;
        g.get(agent_id).and_then(|s| s.last_read_at.clone())
    }

    pub async fn remove(&self, agent_id: &str) {
        let mut g = self.sessions.lock().await;
        g.remove(agent_id);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tokio::sync::mpsc;

    pub fn make_live_session(agent_id: &str) -> (LiveSession, mpsc::Receiver<OutboundFrame>) {
        let (tx, rx) = mpsc::channel(8);
        (
            LiveSession {
                agent_id: agent_id.to_string(),
                session_id: None,
                stdin_tx: tx,
                archived: false,
                last_read_at: None,
            },
            rx,
        )
    }

    #[tokio::test]
    async fn register_then_get_returns_some() {
        let reg = LiveSessionRegistry::new();
        let (sess, _rx) = make_live_session("A-1");
        reg.register(sess).await;
        assert!(reg.get_stdin_tx("A-1").await.is_some());
    }

    #[tokio::test]
    async fn register_then_mark_archived_makes_get_return_none() {
        let reg = LiveSessionRegistry::new();
        let (sess, _rx) = make_live_session("A-1");
        reg.register(sess).await;
        reg.mark_archived("A-1").await;
        assert!(reg.get_stdin_tx("A-1").await.is_none());
        assert!(reg.is_archived("A-1").await);
    }

    #[tokio::test]
    async fn is_archived_true_for_unknown_agent() {
        let reg = LiveSessionRegistry::new();
        assert!(reg.is_archived("NEVER-REGISTERED").await);
    }

    #[tokio::test]
    async fn bind_session_id_and_read_round_trip() {
        let reg = LiveSessionRegistry::new();
        let (sess, _rx) = make_live_session("A-1");
        reg.register(sess).await;
        reg.bind_session_id("A-1", "uuid-1".into()).await;
        assert_eq!(reg.session_id_for("A-1").await.as_deref(), Some("uuid-1"));
        // overwrite on reconnect
        reg.bind_session_id("A-1", "uuid-2".into()).await;
        assert_eq!(reg.session_id_for("A-1").await.as_deref(), Some("uuid-2"));
    }

    #[tokio::test]
    async fn mark_read_updates_last_read_for() {
        let reg = LiveSessionRegistry::new();
        let (sess, _rx) = make_live_session("A-1");
        reg.register(sess).await;
        assert!(reg.last_read_for("A-1").await.is_none());
        reg.mark_read("A-1").await;
        assert!(reg.last_read_for("A-1").await.is_some());
    }

    #[tokio::test]
    async fn double_register_replaces_entry() {
        let reg = LiveSessionRegistry::new();
        let (sess1, _rx1) = make_live_session("A-1");
        let (sess2, _rx2) = make_live_session("A-1");
        reg.register(sess1).await;
        reg.register(sess2).await;
        // second sender is the one reachable via get_stdin_tx
        assert!(reg.get_stdin_tx("A-1").await.is_some());
    }

    #[tokio::test]
    async fn remove_drops_the_entry() {
        let reg = LiveSessionRegistry::new();
        let (sess, _rx) = make_live_session("A-1");
        reg.register(sess).await;
        reg.remove("A-1").await;
        assert!(reg.is_archived("A-1").await);
        assert!(reg.session_id_for("A-1").await.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn register_archive_get_race_no_deadlock() {
        let reg = Arc::new(LiveSessionRegistry::new());
        let start = std::time::Instant::now();
        let mut handles = Vec::new();
        for i in 0..1000 {
            let r = reg.clone();
            let id = format!("A-{}", i % 16);
            handles.push(tokio::spawn(async move {
                let (sess, _rx) = make_live_session(&id);
                r.register(sess).await;
                let _ = r.get_stdin_tx(&id).await;
                r.mark_archived(&id).await;
                let _ = r.is_archived(&id).await;
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        assert!(
            start.elapsed() < std::time::Duration::from_secs(2),
            "stress test took {:?}",
            start.elapsed()
        );
    }
}
