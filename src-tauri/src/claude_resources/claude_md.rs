//! Phase 9 Plan 03 — atomic CLAUDE.md editor helper.
//!
//! Provides an atomic-write path for the two D-13 editable CLAUDE.md
//! locations (`<cwd>/CLAUDE.md` and `<cwd>/.claude/CLAUDE.md`). The
//! global `~/.claude/CLAUDE.md` is intentionally NOT editable this phase —
//! `editable_paths` never returns it, and `is_editable` returns false for
//! any path outside the two project-scoped locations.
//!
//! Atomic writes use `tempfile::NamedTempFile::persist`, which maps to
//! `ReplaceFile` on Windows and `rename(2)` on Unix — both guaranteed
//! atomic at the kernel boundary. This prevents readers (the frontend
//! polling the file, editors mounted on `path`) from observing a partial
//! write.

#![allow(dead_code)]

use std::io::Write;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;

/// Return the D-13 whitelist of editable CLAUDE.md paths for the given
/// project root. `~/.claude/CLAUDE.md` is intentionally absent — global
/// CLAUDE.md is read-only this phase.
pub fn editable_paths(project_root: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::with_capacity(2);
    if let Some(p) = project_root {
        out.push(p.join("CLAUDE.md"));
        out.push(p.join(".claude").join("CLAUDE.md"));
    }
    out
}

/// Return true iff `path` (expected to be canonicalized by the caller) is
/// one of the two editable paths for the given project root.
pub fn is_editable(path: &Path, project_root: Option<&Path>) -> bool {
    editable_paths(project_root).iter().any(|p| p == path)
}

/// Atomically replace the contents of `path` with `content`.
///
/// Uses `tempfile::NamedTempFile::persist`, which maps to `ReplaceFile` on
/// Windows and `rename(2)` on Unix — both atomic at the kernel boundary.
/// The temp file is created in `path`'s parent directory so `persist` does
/// a same-filesystem rename (cross-device renames would silently fall back
/// to a non-atomic copy + unlink).
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    let mut tmp = NamedTempFile::new_in(parent).map_err(|e| format!("tempfile: {e}"))?;
    tmp.write_all(content.as_bytes())
        .map_err(|e| format!("write_all: {e}"))?;
    tmp.flush().map_err(|e| format!("flush: {e}"))?;
    tmp.persist(path)
        .map_err(|e| format!("persist: {}", e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn atomic_write_persists_content() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("CLAUDE.md");
        atomic_write(&path, "hello").expect("write");
        let back = fs::read_to_string(&path).unwrap();
        assert_eq!(back, "hello");
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("CLAUDE.md");
        fs::write(&path, "old").unwrap();
        atomic_write(&path, "new").expect("write");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn atomic_write_leaves_no_temp_files() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("CLAUDE.md");
        atomic_write(&path, "x").expect("write");
        let entries: Vec<String> = fs::read_dir(tmp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["CLAUDE.md".to_string()], "unexpected siblings: {entries:?}");
    }

    #[test]
    fn editable_paths_only_contains_cwd_variants() {
        let proj = PathBuf::from("/proj");
        let paths = editable_paths(Some(&proj));
        assert_eq!(
            paths,
            vec![
                PathBuf::from("/proj/CLAUDE.md"),
                PathBuf::from("/proj/.claude/CLAUDE.md"),
            ]
        );
    }

    #[test]
    fn editable_paths_without_project_is_empty() {
        let paths = editable_paths(None);
        assert!(paths.is_empty(), "{paths:?}");
    }

    #[test]
    fn is_editable_accepts_whitelisted_paths() {
        let proj = PathBuf::from("/proj");
        assert!(is_editable(&proj.join("CLAUDE.md"), Some(&proj)));
        assert!(is_editable(&proj.join(".claude/CLAUDE.md"), Some(&proj)));
    }

    #[test]
    fn is_editable_rejects_global_and_other_paths() {
        let proj = PathBuf::from("/proj");
        // ~/.claude/CLAUDE.md must NOT be editable (D-13).
        assert!(!is_editable(Path::new("/home/u/.claude/CLAUDE.md"), Some(&proj)));
        assert!(!is_editable(Path::new("/etc/passwd"), Some(&proj)));
    }
}
