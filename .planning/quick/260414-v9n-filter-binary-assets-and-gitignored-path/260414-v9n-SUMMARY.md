---
phase: quick-260414-v9n
plan: 01
subsystem: pipeline/tree_index
tags: [radar, treemap, pipeline, filter]
requires: []
provides:
  - BINARY_EXTENSIONS constant (32 denylisted extensions)
  - is_binary_asset(path) helper
  - extension-filter gate in build_tree_index
affects:
  - radar treemap data source (fewer noise entries)
tech-stack:
  added: []
  patterns: [case-insensitive-extension-denylist]
key-files:
  created: []
  modified:
    - src-tauri/src/pipeline/tree_index.rs
decisions:
  - Filter lives inside the walker closure, not in build_walker, so other pipeline consumers (reconciliation diff) still see binary changes for agent-activity tracking.
  - Files without an extension (Dockerfile, Makefile) are never filtered by this layer — intentional, matches source-file expectations.
  - No config toggle in v1; denylist is module-level constant.
metrics:
  duration_minutes: ~5
  tasks_completed: 1
  files_modified: 1
  completed_date: 2026-04-11
---

# Quick Task 260414-v9n: Filter Binary Assets from Tree Index

**One-liner:** Added a conservative 32-extension binary denylist (`BINARY_EXTENSIONS`) and in-closure filter gate to `build_tree_index`, keeping the radar treemap focused on source files while preserving gitignore behavior via the existing `build_walker`.

## What Shipped

- **`BINARY_EXTENSIONS`** (pub const, 32 entries): images (png, jpg, jpeg, gif, webp, bmp, ico, svg, avif, heic), video (mp4, mov, webm, mkv, avi), audio (mp3, wav, ogg, flac, m4a), archives (zip, tar, gz, 7z), compiled binaries (exe, dll, so, dylib), fonts (woff, woff2, ttf, otf, eot), design/doc binaries (pdf, psd, ai, sketch).
- **`is_binary_asset(&Path) -> bool`**: case-insensitive extension check using `to_ascii_lowercase()` + `slice::contains`. Files with no extension return `false`.
- **Filter gate** in `build_tree_index`'s walker closure, placed after the `is_file()` check and before the metadata fetch. Directory entries (`is_dir`) are not subject to the filter.
- **New unit test** `skips_binary_assets`: writes `src/main.rs`, `assets/logo.png`, `assets/BANNER.JPG` to a temp repo; asserts `main.rs` and `README.md` are indexed while `logo.png` and `BANNER.JPG` are absent.

## Filter Placement Rationale

The filter lives **inside the walker closure** (`tree_index.rs`) rather than inside `ignore_filter::build_walker`. Reasoning:

1. `build_walker` is shared by other pipeline code (notably reconciliation diff). Filtering binaries there would also hide binary-file changes from the agent-activity stream — out of scope for this radar-treemap change.
2. `ignore`'s `OverrideBuilder` semantics use gitignore-style globs designed for paths, not "files-only by extension". A simple Rust predicate in the closure is clearer and cheaper.

## Verification

- `cargo test -p aitc --lib pipeline::tree_index` — **5 passed, 0 failed, 1 ignored** (the ignored `bench_walk_10k_files_under_500ms` is `#[ignore]` by design).
- New test `skips_binary_assets` passes on first run.
- Existing tests all still green: `baseline_repo_contains_readme_only`, `file_node_records_size_and_mtime`, `walks_100_files_in_src`, `skips_node_modules`.
- Clippy: initial implementation used `.iter().any(|ext| *ext == lower.as_str())` which clippy flagged as `unnecessary-fold`-style; rewrote as `BINARY_EXTENSIONS.contains(&lower.as_str())`. No warnings on the modified file after that change.

## Deviations from Plan

**1. [Rule 1 - Code Quality] Clippy lint on denylist lookup**
- **Found during:** Verification (`cargo clippy -p aitc --lib`)
- **Issue:** Original implementation `BINARY_EXTENSIONS.iter().any(|ext| *ext == lower.as_str())` triggered clippy suggestion to use `.contains()`.
- **Fix:** Replaced with `BINARY_EXTENSIONS.contains(&lower.as_str())` — semantically identical, idiomatic, no perf difference.
- **Files modified:** `src-tauri/src/pipeline/tree_index.rs`
- **Commit:** 3160e03

Pre-existing clippy errors elsewhere in the crate (e.g., `repo_session.rs` needless_return, `system_load.rs` new_without_default) are out of scope for this quick task — logged mentally, not fixed.

## Authentication Gates

None.

## Commits

- `3160e03` — fix(radar): filter binary assets from tree index

## Self-Check: PASSED

- File exists: `src-tauri/src/pipeline/tree_index.rs` — FOUND (modified)
- Commit `3160e03` — FOUND in git log
- SUMMARY.md written to `.planning/quick/260414-v9n-filter-binary-assets-and-gitignored-path/260414-v9n-SUMMARY.md`
