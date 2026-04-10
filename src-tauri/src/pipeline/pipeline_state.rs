//! Tauri-managed state for the pipeline: holds the active watch (or None if
//! not watching), owns all four JoinHandles, and cleans up on drop.

use crate::pipeline::events::FileEventBatch;
use crate::pipeline::process_snapshot::ProcessSnapshot;
use crate::pipeline::watcher::WatcherHandle;
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
    /// Shared snapshot used by attributing_task + refresher.
    pub snapshot: Arc<RwLock<ProcessSnapshot>>,
    /// Channel to the frontend -- cloned into the forwarder. Held here so the
    /// watcher can be stopped without losing the reference to the consumer.
    pub channel: tauri::ipc::Channel<FileEventBatch>,
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
    }
}
