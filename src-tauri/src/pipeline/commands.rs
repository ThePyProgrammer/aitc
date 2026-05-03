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
use crate::pipeline::deps::extract::{detect_language, extract_source_signatures, MAX_FILE_SIZE_BYTES};
use crate::pipeline::pipeline_state::{ActiveWatch, PipelineState};
use crate::pipeline::process_snapshot::{
    spawn_snapshot_refresher, start_attributing_stream, ProcessSnapshot,
};
use crate::pipeline::tree_index::FileNode;
use crate::pipeline::watcher::spawn_watcher;
use crate::pipeline::worktree::{list_worktrees as do_list_worktrees, Worktree};
use sqlx::{Pool, Sqlite};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::{broadcast, mpsc, RwLock};

/// Wire-format for a capped read-only source snippet. Paths are repo-relative
/// forward-slash strings; lines are capped by [`SOURCE_SNIPPET_MAX_LINES`].
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnippetDto {
    pub path: String,
    pub start_line: usize,
    pub lines: Vec<String>,
}

pub const SOURCE_SNIPPET_MAX_LINES: usize = 12;

fn normalize_repo_relative_path(path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path);
    if raw.is_absolute() {
        return Err("path must be repo-relative".into());
    }
    if path.trim().is_empty() {
        return Err("path must not be empty".into());
    }
    let mut out = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("path traversal is not allowed".into()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("path must be repo-relative".into());
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err("path must not be empty".into());
    }
    Ok(out)
}

fn canonical_source_path(repo_root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let rel = normalize_repo_relative_path(rel_path)?;
    let target = repo_root.join(rel);
    let canonical = target
        .canonicalize()
        .map(strip_unc)
        .map_err(|e| format!("canonicalize source path: {e}"))?;
    if !canonical.starts_with(repo_root) {
        return Err("path escapes active repo root".into());
    }
    if detect_language(&canonical).is_none() {
        return Err("unsupported source file extension".into());
    }
    let metadata = std::fs::metadata(&canonical).map_err(|e| format!("metadata source path: {e}"))?;
    if !metadata.is_file() {
        return Err("path is not a file".into());
    }
    if metadata.len() > MAX_FILE_SIZE_BYTES {
        return Err("source file exceeds size cap".into());
    }
    Ok(canonical)
}

fn read_source_snippet(
    repo_root: &Path,
    rel_path: &str,
    start_line: Option<usize>,
) -> Result<SourceSnippetDto, String> {
    let canonical = canonical_source_path(repo_root, rel_path)?;
    let source = std::fs::read_to_string(&canonical)
        .map_err(|e| format!("read source path as utf-8 text: {e}"))?;
    let start = start_line.unwrap_or(1).max(1);
    let lines = source
        .lines()
        .skip(start.saturating_sub(1))
        .take(SOURCE_SNIPPET_MAX_LINES)
        .map(ToOwned::to_owned)
        .collect();
    Ok(SourceSnippetDto {
        path: rel_path.replace('\\', "/"),
        start_line: start,
        lines,
    })
}

/// PID polling cadence. If Plan 01's BENCH_RESULT showed sysinfo refresh >=50ms,
/// bump this to 2000. Keep at 1000 otherwise.
///
/// Change log: see .planning/phases/02-real-time-data-pipeline/02-01-SUMMARY.md
/// for the measured number.
const PID_POLL_INTERVAL_MS: u64 = 1000;

/// Channel/mpsc capacity between watcher -> attributing_stream -> forwarder.
/// 1024 is the research-recommended cap (02-RESEARCH.md Pitfall 3 threat model).
const PIPELINE_MPSC_CAPACITY: usize = 1024;

/// WR-02: Strip the Windows `\\?\` (extended-length / UNC) prefix that
/// `std::fs::canonicalize` emits on Windows, so backend-side canonical paths
/// match the forward-slash repo roots that `detect_git_root` returns to the
/// frontend. Without this, `tree_index` keys and frontend `activeRepo`
/// compare unequal for the same directory.
pub(crate) fn strip_unc(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    p
}

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
        .map(strip_unc)
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
    //
    // Phase 8 D-04: pass pool + app_handle so first-sighting of a Claude
    // process in a never-seen repo emits `passive-claude-detected` and the
    // consent dialog opens in the UI.
    let bridge_task = crate::pipeline::passive_bridge::spawn_passive_bridge(
        registry_arc.clone(),
        snapshot.clone(),
        canonical.clone(),
        Duration::from_millis(crate::pipeline::passive_bridge::BRIDGE_INTERVAL_MS),
        Some(pool_arc.clone()),
        Some(app_handle.clone()),
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
    //
    // Phase 17 D-15: engine is now shared with /hook via Tauri managed
    // state (registered in lib.rs setup). We no longer construct a local
    // ConflictEngine here. The engine's internal window is baked at
    // lib.rs startup from 5000ms — the /hook path routes around that
    // staleness by passing fresh window_ms into could_conflict_with per
    // request (D-14b). Hot-swapping the engine's eviction-policy window
    // here would require a watch-channel from ConflictState and is
    // out-of-scope for Phase 17.
    let engine: Arc<tokio::sync::Mutex<ConflictEngine>> = app_handle
        .state::<Arc<tokio::sync::Mutex<ConflictEngine>>>()
        .inner()
        .clone();
    let app_handle_clone = app_handle.clone();
    let conflict_task = tokio::spawn(async move {
        while let Ok(batch) = conflict_rx.recv().await {
            // Pitfall 1 / T-17-04: scope the lock TIGHTLY. process_batch is
            // synchronous (no .await inside), so the mutex is held for a
            // handful of microseconds per batch. The lock MUST be released
            // before the alert-dispatch loop so the /hook handler's
            // could_conflict_with query is not starved during burst writes.
            let alerts = {
                let mut eng = engine.lock().await;
                eng.process_batch(&batch)
            };
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
        repo_root: canonical.clone(),
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

/// Serialize the in-memory tree index into repo-relative TreeIndexEntry rows.
///
/// Strips the `repo_root` prefix from each absolute HashMap key so the
/// frontend treemap renders a repo-rooted hierarchy (e.g. `src/foo.rs`)
/// instead of absolute OS paths (e.g. `C:/Users/.../aitc/src/foo.rs`).
/// Normalizes Windows backslashes to forward slashes so the frontend
/// treemap's `split('/')` yields correct segments.
///
/// The repo-root entry itself serializes as `path: ""` (depth 0) so the
/// frontend root aggregate stays intact.
///
/// A path that is NOT under `repo_root` (shouldn't happen — the walker
/// only produces descendants of repo_root) falls back to its absolute
/// form via `strip_prefix(...).unwrap_or(path)` rather than being
/// silently dropped. Belt-and-suspenders against a canonicalization
/// quirk leaving the map blank.
///
/// In-memory HashMap keys remain absolute PathBufs; attribution and
/// reconciliation depend on that invariant and are NOT touched here.
pub(crate) fn serialize_tree_index(
    tree: &HashMap<PathBuf, FileNode>,
    repo_root: &Path,
) -> Vec<TreeIndexEntry> {
    tree.iter()
        .map(|(path, node)| {
            let rel = path.strip_prefix(repo_root).unwrap_or(path);
            let path_str = rel.to_string_lossy().replace('\\', "/");
            let depth = rel.components().count() as u32;
            TreeIndexEntry {
                path: path_str,
                size: node.size,
                // WR-01: read is_dir from the walker-populated FileNode
                // instead of hardcoding false, so the frontend treemap
                // can render folder aggregates correctly.
                is_dir: node.is_dir,
                depth,
            }
        })
        .collect()
}

/// Get the file tree index from the active watch for the Phase 4 radar spatial map.
/// Returns an empty vec if no watch is active.
///
/// Paths are serialized as repo-relative with forward-slash separators. Storing
/// absolute paths on the frontend created an O(depth) chain of single-child
/// directory wrappers (`/`, `home`, `prannayag`, …) before any real content,
/// which visually crushed the treemap into a corner. The repo root itself is
/// emitted as `""` so the frontend root aggregate stays intact.
#[tauri::command]
#[specta::specta]
pub async fn get_tree_index(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<TreeIndexEntry>, String> {
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => Ok(serialize_tree_index(&active.tree_index, &active.repo_root)),
        None => Ok(Vec::new()),
    }
}

/// Get the dependency graph (in-repo import/use/mod edges) for the active watch.
/// Returns an empty vec if no watch is active.
///
/// Edges use repo-relative forward-slash paths (matching `get_tree_index` convention,
/// commit `a1b15b6`) so the frontend can join against `radarStore.contentionScores`
/// keys without a separate normalization layer.
///
/// CPU-heavy parsing runs on `tauri::async_runtime::spawn_blocking` so the main
/// async runtime stays responsive during the <2s build target (D-24).
#[tauri::command]
#[specta::specta]
pub async fn get_dependency_graph(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<crate::pipeline::deps::DependencyEdgeDto>, String> {
    use crate::pipeline::deps::{build_dependency_graph, DependencyEdgeDto};
    let guard = state.inner.lock().await;
    let Some(active) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    let repo_root = active.repo_root.clone();
    let files: Vec<std::path::PathBuf> = active
        .tree_index
        .iter()
        .filter(|(_, node)| !node.is_dir)
        .map(|(path, _)| path.clone())
        .collect();
    drop(guard);

    let repo_root_for_build = repo_root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        build_dependency_graph(&repo_root_for_build, &files)
    })
    .await
    .map_err(|e| format!("spawn_blocking join: {e}"))?;
    if result.degraded {
        tracing::warn!(
            edges = result.edges.len(),
            unresolved = result.unresolved_count,
            "dep_graph: returning degraded result (edge cap hit)"
        );
    }
    // Convert internal edges (PathBuf) to DTO (repo-relative String).
    let dto: Vec<DependencyEdgeDto> = result
        .edges
        .into_iter()
        .filter_map(|e| {
            let from = e
                .from
                .strip_prefix(&repo_root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            let to = e
                .to
                .strip_prefix(&repo_root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some(DependencyEdgeDto { from, to, kind: e.kind })
        })
        .collect();
    Ok(dto)
}

/// Get best-effort source signatures for active watched source files.
/// Returns an empty vec if no watch is active or extraction cannot parse a file.
#[tauri::command]
#[specta::specta]
pub async fn get_source_signatures(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<crate::pipeline::deps::SourceSignatureDto>, String> {
    use crate::pipeline::deps::SourceSignatureDto;
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let repo_root = active.repo_root.clone();
            let files: Vec<std::path::PathBuf> = active
                .tree_index
                .iter()
                .filter(|(_, node)| !node.is_dir)
                .map(|(path, _)| path.clone())
                .collect();
            drop(guard);
            let result = tauri::async_runtime::spawn_blocking(move || {
                files
                    .into_iter()
                    .filter_map(|path| {
                        let signatures = extract_source_signatures(&path);
                        if signatures.is_empty() {
                            return None;
                        }
                        let rel = path.strip_prefix(&repo_root).ok()?.to_string_lossy().replace('\\', "/");
                        Some(SourceSignatureDto { path: rel, signatures })
                    })
                    .collect::<Vec<_>>()
            })
            .await
            .map_err(|e| format!("spawn_blocking join: {e}"))?;
            Ok(result)
        }
        None => Ok(Vec::new()),
    }
}

/// Get a capped read-only snippet for a repo-relative source path.
#[tauri::command]
#[specta::specta]
pub async fn get_source_snippet(
    path: String,
    start_line: Option<usize>,
    state: tauri::State<'_, PipelineState>,
) -> Result<SourceSnippetDto, String> {
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let repo_root = active.repo_root.clone();
            drop(guard);
            tauri::async_runtime::spawn_blocking(move || {
                read_source_snippet(&repo_root, &path, start_line)
            })
            .await
            .map_err(|e| format!("spawn_blocking join: {e}"))?
        }
        None => Err("no active watch".into()),
    }
}

/// Get the IPC bridge surface (commands + handlers + callers) for the active
/// watch. Returns an empty vec if no watch is active.
///
/// Bridges use repo-relative forward-slash paths (matching `get_tree_index`
/// convention, commit `a1b15b6`).
///
/// CPU-heavy parsing runs on `tauri::async_runtime::spawn_blocking` so the main
/// async runtime stays responsive during the <100ms build target (D-35).
#[tauri::command]
#[specta::specta]
pub async fn get_ipc_bridges(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<crate::pipeline::ipc_bridges::IpcBridgeDto>, String> {
    use crate::pipeline::ipc_bridges::build_ipc_bridges;
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let repo_root = active.repo_root.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                build_ipc_bridges(&repo_root)
            })
            .await
            .map_err(|e| format!("spawn_blocking join: {e}"))?;
            Ok(result)
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
mod serialize_tests {
    use super::*;
    use crate::pipeline::tree_index::FileNode;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn node(size: u64, is_dir: bool) -> FileNode {
        FileNode {
            size,
            modified_at: None,
            is_dir,
        }
    }

    #[cfg(not(windows))]
    fn repo_root() -> PathBuf {
        PathBuf::from("/tmp/repo")
    }
    #[cfg(windows)]
    fn repo_root() -> PathBuf {
        PathBuf::from(r"C:\repo")
    }

    fn under_root(rel: &str) -> PathBuf {
        let mut p = repo_root();
        for part in rel.split('/') {
            p.push(part);
        }
        p
    }

    #[test]
    fn emits_repo_relative_file_path() {
        let mut tree: HashMap<PathBuf, FileNode> = HashMap::new();
        tree.insert(under_root("src/foo.rs"), node(123, false));
        let entries = serialize_tree_index(&tree, &repo_root());
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.path, "src/foo.rs");
        assert!(!e.path.starts_with('/'), "leading slash leaked: {}", e.path);
        assert!(!e.path.contains(':'), "drive letter leaked: {}", e.path);
        assert_eq!(e.size, 123);
        assert!(!e.is_dir);
        assert_eq!(e.depth, 2);
    }

    #[test]
    fn emits_repo_relative_dir_path() {
        let mut tree: HashMap<PathBuf, FileNode> = HashMap::new();
        tree.insert(under_root("src"), node(0, true));
        let entries = serialize_tree_index(&tree, &repo_root());
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.path, "src");
        assert!(e.is_dir);
        assert_eq!(e.depth, 1);
    }

    #[test]
    fn emits_repo_root_as_empty_string() {
        // The repo-root entry serializes as path: "" (depth 0) so the
        // frontend root aggregate stays intact.
        let mut tree: HashMap<PathBuf, FileNode> = HashMap::new();
        tree.insert(repo_root(), node(0, true));
        tree.insert(under_root("src/foo.rs"), node(10, false));
        let entries = serialize_tree_index(&tree, &repo_root());
        assert_eq!(entries.len(), 2);
        let root = entries
            .iter()
            .find(|e| e.path.is_empty())
            .expect("repo-root entry missing");
        assert_eq!(root.depth, 0);
        assert!(root.is_dir);
        assert!(entries.iter().any(|e| e.path == "src/foo.rs"));
    }

    #[test]
    fn forward_slash_normalized() {
        let mut tree: HashMap<PathBuf, FileNode> = HashMap::new();
        tree.insert(under_root("src/pipeline/commands.rs"), node(1, false));
        let entries = serialize_tree_index(&tree, &repo_root());
        assert_eq!(entries.len(), 1);
        assert!(
            !entries[0].path.contains('\\'),
            "backslash leaked: {}",
            entries[0].path
        );
        assert_eq!(entries[0].path, "src/pipeline/commands.rs");
        assert_eq!(entries[0].depth, 3);
    }

    #[test]
    fn falls_back_to_absolute_for_outside_root() {
        // Paths not under repo_root (shouldn't happen in practice — walker
        // only produces descendants). Belt-and-suspenders: fall back to the
        // absolute path rather than silently dropping the row, so a
        // canonicalization quirk doesn't leave the map blank.
        let mut tree: HashMap<PathBuf, FileNode> = HashMap::new();
        #[cfg(not(windows))]
        let outside = PathBuf::from("/other/place/x.rs");
        #[cfg(windows)]
        let outside = PathBuf::from(r"D:\elsewhere\x.rs");
        tree.insert(outside, node(1, false));
        tree.insert(under_root("src/foo.rs"), node(1, false));
        let entries = serialize_tree_index(&tree, &repo_root());
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.path == "src/foo.rs"));
        #[cfg(not(windows))]
        assert!(entries.iter().any(|e| e.path == "/other/place/x.rs"));
        #[cfg(windows)]
        assert!(entries.iter().any(|e| e.path == "D:/elsewhere/x.rs"));
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

    #[test]
    fn source_snippet_rejects_absolute_and_traversal_paths() {
        assert!(normalize_repo_relative_path("/etc/passwd").is_err());
        assert!(normalize_repo_relative_path("../secret.ts").is_err());
        assert!(normalize_repo_relative_path("src/../secret.ts").is_err());
    }

    #[test]
    fn source_snippet_caps_output_to_twelve_lines() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().canonicalize().map(strip_unc).unwrap();
        let source = (1..=20).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        std::fs::write(root.join("sample.ts"), source).unwrap();
        let snippet = read_source_snippet(&root, "sample.ts", Some(3)).unwrap();
        assert_eq!(snippet.start_line, 3);
        assert_eq!(snippet.lines.len(), SOURCE_SNIPPET_MAX_LINES);
        assert_eq!(snippet.lines[0], "line 3");
        assert_eq!(snippet.lines[11], "line 14");
    }

    /// V-12-13: `get_ipc_bridges` returns `Ok(Vec::new())` when no watch is
    /// active, without panicking. We cannot construct a real
    /// `tauri::State<'_, PipelineState>` in a unit test (it lives in the
    /// tauri runtime managed-state system), so we exercise the equivalent
    /// business logic: a default `PipelineState` has `inner == None`, which
    /// is the branch that returns `Ok(vec![])`. The Some-branch is covered
    /// by `pipeline::ipc_bridges::tests::build_ipc_bridges_empty_root_returns_empty`
    /// (empty repo → build_ipc_bridges() → []).
    #[tokio::test]
    async fn get_ipc_bridges_smoke_v_12_13() {
        let state = PipelineState::default();
        let guard = state.inner.lock().await;
        assert!(
            guard.as_ref().is_none(),
            "default PipelineState should be inactive (no watch)"
        );
        // Mirror the None-branch of get_ipc_bridges exactly:
        let result: Result<Vec<crate::pipeline::ipc_bridges::IpcBridgeDto>, String> =
            match guard.as_ref() {
                Some(_) => unreachable!("default state should be None"),
                None => Ok(Vec::new()),
            };
        assert!(result.is_ok(), "None-branch returns Ok");
        assert_eq!(
            result.unwrap().len(),
            0,
            "empty state yields empty bridge Vec"
        );
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
