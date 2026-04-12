//! Repo session resolution for Phase 6.
//!
//! TODO(plan-02): Implement capture_launch_cwd, get_launch_cwd, detect_git_root,
//! persist_last_repo, get_last_repo per 06-RESEARCH.md Pattern 1 and Example 2.

use std::path::PathBuf;
use std::sync::OnceLock;

static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

#[allow(dead_code)]
pub fn capture_launch_cwd() {
    let _ = LAUNCH_CWD.set(std::env::current_dir().ok());
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "Wave 0 stub - implemented in Plan 02"]
    fn detect_git_root_for_self_repo() {
        panic!("TODO(plan-02): implement detect_git_root test");
    }

    #[test]
    #[ignore = "Wave 0 stub - implemented in Plan 02"]
    fn persist_and_get_roundtrip() {
        panic!("TODO(plan-02): implement persist_last_repo + get_last_repo roundtrip test");
    }

    // Named test group for VALIDATION.md: `cd src-tauri && cargo test --lib repo_resolution`
    #[test]
    #[ignore = "Wave 0 stub"]
    fn repo_resolution_placeholder() {
        panic!("TODO(plan-02)");
    }
}
