//! In-memory file tree index built via the ignore-crate walker (D-12).
//!
//! Doubles as:
//!   1. The baseline state for reconciliation after dropped events (Pitfall 1)
//!   2. The data source for the Phase 4 Radar spatial map
//!
//! Memory footprint (from 02-RESEARCH.md Pattern 4):
//!   - 10k files  → ~3-4 MB
//!   - 100k files → ~30-40 MB
//!
//! BENCH_RESULT (Plan 02-02 Task 2): walked 10001 files in ~187-228ms on dev
//! Windows box (rustc 1.94.1, `WalkBuilder::build_parallel` strategy). Target
//! <500ms. Sequential walker measured ~1090ms for the same repo — parallel
//! walker restored the budget. See 02-02-SUMMARY.md for full run data.

use crate::pipeline::ignore_filter::build_walker;
use ignore::WalkState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct FileNode {
    pub size: u64,
    pub modified_at: Option<SystemTime>,
}

/// Walk the repo root respecting .gitignore + hardcoded excludes and build
/// a flat HashMap<absolute_path, FileNode>.
///
/// Blocking: this is synchronous and can take 50-500ms for a 10k-file repo.
/// Callers MUST run this inside `tauri::async_runtime::spawn_blocking` if they
/// are on the async runtime.
///
/// Uses `WalkBuilder::build_parallel` for the 10k-file budget — sequential
/// iteration measured ~1100ms for 10k files on Windows, parallel drops it
/// below the 500ms target by spreading metadata() calls across cores.
pub fn build_tree_index(root: &Path) -> HashMap<PathBuf, FileNode> {
    let idx: Mutex<HashMap<PathBuf, FileNode>> = Mutex::new(HashMap::with_capacity(16_384));
    let walker = build_walker(root).build_parallel();
    walker.run(|| {
        Box::new(|result| {
            let Ok(entry) = result else {
                return WalkState::Continue;
            };
            let Some(ft) = entry.file_type() else {
                return WalkState::Continue;
            };
            if !ft.is_file() {
                return WalkState::Continue;
            }
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = meta.as_ref().and_then(|m| m.modified().ok());
            // Short critical section: only the HashMap insert is locked.
            if let Ok(mut guard) = idx.lock() {
                guard.insert(entry.into_path(), FileNode { size, modified_at });
            }
            WalkState::Continue
        })
    });
    idx.into_inner().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::test_util::{make_temp_repo, write_file};
    use std::fs;
    use std::time::Instant;

    #[test]
    fn baseline_repo_contains_readme_only() {
        // make_temp_repo creates: .git/HEAD, src/, README.md
        // .git is in HARDCODED_EXCLUDES; src/ is empty; only README.md should appear.
        let tmp = make_temp_repo();
        let idx = build_tree_index(tmp.path());
        let filenames: Vec<String> = idx
            .keys()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(idx.len(), 1, "expected 1 file, got {:?}", filenames);
        assert!(filenames.iter().any(|n| n == "README.md"));
    }

    #[test]
    fn file_node_records_size_and_mtime() {
        let tmp = make_temp_repo();
        let content = "hello world\n";
        write_file(tmp.path(), "src/main.rs", content);
        let idx = build_tree_index(tmp.path());
        let (_, node) = idx
            .iter()
            .find(|(p, _)| p.file_name().unwrap() == "main.rs")
            .expect("main.rs in index");
        assert_eq!(node.size, content.len() as u64);
        assert!(node.modified_at.is_some(), "mtime should be populated");
    }

    #[test]
    fn walks_100_files_in_src() {
        let tmp = make_temp_repo();
        for i in 0..100 {
            write_file(tmp.path(), &format!("src/file_{i:03}.rs"), "fn x() {}");
        }
        let idx = build_tree_index(tmp.path());
        // 100 src files + 1 README.md = 101
        assert_eq!(idx.len(), 101, "expected 101 files, got {}", idx.len());
    }

    #[test]
    fn skips_node_modules() {
        let tmp = make_temp_repo();
        fs::create_dir_all(tmp.path().join("node_modules").join("pkg")).unwrap();
        fs::write(
            tmp.path().join("node_modules").join("pkg").join("index.js"),
            "x",
        )
        .unwrap();
        let idx = build_tree_index(tmp.path());
        let has_node_modules = idx
            .keys()
            .any(|p| p.to_string_lossy().contains("node_modules"));
        assert!(!has_node_modules, "node_modules leaked into index");
    }

    /// FMON-03: 10k-file tree walk must complete in under 500ms.
    /// Marked #[ignore] so it runs only on-demand via `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn bench_walk_10k_files_under_500ms() {
        let tmp = make_temp_repo();
        // Create 10,000 files across 100 directories (100 files each).
        for d in 0..100 {
            let dir = tmp.path().join("src").join(format!("dir_{d:03}"));
            fs::create_dir_all(&dir).unwrap();
            for f in 0..100 {
                fs::write(dir.join(format!("file_{f:03}.rs")), "fn x() {}").unwrap();
            }
        }
        let t0 = Instant::now();
        let idx = build_tree_index(tmp.path());
        let elapsed = t0.elapsed();
        println!(
            "bench_walk_10k_files_under_500ms: {} files in {}ms",
            idx.len(),
            elapsed.as_millis()
        );
        assert_eq!(idx.len(), 10_001, "expected 10001 files (10000 + README.md)");
        assert!(
            elapsed.as_millis() < 500,
            "walk took {}ms, target <500ms — consider WalkBuilder::build_parallel",
            elapsed.as_millis()
        );
    }
}
