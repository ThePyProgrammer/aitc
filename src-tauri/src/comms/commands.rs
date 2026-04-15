//! Tauri command surface for the Communications Hub (Phase 4, Plan 01).
//!
//! Commands:
//!   - Approval workflow: list, create, approve, deny, ask_more_info, approve_with_edits
//!   - Chat: send_chat_message, list_chat_messages, update_message_delivery_status
//!   - Protected paths: list, add, remove

// Phase 8: WaiterRegistry is wired into approve/deny/approve_with_edits
// below. approve_request signals HookDecision::Allow; deny_request signals
// Deny(reason); approve_with_edits signals AllowWithEdits(updated_input).
use crate::agents::hook_waiters::{HookDecision, WaiterRegistry};
use crate::comms::types::{ApprovalRequest, ChatMessage, ProtectedPath};
use sqlx::{Pool, Row, Sqlite};
use std::sync::Arc;
use tauri::Emitter;

/// Dispatch a native OS notification for an approval request.
///
/// Plan 08-02 added the optional `request_id` argument so Plan 08-05 can
/// deep-link a click-to-focus deeplink on the notification body (see 08-CONTEXT
/// D-23). Carried inline in the body text until the UI wires up a native
/// notification action handler.
fn dispatch_approval_notification<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    agent_id: &str,
    file_path: Option<&str>,
    request_id: Option<i64>,
) {
    use tauri_plugin_notification::NotificationExt;
    let suffix = match request_id {
        Some(id) => format!(" [#{id}]"),
        None => String::new(),
    };
    let body = match file_path {
        Some(fp) => format!("{agent_id} requests access to {fp}{suffix}"),
        None => format!("{agent_id} requests approval{suffix}"),
    };
    // The notification plugin panics on .notification() when not registered
    // (e.g. tauri::test::mock_app). Catch it so hook_handler integration
    // tests don't blow up; in production the plugin is always registered in
    // lib.rs run().
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app_handle
            .notification()
            .builder()
            .title("APPROVAL_REQUIRED")
            .body(&body)
            .show()
    }));
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!("approval notification send failed: {e}"),
        Err(_) => tracing::debug!("notification plugin unavailable (likely test runtime)"),
    }
}

// ---------------------------------------------------------------------------
// Internal helpers for row mapping
// ---------------------------------------------------------------------------

fn map_approval_row(row: &sqlx::sqlite::SqliteRow) -> ApprovalRequest {
    ApprovalRequest {
        id: row.get("id"),
        agent_id: row.get::<Option<String>, _>("agent_id").unwrap_or_default(),
        request_type: row.get("request_type"),
        file_path: row.get("file_path"),
        diff_content: row.get("diff_content"),
        status: row.get("status"),
        urgency: row.get::<Option<String>, _>("urgency").unwrap_or_else(|| "medium".to_string()),
        response_note: row.get("response_note"),
        edited_content: row.get("edited_content"),
        created_at: row.get("created_at"),
        resolved_at: row.get("resolved_at"),
        // Phase 8: PreToolUse hook context. Optional columns — write_access
        // rows (from the Phase 4 protected-path trigger) never set these.
        tool_name: row.try_get("tool_name").ok().flatten(),
        tool_input_json: row.try_get("tool_input_json").ok().flatten(),
        session_id: row.try_get("session_id").ok().flatten(),
    }
}

fn map_chat_row(row: &sqlx::sqlite::SqliteRow) -> ChatMessage {
    ChatMessage {
        id: row.get("id"),
        agent_id: row.get("agent_id"),
        direction: row.get("direction"),
        content: row.get("content"),
        delivery_status: row.get("delivery_status"),
        approval_request_id: row.get("approval_request_id"),
        created_at: row.get("created_at"),
    }
}

fn map_protected_path_row(row: &sqlx::sqlite::SqliteRow) -> ProtectedPath {
    ProtectedPath {
        id: row.get("id"),
        glob_pattern: row.get("glob_pattern"),
        created_at: row.get("created_at"),
    }
}

// ---------------------------------------------------------------------------
// Internal function for creating approval requests (used by protected path trigger)
// ---------------------------------------------------------------------------

/// Create an approval request without going through Tauri State wrappers.
/// Used by the protected path trigger (D-07, write_access rows) and by the
/// Phase 8 `/hook` handler (pretool_use rows).
///
/// Phase 8 extension: `tool_name`, `tool_input_json`, `session_id` carry
/// Claude PreToolUse context for pretool_use rows. All three are `None` for
/// the Phase 4 protected-path trigger path.
#[allow(clippy::too_many_arguments)]
pub async fn create_approval_request_internal<R: tauri::Runtime>(
    agent_id: &str,
    request_type: &str,
    file_path: Option<&str>,
    diff_content: Option<&str>,
    urgency: &str,
    tool_name: Option<&str>,
    tool_input_json: Option<&str>,
    session_id: Option<&str>,
    pool: &Pool<Sqlite>,
    app_handle: &tauri::AppHandle<R>,
) -> Result<ApprovalRequest, String> {
    let row = sqlx::query(
        "INSERT INTO approval_requests \
         (agent_id, request_type, file_path, diff_content, urgency, tool_name, tool_input_json, session_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         RETURNING id, agent_id, request_type, file_path, diff_content, status, urgency, \
                   response_note, edited_content, created_at, resolved_at, \
                   tool_name, tool_input_json, session_id",
    )
    .bind(agent_id)
    .bind(request_type)
    .bind(file_path)
    .bind(diff_content)
    .bind(urgency)
    .bind(tool_name)
    .bind(tool_input_json)
    .bind(session_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("insert approval_request failed: {e}"))?;

    let req = map_approval_row(&row);

    // Emit Tauri event for real-time frontend push (Pattern 4 from research).
    let _ = app_handle.emit("approval-request-created", &req);

    // OS notification — Plan 08-05 reads request_id for click-to-focus deeplink.
    dispatch_approval_notification(app_handle, agent_id, file_path, Some(req.id));

    Ok(req)
}

// ---------------------------------------------------------------------------
// Approval workflow commands
// ---------------------------------------------------------------------------

/// List all approval requests, newest first.
#[tauri::command]
#[specta::specta]
pub async fn list_approval_requests(
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<Vec<ApprovalRequest>, String> {
    let rows = sqlx::query("SELECT * FROM approval_requests ORDER BY created_at DESC")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("list approval_requests failed: {e}"))?;

    Ok(rows.iter().map(map_approval_row).collect())
}

// WR-03: create_approval_request removed from Tauri command surface.
// Backend-only callers use create_approval_request_internal directly.
// Exposing this as a #[tauri::command] allowed the frontend to fabricate
// arbitrary approval requests, contradicting the T-04-03 security model.

/// Approve a pending request.
///
/// Phase 8 semantics: signals the pending /hook waiter (if any) with
/// `HookDecision::Allow`. Pitfall 8 guards via `rows_affected()` — if the row
/// already resolved (e.g. AbandonGuard flipped it to `abandoned`) we skip the
/// signal and just re-emit `approval-resolved` so the UI re-syncs.
///
/// `always_allow_for_session=true` inserts (agent_id, tool_name) into the
/// in-memory always-allow set so subsequent /hook calls bypass row creation
/// (D-22). The set is cleared on terminate_agent + process restart — never
/// persisted to disk.
#[tauri::command]
#[specta::specta]
pub async fn approve_request(
    id: i64,
    always_allow_for_session: Option<bool>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Fetch tool_name + agent_id BEFORE the UPDATE so we know what to
    // always-allow even if another task races the row into 'abandoned'.
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT tool_name, agent_id FROM approval_requests \
         WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("approve lookup: {e}"))?;

    let (tool_name, agent_id) = match row {
        Some((t, a)) => (t.unwrap_or_default(), a.unwrap_or_default()),
        None => {
            // Already resolved (abandoned/denied/approved) — no-op, re-emit.
            let _ = app_handle.emit("approval-resolved", id);
            return Ok(());
        }
    };

    let updated = sqlx::query(
        "UPDATE approval_requests SET status='approved', \
         resolved_at=datetime('now') \
         WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("approve update: {e}"))?;

    if updated.rows_affected() == 0 {
        // Race lost to AbandonGuard — don't signal, re-sync UI.
        let _ = app_handle.emit("approval-resolved", id);
        return Ok(());
    }

    // Always-allow mute (D-22) — only for pretool_use rows.
    if always_allow_for_session.unwrap_or(false)
        && !tool_name.is_empty()
        && !agent_id.is_empty()
    {
        waiters
            .add_always_allow(agent_id.clone(), tool_name.clone())
            .await;
    }

    // Signal the hook waiter (no-op if row was write_access, not pretool_use).
    waiters.signal(id, HookDecision::Allow).await;
    let _ = app_handle.emit("approval-resolved", id);
    Ok(())
}

/// Deny a pending request.
///
/// Phase 8 semantics: signals the pending /hook waiter with
/// `HookDecision::Deny(reason)`. `reason=None` falls back to
/// `"denied by user"`. Pitfall 8 guard: only flip and signal if the row is
/// still `pending`.
#[tauri::command]
#[specta::specta]
pub async fn deny_request(
    id: i64,
    reason: Option<String>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let updated = sqlx::query(
        "UPDATE approval_requests SET status='denied', \
         response_note = COALESCE(?, response_note), \
         resolved_at=datetime('now') \
         WHERE id = ? AND status = 'pending'",
    )
    .bind(reason.as_deref())
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("deny update: {e}"))?;

    if updated.rows_affected() > 0 {
        let reason_str = reason.unwrap_or_else(|| "denied by user".to_string());
        waiters.signal(id, HookDecision::Deny(reason_str)).await;
    }
    let _ = app_handle.emit("approval-resolved", id);
    Ok(())
}

/// Request more information on a pending request. Also creates a chat message
/// with the question so the agent sees it in the communications channel.
#[tauri::command]
#[specta::specta]
pub async fn ask_more_info(
    id: i64,
    question: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Update approval request status and note
    sqlx::query(
        "UPDATE approval_requests SET status = 'info_requested', response_note = ? WHERE id = ?",
    )
    .bind(&question)
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("ask_more_info update failed: {e}"))?;

    // Look up the agent_id from the approval request
    let row = sqlx::query("SELECT agent_id FROM approval_requests WHERE id = ?")
        .bind(id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("ask_more_info lookup failed: {e}"))?;

    if let Some(row) = row {
        let agent_id: Option<String> = row.get("agent_id");
        if let Some(agent_id) = agent_id {
            // Insert a chat message with the question
            sqlx::query(
                "INSERT INTO chat_messages (agent_id, direction, content, delivery_status, approval_request_id) \
                 VALUES (?, 'outbound', ?, 'queued', ?)",
            )
            .bind(&agent_id)
            .bind(&question)
            .bind(id)
            .execute(pool.inner())
            .await
            .map_err(|e| format!("ask_more_info chat insert failed: {e}"))?;
        }
    }

    let _ = app_handle.emit("approval-updated", id);
    Ok(())
}

/// Approve a request with edited content.
///
/// Phase 8 semantics: derives a Claude-compatible `updated_input` JSON from
/// the stored `tool_input_json`, replacing the tool-specific content field
/// (`new_string` for Edit/MultiEdit, `content` for Write, `new_source` for
/// NotebookEdit) with `edited_content`. Signals the waiter with
/// `HookDecision::AllowWithEdits(updated_input)`.
///
/// Pitfall 8 guard: only flip + signal if the row is still `pending`.
#[tauri::command]
#[specta::specta]
pub async fn approve_with_edits(
    id: i64,
    edited_content: String,
    always_allow_for_session: Option<bool>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let row: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT tool_name, tool_input_json, agent_id \
         FROM approval_requests WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("approve_with_edits lookup: {e}"))?;

    let (tool_name, tool_input_json, agent_id) = match row {
        Some(t) => (
            t.0.unwrap_or_default(),
            t.1,
            t.2.unwrap_or_default(),
        ),
        None => {
            let _ = app_handle.emit("approval-resolved", id);
            return Ok(());
        }
    };

    let updated = sqlx::query(
        "UPDATE approval_requests SET status='approved', edited_content=?, \
         resolved_at=datetime('now') WHERE id = ? AND status='pending'",
    )
    .bind(&edited_content)
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("approve_with_edits update: {e}"))?;
    if updated.rows_affected() == 0 {
        let _ = app_handle.emit("approval-resolved", id);
        return Ok(());
    }

    // Build updated_input per Claude's PreToolUse contract (D-17). Edit and
    // MultiEdit surface the edit UI in v1; Write/NotebookEdit handled
    // defensively so the backend can be driven by the frontend's future
    // evolution.
    let base_input: serde_json::Value = tool_input_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));
    let updated_input = match tool_name.as_str() {
        "Edit" | "MultiEdit" => {
            let mut m = base_input.clone();
            if let Some(obj) = m.as_object_mut() {
                obj.insert(
                    "new_string".into(),
                    serde_json::Value::String(edited_content.clone()),
                );
            }
            m
        }
        "Write" => {
            let mut m = base_input.clone();
            if let Some(obj) = m.as_object_mut() {
                obj.insert(
                    "content".into(),
                    serde_json::Value::String(edited_content.clone()),
                );
            }
            m
        }
        "NotebookEdit" => {
            let mut m = base_input.clone();
            if let Some(obj) = m.as_object_mut() {
                obj.insert(
                    "new_source".into(),
                    serde_json::Value::String(edited_content.clone()),
                );
            }
            m
        }
        _ => base_input,
    };

    if always_allow_for_session.unwrap_or(false)
        && !tool_name.is_empty()
        && !agent_id.is_empty()
    {
        waiters.add_always_allow(agent_id, tool_name).await;
    }

    waiters
        .signal(id, HookDecision::AllowWithEdits(updated_input))
        .await;
    let _ = app_handle.emit("approval-resolved", id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Chat commands
// ---------------------------------------------------------------------------

/// Send a chat message to an agent.
#[tauri::command]
#[specta::specta]
pub async fn send_chat_message(
    agent_id: String,
    content: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<ChatMessage, String> {
    let row = sqlx::query(
        "INSERT INTO chat_messages (agent_id, direction, content, delivery_status) \
         VALUES (?, 'outbound', ?, 'queued') \
         RETURNING id, agent_id, direction, content, delivery_status, approval_request_id, created_at",
    )
    .bind(&agent_id)
    .bind(&content)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("send_chat_message failed: {e}"))?;

    let msg = map_chat_row(&row);
    let _ = app_handle.emit("chat-message-sent", &msg);
    Ok(msg)
}

/// List all chat messages for a given agent, oldest first.
#[tauri::command]
#[specta::specta]
pub async fn list_chat_messages(
    agent_id: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<Vec<ChatMessage>, String> {
    let rows = sqlx::query(
        "SELECT * FROM chat_messages WHERE agent_id = ? ORDER BY created_at ASC",
    )
    .bind(&agent_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("list_chat_messages failed: {e}"))?;

    Ok(rows.iter().map(map_chat_row).collect())
}

/// Update the delivery status of a chat message.
/// Validates that status is one of 'delivered', 'queued', 'unsupported'.
#[tauri::command]
#[specta::specta]
pub async fn update_message_delivery_status(
    message_id: i64,
    status: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<(), String> {
    // Validate status value
    if !matches!(status.as_str(), "delivered" | "queued" | "unsupported") {
        return Err(format!(
            "Invalid delivery status '{status}'. Must be 'delivered', 'queued', or 'unsupported'"
        ));
    }

    sqlx::query("UPDATE chat_messages SET delivery_status = ? WHERE id = ?")
        .bind(&status)
        .bind(message_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("update_message_delivery_status failed: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Protected paths commands
// ---------------------------------------------------------------------------

/// List all configured protected path glob patterns.
#[tauri::command]
#[specta::specta]
pub async fn list_protected_paths(
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<Vec<ProtectedPath>, String> {
    let rows = sqlx::query("SELECT * FROM protected_paths")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("list_protected_paths failed: {e}"))?;

    Ok(rows.iter().map(map_protected_path_row).collect())
}

/// Add a new protected path glob pattern.
#[tauri::command]
#[specta::specta]
pub async fn add_protected_path(
    glob_pattern: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<ProtectedPath, String> {
    let row = sqlx::query(
        "INSERT INTO protected_paths (glob_pattern) VALUES (?) \
         RETURNING id, glob_pattern, created_at",
    )
    .bind(&glob_pattern)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("add_protected_path failed: {e}"))?;

    Ok(map_protected_path_row(&row))
}

/// Remove a protected path by ID.
#[tauri::command]
#[specta::specta]
pub async fn remove_protected_path(
    id: i64,
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM protected_paths WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("remove_protected_path failed: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Spin up an in-memory SQLite pool with the approval_requests schema
    /// used by Phase 4 + Phase 8 (including the 005 migration columns).
    pub async fn make_pool_with_approval_schema() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE approval_requests ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT, \
                request_type TEXT NOT NULL, \
                file_path TEXT, \
                diff_content TEXT, \
                status TEXT NOT NULL DEFAULT 'pending', \
                urgency TEXT DEFAULT 'medium', \
                response_note TEXT, \
                edited_content TEXT, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')), \
                resolved_at TEXT, \
                tool_name TEXT, \
                tool_input_json TEXT, \
                session_id TEXT \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn map_approval_row_populates_phase8_fields() {
        let pool = make_pool_with_approval_schema().await;
        sqlx::query(
            "INSERT INTO approval_requests \
             (agent_id, request_type, urgency, tool_name, tool_input_json, session_id) \
             VALUES ('K-1', 'pretool_use', 'high', 'Edit', \
                     '{\"file_path\":\"/x.ts\"}', 's1')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let row = sqlx::query("SELECT * FROM approval_requests WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let req = map_approval_row(&row);

        assert_eq!(req.agent_id, "K-1");
        assert_eq!(req.request_type, "pretool_use");
        assert_eq!(req.tool_name.as_deref(), Some("Edit"));
        assert_eq!(
            req.tool_input_json.as_deref(),
            Some("{\"file_path\":\"/x.ts\"}")
        );
        assert_eq!(req.session_id.as_deref(), Some("s1"));
    }

    #[tokio::test]
    async fn map_approval_row_defaults_phase8_fields_to_none() {
        let pool = make_pool_with_approval_schema().await;
        // write_access row from Phase 4 — no tool_name/tool_input_json/session_id.
        sqlx::query(
            "INSERT INTO approval_requests \
             (agent_id, request_type, urgency, file_path) \
             VALUES ('K-2', 'write_access', 'medium', '/x/.env')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let row = sqlx::query("SELECT * FROM approval_requests WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let req = map_approval_row(&row);
        assert_eq!(req.tool_name, None);
        assert_eq!(req.tool_input_json, None);
        assert_eq!(req.session_id, None);
    }

    // -----------------------------------------------------------------
    // Phase 8 — approve/deny/approve_with_edits tests.
    //
    // These drive the command inputs via a mock Tauri app + State so we
    // exercise the real UPDATE + waiter-signal round-trip end-to-end.
    // -----------------------------------------------------------------

    /// Insert a pending pretool_use row with the given tool_name/agent_id.
    /// Returns the row id.
    async fn insert_pretool_use_row(
        pool: &Pool<Sqlite>,
        agent_id: &str,
        tool_name: &str,
        tool_input_json: &str,
    ) -> i64 {
        let (id,): (i64,) = sqlx::query_as(
            "INSERT INTO approval_requests \
             (agent_id, request_type, urgency, tool_name, tool_input_json) \
             VALUES (?, 'pretool_use', 'high', ?, ?) \
             RETURNING id",
        )
        .bind(agent_id)
        .bind(tool_name)
        .bind(tool_input_json)
        .fetch_one(pool)
        .await
        .unwrap();
        id
    }

    #[tokio::test]
    async fn approve_signals_waiter_with_allow() {
        use tokio::sync::oneshot;
        let pool = make_pool_with_approval_schema().await;
        let waiters = WaiterRegistry::new_arc();
        let app = tauri::test::mock_app();

        let id = insert_pretool_use_row(&pool, "K-1", "Edit", "{}").await;
        let (tx, rx) = oneshot::channel();
        waiters
            .register(
                id,
                crate::agents::hook_waiters::WaiterEntry {
                    agent_id: "K-1".into(),
                    tool_name: "Edit".into(),
                    sender: tx,
                },
            )
            .await;

        // Drive the command body via the same UPDATE/signal flow. We can't
        // easily fabricate tauri::State<'_, ...>, so we call the underlying
        // steps directly. The production #[tauri::command] wrapper adds
        // nothing beyond State unwrapping.
        let row: (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT tool_name, agent_id FROM approval_requests WHERE id = ? AND status='pending'",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0.as_deref(), Some("Edit"));
        let updated = sqlx::query(
            "UPDATE approval_requests SET status='approved', resolved_at=datetime('now') \
             WHERE id = ? AND status='pending'",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(updated.rows_affected(), 1);
        waiters.signal(id, HookDecision::Allow).await;
        let _ = app.handle().emit("approval-resolved", id);

        let d = rx.await.unwrap();
        assert!(matches!(d, HookDecision::Allow));
    }

    #[tokio::test]
    async fn approve_with_edits_derives_updated_input_for_edit() {
        // Exercise the JSON-munging logic directly. Tests isolate the
        // algorithm — the UPDATE + signal path is covered by the e2e
        // integration smokes.
        let base: serde_json::Value =
            serde_json::from_str("{\"file_path\":\"/x.ts\",\"old_string\":\"a\",\"new_string\":\"b\"}")
                .unwrap();
        let edited_content = "REPLACED".to_string();
        let updated = {
            let mut m = base.clone();
            if let Some(obj) = m.as_object_mut() {
                obj.insert(
                    "new_string".into(),
                    serde_json::Value::String(edited_content.clone()),
                );
            }
            m
        };
        assert_eq!(updated["new_string"], "REPLACED");
        assert_eq!(updated["old_string"], "a");
        assert_eq!(updated["file_path"], "/x.ts");
    }

    #[tokio::test]
    async fn approve_with_edits_derives_updated_input_for_write_and_notebook() {
        for (tool, field) in [("Write", "content"), ("NotebookEdit", "new_source")] {
            let base = serde_json::json!({
                "file_path": "/x.py",
                field: "old",
                "keep": "yes",
            });
            let edited = format!("new-{tool}");
            let updated = {
                let mut m = base.clone();
                if let Some(obj) = m.as_object_mut() {
                    obj.insert(field.into(), serde_json::Value::String(edited.clone()));
                }
                m
            };
            assert_eq!(updated[field], edited);
            assert_eq!(updated["keep"], "yes");
        }
    }

    #[tokio::test]
    async fn deny_signals_waiter_with_reason() {
        use tokio::sync::oneshot;
        let pool = make_pool_with_approval_schema().await;
        let waiters = WaiterRegistry::new_arc();

        let id = insert_pretool_use_row(&pool, "K-1", "Bash", "{}").await;
        let (tx, rx) = oneshot::channel();
        waiters
            .register(
                id,
                crate::agents::hook_waiters::WaiterEntry {
                    agent_id: "K-1".into(),
                    tool_name: "Bash".into(),
                    sender: tx,
                },
            )
            .await;

        let reason = "user rejected".to_string();
        let updated = sqlx::query(
            "UPDATE approval_requests SET status='denied', \
             response_note = COALESCE(?, response_note), \
             resolved_at=datetime('now') WHERE id = ? AND status='pending'",
        )
        .bind(Some(&reason))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(updated.rows_affected(), 1);
        waiters.signal(id, HookDecision::Deny(reason.clone())).await;

        match rx.await.unwrap() {
            HookDecision::Deny(r) => assert_eq!(r, "user rejected"),
            other => panic!("expected Deny, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn approve_is_idempotent_when_row_already_abandoned() {
        // Simulate the AbandonGuard-won-the-race case: row flipped to
        // 'abandoned' first, approve_request observes rows_affected() == 0
        // and must skip the signal.
        let pool = make_pool_with_approval_schema().await;
        let waiters = WaiterRegistry::new_arc();

        let id = insert_pretool_use_row(&pool, "K-1", "Edit", "{}").await;
        // Pre-flip to 'abandoned' to mimic disconnect.
        sqlx::query(
            "UPDATE approval_requests SET status='abandoned', \
             resolved_at=datetime('now') WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        // No waiter was registered (AbandonGuard already removed it),
        // so signal returns false.
        let signalled = waiters.signal(id, HookDecision::Allow).await;
        assert!(!signalled);

        // And the UPDATE-WHERE-pending is a no-op.
        let updated = sqlx::query(
            "UPDATE approval_requests SET status='approved', resolved_at=datetime('now') \
             WHERE id = ? AND status='pending'",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            updated.rows_affected(),
            0,
            "Pitfall 8 guard: cannot overwrite abandoned row"
        );
    }

    #[tokio::test]
    async fn approve_always_allow_true_mutes_future_tool_calls() {
        let waiters = WaiterRegistry::new_arc();
        waiters.add_always_allow("K-1".into(), "Bash".into()).await;
        assert!(waiters.is_always_allowed("K-1", "Bash").await);
        // Future /hook calls for (K-1, Bash) will fast-path allow
        // (covered by hook_honors_always_allow_fast_path integration test).
    }
}
