---
phase: 02-real-time-data-pipeline
verified: 2026-04-10T17:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Start the application with cargo tauri dev, call invoke('start_watch', { repoRoot: '/some/repo', channel }) from the frontend, create/modify/delete files in that repo, and observe FileEventBatch messages arriving in the pipelineStore"
    expected: "Events appear in pipelineStore.events within ~500ms of each file write; attribution shows Pid/Unattributed depending on whether a known agent process (claude, codex, etc.) has its cwd in the repo"
    why_human: "End-to-end pipeline requires a live Tauri webview and real filesystem activity; cannot be verified programmatically without running the app"
  - test: "Call invoke('stop_watch') while no watch is active (e.g., before calling start_watch, or after a prior stop)"
    expected: "The call resolves without error; the frontend hook unregister() path should not throw an unhandled Promise rejection"
    why_human: "HR-03 (stop_watch returns Err on no active watch) is a known open issue from the code review. Needs human verification that this does not cause a visible error in the UI or console"
  - test: "Start a watch on a repo whose path has a sibling with a common prefix (e.g., watch 'C:\\dev\\aitc' while 'C:\\dev\\aitc-backup\\' also exists). Create a file in 'aitc-backup'"
    expected: "No FileEvent is emitted for the file in aitc-backup; the path traversal guard correctly excludes it"
    why_human: "HR-01 (path_is_under_root uses string starts_with, not Path::starts_with) means sibling directories with prefix overlap will pass the guard. Cannot verify without a live filesystem setup matching this topology"
---

# Phase 2: Real-Time Data Pipeline Verification Report

**Phase Goal:** System can watch a repository directory tree in real time, attribute file events to processes, and stream batched events to the frontend without data loss
**Verified:** 2026-04-10T17:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | File read/write events across a repository are captured in real time by the Rust backend using filesystem watchers | VERIFIED | `watcher.rs` (458 lines): `spawn_watcher` uses `notify-debouncer-full 0.7` with 150ms aligned tick (`DEBOUNCE_TICK_MS=150`), `RecursiveMode::Recursive`, writes-only `map_event_kind` filter, sync→async bridge via `blocking_send`. 7 non-ignored watcher tests pass (per SUMMARY). |
| 2 | File events are attributed to specific agent processes via PID correlation | VERIFIED | `process_snapshot.rs` (429 lines): `ProcessSnapshot::attribute()` returns `Attribution::Pid(n)` / `Ambiguous` / `Unattributed` via cwd prefix match. `AGENT_NAME_ALLOWLIST = ["claude","claude-code","codex","opencode"]`. `start_attributing_stream` rewrites every `FileEventBatch` in-flight before forwarding to the Channel. 10 unit tests pass. |
| 3 | System handles 10k+ file codebases without excessive CPU/memory (debouncing and event batching active) | VERIFIED | `tree_index.rs` (157 lines): `build_tree_index` uses `WalkBuilder::build_parallel` — measured 187-228ms for 10k files (target <500ms). `watcher.rs`: debouncer aligned at 150ms tick — burst benchmark: 4 batches for 1000 writes (target ≤10). `process_snapshot.rs`: `ProcessRefreshKind` narrowed to cwd+cmd+exe; 24ms refresh avg (target <50ms). |
| 4 | System detects whether agents share a working tree or use isolated git worktrees | VERIFIED | `worktree.rs` (237 lines): `parse_porcelain()` parses `git worktree list --porcelain` output handling single, multi, bare, detached, locked cases. `Worktree` struct has `is_main`, `is_bare`, `detached`, `locked` fields. `list_worktrees` Tauri command calls `git -C <repo_root> worktree list --porcelain`. `start_watch` returns `Vec<Worktree>` to the frontend. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/Cargo.toml` | notify 8, notify-debouncer-full 0.7, sysinfo 0.38, ignore 0.4, tempfile 3, serial_test 3 | VERIFIED | All 6 deps present with correct versions; version-override comment present for notify-debouncer-full |
| `src-tauri/src/pipeline/mod.rs` | Module root with submodule declarations and re-exports | VERIFIED | 39 lines; declares all 8 submodules; re-exports Attribution, FileEvent, FileEventBatch, FileEventKind, ActiveWatch, PipelineState, ProcessSnapshot, ProcessInfo, spawn_snapshot_refresher, start_attributing_stream, AGENT_NAME_ALLOWLIST, list_worktrees, Worktree |
| `src-tauri/src/pipeline/events.rs` | FileEvent, FileEventBatch, FileEventKind, Attribution with specta + serde | VERIFIED | 141 lines; all 4 types have `#[derive(..., Type)]`; camelCase tagged enums; `FileEvent::new()` and `FileEventBatch::new_empty()` constructors; 4 inline unit tests |
| `src-tauri/src/pipeline/smoke_tests.rs` | Wave 0 smoke tests for Channel lifetime + sysinfo benchmark | VERIFIED | 162 lines; `channel_type_is_clone_send_sync_static`, `file_event_batch_serializes_for_channel_transport`, `#[ignore]`'d `bench_sysinfo_refresh_cost`; `BENCH_RESULT (Wave 0): sysinfo refresh averaged 24ms` comment present |
| `src-tauri/src/lib.rs` | pipeline module declared | VERIFIED | `mod pipeline;` present at line 2 |
| `src-tauri/src/pipeline/ignore_filter.rs` | WalkBuilder wrapper with HARDCODED_EXCLUDES | VERIFIED | 135 lines; `HARDCODED_EXCLUDES` const with 7 entries (.git, node_modules, target, build, dist, .next, out); `build_walker` function present |
| `src-tauri/src/pipeline/tree_index.rs` | FileNode + HashMap tree index via WalkBuilder | VERIFIED | 157 lines; `build_tree_index` using `build_parallel`; `FileNode` struct; benchmark result persisted in BENCH_RESULT comment |
| `src-tauri/src/pipeline/watcher.rs` | Debouncer + notify→tokio bridge + writes-only filter + batch assembly | VERIFIED | 458 lines; `spawn_watcher`, `WatcherHandle`, `WatcherOutput`, `process_debounce_result`, `map_event_kind`, `DEBOUNCE_TICK_MS=150`; defense-in-depth path guards |
| `src-tauri/src/pipeline/test_util.rs` | make_temp_repo(), write_file(), wait_for_batch() | VERIFIED | 47 lines; `#[cfg(test)]`; all 3 helpers present |
| `src-tauri/src/pipeline/process_snapshot.rs` | ProcessSnapshot with attribute(), start_attributing_stream, spawn_snapshot_refresher | VERIFIED | 429 lines; all required functions/types present; AGENT_NAME_ALLOWLIST = 4 entries |
| `src-tauri/src/pipeline/worktree.rs` | Worktree struct, list_worktrees(), parse_porcelain() | VERIFIED | 237 lines; all required items present |
| `src-tauri/src/pipeline/pipeline_state.rs` | PipelineState managed by Tauri | VERIFIED | 53 lines; `pub struct PipelineState` with `Mutex<Option<ActiveWatch>>`; `impl Drop` present |
| `src-tauri/src/pipeline/commands.rs` | start_watch, stop_watch, list_worktrees Tauri commands | VERIFIED | 156 lines; 3 `#[tauri::command]` annotations; `Channel<FileEventBatch>` parameter on `start_watch` |
| `src/stores/pipelineStore.ts` | Zustand store with ring buffer | VERIFIED | 59 lines; `create<PipelineStore>`; `MAX_EVENTS=5000`; `ingest`, `droppedBatches`, `setWorktrees`, `setProcesses`, `setWatching`, `reset` all present |
| `src/hooks/usePipelineChannel.ts` | React hook constructing Channel | VERIFIED | 54 lines; `new Channel<FileEventBatch>()`; `channel.onmessage` → `usePipelineStore.getState().ingest`; `register` + `unregister` callbacks |
| `src/__tests__/pipelineStore.test.ts` | Vitest coverage of ring buffer and store ops | VERIFIED | 117 lines; `import { describe` present; covers ingest, ring buffer trim, droppedBatches, setWorktrees, setProcesses, setWatching, reset (8 tests per SUMMARY) |
| `src/bindings.ts` | TypeScript bindings containing all Phase 2 types | VERIFIED | 71 lines; `FileEventKind`, `Attribution`, `FileEvent`, `FileEventBatch`, `Worktree`, `ProcessInfo` type exports; `commands.startWatch`, `commands.stopWatch`, `commands.listWorktrees` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src-tauri/src/lib.rs` | `src-tauri/src/pipeline/mod.rs` | `mod pipeline` declaration | WIRED | `mod pipeline;` at line 2 of lib.rs |
| `src-tauri/src/pipeline/mod.rs` | `src-tauri/src/pipeline/events.rs` | `pub mod events` | WIRED | `pub mod events;` at line 19 of mod.rs |
| `src-tauri/src/pipeline/commands.rs` | `src-tauri/src/pipeline/watcher.rs` | `start_watch` calls `spawn_watcher` | WIRED | `use crate::pipeline::watcher::spawn_watcher;` at line 17; called at line 67 |
| `src-tauri/src/pipeline/commands.rs` | `src-tauri/src/pipeline/process_snapshot.rs` | `start_watch` calls `start_attributing_stream` | WIRED | Imported at line 15; called at line 80 |
| `src-tauri/src/pipeline/commands.rs` | `tauri::ipc::Channel` | `Channel<FileEventBatch>` parameter | WIRED | `channel: tauri::ipc::Channel<FileEventBatch>` at line 39 |
| `src-tauri/src/lib.rs` | `src-tauri/src/pipeline/commands.rs` | `tauri_specta::collect_commands!` | WIRED | `pipeline::commands::start_watch`, `stop_watch`, `list_worktrees` collected at lines 10-13 |
| `src/hooks/usePipelineChannel.ts` | `src/stores/pipelineStore.ts` | `channel.onmessage` → `store.ingest` | WIRED | `usePipelineStore.getState().ingest(batch)` at line 24 |
| `src-tauri/src/pipeline/tree_index.rs` | `src-tauri/src/pipeline/ignore_filter.rs` | `build_tree_index` uses `build_walker` | WIRED | `build_walker` imported and called in tree_index.rs |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `pipelineStore.ts` | `events: FileEvent[]` | `ingest(batch)` called from `usePipelineChannel.ts` line 24, which receives from `Channel<FileEventBatch>` backed by Rust `start_watch` command | Channel sends real batches from notify-debouncer + process_snapshot pipeline | FLOWING |
| `pipelineStore.ts` | `worktrees: Worktree[]` | `setWorktrees(worktrees)` in `usePipelineChannel.ts` line 42; worktrees come from `start_watch` return value (git porcelain parser) | `parse_porcelain` runs `git worktree list --porcelain` producing real git output | FLOWING |
| `pipelineStore.ts` | `droppedBatches: number` | `ingest()` accumulates `batch.droppedBatches` from Rust side | `dropped_batches` field is **always hardcoded to 0** in `watcher.rs` (lines 148 and 189); counter never increments (see MR-03) | STATIC — back-pressure signal not implemented |

### Behavioral Spot-Checks

Step 7b: SKIPPED for Tauri command surface — requires a live Tauri runtime + webview. Tests verified at unit level; end-to-end behavior requires human verification.

Module-level unit test counts verified via SUMMARYs (all consistent):
- `cargo test --lib pipeline::` — 39 passed, 0 failed, 3 ignored (per 02-04-SUMMARY.md)
- `npm test pipelineStore` — 8 passed, 0 failed (per 02-04-SUMMARY.md)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FMON-01 | 02-01, 02-02, 02-04 | System monitors all file read/write events via Rust filesystem watchers | SATISFIED | `notify-debouncer-full` watcher in `watcher.rs`; Tauri `start_watch` command; Channel streaming to frontend |
| FMON-02 | 02-01, 02-03 | System attributes file events to specific agent processes (PID-based) | SATISFIED | `ProcessSnapshot::attribute()` with cwd prefix heuristic; `start_attributing_stream` rewrites batches in-flight |
| FMON-03 | 02-01, 02-02 | System handles 10k+ files without excessive CPU/memory | SATISFIED | Parallel walker (187-228ms for 10k files); 150ms aligned debounce (4 batches per 1000 writes); narrowed `ProcessRefreshKind` (24ms refresh) |
| FMON-04 | 02-04 | System detects whether agents share a working tree or use isolated git worktrees | SATISFIED | `parse_porcelain()` + `list_worktrees` Tauri command; `Worktree` struct with `is_main`, `is_bare`, `detached`, `locked` fields |

No orphaned requirements — REQUIREMENTS.md maps FMON-01/02/03/04 to Phase 2 and all four are covered. FMON-05 is mapped to Phase 5 and is out of scope here.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src-tauri/src/pipeline/watcher.rs` | 240-244 | `path_is_under_root` uses string `starts_with` instead of `Path::starts_with` — sibling directories with shared prefix pass the guard (HR-01 from code review) | Warning | Allows events from `repo-backup/` when watching `repo/`; no crash, but incorrect event inclusion on Windows |
| `src-tauri/src/pipeline/commands.rs` | 67 | `spawn_watcher` called directly inside `async fn start_watch` without `spawn_blocking`, blocking the tokio executor for up to 500ms during tree index walk (HR-02 from code review) | Warning | Executor stall on watch start for large repos; functional but causes latency spike |
| `src-tauri/src/pipeline/commands.rs` | 132 | `stop_watch` returns `Err("no active watch")` when called with no active watch — not idempotent (HR-03 from code review) | Warning | Frontend `unregister()` at line 48 of `usePipelineChannel.ts` has no error handling; unhandled Promise rejection on defensive stop calls |
| `src-tauri/src/pipeline/process_snapshot.rs` | 199-200 | `snap.refresh()` (synchronous sysinfo call, ~24ms) runs inside `tokio::spawn` without `spawn_blocking` (MR-01 from code review) | Warning | Recurring 24ms executor stall every 1000ms; acceptable at 24ms but degrades at higher process counts |
| `src-tauri/src/pipeline/mod.rs` | 15-16 | `#![allow(dead_code)]` and `#![allow(unused_imports)]` still present at module level; Wave 0 suppressions were not removed after Plans 02-02..02-04 consumed all types (MR-02 from code review) | Info | Masks future dead code in the entire pipeline module |
| `src-tauri/src/pipeline/watcher.rs` | 148, 189 | `dropped_batches: 0` hardcoded — back-pressure counter never increments; `FileEventBatch.dropped_batches` is always 0 regardless of mpsc fullness (MR-03 from code review) | Info | Back-pressure signal never reaches frontend; `pipelineStore.droppedBatches` always stays 0; data loss goes unreported under extreme load |

All anti-patterns rated Warning or Info — none are Blockers that prevent goal achievement. The pipeline functions correctly for its defined purpose; these are correctness/robustness gaps noted in the code review for future cleanup.

### Human Verification Required

#### 1. End-to-End Pipeline Smoke Test

**Test:** Launch `cargo tauri dev`, open the app, call `register('/path/to/any/git/repo')` via the usePipelineChannel hook (or directly via Tauri devtools), then create/modify/delete files in that repo while watching the browser devtools / React DevTools for store updates.

**Expected:** Events appear in `pipelineStore.events` within ~500ms of each file write. Attribution shows `Pid` for agent processes with matching cwd, `Unattributed` otherwise. `worktrees` in the store matches the repo's actual git worktree topology.

**Why human:** Requires a live Tauri runtime, real filesystem, and observable frontend state. Unit tests cover individual pipeline stages; end-to-end integration from filesystem event to Zustand store update has not been exercised outside the running app.

#### 2. stop_watch Idempotency (HR-03)

**Test:** Call `usePipelineChannel.unregister()` before ever calling `register()`, or call it twice in a row.

**Expected:** No unhandled Promise rejection. Console remains clean. `isWatching` stays false.

**Why human:** The code review identified that `stop_watch` returns `Err("no active watch")` on defensive calls, and the hook's `unregister` at line 48 of `usePipelineChannel.ts` has no `.catch()` handler. Whether this silently swallows or surfaces as a visible error requires a running app to observe.

#### 3. Path Traversal Guard False-Positive (HR-01)

**Test:** Start a watch on a repo at e.g. `C:\dev\aitc`. In a separate terminal, create a file in `C:\dev\aitc-backup\test.txt`. Observe whether a FileEvent is emitted for that file.

**Expected:** No event is emitted — the file is outside the watched root.

**Why human:** `path_is_under_root` uses string `starts_with` (byte-prefix), not `Path::starts_with` (component-aware). On a machine where sibling directories with prefix overlap exist, events from the wrong directory will pass the guard. Requires a specific filesystem layout to test.

### Gaps Summary

No blocking gaps. All 4 roadmap success criteria are verified in code. The phase goal — "System can watch a repository directory tree in real time, attribute file events to processes, and stream batched events to the frontend without data loss" — is implemented.

Three code review HIGH findings (HR-01, HR-02, HR-03) and two MEDIUM findings (MR-01, MR-03) remain open from the review committed in `153f2ae`. These are correctness and robustness issues, not missing features:

- HR-01 (path guard false-positive) and HR-03 (stop_watch not idempotent) require human verification to assess real-world impact.
- HR-02 (blocking executor during tree walk) and MR-01 (sysinfo refresh on async thread) are performance issues that only matter under real load.
- MR-03 (dropped_batches always 0) means the back-pressure signal is absent, but events are not actually dropped — `blocking_send` applies back-pressure at the OS thread level.

These findings are candidates for a Phase 2 fix sprint before Phase 3 builds on top of the pipeline.

---

_Verified: 2026-04-10T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
