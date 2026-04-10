//! Tauri command surface for the Communications Hub (Phase 4, Plan 01).
//!
//! Commands:
//!   - Approval workflow: list, create, approve, deny, ask_more_info, approve_with_edits
//!   - Chat: send_chat_message, list_chat_messages, update_message_delivery_status
//!   - Protected paths: list, add, remove

use crate::comms::types::{ApprovalRequest, ChatMessage, ProtectedPath};
use sqlx::{Pool, Row, Sqlite};
use tauri::Emitter;

/// Dispatch a native OS notification for an approval request.
fn dispatch_approval_notification(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    file_path: Option<&str>,
) {
    use tauri_plugin_notification::NotificationExt;
    let body = match file_path {
        Some(fp) => format!("{agent_id} requests access to {fp}"),
        None => format!("{agent_id} requests approval"),
    };
    app_handle
        .notification()
        .builder()
        .title("APPROVAL_REQUIRED")
        .body(&body)
        .show()
        .unwrap_or_else(|e| tracing::warn!("approval notification send failed: {e}"));
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
/// Used by the protected path trigger (D-07) and delegated-to by the Tauri command.
pub async fn create_approval_request_internal(
    agent_id: &str,
    request_type: &str,
    file_path: Option<&str>,
    diff_content: Option<&str>,
    urgency: &str,
    pool: &Pool<Sqlite>,
    app_handle: &tauri::AppHandle,
) -> Result<ApprovalRequest, String> {
    let row = sqlx::query(
        "INSERT INTO approval_requests (agent_id, request_type, file_path, diff_content, urgency) \
         VALUES (?, ?, ?, ?, ?) \
         RETURNING id, agent_id, request_type, file_path, diff_content, status, urgency, \
                   response_note, edited_content, created_at, resolved_at",
    )
    .bind(agent_id)
    .bind(request_type)
    .bind(file_path)
    .bind(diff_content)
    .bind(urgency)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("insert approval_request failed: {e}"))?;

    let req = map_approval_row(&row);

    // Emit Tauri event for real-time frontend push (Pattern 4 from research)
    let _ = app_handle.emit("approval-request-created", &req);

    // OS notification
    dispatch_approval_notification(app_handle, agent_id, file_path);

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

/// Create a new approval request (frontend-facing Tauri command).
/// Delegates to create_approval_request_internal.
///
/// T-04-03 mitigation: Only called from Rust backend (adapter hooks or protected
/// path detection). Frontend can approve/deny/ask but not fabricate requests
/// through this command in normal workflow.
#[tauri::command]
#[specta::specta]
pub async fn create_approval_request(
    agent_id: String,
    request_type: String,
    file_path: Option<String>,
    diff_content: Option<String>,
    urgency: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<ApprovalRequest, String> {
    create_approval_request_internal(
        &agent_id,
        &request_type,
        file_path.as_deref(),
        diff_content.as_deref(),
        &urgency,
        pool.inner(),
        &app_handle,
    )
    .await
}

/// Approve a pending request.
#[tauri::command]
#[specta::specta]
pub async fn approve_request(
    id: i64,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE approval_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("approve_request failed: {e}"))?;

    let _ = app_handle.emit("approval-resolved", id);
    Ok(())
}

/// Deny a pending request.
#[tauri::command]
#[specta::specta]
pub async fn deny_request(
    id: i64,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE approval_requests SET status = 'denied', resolved_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("deny_request failed: {e}"))?;

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
#[tauri::command]
#[specta::specta]
pub async fn approve_with_edits(
    id: i64,
    edited_content: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE approval_requests SET status = 'approved', edited_content = ?, \
         resolved_at = datetime('now') WHERE id = ?",
    )
    .bind(&edited_content)
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("approve_with_edits failed: {e}"))?;

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
