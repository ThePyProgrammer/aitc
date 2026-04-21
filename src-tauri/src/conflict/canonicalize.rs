//! Phase 17 D-02 + Pitfall 3: shared canonicalization used by both the
//! pipeline write path (FileWriteRecord.path key in `recent_writes`) and
//! the hook query path (ConflictEngine::could_conflict_with input). Using
//! one helper eliminates the HashMap-miss class of bugs where pipeline
//! stores `/repo/foo.rs` (canonical) but hook queries `./foo.rs` (lexical).
//!
//! Behavior:
//!   - If `fs::canonicalize(path)` succeeds → strip UNC prefix on Windows
//!     (inline logic equivalent to `pipeline::commands::strip_unc`) → return.
//!   - If `fs::canonicalize` fails (ENOENT — file does not exist yet; common
//!     for Write on new files + Bash stdout redirects) → return
//!     `path_clean::clean(path)` — pure lexical normalization of `.`/`..`/
//!     double-separator. NO case folding (D-02 locks this).
//!
//! Mitigates T-17-05 (canonicalization mismatch): by construction both the
//! pipeline-side record key and the hook-side query key flow through this
//! single function, so a HashMap lookup cannot miss due to form drift.

use std::path::{Path, PathBuf};

/// Canonicalize `path` into the exact PathBuf used as a HashMap key in
/// `ConflictEngine::recent_writes`. If `path` exists on disk, delegates to
/// `std::fs::canonicalize` (with Windows UNC prefix stripped). If it does
/// not exist, falls back to `path_clean::clean` (pure lexical
/// normalization — NO case folding, NO filesystem access).
pub fn canonicalize_for_conflict(path: &Path) -> PathBuf {
    match std::fs::canonicalize(path) {
        Ok(abs) => strip_unc_local(abs),
        Err(_) => path_clean::clean(path),
    }
}

/// Inline clone of pipeline::commands::strip_unc — Windows UNC prefix
/// stripper. On non-Windows this is identity. Inlined rather than
/// reaching up into `pipeline::commands` to avoid an upward dependency
/// from `conflict/` to `pipeline/`.
fn strip_unc_local(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalize_existing_file() {
        // Cargo.toml is a stable real file at the crate root used as an
        // existing-file smoke. fs::canonicalize always returns an absolute
        // path, so success-branch output must be absolute + end with
        // "Cargo.toml".
        let result = canonicalize_for_conflict(Path::new("Cargo.toml"));
        assert!(result.is_absolute(), "expected absolute, got {result:?}");
        assert!(result.ends_with("Cargo.toml"));
    }

    #[test]
    fn canonicalize_nonexistent_file_lexical_fallback() {
        // path_clean resolves `..` lexically, never touches the filesystem.
        let input = Path::new("/definitely/does/not/../exist/foo.rs");
        let result = canonicalize_for_conflict(input);
        assert_eq!(result, PathBuf::from("/definitely/does/exist/foo.rs"));
    }

    #[test]
    fn canonicalize_lexical_resolves_dot() {
        let result = canonicalize_for_conflict(Path::new("/tmp/./foo.rs"));
        assert_eq!(result, PathBuf::from("/tmp/foo.rs"));
    }

    #[test]
    fn canonicalize_lexical_preserves_case() {
        // D-02: NO case folding. Auth.rs and auth.rs must stay distinct
        // so macOS case-insensitive filesystems don't silently collapse
        // two agents' writes into a false-match HashMap key.
        let a = canonicalize_for_conflict(Path::new("/nonexistent/Auth.rs"));
        let b = canonicalize_for_conflict(Path::new("/nonexistent/auth.rs"));
        assert_ne!(a, b);
    }
}
