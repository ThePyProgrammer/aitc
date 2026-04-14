//! Tauri command surface for the Phase 2 pipeline.
//!
//! Commands:
//!   - start_watch(repo_root, channel) -> Vec<Worktree>
//!       Canonicalizes repo_root, spawns watcher + snapshot refresher +
//!       attributing stream + channel forwarder + conflict engine task.
//!       Returns initial worktree list.
//!   - stop_watch() -> ()
//!       Drops the ActiveWatch, cleaning up all tasks.
//!   - list_worktrees(repo_root) -> Vec<Worktree>
//!       Standalone worktree lookup (Phase 3 refresh per D-09).

use crate::agents::notifications::{dispatch_state_notification, NotificationState};
use crate::agents::{AgentRegistry, AgentState};
use crate::comms::protected_path_trigger::spawn_protected_path_watcher;
use crate::comms::types::TreeIndexEntry;
use crate::conflict::engine::ConflictEngine;
use crate::conflict::commands::emit_conflict_event;
use crate::conflict::types::ConflictState;
use crate::pipeline::events::FileEventBatch;
use crate::pipeline::pipeline_state::{ActiveWatch, PipelineState};
use crate::pipeline::process_snapshot::{
    spawn_snapshot_refresher, start_attributing_stream, ProcessSnapshot,
};
use crate::pipeline::watcher::spawn_watcher;
use crate::pipeline::worktree::{list_worktrees as do_list_worktrees, Worktree};
use sqlx::{Pool, Sqlite};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::sync::{broadcast, mpsc, RwLock};

/// PID polling cadence. If Plan 01's BENCH_RESULT showed sysinfo refresh >=50ms,
/// bump this to 2000. Keep at 1000 otherwise.
///
/// Change log: see .planning/phases/02-real-time-data-pipeline/02-01-SUMMARY.md
/// for the measured number.
const PID_POLL_INTERVAL_MS: u64 = 1000;

/// Channel/mpsc capacity between watcher -> attributing_stream -> forwarder.
/// 1024 is the research-recommended cap (02-RESEARCH.md Pitfall 3 threat model).
const PIPELINE_MPSC_CAPACITY: usize = 1024;

#[tauri::command]
#[specta::specta]
pub async fn start_watch(
    repo_root: String,
    channel: tauri::ipc::Channel<FileEventBatch>,
    state: tauri::State<'_, PipelineState>,
    conflict_state: tauri::State<'_, ConflictState>,
    notification_state: tauri::State<'_, NotificationState>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<Worktree>, String> {
    // Validate and canonicalize the input path.
    let repo_root_path = PathBuf::from(&repo_root);
    if !repo_root_path.exists() {
        return Err(format!("repo_root does not exist: {repo_root}"));
    }
    if !repo_root_path.is_dir() {
        return Err(format!("repo_root is not a directory: {repo_root}"));
    }
    let canonical = repo_root_path
        .canonicalize()
        .map_err(|e| format!("canonicalize repo_root: {e}"))?;

    // If a watch is already active, stop it first (idempotent start).
    let mut guard = state.inner.lock().await;
    if let Some(existing) = guard.take() {
        drop(existing); // triggers Drop -> aborts all tasks
    }

    // Wire the pipeline: watcher -> raw_rx -> attributing_stream -> attributed_rx -> forwarder -> Channel
    let (raw_tx, raw_rx) = mpsc::channel::<FileEventBatch>(PIPELINE_MPSC_CAPACITY);
    let (attributed_tx, mut attributed_rx) =
        mpsc::channel::<FileEventBatch>(PIPELINE_MPSC_CAPACITY);

    // Spawn the watcher (Plan 02).
    // spawn_watcher calls build_tree_index which blocks for 50-500ms on large
    // repos. Wrap in spawn_blocking to avoid starving the tokio async executor.
    let watcher_output = {
        let canonical_clone = canonical.clone();
        let raw_tx_clone = raw_tx;
        tauri::async_runtime::spawn_blocking(move || {
            spawn_watcher(&canonical_clone, raw_tx_clone)
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {e}"))?
        .map_err(|e| format!("spawn_watcher failed: {e}"))?
    };

    // Spawn snapshot refresher (Plan 03).
    let snapshot = Arc::new(RwLock::new(ProcessSnapshot::new()));
    // Prime the snapshot before the first attribution to avoid a blank-for-one-second window.
    {
        let mut s = snapshot.write().await;
        s.refresh();
    }
    let refresher =
        spawn_snapshot_refresher(snapshot.clone(), Duration::from_millis(PID_POLL_INTERVAL_MS));

    // Pull shared states needed by the passive bridge + session-file forwarder.
    let registry_arc: Arc<AgentRegistry> = app_handle
        .state::<Arc<AgentRegistry>>()
        .inner()
        .clone();
    let pool_arc: sqlx::SqlitePool = pool.inner().clone();

    // AGNT-03: passive PID → AgentRegistry bridge (2s tick). Aborted when
    // ActiveWatch is dropped (Drop impl in pipeline_state.rs).
    let bridge_task = crate::pipeline::passive_bridge::spawn_passive_bridge(
        registry_arc.clone(),
        snapshot.clone(),
        Duration::from_millis(crate::pipeline::passive_bridge::BRIDGE_INTERVAL_MS),
    );

    // Spawn the attributing stream (Plan 03).
    let attributing = start_attributing_stream(raw_rx, attributed_tx, snapshot.clone());

    // Create broadcast channel for conflict engine fan-out.
    // The forwarder sends each batch to both the frontend Channel and the
    // conflict engine via broadcast.
    //
    // WR-02: Subscribe both receivers BEFORE spawning the forwarder task
    // to prevent the first events from being dropped when there are zero
    // active receivers at the moment of send.
    let (conflict_tx, _) = broadcast::channel::<FileEventBatch>(256);
    let mut conflict_rx = conflict_tx.subscribe();
    let protected_rx = conflict_tx.subscribe();

    // Spawn the Channel forwarder: reads attributed batches, fans out to
    // conflict engine via broadcast, persists attributed session-file rows
    // (D-09, HIST-01), then sends over the Tauri Channel.
    let channel_clone = channel.clone();
    let conflict_tx_clone = conflict_tx.clone();
    let registry_for_forwarder = registry_arc.clone();
    let pool_for_forwarder = pool_arc.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(batch) = attributed_rx.recv().await {
            // Fan out to conflict engine (non-blocking; drop if no receivers)
            let _ = conflict_tx_clone.send(batch.clone());
            // D-09: persist session-file records for every attributed write.
            persist_attributed_batch(&batch, &registry_for_forwarder, &pool_for_forwarder).await;
            if let Err(e) = channel_clone.send(batch) {
                tracing::warn!(error = ?e, "channel send failed -- frontend channel dead");
                break;
            }
        }
    });

    // Spawn conflict engine task: processes batches from broadcast channel,
    // detects conflicts, emits Tauri events for real-time frontend push (CNFL-02),
    // and dispatches OS notifications for conflict state (D-09).
    let conflict_window_ms = conflict_state.get_window_ms();
    let app_handle_clone = app_handle.clone();
    let conflict_task = tokio::spawn(async move {
        let mut engine = ConflictEngine::new(Duration::from_millis(conflict_window_ms));
        while let Ok(batch) = conflict_rx.recv().await {
            let alerts = engine.process_batch(&batch);
            for alert in alerts {
                // Push to frontend in real time via Tauri event (CNFL-02)
                emit_conflict_event(&app_handle_clone, &alert);
                // Dispatch OS notification for conflict state per D-09
                let notification_state_ref = app_handle_clone.state::<NotificationState>();
                let prefs = notification_state_ref.get_prefs().await;
                dispatch_state_notification(
                    &app_handle_clone,
                    &alert.agent_a_id,
                    &AgentState::Conflict,
                    &prefs,
                );
                // Store alert in shared state
                let conflict_state_ref = app_handle_clone.state::<ConflictState>();
                conflict_state_ref.add_alert(alert).await;
            }
        }
    });

    // Spawn protected path trigger (D-07): uses pre-subscribed broadcast receiver
    let protected_path_handle = Some(spawn_protected_path_watcher(
        protected_rx,
        pool.inner().clone(),
        app_handle.clone(),
    ));

    // Run worktree detection once at start per D-09.
    let worktrees = do_list_worktrees(&canonical).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "worktree list failed -- returning empty");
        Vec::new()
    });

    // Store the active watch in state, including the tree index for Phase 4 radar.
    let tree_file_count = watcher_output.initial_tree.len();
    *guard = Some(ActiveWatch {
        watcher_handle: watcher_output.handle,
        snapshot_refresher: refresher,
        attributing_task: attributing,
        forwarder_task: forwarder,
        conflict_task,
        bridge_task,
        protected_path_handle,
        snapshot,
        channel,
        tree_index: watcher_output.initial_tree,
    });

    tracing::info!(
        initial_tree_files = tree_file_count,
        worktrees = worktrees.len(),
        "watch started"
    );

    Ok(worktrees)
}

#[tauri::command]
#[specta::specta]
pub async fn stop_watch(state: tauri::State<'_, PipelineState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(active) = guard.take() {
        drop(active);
    }
    // Idempotent: no-op if already stopped. Returning Ok(()) avoids
    // rejected promises on the JS side when unregister is called defensively.
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_worktrees(repo_root: String) -> Result<Vec<Worktree>, String> {
    let path = PathBuf::from(&repo_root);
    if !path.exists() {
        return Err(format!("repo_root does not exist: {repo_root}"));
    }
    if !path.is_dir() {
        return Err(format!("repo_root is not a directory: {repo_root}"));
    }
    do_list_worktrees(&path)
}

/// Get the file tree index from the active watch for the Phase 4 radar spatial map.
/// Returns an empty vec if no watch is active.
#[tauri::command]
#[specta::specta]
pub async fn get_tree_index(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<TreeIndexEntry>, String> {
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let entries: Vec<TreeIndexEntry> = active
                .tree_index
                .iter()
                .map(|(path, node)| {
                    let path_str = path.to_string_lossy().to_string();
                    let depth = path.components().count() as u32;
                    TreeIndexEntry {
                        path: path_str,
                        size: node.size,
                        is_dir: false,
                        depth,
                    }
                })
                .collect();
            Ok(entries)
        }
        None => Ok(Vec::new()),
    }
}

/// Persist every attributed file event in `batch` to SQLite (D-09, HIST-01).
///
/// Unattributed / Ambiguous events are silently skipped — per D-09 only
/// `Attribution::Pid(p)` events with a matching registry entry produce
/// session_files rows. Failures are logged and skipped; the forwarder never
/// blocks frontend delivery on DB writes.
pub async fn persist_attributed_batch(
    batch: &crate::pipeline::events::FileEventBatch,
    registry: &crate::agents::AgentRegistry,
    pool: &sqlx::SqlitePool,
) {
    use crate::pipeline::events::Attribution;
    for ev in &batch.events {
        let pid = match ev.attribution {
            Attribution::Pid(p) => p,
            _ => continue,
        };
        let Some(info) = registry.find_agent_by_pid(pid).await else {
            continue;
        };
        let session_id = match crate::db::session::ensure_open_session(
            &info.id,
            &info.agent_type,
            pool,
        )
        .await
        {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(agent_id = %info.id, error = %e, "ensure_open_session failed in forwarder");
                continue;
            }
        };
        let path = ev.path.to_string_lossy();
        if let Err(e) = crate::db::session::record_session_file_internal(
            session_id,
            &path,
            pool,
        )
        .await
        {
            tracing::warn!(session_id, path = %path, error = %e, "record_session_file_internal failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_poll_interval_is_within_range() {
        assert!(PID_POLL_INTERVAL_MS >= 500 && PID_POLL_INTERVAL_MS <= 2000);
    }

    #[test]
    fn pipeline_mpsc_capacity_matches_research_recommendation() {
        assert_eq!(PIPELINE_MPSC_CAPACITY, 1024);
    }
}

#[cfg(test)]
mod forwarder_persist_tests {
    use super::*;
    use crate::agents::adapter::{AgentInfo, AgentState};
    use crate::agents::AgentRegistry;
    use crate::pipeline::events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::PathBuf;
    use std::sync::Arc;

    async fn pool_with_schema() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for stmt in [
            "CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                started_at TEXT NOT NULL,
                ended_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                file_count INTEGER NOT NULL DEFAULT 0
            )",
            "CREATE TABLE session_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
                file_path TEXT NOT NULL,
                write_count INTEGER NOT NULL DEFAULT 1,
                last_written_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(session_id, file_path)
            )",
        ] {
            sqlx::query(stmt).execute(&pool).await.unwrap();
        }
        pool
    }

    fn batch_with_attrib(attr: Attribution, path: &str) -> FileEventBatch {
        FileEventBatch {
            events: vec![FileEvent {
                path: PathBuf::from(path),
                kind: FileEventKind::Modify,
                attribution: attr,
                timestamp_ms: 0,
            }],
            batch_id: 0,
            dropped_batches: 0,
        }
    }

    #[tokio::test]
    async fn forwarder_persist_attributed_batch_records_files_for_matched_pid() {
        let pool = pool_with_schema().await;
        let reg = Arc::new(AgentRegistry::new());
        let adapter = crate::agents::generic::passive_sentinel_adapter();
        reg.upsert_agent(
            "KAGENT-111".into(),
            AgentInfo {
                id: "KAGENT-111".into(),
                agent_type: "claude-code".into(),
                protocol: "http".into(),
                state: AgentState::Running,
                pid: Some(111),
                cwd: None,
                intent: None,
            },
            adapter,
            false,
        )
        .await
        .unwrap();

        let batch = batch_with_attrib(Attribution::Pid(111), "src/foo.rs");
        persist_attributed_batch(&batch, &reg, &pool).await;

        let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM session_files")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(cnt, 1);

        // And a session row should have been created.
        let (sess_cnt,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM agent_sessions WHERE agent_id = 'KAGENT-111'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sess_cnt, 1);
    }

    #[tokio::test]
    async fn forwarder_persist_attributed_batch_skips_unattributed() {
        let pool = pool_with_schema().await;
        let reg = Arc::new(AgentRegistry::new());
        let batch = batch_with_attrib(Attribution::Unattributed, "src/foo.rs");
        persist_attributed_batch(&batch, &reg, &pool).await;
        let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM session_files")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(cnt, 0);
    }

    #[tokio::test]
    async fn forwarder_persist_attributed_batch_skips_ambiguous() {
        let pool = pool_with_schema().await;
        let reg = Arc::new(AgentRegistry::new());
        let batch = batch_with_attrib(Attribution::Ambiguous(vec![1, 2]), "src/foo.rs");
        persist_attributed_batch(&batch, &reg, &pool).await;
        let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM session_files")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(cnt, 0);
    }

    #[tokio::test]
    async fn forwarder_persist_attributed_batch_skips_pid_with_no_registry_match() {
        let pool = pool_with_schema().await;
        let reg = Arc::new(AgentRegistry::new()); // empty
        let batch = batch_with_attrib(Attribution::Pid(9999), "src/foo.rs");
        persist_attributed_batch(&batch, &reg, &pool).await;
        let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM session_files")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(cnt, 0);
    }
}
