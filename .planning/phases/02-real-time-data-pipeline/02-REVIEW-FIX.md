---
phase: 02-real-time-data-pipeline
fixed_at: 2026-04-08T12:30:00Z
review_path: .planning/phases/02-real-time-data-pipeline/02-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-04-08T12:30:00Z
**Source review:** .planning/phases/02-real-time-data-pipeline/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### HR-01: `path_is_under_root` has false-positive prefix collision

**Files modified:** `src-tauri/src/pipeline/watcher.rs`
**Commit:** 33927e8
**Applied fix:** Replaced string-prefix comparison (`p_str.starts_with(r_str.as_ref())`) with `Path::starts_with(root)` which is component-aware and correctly rejects sibling directories like `/repo-extra` when root is `/repo`. Updated doc comment to reflect the new behavior.

### HR-02: `spawn_watcher` blocks the async executor while building the tree index

**Files modified:** `src-tauri/src/pipeline/commands.rs`
**Commit:** ecd6b2e
**Applied fix:** Wrapped the `spawn_watcher` call in `tauri::async_runtime::spawn_blocking` so that `build_tree_index` (50-500ms on large repos) runs on a blocking thread pool instead of starving the tokio async executor.

### HR-03: `stop_watch` returns `Err` when no watch is active

**Files modified:** `src-tauri/src/pipeline/commands.rs`
**Commit:** fdfb98c
**Applied fix:** Made `stop_watch` idempotent by returning `Ok(())` when no active watch exists, instead of `Err("no active watch")`. This prevents rejected promises on the JS side when `unregister` is called defensively (e.g., on component unmount before register).

### MR-01: `spawn_snapshot_refresher` runs `sysinfo::refresh` on the async runtime

**Files modified:** `src-tauri/src/pipeline/process_snapshot.rs`
**Commit:** 4bb6ae7
**Applied fix:** Wrapped the `snap.refresh()` call inside `tokio::task::spawn_blocking` so the synchronous sysinfo refresh (24-100ms) runs off the async executor. Uses `Handle::current().block_on()` inside spawn_blocking to acquire the write lock.

### MR-02: Module-level `#![allow(dead_code)]` and `#![allow(unused_imports)]` suppression

**Files modified:** `src-tauri/src/pipeline/mod.rs`
**Commit:** f2e4704
**Applied fix:** Removed both `#![allow(dead_code)]` and `#![allow(unused_imports)]` directives now that all plans (02-02 through 02-04) are implemented. Updated the Wave 0 scaffolding comment to reflect that suppressions have been removed.

### MR-03: `dropped_batches` counter always returns zero

**Files modified:** `src-tauri/src/pipeline/watcher.rs`
**Commit:** 101326b
**Applied fix:** Replaced `blocking_send` with `try_send` in the drain loop, and added an `AtomicU32` drop counter. When `try_send` returns `Full`, the counter increments. The next successfully sent batch carries the accumulated drop count in its `dropped_batches` field (via `swap(0)`), then resets. This implements the back-pressure signal described in `events.rs`.

### MR-04: `list_worktrees` command skips path validation

**Files modified:** `src-tauri/src/pipeline/commands.rs`
**Commit:** f94b6ea
**Applied fix:** Added `exists()` and `is_dir()` validation checks to `list_worktrees`, matching the same validation already present in `start_watch`. This prevents relative/invalid paths from being passed to the git CLI.

---

_Fixed: 2026-04-08T12:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
