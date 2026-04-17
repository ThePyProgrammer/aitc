//! Phase 10: auto-resume fallback for archived Claude sessions.
//!
//! When `send_chat_message_to_agent` targets an agent whose long-lived
//! subprocess has exited, fall back to a one-shot
//! `claude --resume <session_id> --print "<msg>" --output-format stream-json
//! --verbose` invocation (D-08 fallback path). The captured result flushes
//! back into the same `agent_id` thread, prefixed with a
//! `SESSION_RESUMED · via --resume` boundary event.
//!
//! Threat mitigations:
//! - T-10-09: size cap enforced before exec.
//! - T-10-11: session_id validated as UUID-shaped (regex-equivalent pure-byte
//!   check) before being passed to `Command::arg`. Argv-only, never shell.

#![allow(dead_code)]

use sqlx::SqlitePool;
use tauri::Emitter;

use super::types::{AgentEvent, MAX_CHAT_MESSAGE_BYTES};

/// Fallback send path for a Claude agent whose long-lived subprocess has
/// already exited. Spawns a one-shot `claude --resume` subprocess and flushes
/// the resulting assistant turn into the same `agent_id` thread.
///
/// Returns the freshly-inserted `user_text` row (same optimistic-append
/// semantics as the duplex path in `chat_runtime::commands`).
pub async fn auto_resume_send<R: tauri::Runtime>(
    agent_id: &str,
    content: &str,
    session_id: Option<&str>,
    cwd: &std::path::Path,
    pool: &SqlitePool,
    app_handle: &tauri::AppHandle<R>,
) -> Result<AgentEvent, String> {
    // T-10-09: size cap.
    if content.len() > MAX_CHAT_MESSAGE_BYTES {
        return Err("message exceeds 256 KiB limit".into());
    }
    // T-10-11: validate session_id shape before passing to Command::arg.
    let sid = match session_id {
        Some(s) if is_valid_uuidv4(s) => s.to_string(),
        Some(_) => return Err("invalid session_id shape".into()),
        None => return Err("no session_id available for auto-resume".into()),
    };

    // Insert the user_text row first (D-10 optimistic append).
    let payload = serde_json::json!({ "content": content });
    let user_event = crate::db::events::insert_agent_event(
        pool,
        agent_id,
        Some(&sid),
        "user_text",
        &payload,
        None,
        None,
        Some("queued"),
    )
    .await?;
    if let Err(e) = app_handle.emit("agent-event-appended", &user_event) {
        tracing::debug!(err = %e, "agent-event-appended emit failed in auto_resume");
    }

    // Prepend a session_boundary { kind: "resumed" } row.
    let boundary_payload = serde_json::json!({
        "kind": "resumed",
        "session_id": sid,
    });
    if let Err(e) = crate::db::events::insert_agent_event(
        pool,
        agent_id,
        Some(&sid),
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
            "failed to insert session_boundary (resumed)"
        );
    }

    // Spawn `claude --resume <sid> --print <content> --output-format
    // stream-json --verbose`. All argv passed via .arg (T-10-11).
    let output = tokio::process::Command::new("claude")
        .arg("--resume")
        .arg(&sid)
        .arg("--print")
        .arg(content)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("auto_resume claude spawn: {e}"))?;

    if !output.status.success() {
        let _ = crate::db::events::update_event_delivery_status(
            pool,
            user_event.id,
            "unsupported",
        )
        .await;
        return Err(format!(
            "claude --resume exited non-zero: {:?}",
            output.status.code()
        ));
    }

    // Extract the assistant text from the last {type:"result"} envelope.
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let result_line = stdout_str
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find(|v| v.get("type").and_then(|t| t.as_str()) == Some("result"));
    if let Some(v) = result_line {
        if let Some(text) = v.get("result").and_then(|r| r.as_str()) {
            let assistant_payload = serde_json::json!({ "content": text });
            if let Err(e) = crate::db::events::insert_agent_event(
                pool,
                agent_id,
                Some(&sid),
                "assistant_text",
                &assistant_payload,
                None,
                None,
                None,
            )
            .await
            {
                tracing::warn!(
                    agent_id = %agent_id,
                    err = %e,
                    "auto_resume: failed to insert assistant_text row"
                );
            }
        }
    }

    let _ = crate::db::events::update_event_delivery_status(pool, user_event.id, "consumed").await;
    Ok(user_event)
}

/// UUID-shaped validator. Accepts the classic 8-4-4-4-12 hyphenated form;
/// doesn't require the v4-specific bit pattern (auto-resume accepts whatever
/// session_id Claude gave us, as long as it's UUID-shaped).
pub(crate) fn is_valid_uuidv4(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *b != b'-' {
                    return false;
                }
            }
            _ => {
                if !b.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::events::tests::make_pool_with_chat_schema;

    #[test]
    fn is_valid_uuidv4_accepts_and_rejects() {
        assert!(is_valid_uuidv4("0d836c4f-8546-4aeb-a994-6fb94ba800b7"));
        // Rejected shapes.
        assert!(!is_valid_uuidv4("not-a-uuid"));
        assert!(!is_valid_uuidv4("; rm -rf /"));
        assert!(!is_valid_uuidv4(""));
        assert!(!is_valid_uuidv4("0d836c4f-8546-4aeb-a994-6fb94ba800b")); // too short
        assert!(!is_valid_uuidv4("0d836c4f-8546-4aeb-a994-6fb94ba800b77")); // too long
        assert!(!is_valid_uuidv4("0d836c4fX8546-4aeb-a994-6fb94ba800b7")); // bad hyphen
        assert!(!is_valid_uuidv4("0d836c4g-8546-4aeb-a994-6fb94ba800b7")); // non-hex 'g'
    }

    #[tokio::test]
    async fn auto_resume_rejects_oversize_content() {
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let huge = "x".repeat(MAX_CHAT_MESSAGE_BYTES + 1);
        let result = auto_resume_send(
            "A-1",
            &huge,
            Some("0d836c4f-8546-4aeb-a994-6fb94ba800b7"),
            std::env::temp_dir().as_path(),
            &pool,
            &app_handle,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("256"));
    }

    #[tokio::test]
    async fn auto_resume_rejects_invalid_session_id() {
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let result = auto_resume_send(
            "A-1",
            "hi",
            Some("not-a-uuid"),
            std::env::temp_dir().as_path(),
            &pool,
            &app_handle,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid session_id shape"));
    }

    #[tokio::test]
    async fn auto_resume_rejects_missing_session_id() {
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let result = auto_resume_send(
            "A-1",
            "hi",
            None,
            std::env::temp_dir().as_path(),
            &pool,
            &app_handle,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no session_id"));
    }
}
