//! Phase 10: long-lived subprocess supervisor.
//!
//! Owns the `tokio::process::Child` for a chattable Claude session, waits on
//! `child.wait()`, and emits the `agent-session-ended` signal + writes the
//! session_boundary row (D-03) when the subprocess exits. Session archival
//! (D-04) is a side effect: after wait, the registry is told to
//! `mark_archived(agent_id)`. Further sends fall through to auto_resume.

#![allow(dead_code)]

use std::sync::Arc;
use tauri::Emitter;
use tokio::process::Child;

use super::session_registry::LiveSessionRegistry;
use super::types::SessionEndedPayload;

/// Spawn the supervisor task for a newly-launched live session. Retains the
/// `Child` handle so `child.wait()` drives the SESSION_ENDED boundary.
pub fn spawn_supervisor<R: tauri::Runtime>(
    child: Child,
    agent_id: String,
    registry: Arc<LiveSessionRegistry>,
    pool: sqlx::SqlitePool,
    app_handle: tauri::AppHandle<R>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(run_supervisor(child, agent_id, registry, pool, app_handle))
}

async fn run_supervisor<R: tauri::Runtime>(
    mut child: Child,
    agent_id: String,
    registry: Arc<LiveSessionRegistry>,
    pool: sqlx::SqlitePool,
    app_handle: tauri::AppHandle<R>,
) {
    let (reason, exit_code) = match child.wait().await {
        Ok(status) if status.success() => ("completed".to_string(), Some(0)),
        Ok(status) => {
            let code = status.code();
            ("crashed".to_string(), code)
        }
        Err(e) => {
            tracing::warn!(agent_id = %agent_id, err = %e, "child.wait() failed");
            ("error".to_string(), None)
        }
    };

    registry.mark_archived(&agent_id).await;
    let session_id = registry.session_id_for(&agent_id).await;

    // D-03: write a session_boundary row for the UI to render a divider.
    let boundary_payload = serde_json::json!({
        "kind": "ended",
        "reason": reason,
        "exit_code": exit_code,
        "session_id": session_id,
    });
    if let Err(e) = crate::db::events::insert_agent_event(
        &pool,
        &agent_id,
        session_id.as_deref(),
        "session_boundary",
        &boundary_payload,
        None,
        None,
        None,
    )
    .await
    {
        tracing::warn!(
            agent_id = %agent_id,
            err = %e,
            "failed to insert session_boundary row on exit"
        );
    }

    let payload = SessionEndedPayload {
        agent_id: agent_id.clone(),
        session_id,
        reason,
        exit_code,
    };
    // emit() can fail in test runtimes — log-only is fine, nothing depends on
    // the event delivery for correctness.
    if let Err(e) = app_handle.emit("agent-session-ended", &payload) {
        tracing::debug!(
            agent_id = %agent_id,
            err = %e,
            "agent-session-ended emit failed (likely no listeners)"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat_runtime::session_registry::tests::make_live_session;
    use crate::db::events::tests::make_pool_with_chat_schema;

    #[cfg(not(windows))]
    #[tokio::test]
    async fn supervisor_on_clean_exit_marks_archived_and_emits() {
        let pool = make_pool_with_chat_schema().await;
        let registry = Arc::new(LiveSessionRegistry::new());
        let (sess, _rx) = make_live_session("A-1");
        registry.register(sess).await;
        registry.bind_session_id("A-1", "sess-1".into()).await;

        // Spawn `/bin/true` so child.wait() returns Ok(status.success()=true).
        let child = tokio::process::Command::new("/bin/true")
            .spawn()
            .expect("spawn /bin/true");

        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();

        let handle = spawn_supervisor(
            child,
            "A-1".to_string(),
            registry.clone(),
            pool.clone(),
            app_handle,
        );
        tokio::time::timeout(std::time::Duration::from_secs(3), handle)
            .await
            .unwrap()
            .unwrap();

        // Archived.
        assert!(registry.is_archived("A-1").await);
        // Boundary row inserted.
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .unwrap();
        let boundary = rows
            .iter()
            .find(|e| e.event_type == "session_boundary")
            .expect("session_boundary row inserted");
        assert_eq!(boundary.payload_json["kind"], serde_json::json!("ended"));
        assert_eq!(
            boundary.payload_json["reason"],
            serde_json::json!("completed")
        );
        assert_eq!(boundary.payload_json["exit_code"], serde_json::json!(0));
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn supervisor_on_nonzero_exit_marks_crashed() {
        let pool = make_pool_with_chat_schema().await;
        let registry = Arc::new(LiveSessionRegistry::new());
        let (sess, _rx) = make_live_session("A-1");
        registry.register(sess).await;

        // /bin/false exits with status 1.
        let child = tokio::process::Command::new("/bin/false")
            .spawn()
            .expect("spawn /bin/false");

        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let handle = spawn_supervisor(
            child,
            "A-1".to_string(),
            registry.clone(),
            pool.clone(),
            app_handle,
        );
        tokio::time::timeout(std::time::Duration::from_secs(3), handle)
            .await
            .unwrap()
            .unwrap();

        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .unwrap();
        let boundary = rows
            .iter()
            .find(|e| e.event_type == "session_boundary")
            .expect("session_boundary row inserted");
        assert_eq!(
            boundary.payload_json["reason"],
            serde_json::json!("crashed")
        );
    }
}
