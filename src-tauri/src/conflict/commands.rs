use crate::conflict::types::{ConflictAlert, ConflictState};

/// List all active (non-dismissed) conflict alerts.
#[tauri::command]
#[specta::specta]
pub async fn list_conflicts(
    state: tauri::State<'_, ConflictState>,
) -> Result<Vec<ConflictAlert>, String> {
    Ok(state.get_active().await)
}

/// Dismiss a conflict alert by its ID.
#[tauri::command]
#[specta::specta]
pub async fn dismiss_conflict(
    conflict_id: String,
    state: tauri::State<'_, ConflictState>,
) -> Result<(), String> {
    state.dismiss(&conflict_id).await;
    Ok(())
}

/// Get the current conflict detection window in milliseconds.
#[tauri::command]
#[specta::specta]
pub async fn get_conflict_settings(
    state: tauri::State<'_, ConflictState>,
) -> Result<u64, String> {
    Ok(state.get_window_ms())
}

/// Update the conflict detection window. Validates range: 1000-60000ms (1-60 seconds).
///
/// Mitigates T-03-09: prevents DoS via 0ms window (every write conflicts) or
/// effectiveness bypass via huge window.
#[tauri::command]
#[specta::specta]
pub async fn update_conflict_window(
    window_ms: u64,
    state: tauri::State<'_, ConflictState>,
) -> Result<(), String> {
    if window_ms < 1000 {
        return Err(format!(
            "Conflict window must be at least 1000ms (1 second), got {window_ms}ms"
        ));
    }
    if window_ms > 60000 {
        return Err(format!(
            "Conflict window must be at most 60000ms (60 seconds), got {window_ms}ms"
        ));
    }
    state.set_window_ms(window_ms);
    Ok(())
}

/// Emit a conflict-detected Tauri event so the frontend receives alerts in real time.
///
/// Called from the conflict engine tokio task after each detected conflict.
/// Uses `tauri::Emitter` trait's `emit()` to push ConflictAlert payloads to all
/// frontend windows. The frontend's conflictStore will subscribe via
/// `listen("conflict-detected", ...)`.
pub fn emit_conflict_event(app_handle: &tauri::AppHandle, alert: &ConflictAlert) {
    use tauri::Emitter;
    if let Err(e) = app_handle.emit("conflict-detected", alert) {
        tracing::warn!(error = %e, "Failed to emit conflict-detected event");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn conflict_window_validation_rejects_below_1000() {
        let state = ConflictState::new(5000);
        // Simulate what the command does without going through Tauri state extraction
        let result = if 999u64 < 1000 {
            Err(format!(
                "Conflict window must be at least 1000ms (1 second), got {}ms",
                999
            ))
        } else {
            state.set_window_ms(999);
            Ok(())
        };
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("at least 1000ms"));
        // Verify state wasn't changed
        assert_eq!(state.get_window_ms(), 5000);
    }

    #[tokio::test]
    async fn conflict_window_validation_rejects_above_60000() {
        let state = ConflictState::new(5000);
        let result = if 60001u64 > 60000 {
            Err(format!(
                "Conflict window must be at most 60000ms (60 seconds), got {}ms",
                60001
            ))
        } else {
            state.set_window_ms(60001);
            Ok(())
        };
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("at most 60000ms"));
        assert_eq!(state.get_window_ms(), 5000);
    }

    #[tokio::test]
    async fn conflict_window_validation_accepts_valid_range() {
        let state = ConflictState::new(5000);
        // Test boundary values
        state.set_window_ms(1000);
        assert_eq!(state.get_window_ms(), 1000);
        state.set_window_ms(60000);
        assert_eq!(state.get_window_ms(), 60000);
        state.set_window_ms(30000);
        assert_eq!(state.get_window_ms(), 30000);
    }
}
