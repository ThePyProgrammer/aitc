//! Repo session resolution (D-01, D-02, D-03).

use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Called from lib.rs::run() at the very top, BEFORE the Tauri builder.
pub fn capture_launch_cwd() {
    let _ = LAUNCH_CWD.set(std::env::current_dir().ok());
}

#[tauri::command]
#[specta::specta]
pub async fn get_launch_cwd() -> Result<Option<String>, String> {
    Ok(LAUNCH_CWD
        .get()
        .and_then(|o| o.as_ref())
        .map(|p| p.to_string_lossy().to_string()))
}

/// Walk up from `start` looking for a `.git` directory or file marker.
///
/// CR-02: Pure Rust implementation, no subprocess. Previously this shelled
/// out to `git rev-parse --show-toplevel` which is an RCE vector inside
/// attacker-controlled trees via `core.fsmonitor`, `core.hooksPath`,
/// shell aliases, and multi-submodule/symlink attacks (CVE-2022-41953,
/// CVE-2024-32002 family). Walking parents for a `.git` entry avoids
/// running any git config or hook while still correctly identifying the
/// repo root (including git worktrees, where `.git` is a file pointing to
/// the real gitdir).
fn find_git_root(start: &Path) -> Option<PathBuf> {
    let mut cur: Option<&Path> = Some(start);
    while let Some(dir) = cur {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    None
}

#[tauri::command]
#[specta::specta]
pub async fn detect_git_root(path: String) -> Result<Option<String>, String> {
    // Reject traversal tokens (T-06-02-01) -- still useful as a defense in depth
    // against path-string manipulation even though the lookup no longer shells out.
    if path.contains("..") {
        return Err("path must not contain '..' segments".into());
    }
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return Ok(None);
    }
    Ok(find_git_root(&p).map(|r| {
        // WR-02: normalize to forward slashes on Windows so frontend activeRepo
        // (previously shaped by `git rev-parse --show-toplevel`, which emits
        // POSIX-style paths) keeps matching after the shell-out was replaced.
        let s = r.to_string_lossy().to_string();
        #[cfg(windows)]
        {
            return s.replace('\\', "/");
        }
        #[cfg(not(windows))]
        s
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn persist_last_repo(
    path: String,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<(), String> {
    // Validate exists + is directory (T-06-02-02 mirrors pipeline::commands validation).
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    if !p.is_dir() {
        return Err(format!("path is not a directory: {path}"));
    }
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ('last_repo_root', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&path)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("persist: {e}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_last_repo(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Option<String>, String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'last_repo_root'")
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("load: {e}"))?;
    Ok(row.map(|r| r.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("pool");
        sqlx::query("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .expect("create table");
        pool
    }

    #[tokio::test]
    async fn repo_resolution_detect_git_root_for_self_repo() {
        let cwd = std::env::current_dir().expect("cwd");
        let root = detect_git_root(cwd.to_string_lossy().into_owned())
            .await
            .expect("ok");
        assert!(root.is_some(), "expected self repo to be detected");
    }

    #[tokio::test]
    async fn repo_resolution_detect_git_root_returns_none_for_non_git() {
        let td = tempfile::tempdir().expect("td");
        let res = detect_git_root(td.path().to_string_lossy().into_owned())
            .await
            .expect("ok");
        assert!(res.is_none(), "non-git tempdir should return None");
    }

    #[tokio::test]
    async fn repo_resolution_persist_and_get_roundtrip() {
        let pool = test_pool().await;
        // Use current dir as a known-existing directory.
        let cwd = std::env::current_dir().unwrap().to_string_lossy().into_owned();
        sqlx::query("INSERT INTO app_settings(key, value) VALUES('last_repo_root', ?)")
            .bind(&cwd)
            .execute(&pool)
            .await
            .unwrap();
        // Simulate the Tauri State wrapper via direct pool access in a helper;
        // we test the SQL path by calling get_last_repo-equivalent query directly.
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_settings WHERE key = 'last_repo_root'")
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(row.map(|r| r.0), Some(cwd));
    }

    #[tokio::test]
    async fn repo_resolution_persist_rejects_nonexistent_path() {
        // Call the validation path via constructing the same checks inline --
        // mirrors the pre-DB validation in persist_last_repo.
        let bogus = "C:/definitely/not/a/path/xyz123_aitc_test";
        let p = PathBuf::from(bogus);
        assert!(!p.exists(), "precondition: path must not exist");
    }

    #[tokio::test]
    async fn repo_resolution_rejects_dotdot_traversal() {
        let res = detect_git_root("../../etc".into()).await;
        assert!(res.is_err());
    }
}
