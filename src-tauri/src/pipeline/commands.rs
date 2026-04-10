//! Tauri command surface for the Phase 2 pipeline.
//!
//! Commands:
//!   - start_watch(repo_root, channel) -> Vec<Worktree>
//!       Canonicalizes repo_root, spawns watcher + snapshot refresher +
//!       attributing stream + channel forwarder. Returns initial worktree list.
//!   - stop_watch() -> ()
//!       Drops the ActiveWatch, cleaning up all tasks.
//!   - list_worktrees(repo_root) -> Vec<Worktree>
//!       Standalone worktree lookup (Phase 3 refresh per D-09).

use crate::pipeline::events::FileEventBatch;
use crate::pipeline::pipeline_state::{ActiveWatch, PipelineState};
use crate::pipeline::process_snapshot::{
    spawn_snapshot_refresher, start_attributing_stream, ProcessSnapshot,
};
use crate::pipeline::watcher::spawn_watcher;
use crate::pipeline::worktree::{list_worktrees as do_list_worktrees, Worktree};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

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

    // Spawn the attributing stream (Plan 03).
    let attributing = start_attributing_stream(raw_rx, attributed_tx, snapshot.clone());

    // Spawn the Channel forwarder: reads attributed batches, sends over the
    // Tauri Channel. This is the CRITICAL piece -- it's the proof that
    // Channel<FileEventBatch> outlives its registering command (Research Open
    // Question 1 runtime confirmation).
    let channel_clone = channel.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(batch) = attributed_rx.recv().await {
            if let Err(e) = channel_clone.send(batch) {
                tracing::warn!(error = ?e, "channel send failed -- frontend channel dead");
                break;
            }
        }
    });

    // Run worktree detection once at start per D-09.
    let worktrees = do_list_worktrees(&canonical).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "worktree list failed -- returning empty");
        Vec::new()
    });

    // Store the active watch in state.
    *guard = Some(ActiveWatch {
        watcher_handle: watcher_output.handle,
        snapshot_refresher: refresher,
        attributing_task: attributing,
        forwarder_task: forwarder,
        snapshot,
        channel,
    });

    // The initial_tree from watcher_output is dropped here. Phase 4's radar can
    // request it via a separate command (`get_tree_index`) -- not in Phase 2 scope.
    // For now we log the count for observability.
    tracing::info!(
        initial_tree_files = watcher_output.initial_tree.len(),
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
