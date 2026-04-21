//! Tauri-managed state for the pipeline: holds the active watch (or None if
//! not watching), owns all four JoinHandles, and cleans up on drop.

use crate::pipeline::events::FileEventBatch;
use crate::pipeline::process_snapshot::ProcessSnapshot;
use crate::pipeline::tree_index::FileNode;
use crate::pipeline::watcher::WatcherHandle;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// Exactly one concurrent watch per app (Phase 2 scope). Multiple repos
/// would need a HashMap keyed by repo_root -- deferred to Phase 3.
pub struct ActiveWatch {
    /// Keeps the debouncer alive; dropping this stops the filesystem watcher.
    pub watcher_handle: WatcherHandle,
    /// Periodic sysinfo refresh task; aborted on stop_watch.
    pub snapshot_refresher: tokio::task::JoinHandle<()>,
    /// Rewrites Attribution in each batch in-flight.
    pub attributing_task: tokio::task::JoinHandle<()>,
    /// Forwards attributed batches onto the Channel<FileEventBatch>.
    pub forwarder_task: tokio::task::JoinHandle<()>,
    /// Conflict engine task: processes batches via broadcast, emits Tauri events.
    pub conflict_task: tokio::task::JoinHandle<()>,
    /// Passive-scan bridge (AGNT-03): PASSIVE-{pid} upserts + reaps; aborted on stop_watch.
    pub bridge_task: tokio::task::JoinHandle<()>,
    /// Protected path trigger task: checks writes against protected globs (D-07).
    pub protected_path_handle: Option<tokio::task::JoinHandle<()>>,
    /// Shared snapshot used by attributing_task + refresher.
    pub snapshot: Arc<RwLock<ProcessSnapshot>>,
    /// Channel to the frontend -- cloned into the forwarder. Held here so the
    /// watcher can be stopped without losing the reference to the consumer.
    pub channel: tauri::ipc::Channel<FileEventBatch>,
    /// In-memory file tree index for Phase 4 radar spatial map. Keys are
    /// absolute canonical paths (needed for filesystem-event reconciliation);
    /// the `get_tree_index` command strips `repo_root` before handing them
    /// to the frontend so the treemap sees repo-relative paths.
    pub tree_index: HashMap<PathBuf, FileNode>,
    /// Canonical, UNC-stripped root of the watched repo. Used to convert
    /// tree_index keys into repo-relative paths for the radar spatial map
    /// and to keep the frontend tree from growing an O(depth) chain of
    /// single-child wrappers representing the filesystem prefix.
    pub repo_root: PathBuf,
}

pub struct PipelineState {
    pub inner: Mutex<Option<ActiveWatch>>,
}

impl PipelineState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

impl Default for PipelineState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ActiveWatch {
    fn drop(&mut self) {
        // Abort background tasks. The debouncer drops naturally via WatcherHandle.
        self.snapshot_refresher.abort();
        self.attributing_task.abort();
        self.forwarder_task.abort();
        self.conflict_task.abort();
        self.bridge_task.abort();
        if let Some(handle) = self.protected_path_handle.take() {
            handle.abort();
        }
    }
}
