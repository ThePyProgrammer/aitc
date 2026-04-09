//! Test helpers shared across pipeline module tests.

#![cfg(test)]

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::TempDir;

use crate::pipeline::events::FileEventBatch;

/// Create a temporary directory that looks like a repo: has .git/, src/, README.md.
pub fn make_temp_repo() -> TempDir {
    let tmp = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(tmp.path().join(".git")).unwrap();
    fs::write(tmp.path().join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::create_dir_all(tmp.path().join("src")).unwrap();
    fs::write(tmp.path().join("README.md"), "# test repo\n").unwrap();
    tmp
}

/// Write a file at repo_root/rel_path, creating parent dirs as needed.
pub fn write_file(repo_root: &std::path::Path, rel_path: &str, content: &str) -> PathBuf {
    let p = repo_root.join(rel_path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&p, content).unwrap();
    p
}

/// Wait up to `timeout` for the next FileEventBatch from the receiver. Returns None on timeout.
pub async fn wait_for_batch(
    rx: &mut tokio::sync::mpsc::Receiver<FileEventBatch>,
    timeout: Duration,
) -> Option<FileEventBatch> {
    let deadline = Instant::now() + timeout;
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return None;
    }
    match tokio::time::timeout(remaining, rx.recv()).await {
        Ok(Some(batch)) => Some(batch),
        Ok(None) => None, // channel closed
        Err(_) => None,   // timeout
    }
}
