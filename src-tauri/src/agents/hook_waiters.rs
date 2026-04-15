//! Waiter registry shared between the axum `/hook` handler (via Extension)
//! and the Tauri command layer (via State). Holds a one-shot sender per
//! pending pretool_use approval row, an in-memory always-allow set scoped by
//! (agent_id, tool_name), and a session_id -> agent_id binding map.
//!
//! Plan 01 (Wave 0) locked the signatures exactly as described in
//! 08-01-PLAN.md `<interfaces>`. Plan 02 (this file) fills in the method
//! bodies. Plan 03 reads from it in the axum /hook handler (sidecar).
//!
//! Lock order (never held simultaneously):
//!   waiters  ->  always_allow  ->  session_agents
//!
//! Mitigations (see 08-VALIDATION.md):
//! - T-08-02: all internal state behind tokio::sync::Mutex.
//! - Pitfall 5: stores full PID strings in agent_id (never truncated).
//! - Pitfall 7: session_id is the correlation key; PID is not required.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

/// Decision emitted by the user's resolve action (approve/deny/approve-with-edits)
/// OR by force-deny on terminate, OR by the AbandonGuard on client disconnect.
#[derive(Clone, Debug)]
pub enum HookDecision {
    Allow,
    AllowWithEdits(serde_json::Value), // updatedInput payload, shape per Claude hook contract
    Deny(String),                      // permissionDecisionReason
}

/// Per-waiter record stored in the registry. `agent_id` is carried so
/// terminate_process can enumerate waiters by agent without a separate lookup.
pub struct WaiterEntry {
    pub agent_id: String,
    pub tool_name: String,
    pub sender: oneshot::Sender<HookDecision>,
}

/// Registry shared between the axum /hook handler (Extension) and Tauri
/// command handlers (State). Not Clone; wrap in Arc before sharing.
#[derive(Default)]
pub struct WaiterRegistry {
    waiters: Mutex<HashMap<i64, WaiterEntry>>,
    always_allow: Mutex<HashSet<(String, String)>>, // (agent_id, tool_name)
    session_agents: Mutex<HashMap<String, String>>, // session_id -> agent_id (Pitfall 7 opt 4)
}

impl WaiterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn register(&self, id: i64, entry: WaiterEntry) {
        self.waiters.lock().await.insert(id, entry);
    }

    /// Signal the waiter for `id` with the given decision. Returns `true` if
    /// a waiter was registered and the send succeeded.
    pub async fn signal(&self, id: i64, d: HookDecision) -> bool {
        let entry = self.waiters.lock().await.remove(&id);
        match entry {
            Some(e) => e.sender.send(d).is_ok(),
            None => false,
        }
    }

    /// Signal every registered waiter whose `agent_id` matches. Returns the
    /// list of row ids that were signalled. Collects ids under the lock then
    /// sends outside to keep lock scope tight (senders are cheap).
    pub async fn signal_for_agent(&self, agent_id: &str, d: HookDecision) -> Vec<i64> {
        let matching_ids: Vec<i64> = {
            let map = self.waiters.lock().await;
            map.iter()
                .filter(|(_, e)| e.agent_id == agent_id)
                .map(|(id, _)| *id)
                .collect()
        };
        let mut signalled = Vec::with_capacity(matching_ids.len());
        for id in matching_ids {
            let entry = self.waiters.lock().await.remove(&id);
            if let Some(e) = entry {
                // Clone decision per waiter (HookDecision is Clone).
                let _ = e.sender.send(d.clone());
                signalled.push(id);
            }
        }
        signalled
    }

    /// Remove a waiter entry without signalling. Used by the AbandonGuard drop
    /// path when the client disconnected mid-wait.
    pub async fn remove_silently(&self, id: i64) -> Option<WaiterEntry> {
        self.waiters.lock().await.remove(&id)
    }

    pub async fn add_always_allow(&self, agent_id: String, tool_name: String) {
        self.always_allow.lock().await.insert((agent_id, tool_name));
    }

    pub async fn is_always_allowed(&self, agent_id: &str, tool_name: &str) -> bool {
        self.always_allow
            .lock()
            .await
            .contains(&(agent_id.to_string(), tool_name.to_string()))
    }

    pub async fn clear_always_allow_for_agent(&self, agent_id: &str) {
        self.always_allow
            .lock()
            .await
            .retain(|(a, _)| a != agent_id);
    }

    pub async fn bind_session(&self, session_id: String, agent_id: String) {
        self.session_agents.lock().await.insert(session_id, agent_id);
    }

    pub async fn agent_for_session(&self, session_id: &str) -> Option<String> {
        self.session_agents.lock().await.get(session_id).cloned()
    }

    pub async fn clear_session_bindings_for_agent(&self, agent_id: &str) {
        self.session_agents
            .lock()
            .await
            .retain(|_, a| a != agent_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_then_signal_delivers_decision() {
        let reg = WaiterRegistry::new();
        let (tx, rx) = oneshot::channel();
        reg.register(
            1,
            WaiterEntry {
                agent_id: "KAGENT-9".into(),
                tool_name: "Edit".into(),
                sender: tx,
            },
        )
        .await;
        assert!(reg.signal(1, HookDecision::Allow).await);
        assert!(matches!(rx.await.unwrap(), HookDecision::Allow));
    }

    #[tokio::test]
    async fn signal_returns_false_when_no_waiter_registered() {
        let reg = WaiterRegistry::new();
        assert!(!reg.signal(999, HookDecision::Allow).await);
    }

    #[tokio::test]
    async fn signal_for_agent_fires_all_waiters_for_that_agent() {
        let reg = WaiterRegistry::new();
        let (tx1, rx1) = oneshot::channel();
        let (tx2, rx2) = oneshot::channel();
        let (tx3, rx3) = oneshot::channel();

        reg.register(
            1,
            WaiterEntry {
                agent_id: "KAGENT-9".into(),
                tool_name: "Edit".into(),
                sender: tx1,
            },
        )
        .await;
        reg.register(
            2,
            WaiterEntry {
                agent_id: "KAGENT-9".into(),
                tool_name: "Bash".into(),
                sender: tx2,
            },
        )
        .await;
        reg.register(
            3,
            WaiterEntry {
                agent_id: "KAGENT-OTHER".into(),
                tool_name: "Bash".into(),
                sender: tx3,
            },
        )
        .await;

        let mut fired = reg
            .signal_for_agent("KAGENT-9", HookDecision::Deny("t".into()))
            .await;
        fired.sort();
        assert_eq!(fired, vec![1, 2]);

        // KAGENT-9 waiters received Deny; the KAGENT-OTHER waiter must still be pending.
        assert!(matches!(rx1.await.unwrap(), HookDecision::Deny(_)));
        assert!(matches!(rx2.await.unwrap(), HookDecision::Deny(_)));
        // rx3 should NOT have received anything yet -- the sender is still in the map.
        let still_pending = reg.remove_silently(3).await;
        assert!(still_pending.is_some());
        // Dropping the sender closes rx3.
        drop(still_pending);
        assert!(rx3.await.is_err());
    }

    #[tokio::test]
    async fn always_allow_roundtrip() {
        let reg = WaiterRegistry::new();
        reg.add_always_allow("KAGENT-9".into(), "Bash".into()).await;
        assert!(reg.is_always_allowed("KAGENT-9", "Bash").await);
        assert!(!reg.is_always_allowed("KAGENT-9", "Edit").await);
        assert!(!reg.is_always_allowed("KAGENT-OTHER", "Bash").await);
    }

    #[tokio::test]
    async fn clear_always_allow_for_agent_only_clears_that_agent() {
        let reg = WaiterRegistry::new();
        reg.add_always_allow("KAGENT-1".into(), "Bash".into()).await;
        reg.add_always_allow("KAGENT-1".into(), "Edit".into()).await;
        reg.add_always_allow("KAGENT-2".into(), "Bash".into()).await;

        reg.clear_always_allow_for_agent("KAGENT-1").await;
        assert!(!reg.is_always_allowed("KAGENT-1", "Bash").await);
        assert!(!reg.is_always_allowed("KAGENT-1", "Edit").await);
        assert!(reg.is_always_allowed("KAGENT-2", "Bash").await);
    }

    #[tokio::test]
    async fn bind_and_resolve_session() {
        let reg = WaiterRegistry::new();
        reg.bind_session("s1".into(), "K-1".into()).await;
        assert_eq!(
            reg.agent_for_session("s1").await,
            Some("K-1".to_string())
        );
        reg.clear_session_bindings_for_agent("K-1").await;
        assert_eq!(reg.agent_for_session("s1").await, None);
    }

    #[tokio::test]
    async fn clear_session_only_touches_that_agent() {
        let reg = WaiterRegistry::new();
        reg.bind_session("s1".into(), "K-1".into()).await;
        reg.bind_session("s2".into(), "K-2".into()).await;
        reg.clear_session_bindings_for_agent("K-1").await;
        assert_eq!(reg.agent_for_session("s1").await, None);
        assert_eq!(
            reg.agent_for_session("s2").await,
            Some("K-2".to_string())
        );
    }

    #[tokio::test]
    async fn remove_silently_drops_sender_without_notifying() {
        let reg = WaiterRegistry::new();
        let (tx, rx) = oneshot::channel::<HookDecision>();
        reg.register(
            42,
            WaiterEntry {
                agent_id: "K".into(),
                tool_name: "Edit".into(),
                sender: tx,
            },
        )
        .await;
        let entry = reg.remove_silently(42).await;
        assert!(entry.is_some());
        drop(entry); // drops the sender
        assert!(rx.await.is_err()); // receiver sees channel closed, not a value
    }
}
