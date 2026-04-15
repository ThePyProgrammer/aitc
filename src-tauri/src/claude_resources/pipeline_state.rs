//! Phase 9 Plan 03 — Tauri-managed state for the ARSENAL watcher.
//!
//! Mirrors `crate::pipeline::pipeline_state::PipelineState`: an optional
//! `ActiveResourcesWatch` held behind a `Mutex`, plus a clonable
//! `WriteFence` accessible even when no watch is active (so a
//! `write_claude_md` call that races `stop_watch` still records).
//!
//! D-05 invariant: `ActiveResourcesWatch` owns ONE `WatcherHandle`. We do
//! not store a second `Debouncer` here — the handle is the single
//! Debouncer created by `spawn_watcher_multi`.

#![allow(dead_code)]

use std::path::PathBuf;

use tokio::sync::Mutex;

use crate::claude_resources::events::ResourceEventBatch;
use crate::claude_resources::write_fence::WriteFence;
use crate::pipeline::watcher::WatcherHandle;

/// State held while `start_claude_resources_watch` is active.
pub struct ActiveResourcesWatch {
    /// The SINGLE Debouncer handle per D-05. Dropping this stops the
    /// underlying filesystem watcher.
    pub watcher_handle: WatcherHandle,
    /// Informational — used so `write_claude_md` knows which paths count
    /// as editable without re-reading state.
    pub project_root: Option<PathBuf>,
    /// Drains the resources mpsc and forwards batches onto the
    /// `Channel<ResourceEventBatch>`. Aborted on Drop.
    pub forwarder_task: tokio::task::JoinHandle<()>,
    /// Discards pipeline events emitted by the shared Debouncer when
    /// pipeline::start_watch is NOT co-active. Aborted on Drop.
    pub pipeline_drainer_task: tokio::task::JoinHandle<()>,
    /// Frontend sink.
    pub channel: tauri::ipc::Channel<ResourceEventBatch>,
    /// Fence shared with the watcher drain + the `write_claude_md` handler.
    pub fence: WriteFence,
}

impl Drop for ActiveResourcesWatch {
    fn drop(&mut self) {
        self.forwarder_task.abort();
        self.pipeline_drainer_task.abort();
    }
}

/// Managed state registered via `.manage(ClaudeResourcesState::new())`.
pub struct ClaudeResourcesState {
    pub inner: Mutex<Option<ActiveResourcesWatch>>,
    /// Long-lived fence — survives start/stop cycles so a racing write
    /// right after `stop_claude_resources_watch` still records.
    pub fence: WriteFence,
}

impl ClaudeResourcesState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            fence: WriteFence::new(),
        }
    }
}

impl Default for ClaudeResourcesState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_state_has_empty_inner_and_fresh_fence() {
        let s = ClaudeResourcesState::new();
        // Fence is clonable + starts empty.
        let clone = s.fence.clone();
        assert!(!clone.was_ours(std::path::Path::new("/never-recorded")));
    }

    #[tokio::test]
    async fn inner_mutex_starts_empty() {
        let s = ClaudeResourcesState::new();
        let g = s.inner.lock().await;
        assert!(g.is_none());
    }
}
