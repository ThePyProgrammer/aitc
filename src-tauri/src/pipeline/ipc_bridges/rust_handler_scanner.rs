//! Phase 12 Wave 1: grep-scan for `#[tauri::command]` attributes + fn declarations.
//!
//! Walks `src-tauri/src/**/*.rs` in parallel via rayon, applies a single regex
//! that captures the `fn snake_name` following one or more `#[attr]` lines, and
//! aggregates into a `HashMap<snake_name, HandlerHit>`. The first hit (by sort
//! order: path, then line) wins; duplicates are reported via `tracing::warn!`
//! (V-12-07).
//!
//! Perf notes:
//! - OnceLock regex cache (no re-compile per file — Pitfall 8).
//! - Rayon parallel per-file scan mirrors `deps/mod.rs:95-127`.
//! - Line numbers are 1-indexed (D-06, Pitfall 4) — computed by counting
//!   newlines before the match start.

use rayon::prelude::*;
use regex::Regex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct HandlerHit {
    pub snake_name: String,
    pub file: PathBuf,
    /// 1-indexed.
    pub line: u32,
}

fn handler_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?m)^\s*#\[tauri::command(?:\([^\)]*\))?\]\s*(?:\n\s*#\[[^\]]+\]\s*)*\n\s*(?:pub(?:\([^\)]*\))?\s+)?(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)\s*\(",
        )
        .expect("handler regex compiles")
    })
}

fn scan_one_rust_file(path: &Path) -> Vec<HandlerHit> {
    let Ok(src) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for cap in handler_re().captures_iter(&src) {
        let name = cap
            .get(1)
            .expect("handler regex group 1 always present")
            .as_str()
            .to_string();
        let start = cap
            .get(0)
            .expect("handler regex full match always present")
            .start();
        // Count '\n' before match start; add 1 for 1-indexing.
        let line = src[..start].bytes().filter(|&b| b == b'\n').count() as u32 + 1;
        out.push(HandlerHit {
            snake_name: name,
            file: path.to_path_buf(),
            line,
        });
    }
    out
}

/// Scan every `.rs` file under `src_tauri_root/src` for `#[tauri::command]`
/// handlers. Returns a map keyed on snake_case fn name; on collision, the
/// path-sorted first hit wins and a `tracing::warn!` fires per collision.
pub fn scan_rust_handlers(src_tauri_root: &Path) -> HashMap<String, HandlerHit> {
    let files: Vec<PathBuf> = WalkDir::new(src_tauri_root.join("src"))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("rs"))
        .map(|e| e.path().to_path_buf())
        .collect();

    let per_file: Vec<Vec<HandlerHit>> = files
        .par_iter()
        .map(|p| scan_one_rust_file(p))
        .collect();

    // V-12-07: deterministic path-sorted dedup. First hit wins; log once on
    // every duplicate occurrence.
    let mut all: Vec<HandlerHit> = per_file.into_iter().flatten().collect();
    all.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));

    let mut out: HashMap<String, HandlerHit> = HashMap::new();
    for hit in all {
        match out.get(&hit.snake_name) {
            Some(existing) => {
                tracing::warn!(
                    name = %hit.snake_name,
                    first_file = %existing.file.display(),
                    dup_file = %hit.file.display(),
                    "ipc_bridges: duplicate #[tauri::command] handler; keeping first"
                );
            }
            None => {
                out.insert(hit.snake_name.clone(), hit);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &TempDir, rel: &str, body: &str) -> PathBuf {
        let p = dir.path().join("src").join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, body).unwrap();
        p
    }

    const SAMPLE: &str = include_str!("test_fixtures/sample_handler.rs");

    #[test]
    fn scan_rust_handlers_empty_root() {
        let dir = TempDir::new().unwrap();
        let result = scan_rust_handlers(dir.path());
        assert_eq!(result.len(), 0);
    }

    // V-12-05: the sample_handler.rs fixture has 3 #[tauri::command] attrs.
    #[test]
    fn matches_attribute_to_fn() {
        let dir = TempDir::new().unwrap();
        write(&dir, "handlers.rs", SAMPLE);
        let hits = scan_rust_handlers(dir.path());
        assert!(hits.contains_key("ping"), "ping missing: {:?}", hits.keys().collect::<Vec<_>>());
        assert!(
            hits.contains_key("start_watch"),
            "start_watch missing: {:?}",
            hits.keys().collect::<Vec<_>>()
        );
        assert!(
            hits.contains_key("internal_helper"),
            "internal_helper missing: {:?}",
            hits.keys().collect::<Vec<_>>()
        );
    }

    // V-12-06: all 3 fn variants are covered (pub fn, pub async fn, async fn).
    #[test]
    fn supports_fn_variants() {
        let dir = TempDir::new().unwrap();
        write(&dir, "handlers.rs", SAMPLE);
        let hits = scan_rust_handlers(dir.path());
        assert_eq!(
            hits.len(),
            3,
            "expected 3 handlers (pub fn, pub async fn, async fn), got {}: {:?}",
            hits.len(),
            hits.keys().collect::<Vec<_>>()
        );
    }

    // V-12-07: duplicate handler across files → path-sorted first wins.
    #[test]
    fn duplicate_warn_once() {
        let dir = TempDir::new().unwrap();
        let dup = "#[tauri::command]\n#[specta::specta]\npub fn ping() -> Result<(), String> { Ok(()) }\n";
        write(&dir, "a.rs", dup);
        write(&dir, "b.rs", dup);
        let hits = scan_rust_handlers(dir.path());
        assert_eq!(hits.len(), 1, "duplicate ping → single winner");
        assert!(
            hits["ping"].file.ends_with("a.rs"),
            "a.rs wins path-sort order, got {}",
            hits["ping"].file.display()
        );
    }
}
