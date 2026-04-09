//! Gitignore-respecting walker with hardcoded excludes per D-10 and Pitfall 6.
//!
//! Hardcoded excludes (layered on .gitignore): .git, node_modules, target,
//! build, dist, .next, out

use ignore::{overrides::OverrideBuilder, WalkBuilder};
use std::path::Path;

/// Hardcoded directory names excluded regardless of .gitignore contents.
/// Rationale (02-RESEARCH.md Pitfall 6): walking node_modules/ with 50k files
/// adds seconds of startup latency and fills the tree index with noise.
pub const HARDCODED_EXCLUDES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "build",
    "dist",
    ".next",
    "out",
];

/// Construct a WalkBuilder that:
/// - respects `.gitignore`, `.ignore`, `.git/info/exclude`, and global gitignore
/// - additionally excludes HARDCODED_EXCLUDES directories
/// - skips hidden files by default (matches D-10 intent of repo-relevant files only)
/// - follows a single-threaded walk (parallel has overhead for <10k files — escalate later if benchmarks need it)
pub fn build_walker(root: &Path) -> WalkBuilder {
    let mut overrides = OverrideBuilder::new(root);
    for excluded in HARDCODED_EXCLUDES {
        // `!pattern` in gitignore-speak means "exclude this". OverrideBuilder
        // uses gitignore syntax with inverted sense: add("!pattern") means
        // "treat this as excluded". Add both the dir itself and its contents
        // to catch both the entry and its descendants.
        let _ = overrides.add(&format!("!**/{}", excluded));
        let _ = overrides.add(&format!("!**/{}/**", excluded));
    }
    let overrides = overrides.build().expect("override builder failed");

    let mut b = WalkBuilder::new(root);
    b.standard_filters(true)
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .overrides(overrides);
    b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::test_util::make_temp_repo;
    use std::fs;

    fn collect_paths(root: &Path) -> Vec<String> {
        build_walker(root)
            .build()
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .map(|e| {
                e.path()
                    .strip_prefix(root)
                    .unwrap_or(e.path())
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    #[test]
    fn skips_dot_git_dir() {
        let tmp = make_temp_repo();
        // make_temp_repo already creates .git/HEAD; re-creating is idempotent.
        fs::create_dir_all(tmp.path().join(".git")).unwrap();
        fs::write(tmp.path().join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let paths = collect_paths(tmp.path());
        assert!(
            !paths.iter().any(|p| p.contains(".git/")),
            "found .git file: {paths:?}"
        );
    }

    #[test]
    fn skips_hardcoded_build_dirs() {
        let tmp = make_temp_repo();
        for dir in ["node_modules", "target", "build", "dist", ".next", "out"] {
            let d = tmp.path().join(dir);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("junk.bin"), b"x").unwrap();
        }
        let paths = collect_paths(tmp.path());
        for dir in ["node_modules", "target", "build", "dist", ".next", "out"] {
            assert!(
                !paths.iter().any(|p| p.contains(&format!("{}/", dir))),
                "found {} files in walk: {:?}",
                dir,
                paths
            );
        }
    }

    #[test]
    fn respects_gitignore_glob() {
        let tmp = make_temp_repo();
        fs::write(tmp.path().join(".gitignore"), "*.log\n").unwrap();
        fs::write(tmp.path().join("app.log"), "nope").unwrap();
        fs::write(tmp.path().join("app.rs"), "ok").unwrap();
        let paths = collect_paths(tmp.path());
        assert!(
            paths.iter().any(|p| p.ends_with("app.rs")),
            "missing app.rs: {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.ends_with("app.log")),
            "found app.log: {paths:?}"
        );
    }

    #[test]
    fn includes_regular_source_files() {
        let tmp = make_temp_repo();
        fs::create_dir_all(tmp.path().join("src")).unwrap();
        fs::write(tmp.path().join("src").join("main.rs"), "fn main() {}").unwrap();
        fs::write(tmp.path().join("README.md"), "# readme").unwrap();
        let paths = collect_paths(tmp.path());
        assert!(
            paths.iter().any(|p| p.ends_with("src/main.rs")),
            "missing src/main.rs: {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p.ends_with("README.md")),
            "missing README.md: {paths:?}"
        );
    }
}
