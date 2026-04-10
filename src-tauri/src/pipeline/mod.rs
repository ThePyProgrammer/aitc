//! Phase 2: Real-Time Data Pipeline
//!
//! Sensing layer: filesystem watcher (notify + notify-debouncer-full), process
//! attribution (sysinfo), worktree topology (git CLI), and streaming to the
//! frontend via tauri::ipc::Channel<FileEventBatch>.
//!
//! See: .planning/phases/02-real-time-data-pipeline/02-RESEARCH.md
//!
//! # Wave 0 scaffolding note
//!
//! This module started as a pure type contract in Plan 02-01. The concrete
//! watcher, attributor, and IPC sender were introduced in Plans 02-02..02-04.
//! Module-level dead_code/unused_imports suppressions have been removed now
//! that all plans are implemented.

pub mod commands;
pub mod events;
pub mod ignore_filter;
pub mod pipeline_state;
pub mod process_snapshot;
pub mod tree_index;
pub mod watcher;
pub mod worktree;

#[cfg(test)]
pub(crate) mod test_util;

#[cfg(test)]
mod smoke_tests;

pub use events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
pub use pipeline_state::{ActiveWatch, PipelineState};
pub use process_snapshot::{
    spawn_snapshot_refresher, start_attributing_stream, ProcessInfo, ProcessSnapshot,
    AGENT_NAME_ALLOWLIST,
};
pub use worktree::{list_worktrees, Worktree};
