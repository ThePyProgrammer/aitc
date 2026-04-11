use crate::conflict::backup::BackupManager;
use crate::conflict::types::ConflictState;
use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::SqlitePool;
use tauri::Manager;

/// File versions for a conflict: base (git HEAD), and current disk content.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileVersions {
    pub base_content: String,
    pub agent_a_content: String,
    pub agent_b_content: String,
    pub file_path: String,
    pub agent_a_id: String,
    pub agent_b_id: String,
}

/// Resolution choice for a single hunk in the merge UI.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HunkResolution {
    pub hunk_index: u32,
    pub choice: String, // "a", "b", "custom"
    pub custom_content: Option<String>,
}

/// A persisted conflict resolution record.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionRecord {
    pub id: i64,
    pub conflict_event_id: Option<i64>,
    pub file_path: String,
    pub agent_a_id: String,
    pub agent_b_id: String,
    pub resolution_type: String,
    pub hunk_resolutions: String, // JSON
    pub notification_status: String,
    pub resolved_at: String,
}

/// An agent session record for history display.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: i64,
    pub agent_id: String,
    pub agent_type: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub file_count: i64,
}

/// A file record within a session.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileRecord {
    pub id: i64,
    pub session_id: i64,
    pub file_path: String,
    pub write_count: i64,
    pub last_written_at: String,
}

/// An approval request record for history display.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalHistoryRecord {
    pub id: i64,
    pub session_id: Option<i64>,
    pub agent_id: Option<String>,
    pub request_type: String,
    pub file_path: Option<String>,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub response_note: Option<String>,
}

/// Maximum file size we will read for conflict resolution (1 MB).
const MAX_FILE_SIZE: u64 = 1_048_576;

/// Validate that a file path contains no `..` segments (T-05-01, T-05-03).
fn validate_file_path(path: &str) -> Result<(), String> {
    if path.contains("..") {
        return Err("File path contains '..' traversal segment".to_string());
    }
    Ok(())
}

/// Read file versions for a conflict: base from git HEAD, current from disk.
///
/// Both agent_a_content and agent_b_content are set to the current disk content
/// since agents write to the same file -- the latest write is what's on disk.
/// The base version comes from `git show HEAD:<relative_path>`.
///
/// File size is capped at 1MB (T-05-04).
#[tauri::command]
#[specta::specta]
pub async fn read_conflict_files(
    conflict_id: String,
    state: tauri::State<'_, ConflictState>,
) -> Result<ConflictFileVersions, String> {
    // Look up the conflict alert
    let alerts = state.get_active().await;
    let alert = alerts
        .iter()
        .find(|a| a.id == conflict_id)
        .ok_or_else(|| format!("Conflict not found: {conflict_id}"))?;

    let file_path = alert.file_path.to_string_lossy().to_string();
    validate_file_path(&file_path)?;

    // Check file size before reading
    let metadata = std::fs::metadata(&alert.file_path)
        .map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err("FILE_EXCEEDS_LIMIT".to_string());
    }

    // Read current file from disk
    let current_content = std::fs::read_to_string(&alert.file_path)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    // Get base version from git, anchored to file's parent directory
    let repo_dir = alert.file_path.parent().unwrap_or(std::path::Path::new("."));
    let base_content = get_git_base_content(&file_path, repo_dir).await.unwrap_or_default();

    Ok(ConflictFileVersions {
        base_content,
        agent_a_content: current_content.clone(),
        agent_b_content: current_content,
        file_path,
        agent_a_id: alert.agent_a_id.clone(),
        agent_b_id: alert.agent_b_id.clone(),
    })
}

/// Get the base file content from git HEAD.
///
/// `repo_root` anchors the git command to the correct working directory,
/// preventing the command from running in an arbitrary CWD (T-05-CR-02).
async fn get_git_base_content(relative_path: &str, repo_root: &std::path::Path) -> Result<String, String> {
    // Normalize path separators for git (always forward slashes)
    let git_path = relative_path.replace('\\', "/");

    let output = tokio::process::Command::new("git")
        .current_dir(repo_root)
        .args(["show", "--", &format!("HEAD:{git_path}")])
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 from git: {e}"))
    } else {
        Err(format!(
            "git show failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Apply a conflict resolution: backup files, write merged content, persist to DB.
///
/// Steps:
/// 1. Look up conflict alert
/// 2. Read current file + git base
/// 3. Save backups (base, agent_a, agent_b versions)
/// 4. Write merged_content to disk
/// 5. Save backup of merged version
/// 6. INSERT into conflict_resolutions
/// 7. UPDATE conflict_events SET resolution_id
/// 8. Dismiss the conflict alert
/// 9. Emit "conflict-resolved" event
/// 10. Return the ResolutionRecord
#[tauri::command]
#[specta::specta]
pub async fn apply_resolution(
    conflict_id: String,
    merged_content: String,
    hunk_resolutions: Vec<HunkResolution>,
    resolution_type: String,
    state: tauri::State<'_, ConflictState>,
    pool: tauri::State<'_, SqlitePool>,
    app: tauri::AppHandle,
) -> Result<ResolutionRecord, String> {
    // Validate resolution_type
    if !["accept_a", "accept_b", "manual", "mixed"].contains(&resolution_type.as_str()) {
        return Err(format!("Invalid resolution_type: {resolution_type}"));
    }

    // 1. Look up conflict alert
    let alerts = state.get_active().await;
    let alert = alerts
        .iter()
        .find(|a| a.id == conflict_id)
        .ok_or_else(|| format!("Conflict not found: {conflict_id}"))?
        .clone();

    let file_path = alert.file_path.to_string_lossy().to_string();
    validate_file_path(&file_path)?;

    // 2. Read current file + git base
    let current_content = std::fs::read_to_string(&alert.file_path)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let repo_dir = alert.file_path.parent().unwrap_or(std::path::Path::new("."));
    let base_content = get_git_base_content(&file_path, repo_dir).await.unwrap_or_default();

    // 3. Save backups via BackupManager
    let backup_manager = app
        .try_state::<BackupManager>()
        .ok_or("BackupManager not initialized")?;

    let backup_base_path = backup_manager
        .save_backup(&conflict_id, "base", &base_content)
        .ok();
    let backup_a_path = backup_manager
        .save_backup(&conflict_id, "agent_a", &current_content)
        .ok();
    let backup_b_path = backup_manager
        .save_backup(&conflict_id, "agent_b", &current_content)
        .ok();

    // 4. Write merged content to disk
    std::fs::write(&alert.file_path, &merged_content)
        .map_err(|e| format!("Failed to write merged file: {e}"))?;

    // 5. Save backup of merged version
    let backup_merged_path = backup_manager
        .save_backup(&conflict_id, "merged", &merged_content)
        .ok();

    // 6. Serialize hunk_resolutions to JSON
    let hunk_json = serde_json::to_string(&hunk_resolutions)
        .map_err(|e| format!("Failed to serialize hunk resolutions: {e}"))?;

    // 7. INSERT into conflict_resolutions
    let result = sqlx::query_as::<_, (i64, String, String)>(
        r#"INSERT INTO conflict_resolutions
           (file_path, agent_a_id, agent_b_id, resolution_type,
            backup_base_path, backup_a_path, backup_b_path, backup_merged_path,
            hunk_resolutions, notification_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
           RETURNING id, notification_status, resolved_at"#,
    )
    .bind(&file_path)
    .bind(&alert.agent_a_id)
    .bind(&alert.agent_b_id)
    .bind(&resolution_type)
    .bind(&backup_base_path)
    .bind(&backup_a_path)
    .bind(&backup_b_path)
    .bind(&backup_merged_path)
    .bind(&hunk_json)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Failed to insert resolution: {e}"))?;

    let resolution_id = result.0;

    // 8. UPDATE conflict_events SET resolution_id (best-effort, may not have matching event)
    let _ = sqlx::query("UPDATE conflict_events SET resolution_id = ? WHERE file_path = ? AND resolution_id IS NULL ORDER BY detected_at DESC LIMIT 1")
        .bind(resolution_id)
        .bind(&file_path)
        .execute(pool.inner())
        .await;

    // 9. Dismiss the conflict alert
    state.dismiss(&conflict_id).await;

    // 10. Emit conflict-resolved event
    {
        use tauri::Emitter;
        let _ = app.emit("conflict-resolved", &conflict_id);
    }

    Ok(ResolutionRecord {
        id: resolution_id,
        conflict_event_id: None,
        file_path,
        agent_a_id: alert.agent_a_id,
        agent_b_id: alert.agent_b_id,
        resolution_type,
        hunk_resolutions: hunk_json,
        notification_status: result.1,
        resolved_at: result.2,
    })
}

/// List all conflict resolutions, most recent first.
#[tauri::command]
#[specta::specta]
pub async fn list_conflict_resolutions(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<ResolutionRecord>, String> {
    let rows = sqlx::query_as::<_, (i64, Option<i64>, String, String, String, String, String, String, String)>(
        r#"SELECT id, conflict_event_id, file_path, agent_a_id, agent_b_id,
                  resolution_type, COALESCE(hunk_resolutions, '[]'),
                  COALESCE(notification_status, 'pending'), resolved_at
           FROM conflict_resolutions
           ORDER BY resolved_at DESC"#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to query resolutions: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| ResolutionRecord {
            id: r.0,
            conflict_event_id: r.1,
            file_path: r.2,
            agent_a_id: r.3,
            agent_b_id: r.4,
            resolution_type: r.5,
            hunk_resolutions: r.6,
            notification_status: r.7,
            resolved_at: r.8,
        })
        .collect())
}

/// List files touched in a given session, ordered by write count descending.
#[tauri::command]
#[specta::specta]
pub async fn list_session_files(
    session_id: i64,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<SessionFileRecord>, String> {
    let rows = sqlx::query_as::<_, (i64, i64, String, i64, String)>(
        r#"SELECT id, session_id, file_path, write_count, last_written_at
           FROM session_files
           WHERE session_id = ?
           ORDER BY write_count DESC
           LIMIT 10"#,
    )
    .bind(session_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to query session files: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| SessionFileRecord {
            id: r.0,
            session_id: r.1,
            file_path: r.2,
            write_count: r.3,
            last_written_at: r.4,
        })
        .collect())
}

/// Record a file write for a session (upsert pattern).
///
/// If the file was already recorded for this session, increments write_count.
/// Also updates the session's file_count aggregate.
#[tauri::command]
#[specta::specta]
pub async fn record_session_file(
    session_id: i64,
    file_path: String,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<(), String> {
    validate_file_path(&file_path)?;

    sqlx::query(
        r#"INSERT INTO session_files (session_id, file_path, write_count, last_written_at)
           VALUES (?, ?, 1, datetime('now'))
           ON CONFLICT(session_id, file_path) DO UPDATE SET
             write_count = write_count + 1,
             last_written_at = datetime('now')"#,
    )
    .bind(session_id)
    .bind(&file_path)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to record session file: {e}"))?;

    // Update aggregate file_count on agent_sessions
    sqlx::query(
        r#"UPDATE agent_sessions SET file_count = (
             SELECT COUNT(*) FROM session_files WHERE session_id = ?
           ) WHERE id = ?"#,
    )
    .bind(session_id)
    .bind(session_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to update session file count: {e}"))?;

    Ok(())
}

/// List all agent sessions with file counts, most recent first.
#[tauri::command]
#[specta::specta]
pub async fn list_sessions(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<SessionRecord>, String> {
    let rows = sqlx::query_as::<_, (i64, String, String, String, String, Option<String>, i64)>(
        r#"SELECT id, agent_id, agent_type, status, started_at, ended_at, file_count
           FROM agent_sessions
           ORDER BY started_at DESC"#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to query sessions: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| SessionRecord {
            id: r.0,
            agent_id: r.1,
            agent_type: r.2,
            status: r.3,
            started_at: r.4,
            ended_at: r.5,
            file_count: r.6,
        })
        .collect())
}

/// List approval request history with agent context, most recent first.
#[tauri::command]
#[specta::specta]
pub async fn list_approval_history(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<ApprovalHistoryRecord>, String> {
    let rows = sqlx::query_as::<_, (i64, Option<i64>, Option<String>, String, Option<String>, String, String, Option<String>, Option<String>)>(
        r#"SELECT id, session_id, agent_id, request_type, file_path,
                  status, created_at, resolved_at, response_note
           FROM approval_requests
           ORDER BY created_at DESC"#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to query approval history: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| ApprovalHistoryRecord {
            id: r.0,
            session_id: r.1,
            agent_id: r.2,
            request_type: r.3,
            file_path: r.4,
            status: r.5,
            created_at: r.6,
            resolved_at: r.7,
            response_note: r.8,
        })
        .collect())
}
