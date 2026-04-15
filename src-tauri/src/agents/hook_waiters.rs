//! Waiter registry shared between the axum `/hook` handler (via Extension)
//! and the Tauri command layer (via State). Holds a one-shot sender per
//! pending pretool_use approval row, an in-memory always-allow set scoped by
//! (agent_id, tool_name), and a session_id -> agent_id binding map.
//!
//! Plan 01 (Wave 0) locks the signatures exactly as described in
//! 08-01-PLAN.md `<interfaces>`. Plan 02 fills in the method bodies; Plan 03
//! reads from it in the axum /hook handler.
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
    #[allow(dead_code)] // Plan 02 wires these maps into method bodies.
    waiters: Mutex<HashMap<i64, WaiterEntry>>,
    #[allow(dead_code)]
    always_allow: Mutex<HashSet<(String, String)>>, // (agent_id, tool_name)
    #[allow(dead_code)]
    session_agents: Mutex<HashMap<String, String>>, // session_id -> agent_id (Pitfall 7 opt 4)
}

impl WaiterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    // STUBS — Plan 02 fills these in. Each panics with a `plan 02` tag so
    // the `#[should_panic(expected = "plan 02")]` tests below flip GREEN when
    // Plan 02 replaces the `todo!` with a real body.

    pub async fn register(&self, _id: i64, _entry: WaiterEntry) {
        todo!("plan 02")
    }

    pub async fn signal(&self, _id: i64, _d: HookDecision) -> bool {
        todo!("plan 02")
    }

    pub async fn signal_for_agent(&self, _agent_id: &str, _d: HookDecision) -> Vec<i64> {
        todo!("plan 02")
    }

    pub async fn remove_silently(&self, _id: i64) -> Option<WaiterEntry> {
        todo!("plan 02")
    }

    pub async fn add_always_allow(&self, _agent_id: String, _tool_name: String) {
        todo!("plan 02")
    }

    pub async fn is_always_allowed(&self, _agent_id: &str, _tool_name: &str) -> bool {
        todo!("plan 02")
    }

    pub async fn clear_always_allow_for_agent(&self, _agent_id: &str) {
        todo!("plan 02")
    }

    pub async fn bind_session(&self, _session_id: String, _agent_id: String) {
        todo!("plan 02")
    }

    pub async fn agent_for_session(&self, _session_id: &str) -> Option<String> {
        todo!("plan 02")
    }

    pub async fn clear_session_bindings_for_agent(&self, _agent_id: &str) {
        todo!("plan 02")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[should_panic(expected = "plan 02")]
    async fn register_then_signal_delivers_decision() {
        let reg = WaiterRegistry::new();
        let (tx, _rx) = oneshot::channel();
        reg.register(
            1,
            WaiterEntry {
                agent_id: "KAGENT-9".into(),
                tool_name: "Bash".into(),
                sender: tx,
            },
        )
        .await;
        let _ = reg.signal(1, HookDecision::Allow).await;
    }

    #[tokio::test]
    #[should_panic(expected = "plan 02")]
    async fn signal_for_agent_fires_all_waiters_for_that_agent() {
        let reg = WaiterRegistry::new();
        let (tx, _rx) = oneshot::channel();
        reg.register(
            1,
            WaiterEntry {
                agent_id: "KAGENT-9".into(),
                tool_name: "Bash".into(),
                sender: tx,
            },
        )
        .await;
        let _ = reg
            .signal_for_agent("KAGENT-9", HookDecision::Deny("t".into()))
            .await;
    }

    #[tokio::test]
    #[should_panic(expected = "plan 02")]
    async fn always_allow_roundtrip() {
        let reg = WaiterRegistry::new();
        reg.add_always_allow("KAGENT-9".into(), "Bash".into()).await;
    }
}
