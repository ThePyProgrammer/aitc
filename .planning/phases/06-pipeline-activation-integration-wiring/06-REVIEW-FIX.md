---
phase: 06-pipeline-activation-integration-wiring
fixed_at: 2026-04-11T00:00:00Z
review_path: .planning/phases/06-pipeline-activation-integration-wiring/06-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-04-11
**Source review:** .planning/phases/06-pipeline-activation-integration-wiring/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (2 critical + 6 warning)
- Fixed: 8
- Skipped: 0

Out-of-scope: IN-01..IN-05 were not addressed per `fix_scope=critical_warning`. Pre-existing `conflict::engine` test failures (2) are unrelated to Phase 6 and were left untouched per instructions.

## Fixed Issues

### CR-01: PID collision via modulo-10000 in KAGENT id generation

**Files modified:** `src-tauri/src/agents/self_register.rs`
**Commit:** 2779bf9
**Applied fix:** Replaced `format!("KAGENT-{:04}", payload.pid % 10000)` with `format!("KAGENT-{}", payload.pid)` so the self-register handler stores the full PID. This matches `passive_bridge::bridge_tick`'s `PASSIVE-{pid}` format and removes the collision path where low-4-digit PIDs overwrote each other and left PASSIVE ghost entries after reconciliation.

### CR-02: detect_git_root executes git inside attacker-controlled directory

**Files modified:** `src-tauri/src/repo_session.rs`
**Commit:** 366d9e4
**Applied fix:** Removed `Command::new("git").args(["rev-parse", "--show-toplevel"])` entirely. Replaced with a pure-Rust `find_git_root` helper that walks parents looking for a `.git` directory or file marker. Eliminates the RCE vector via malicious `core.fsmonitor`, `core.hooksPath`, shell aliases, and CVE-2022-41953/CVE-2024-32002 submodule-symlink attacks. Also removes the implicit dependency on `git` being on PATH. All 5 existing repo_session tests pass.

### WR-01: get_tree_index hardcodes is_dir: false

**Files modified:** `src-tauri/src/pipeline/tree_index.rs`, `src-tauri/src/pipeline/commands.rs`, `src-tauri/src/pipeline/watcher.rs`
**Commits:** 8d66b17, 8032471
**Applied fix:** Added `is_dir: bool` to `FileNode`, updated `build_tree_index` to insert directory entries (size=0, is_dir=true) in addition to files, and updated `get_tree_index` to read `node.is_dir` instead of hardcoding false. Frontend treemap can now render folder aggregates correctly. Tree-index tests and the `initial_tree_populated_before_watch` watcher test were updated to filter by `is_dir` when asserting file counts.

### WR-02: Windows canonicalize() produces UNC paths that mismatch frontend

**Files modified:** `src-tauri/src/pipeline/commands.rs`, `src-tauri/src/repo_session.rs`
**Commit:** d52cf43
**Applied fix:** Added `strip_unc(PathBuf) -> PathBuf` helper in `pipeline::commands` that strips the `\\?\` extended-length prefix on Windows (no-op on other platforms) and applied it after `canonicalize()` in `start_watch`. Additionally normalized the git root path returned by `detect_git_root` to forward-slash separators on Windows to preserve the POSIX-style output that the frontend stored when `git rev-parse --show-toplevel` was in use.

### WR-03: SQLite foreign keys not enabled at connection time

**Files modified:** `src-tauri/src/db/mod.rs`
**Commit:** dc13ab0
**Applied fix:** Added `.foreign_keys(true)` to the `SqliteConnectOptions` builder so every pooled connection enforces `session_files.session_id REFERENCES agent_sessions(id)`. Prevents the silent-corruption path where `record_session_file_internal` could insert orphan rows and zero out `file_count`.

### WR-04: record_session_file_internal is not atomic

**Files modified:** `src-tauri/src/db/session.rs`
**Commit:** 9855af3
**Applied fix:** Wrapped the insert/upsert into `session_files` and the `UPDATE agent_sessions SET file_count = ...` in a single `pool.begin()` / `tx.commit()` transaction. If the UPDATE fails, the INSERT is rolled back and `file_count` no longer drifts below the real row count. All 5 session_lifecycle tests pass.

### WR-05: resolvedOnce ref permanently latches on a failed initial resolve

**Files modified:** `src/providers/RepoSessionProvider.tsx`
**Commit:** c7136e4
**Applied fix:** Moved `resolvedOnce.current = true` to run after `await useRepoStore.getState().resolveInitialRepo()` succeeds. On throw, the ref stays false so a subsequent mount can retry instead of stranding the user on a permanent error banner. Added a `cancelled` guard to avoid setting the ref on an unmounted component. All 5 RepoSessionProvider tests pass.

### WR-06: Rate limiter in self_register double-counts across window boundaries

**Files modified:** `src-tauri/src/agents/self_register.rs`
**Commit:** 520dd10
**Applied fix:** Replaced the two-`AtomicU64` CAS-based rate limiter with a `tokio::sync::Mutex<(u64, u64)>` holding `(window_secs, count)`. `check()` is now async, takes the lock, resets on window change, increments, and compares against the 10 rps cap atomically. Lock contention at 10 rps is negligible and the code is obviously correct. All 4 self_register tests pass.

---

_Fixed: 2026-04-11_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
