//! Per-language import resolution (D-09). Plan 02 implements; this file declares
//! the public surface only.
use std::path::{Path, PathBuf};

/// STUB — Plan 02 implements per-language resolution.
pub fn resolve_import(
    _spec: &str,
    _from_file: &Path,
    _repo_root: &Path,
) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_stub_returns_none() {
        assert!(resolve_import("./foo", Path::new("/tmp/a.ts"), Path::new("/tmp")).is_none());
    }
}
