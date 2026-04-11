//! Notification preferences and OS notification dispatch per D-09.
//!
//! Users can configure which agent state transitions trigger native OS
//! notifications. Default: conflicts, errors, idle, and waiting trigger
//! notifications; running does not.

use crate::agents::adapter::AgentState;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// Per-state notification preferences.
///
/// Each field controls whether a transition TO that state triggers a
/// native OS notification.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPrefs {
    /// Notify when agent enters Running state. Default: false.
    pub on_running: bool,
    /// Notify when agent enters Idle state. Default: true.
    pub on_idle: bool,
    /// Notify when agent enters Waiting state. Default: true.
    pub on_waiting: bool,
    /// Notify when agent enters Conflict state. Default: true.
    pub on_conflict: bool,
    /// Notify when agent enters Error state. Default: true.
    pub on_error: bool,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            on_running: false,
            on_idle: true,
            on_waiting: true,
            on_conflict: true,
            on_error: true,
        }
    }
}

/// Thread-safe wrapper for notification preferences.
pub struct NotificationState {
    prefs: RwLock<NotificationPrefs>,
}

impl NotificationState {
    pub fn new() -> Self {
        Self {
            prefs: RwLock::new(NotificationPrefs::default()),
        }
    }

    pub async fn get_prefs(&self) -> NotificationPrefs {
        self.prefs.read().await.clone()
    }

    pub async fn set_prefs(&self, prefs: NotificationPrefs) {
        *self.prefs.write().await = prefs;
    }
}

impl Default for NotificationState {
    fn default() -> Self {
        Self::new()
    }
}

/// Dispatch a native OS notification for an agent state change, if enabled.
///
/// Checks the prefs for the new state and sends a notification via
/// `tauri_plugin_notification` if the corresponding pref is enabled.
pub fn dispatch_state_notification(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    new_state: &AgentState,
    prefs: &NotificationPrefs,
) {
    let enabled = match new_state {
        AgentState::Running => prefs.on_running,
        AgentState::Idle => prefs.on_idle,
        AgentState::Waiting => prefs.on_waiting,
        AgentState::Conflict => prefs.on_conflict,
        AgentState::Error => prefs.on_error,
    };

    if !enabled {
        return;
    }

    use tauri_plugin_notification::NotificationExt;
    app_handle
        .notification()
        .builder()
        .title(&format!("AITC: Agent {}", agent_id))
        .body(&format!("State changed to {:?}", new_state))
        .show()
        .unwrap_or_else(|e| tracing::warn!("notification send failed: {e}"));
}

/// Dispatch a native OS notification for an approval request (COMM-05).
///
/// Called when a new approval request is created, alerting the user that
/// an agent requires attention.
pub fn dispatch_approval_notification(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    file_path: &str,
) {
    use tauri_plugin_notification::NotificationExt;
    app_handle
        .notification()
        .builder()
        .title("APPROVAL_REQUIRED")
        .body(&format!("{} requests access to {}", agent_id, file_path))
        .show()
        .unwrap_or_else(|e| tracing::warn!("approval notification send failed: {e}"));
}

/// Tauri command: get current notification preferences.
#[tauri::command]
#[specta::specta]
pub async fn get_notification_prefs(
    state: tauri::State<'_, NotificationState>,
) -> Result<NotificationPrefs, String> {
    Ok(state.get_prefs().await)
}

/// Tauri command: update notification preferences.
#[tauri::command]
#[specta::specta]
pub async fn update_notification_prefs(
    prefs: NotificationPrefs,
    state: tauri::State<'_, NotificationState>,
) -> Result<(), String> {
    state.set_prefs(prefs).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_prefs_conflict_enabled() {
        let prefs = NotificationPrefs::default();
        assert!(prefs.on_conflict);
    }

    #[test]
    fn default_prefs_running_disabled() {
        let prefs = NotificationPrefs::default();
        assert!(!prefs.on_running);
    }

    #[test]
    fn default_prefs_error_enabled() {
        let prefs = NotificationPrefs::default();
        assert!(prefs.on_error);
    }

    #[test]
    fn default_prefs_idle_enabled() {
        let prefs = NotificationPrefs::default();
        assert!(prefs.on_idle);
    }

    #[test]
    fn default_prefs_waiting_enabled() {
        let prefs = NotificationPrefs::default();
        assert!(prefs.on_waiting);
    }

    #[tokio::test]
    async fn notification_state_roundtrip() {
        let state = NotificationState::new();
        let mut prefs = state.get_prefs().await;
        assert!(prefs.on_conflict);

        prefs.on_conflict = false;
        state.set_prefs(prefs.clone()).await;

        let updated = state.get_prefs().await;
        assert!(!updated.on_conflict);
    }
}
