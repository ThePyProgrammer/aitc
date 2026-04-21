//! Protected path trigger for synthetic approval requests (D-07).
//!
//! Subscribes to the pipeline broadcast channel and generates approval requests
//! when agents write to user-configured protected path globs.

use crate::comms::commands::create_approval_request_internal;
use crate::pipeline::events::{Attribution, FileEventBatch, FileEventKind};
use glob::Pattern;
use sqlx::{Pool, Row, Sqlite};
use tokio::sync::broadcast;

/// Spawns a task that subscribes to the pipeline broadcast channel and checks
/// each write event against the user's configured protected path globs.
/// When a match is found, calls create_approval_request_internal to generate
/// a synthetic approval request for that agent+file.
pub fn spawn_protected_path_watcher(
    mut rx: broadcast::Receiver<FileEventBatch>,
    pool: Pool<Sqlite>,
    app_handle: tauri::AppHandle,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Ok(batch) = rx.recv().await {
            check_protected_paths(&batch, &pool, &app_handle).await;
        }
    })
}

/// For each write/create event in the batch, query protected_paths from DB,
/// check if the event file_path matches any glob pattern.
/// If match found AND the event's attribution agent_id is present (non-anonymous),
/// call create_approval_request_internal with request_type="write_access",
/// urgency="medium", and the matched file path.
///
/// T-04-14 mitigation: Deduplication check prevents duplicate pending requests
/// for the same agent_id + file_path combination.
pub async fn check_protected_paths(
    batch: &FileEventBatch,
    pool: &Pool<Sqlite>,
    app_handle: &tauri::AppHandle,
) {
    // 1. Query all protected path globs from DB
    let glob_rows = match sqlx::query("SELECT glob_pattern FROM protected_paths")
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!("failed to query protected_paths: {e}");
            return;
        }
    };

    if glob_rows.is_empty() {
        return;
    }

    // Parse glob patterns (skip invalid ones with a warning)
    let patterns: Vec<Pattern> = glob_rows
        .iter()
        .filter_map(|row| {
            let pat: String = row.get("glob_pattern");
            match Pattern::new(&pat) {
                Ok(p) => Some(p),
                Err(e) => {
                    tracing::warn!("invalid protected path glob '{pat}': {e}");
                    None
                }
            }
        })
        .collect();

    if patterns.is_empty() {
        return;
    }

    // 2. For each event in batch where kind is Write (Modify) or Create
    for event in &batch.events {
        let is_write_or_create = matches!(
            event.kind,
            FileEventKind::Modify | FileEventKind::Create
        );
        if !is_write_or_create {
            continue;
        }

        // a. Get agent PID from attribution (skip if unattributed/ambiguous)
        let pid = match &event.attribution {
            Attribution::Pid(pid) => *pid,
            _ => continue,
        };
        let agent_id = format!("KAGENT-{:04}", pid % 10000);

        // b. Check if file path matches any protected glob
        let path_str = event.path.to_string_lossy();
        let matches_protected = patterns.iter().any(|p| p.matches(&path_str));
        if !matches_protected {
            continue;
        }

        // c. Dedup: skip if a pending approval already exists for this agent+file
        let file_path_str = path_str.to_string();
        let existing = sqlx::query(
            "SELECT COUNT(*) as cnt FROM approval_requests \
             WHERE status = 'pending' AND agent_id = ? AND file_path = ?",
        )
        .bind(&agent_id)
        .bind(&file_path_str)
        .fetch_one(pool)
        .await;

        if let Ok(row) = existing {
            let count: i64 = row.get("cnt");
            if count > 0 {
                continue;
            }
        }

        // d. Create synthetic approval request
        tracing::info!(
            agent_id = %agent_id,
            file_path = %file_path_str,
            "protected path write detected, creating synthetic approval request"
        );

        // write_access rows never carry Claude PreToolUse fields (those are
        // reserved for pretool_use rows created by the /hook handler). Phase
        // 17 D-21: protected_path gates carry `gate_reason="protected_path"`
        // with `conflict_with_agent_id=None`; the file-watcher-triggered
        // write_access path is a post-write detection with no conflict
        // peer, so BOTH new fields are `None` here (legacy write_access
        // semantics preserved).
        if let Err(e) = create_approval_request_internal(
            &agent_id,
            "write_access",
            Some(&file_path_str),
            None,
            "medium",
            None,
            None,
            None,
            None,
            None,
            pool,
            app_handle,
        )
        .await
        {
            tracing::warn!("failed to create synthetic approval request: {e}");
        }
    }
}
