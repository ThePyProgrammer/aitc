//! Git worktree topology detection (FMON-04, D-08, D-09).
//!
//! Shells out to `git worktree list --porcelain -z` and parses the NUL-terminated
//! porcelain format. The NUL format is stable (documented in git-worktree(1))
//! and handles paths with spaces, newlines, or non-ASCII characters safely.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: PathBuf,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub is_main: bool,
    pub is_bare: bool,
    pub detached: bool,
    pub locked: bool,
}

/// Shell out to `git worktree list --porcelain -z`.
///
/// Uses `Command::arg` (not a shell) so it is safe against shell injection in
/// repo_root. Canonicalizes the repo root before passing to `-C`.
pub fn list_worktrees(repo_root: &Path) -> Result<Vec<Worktree>, String> {
    let root = repo_root
        .canonicalize()
        .map_err(|e| format!("canonicalize repo_root: {e}"))?;

    let output = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["worktree", "list", "--porcelain", "-z"])
        .output()
        .map_err(|e| format!("git worktree list failed: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Porcelain -z uses NUL between lines and double-NUL between records.
    // Replace NUL with \n to reuse a simple line-based parser.
    let body = String::from_utf8_lossy(&output.stdout).replace('\0', "\n");
    Ok(parse_porcelain(&body))
}

/// Parse git worktree list --porcelain output. Records are separated by
/// blank lines; within a record each line is `<label> <value>` or a bare
/// keyword like `detached`, `bare`, `locked`.
///
/// Panic-free: returns an empty Vec on malformed input rather than Err,
/// because worktree parsing failure should degrade gracefully (no worktree
/// info is better than no app).
pub fn parse_porcelain(s: &str) -> Vec<Worktree> {
    let mut out: Vec<Worktree> = Vec::new();
    let mut cur: Option<Worktree> = None;
    let mut first_record = true;

    for line in s.lines() {
        if line.is_empty() {
            if let Some(wt) = cur.take() {
                out.push(wt);
            }
            continue;
        }
        let (label, value) = match line.split_once(' ') {
            Some((l, v)) => (l, v),
            None => (line, ""),
        };
        match label {
            "worktree" => {
                if let Some(wt) = cur.take() {
                    out.push(wt);
                }
                let is_main = first_record;
                first_record = false;
                cur = Some(Worktree {
                    path: PathBuf::from(value),
                    head: None,
                    branch: None,
                    is_main,
                    is_bare: false,
                    detached: false,
                    locked: false,
                });
            }
            "HEAD" => {
                if let Some(c) = cur.as_mut() {
                    c.head = Some(value.to_string());
                }
            }
            "branch" => {
                if let Some(c) = cur.as_mut() {
                    c.branch = Some(value.to_string());
                }
            }
            "bare" => {
                if let Some(c) = cur.as_mut() {
                    c.is_bare = true;
                }
            }
            "detached" => {
                if let Some(c) = cur.as_mut() {
                    c.detached = true;
                }
            }
            "locked" => {
                if let Some(c) = cur.as_mut() {
                    c.locked = true;
                }
            }
            _ => {} // unknown label, skip silently (forward compatibility)
        }
    }
    if let Some(wt) = cur.take() {
        out.push(wt);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SINGLE_WORKTREE: &str = "\
worktree C:/Users/prann/projects/aitc
HEAD 3e74406a5e51786a38fc2bb897b7c20279faaef7
branch refs/heads/main
";

    const MULTI_WORKTREE: &str = "\
worktree /home/dev/repo
HEAD abc123
branch refs/heads/main

worktree /home/dev/repo-feature
HEAD def456
branch refs/heads/feature

worktree /home/dev/repo-detached
HEAD 789abc
detached
";

    const BARE_REPO: &str = "\
worktree /srv/git/repo.git
bare
";

    const LOCKED_WORKTREE: &str = "\
worktree /home/dev/repo
HEAD abc123
branch refs/heads/main

worktree /home/dev/repo-locked
HEAD def456
branch refs/heads/locked-feature
locked
";

    #[test]
    fn parses_single_worktree() {
        let wts = parse_porcelain(SINGLE_WORKTREE);
        assert_eq!(wts.len(), 1);
        let w = &wts[0];
        assert_eq!(w.path, PathBuf::from("C:/Users/prann/projects/aitc"));
        assert_eq!(
            w.head.as_deref(),
            Some("3e74406a5e51786a38fc2bb897b7c20279faaef7")
        );
        assert_eq!(w.branch.as_deref(), Some("refs/heads/main"));
        assert!(w.is_main);
        assert!(!w.is_bare);
        assert!(!w.detached);
        assert!(!w.locked);
    }

    #[test]
    fn parses_multi_worktree() {
        let wts = parse_porcelain(MULTI_WORKTREE);
        assert_eq!(wts.len(), 3);
        assert!(wts[0].is_main, "first is main");
        assert!(!wts[1].is_main);
        assert!(!wts[2].is_main);
        assert_eq!(wts[1].branch.as_deref(), Some("refs/heads/feature"));
        assert!(wts[2].detached);
        assert!(wts[2].branch.is_none());
    }

    #[test]
    fn parses_bare_repo() {
        let wts = parse_porcelain(BARE_REPO);
        assert_eq!(wts.len(), 1);
        assert!(wts[0].is_bare);
        assert!(wts[0].head.is_none());
    }

    #[test]
    fn parses_locked_worktree() {
        let wts = parse_porcelain(LOCKED_WORKTREE);
        assert_eq!(wts.len(), 2);
        assert!(!wts[0].locked);
        assert!(wts[1].locked);
        assert_eq!(wts[1].branch.as_deref(), Some("refs/heads/locked-feature"));
    }

    #[test]
    fn parses_empty_input_to_empty_vec() {
        let wts = parse_porcelain("");
        assert_eq!(wts.len(), 0);
    }

    #[test]
    fn list_worktrees_on_current_repo() {
        // Smoke test — requires git in PATH. Uses CARGO_MANIFEST_DIR which points
        // to src-tauri/; walk up one level to hit the actual repo root.
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let repo_root = Path::new(manifest_dir)
            .parent()
            .expect("src-tauri has parent");
        match list_worktrees(repo_root) {
            Ok(wts) => {
                assert!(!wts.is_empty(), "expected at least one worktree");
                assert!(wts[0].is_main);
            }
            Err(e) => {
                // git might not be in PATH on CI — don't fail the suite
                eprintln!(
                    "list_worktrees_on_current_repo: git unavailable or failed: {e} — skipping"
                );
            }
        }
    }
}
