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
//! This module is a pure type contract in Plan 02-01. The concrete watcher,
//! attributor, and IPC sender are introduced in Plans 02-02..02-04, which is
//! when these types become "used" in the compiler's view. Until then, dead-
//! code warnings are suppressed at the module level.
#![allow(dead_code)]
#![allow(unused_imports)]

pub mod events;
pub mod ignore_filter;
pub mod tree_index;
pub mod watcher;

#[cfg(test)]
pub(crate) mod test_util;

#[cfg(test)]
mod smoke_tests;

pub use events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
