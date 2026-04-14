//! Shared helpers for integration tests in src-tauri/tests/.
//!
//! Used by `end_to_end_smoke.rs` (Plan 06-05) to set up tempdir git repos and
//! an in-memory SQLite pool with the Phase 6 schema.

#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;
use tempfile::TempDir;

/// Create a tempdir, run `git init` inside it, return (TempDir, PathBuf).
/// Tests must keep the TempDir in scope to prevent premature cleanup.
pub fn tempdir_git_repo() -> (TempDir, PathBuf) {
    let td = tempfile::tempdir().expect("tempdir");
    let path = td.path().to_path_buf();
    let status = Command::new("git")
        .arg("init")
        .arg(&path)
        .status()
        .expect("git init");
    assert!(status.success(), "git init failed in {path:?}");
    (td, path)
}

/// In-memory SQLite pool with the Phase 6 `agent_sessions` / `session_files`
/// schema. Mirrors the layout used by `pipeline::commands::forwarder_persist_tests`.
pub async fn pool_with_phase6_schema() -> sqlx::SqlitePool {
    use sqlx::sqlite::SqlitePoolOptions;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for stmt in [
        "CREATE TABLE agent_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL, agent_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'idle',
            started_at TEXT NOT NULL, ended_at TEXT,
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
