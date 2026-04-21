use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::RwLock;

/// A record of a single file write by a specific agent.
#[derive(Debug, Clone)]
pub struct FileWriteRecord {
    pub agent_id: String,
    pub pid: u32,
    pub timestamp_ms: i64,
    /// Optional byte range (start, end) for hunk hints per D-12.
    pub byte_range: Option<(u64, u64)>,
}

/// An alert generated when two different agents write the same file within the
/// configured conflict window.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictAlert {
    pub id: String,
    pub file_path: PathBuf,
    pub agent_a_id: String,
    pub agent_a_pid: u32,
    pub agent_b_id: String,
    pub agent_b_pid: u32,
    pub detected_at_ms: i64,
    pub conflict_window_ms: u64,
    pub hunk_hints_a: Option<(u64, u64)>,
    pub hunk_hints_b: Option<(u64, u64)>,
    pub dismissed: bool,
}

/// Thread-safe state container for conflict alerts and configuration.
///
/// Managed as Tauri state so commands can query/mutate alerts and settings.
pub struct ConflictState {
    alerts: RwLock<Vec<ConflictAlert>>,
    window_ms: AtomicU64,
}

/// Maximum alerts retained in state to prevent unbounded memory growth (T-03-10).
const MAX_ALERTS: usize = 1000;

impl ConflictState {
    pub fn new(window_ms: u64) -> Self {
        Self {
            alerts: RwLock::new(Vec::new()),
            window_ms: AtomicU64::new(window_ms),
        }
    }

    /// Add a new conflict alert. If at capacity, evict the oldest alert.
    pub async fn add_alert(&self, alert: ConflictAlert) {
        let mut alerts = self.alerts.write().await;
        if alerts.len() >= MAX_ALERTS {
            alerts.remove(0);
        }
        alerts.push(alert);
    }

    /// Return all non-dismissed alerts.
    pub async fn get_active(&self) -> Vec<ConflictAlert> {
        let alerts = self.alerts.read().await;
        alerts.iter().filter(|a| !a.dismissed).cloned().collect()
    }

    /// Mark an alert as dismissed by its ID.
    pub async fn dismiss(&self, id: &str) {
        let mut alerts = self.alerts.write().await;
        if let Some(alert) = alerts.iter_mut().find(|a| a.id == id) {
            alert.dismissed = true;
        }
    }

    /// Update the conflict detection window (milliseconds).
    pub fn set_window_ms(&self, ms: u64) {
        self.window_ms.store(ms, Ordering::Relaxed);
    }

    /// Get the current conflict detection window (milliseconds).
    pub fn get_window_ms(&self) -> u64 {
        self.window_ms.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn conflict_state_add_and_get_active() {
        let state = ConflictState::new(5000);
        let alert = ConflictAlert {
            id: "CNFL-1000-abc".to_string(),
            file_path: PathBuf::from("/tmp/test.rs"),
            agent_a_id: "agent-1".to_string(),
            agent_a_pid: 100,
            agent_b_id: "agent-2".to_string(),
            agent_b_pid: 200,
            detected_at_ms: 1000,
            conflict_window_ms: 5000,
            hunk_hints_a: None,
            hunk_hints_b: None,
            dismissed: false,
        };
        state.add_alert(alert).await;
        let active = state.get_active().await;
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "CNFL-1000-abc");
    }

    #[tokio::test]
    async fn conflict_state_dismiss_filters_from_active() {
        let state = ConflictState::new(5000);
        let alert = ConflictAlert {
            id: "CNFL-1000-abc".to_string(),
            file_path: PathBuf::from("/tmp/test.rs"),
            agent_a_id: "agent-1".to_string(),
            agent_a_pid: 100,
            agent_b_id: "agent-2".to_string(),
            agent_b_pid: 200,
            detected_at_ms: 1000,
            conflict_window_ms: 5000,
            hunk_hints_a: None,
            hunk_hints_b: None,
            dismissed: false,
        };
        state.add_alert(alert).await;
        state.dismiss("CNFL-1000-abc").await;
        let active = state.get_active().await;
        assert_eq!(active.len(), 0);
    }

    #[tokio::test]
    async fn conflict_state_caps_at_max_alerts() {
        let state = ConflictState::new(5000);
        for i in 0..1001 {
            state
                .add_alert(ConflictAlert {
                    id: format!("CNFL-{i}"),
                    file_path: PathBuf::from("/tmp/test.rs"),
                    agent_a_id: "a".to_string(),
                    agent_a_pid: 1,
                    agent_b_id: "b".to_string(),
                    agent_b_pid: 2,
                    detected_at_ms: i as i64,
                    conflict_window_ms: 5000,
                    hunk_hints_a: None,
                    hunk_hints_b: None,
                    dismissed: false,
                })
                .await;
        }
        let alerts = state.alerts.read().await;
        assert_eq!(alerts.len(), 1000);
        // Oldest (CNFL-0) should have been evicted
        assert_eq!(alerts[0].id, "CNFL-1");
    }

    #[test]
    fn conflict_state_window_ms_get_set() {
        let state = ConflictState::new(5000);
        assert_eq!(state.get_window_ms(), 5000);
        state.set_window_ms(10000);
        assert_eq!(state.get_window_ms(), 10000);
    }
}

/// Phase 17 D-20: reason a PreToolUse row was gated. Persisted as a string at
/// the DB boundary (serde rename_all="snake_case") so migration 007's
/// nullable TEXT column round-trips cleanly. `specta::Type` auto-exports a TS
/// union `'file_conflict' | 'protected_path' | 'unknown'` to `src/bindings.ts`.
///
/// Registered in `lib.rs` specta builder via `.typ::<conflict::types::GateReason>()`
/// (Plan 04 wires this alongside the engine State registration).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum GateReason {
    FileConflict,
    ProtectedPath,
    Unknown,
}

impl GateReason {
    /// D-20 locked wire-format / DB string values. Must match the TS union
    /// generated by specta exactly — any drift breaks the cross-boundary
    /// contract and the approval_requests.gate_reason column.
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::FileConflict => "file_conflict",
            Self::ProtectedPath => "protected_path",
            Self::Unknown => "unknown",
        }
    }
}

#[cfg(test)]
mod gate_reason_tests {
    use super::*;

    #[test]
    fn gate_reason_db_str() {
        assert_eq!(GateReason::FileConflict.as_db_str(), "file_conflict");
        assert_eq!(GateReason::ProtectedPath.as_db_str(), "protected_path");
        assert_eq!(GateReason::Unknown.as_db_str(), "unknown");
    }

    #[test]
    fn gate_reason_serde_roundtrip() {
        let json = serde_json::to_string(&GateReason::FileConflict).unwrap();
        assert_eq!(json, "\"file_conflict\"");
        let back: GateReason = serde_json::from_str("\"protected_path\"").unwrap();
        assert_eq!(back, GateReason::ProtectedPath);
    }
}
