---
phase: 02-real-time-data-pipeline
reviewed: 2026-04-08T12:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src-tauri/src/pipeline/events.rs
  - src-tauri/src/pipeline/ignore_filter.rs
  - src-tauri/src/pipeline/tree_index.rs
  - src-tauri/src/pipeline/watcher.rs
  - src-tauri/src/pipeline/process_snapshot.rs
  - src-tauri/src/pipeline/worktree.rs
  - src-tauri/src/pipeline/pipeline_state.rs
  - src-tauri/src/pipeline/commands.rs
  - src-tauri/src/pipeline/mod.rs
  - src-tauri/src/pipeline/smoke_tests.rs
  - src-tauri/src/pipeline/test_util.rs
  - src-tauri/src/lib.rs
  - src-tauri/Cargo.toml
  - src/stores/pipelineStore.ts
  - src/hooks/usePipelineChannel.ts
  - src/bindings.ts
  - src/__tests__/pipelineStore.test.ts
findings:
  critical: 0
  high: 3
  medium: 4
  low: 3
  info: 3
  total: 13
status: findings
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-08
**Depth:** standard
**Files Reviewed:** 17
**Status:** findings

## Summary

Phase 2 delivers a solid Rust pipeline: the `notify-debouncer-full` watcher, PID attribution via `sysinfo`, git worktree detection, and a `tauri::ipc::Channel` forwarder all wire together cleanly. The architecture correctly follows the research recommendations (Channel over emit, debounce at 150ms, bounded mpsc, parallel walker). The frontend Zustand store and hook are minimal and correct.

Three HIGH findings require attention before this code ships:

1. A path prefix check in `watcher.rs` is vulnerable to path prefix false-positives — the most impactful correctness issue in the file.
2. The `spawn_watcher` call inside `start_watch` blocks the Tauri async executor for up to 500ms while building the tree index — a documented footgun in the code's own comments that is not actually respected.
3. `stop_watch` returns an error when no watch is active, which will crash the unregister flow from the frontend hook on any cold-stop call.

---

## High Issues

### HR-01: `path_is_under_root` has false-positive prefix collision

**File:** `src-tauri/src/pipeline/watcher.rs:240-244`

**Issue:** The guard compares raw string prefixes without ensuring a path separator boundary. A repo rooted at `/home/dev/repo` will accept events from `/home/dev/repo-extra/malicious.rs` because `"/home/dev/repo-extra/..."` starts with the string `"/home/dev/repo"`. On Windows this is especially easy to hit: a project `C:\Users\dev\aitc` would accept events from `C:\Users\dev\aitc-backup\`.

```rust
fn path_is_under_root(path: &Path, root: &Path) -> bool {
    let p_str = path.to_string_lossy();
    let r_str = root.to_string_lossy();
    p_str.starts_with(r_str.as_ref())   // <-- no separator check
}
```

This is the documented Tauri security test T-02-02-01 path-traversal guard, and it silently passes for sibling directories.

**Fix:** Use `Path::starts_with` which is component-aware, not byte-prefix aware:

```rust
fn path_is_under_root(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}
```

`Path::starts_with` compares complete path components, so `/home/dev/repo-extra` does not pass for root `/home/dev/repo`.

---

### HR-02: `spawn_watcher` blocks the async executor while building the tree index

**File:** `src-tauri/src/pipeline/watcher.rs:62-68` and `src-tauri/src/pipeline/commands.rs:67`

**Issue:** `build_tree_index` is documented as "Callers MUST run this inside `tauri::async_runtime::spawn_blocking`" (tree_index.rs:33). `spawn_watcher` calls it synchronously at line 67. In `commands.rs`, `spawn_watcher` is invoked directly inside the `async fn start_watch` Tauri command handler — this blocks the tokio runtime thread for the full 50–500ms walk duration, starving all other tasks sharing that worker thread.

The comment in `watcher.rs:52-53` acknowledges this ("Blocks briefly to build the initial tree index (use spawn_blocking if calling from an async runtime for a very large repo)") but the call site in `commands.rs` does not act on it.

**Fix:** In `commands.rs`, wrap `spawn_watcher` in `spawn_blocking`:

```rust
let watcher_output = tauri::async_runtime::spawn_blocking({
    let canonical = canonical.clone();
    let raw_tx = raw_tx.clone();
    move || spawn_watcher(&canonical, raw_tx)
})
.await
.map_err(|e| format!("spawn_blocking join error: {e}"))?
.map_err(|e| format!("spawn_watcher failed: {e}"))?;
```

Alternatively, refactor `spawn_watcher` to accept a pre-built tree so callers can wrap `build_tree_index` independently.

---

### HR-03: `stop_watch` returns `Err` when no watch is active — breaks the frontend `unregister` flow

**File:** `src-tauri/src/pipeline/commands.rs:126-134`

**Issue:** `stop_watch` returns `Err("no active watch")` when called with no active watch. The `usePipelineChannel` hook calls `invoke('stop_watch')` in its `unregister` callback without error handling. An `invoke` that resolves to an Err from Tauri throws a rejected Promise in JavaScript. If `unregister` is called defensively (e.g., on component unmount before `register` was ever called, or after a prior stop), the unhandled rejection is silently swallowed but leaves `isWatching` in an inconsistent state if the caller relies on the await completing successfully.

```rust
pub async fn stop_watch(...) -> Result<(), String> {
    ...
    } else {
        Err("no active watch".to_string())   // throws on JS side
    }
```

**Fix:** Make `stop_watch` idempotent — return `Ok(())` when there is nothing to stop:

```rust
pub async fn stop_watch(state: tauri::State<'_, PipelineState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(active) = guard.take() {
        drop(active);
    }
    // Idempotent: no-op if already stopped
    Ok(())
}
```

---

## Medium Issues

### MR-01: `spawn_snapshot_refresher` runs `sysinfo::refresh` on the async runtime, not in `spawn_blocking`

**File:** `src-tauri/src/pipeline/process_snapshot.rs:189-203`

**Issue:** `snap.refresh()` calls `sysinfo::System::refresh_processes_specifics`, which is a synchronous, potentially blocking call (benchmarked at 24ms average, up to 100ms). This runs inside a `tokio::spawn` async task, not `spawn_blocking`. Per tokio's documentation, blocking operations inside `tokio::spawn` starve the async executor. At 24ms this is a recurring 1-per-second executor stall. The benchmark note says the target is <50ms but at 100ms on a loaded box this becomes significant.

**Fix:**

```rust
pub fn spawn_snapshot_refresher(
    snapshot: Arc<RwLock<ProcessSnapshot>>,
    interval: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval);
        loop {
            tick.tick().await;
            let snap_clone = snapshot.clone();
            tokio::task::spawn_blocking(move || {
                // refresh() is synchronous and blocks; run off the async executor
                let rt = tokio::runtime::Handle::current();
                rt.block_on(async {
                    let mut snap = snap_clone.write().await;
                    snap.refresh();
                })
            })
            .await
            .ok();
        }
    })
}
```

Or simpler: use `spawn_blocking` to do the refresh then write the result back under the lock.

---

### MR-02: `#[allow(dead_code)]` and `#[allow(unused_imports)]` suppressed at module level without a sunset date

**File:** `src-tauri/src/pipeline/mod.rs:15-16`

**Issue:** Module-level `#![allow(dead_code)]` and `#![allow(unused_imports)]` are wide suppressions that mask future dead code within the entire pipeline module. The comment says "dead-code warnings are suppressed at the module level" for Wave 0 scaffolding, but now that all plans (02-02..02-04) are complete, these suppressions are no longer needed and actively hide unused code.

**Fix:** Remove both `#![allow]` directives now that the pipeline module is fully implemented:

```rust
// Remove lines 15-16:
// #![allow(dead_code)]
// #![allow(unused_imports)]
```

If specific items still need suppression, apply `#[allow(dead_code)]` narrowly to those items rather than the entire module.

---

### MR-03: `drop_batches` counter in `process_debounce_result` always returns zero — back-pressure signal never fires

**File:** `src-tauri/src/pipeline/watcher.rs:142-190`

**Issue:** `FileEventBatch.dropped_batches` exists specifically so the Rust side can signal to the frontend when the mpsc channel is full and batches are being dropped (documented in `events.rs:69-72`). However, `process_debounce_result` always constructs `FileEventBatch { dropped_batches: 0, ... }`. The `blocking_send` at line 114 returns an error only when the receiver is dropped — it does NOT indicate that the channel was full (because `blocking_send` blocks until space is available, it never drops). The drop counter is therefore always zero and the back-pressure signal is never surfaced to the frontend.

The comment in the code ("when the bounded tokio mpsc between the watcher and the sender actor is full, whole batches are dropped and this counter increments") describes intended behavior that is not implemented.

**Fix:** To implement the described semantics, replace `blocking_send` with `try_send` and track drops:

```rust
use std::sync::atomic::{AtomicU32, Ordering};
// ... in the spawn_blocking closure:
match out_tx.try_send(batch) {
    Ok(()) => {}
    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
        dropped_counter.fetch_add(1, Ordering::Relaxed);
        // batch is lost; next successful batch carries the accumulated count
    }
    Err(tokio::sync::mpsc::error::TrySendError::Disconnected(_)) => break,
}
```

The counter should be included in the next sent batch's `dropped_batches` field and then reset.

---

### MR-04: `list_worktrees` command skips canonicalization, allowing relative paths

**File:** `src-tauri/src/pipeline/commands.rs:138-141`

**Issue:** The standalone `list_worktrees` command constructs a `PathBuf` from the raw `repo_root` string and passes it directly to `do_list_worktrees`, which passes it to `Command::new("git").arg("-C").arg(&root)`. Unlike `start_watch`, there is no validation that the path exists, is a directory, or canonicalization to remove `..` components. A caller passing `"../../etc"` would cause git to run in an unintended directory.

The `worktree::list_worktrees` function does call `canonicalize` internally, but only after running `Command::new("git")` — wait, checking: it canonicalizes at line 31 before passing to the Command. However the existence/directory check present in `start_watch` is absent here.

**Fix:** Apply the same validation present in `start_watch`:

```rust
#[tauri::command]
#[specta::specta]
pub async fn list_worktrees(repo_root: String) -> Result<Vec<Worktree>, String> {
    let path = PathBuf::from(&repo_root);
    if !path.exists() {
        return Err(format!("repo_root does not exist: {repo_root}"));
    }
    if !path.is_dir() {
        return Err(format!("repo_root is not a directory: {repo_root}"));
    }
    do_list_worktrees(&path)
}
```

---

## Low Issues

### LR-01: `wait_for_batch` in test_util computes `remaining` duration then immediately may discard it

**File:** `src-tauri/src/pipeline/test_util.rs:36-40`

**Issue:** The `deadline.saturating_duration_since(Instant::now())` call on line 38 computes the remaining time, but the check `if remaining.is_zero()` on line 39 will almost never be true because the deadline was just computed as `Instant::now() + timeout` on line 37 — there is effectively zero elapsed time between the two `Instant::now()` calls. The early-return guard is logically dead. This is a test utility so the impact is low, but it misleads readers.

**Fix:** Simplify to use `tokio::time::timeout` directly with the original `timeout` argument:

```rust
pub async fn wait_for_batch(
    rx: &mut tokio::sync::mpsc::Receiver<FileEventBatch>,
    timeout: Duration,
) -> Option<FileEventBatch> {
    match tokio::time::timeout(timeout, rx.recv()).await {
        Ok(Some(batch)) => Some(batch),
        Ok(None) | Err(_) => None,
    }
}
```

---

### LR-02: `usePipelineChannel` `register` call uses raw `invoke` instead of generated bindings

**File:** `src/hooks/usePipelineChannel.ts:38-41`

**Issue:** The hook calls `invoke<Worktree[]>('start_watch', { repoRoot, channel: channelRef.current })` with a raw string command name and manual argument object. The generated `bindings.ts` already exports `commands.startWatch(repoRoot, channel)` which provides compile-time type safety. Using the raw `invoke` bypasses the type-safe wrapper and risks argument name mismatches (e.g., `repoRoot` vs `repo_root` if the binding generator changes its camelCase mapping).

**Fix:**

```typescript
import { commands } from '../bindings';
// ...
const worktrees = await commands.startWatch(repoRoot, channelRef.current);
```

Similarly, `invoke('stop_watch')` should become `commands.stopWatch()`.

---

### LR-03: `ingest` ring buffer preserves oldest events from earlier batches when new batch overflows

**File:** `src/stores/pipelineStore.ts:40-46`

**Issue:** When a batch with more than `MAX_EVENTS` items is ingested, `merged.slice(0, MAX_EVENTS)` keeps the first `MAX_EVENTS` items of `[...batch.events, ...s.events]`. Since `batch.events` comes first (newest events), this correctly keeps the newest batch events. However, when a normal-size batch fills the buffer (`merged.length > MAX_EVENTS`), older events from prior batches that now exceed the limit are silently dropped without ever reaching `eventCount`. `eventCount` accumulates the full `batch.events.length` regardless of how many events were actually retained. This means `eventCount` can be higher than the number of events accessible in the `events` array by up to `MAX_EVENTS` after many batches — a minor accounting inconsistency.

This is a known tradeoff for a ring buffer design and consistent with the comment "eventCount is cumulative, not capped" in the test. Noting it as a low issue because downstream consumers that compute rates or percentages from `eventCount` vs `events.length` may see confusing numbers.

**Fix (optional, if accounting accuracy matters):** Document the intentional divergence explicitly in a comment, or track a separate `droppedEventCount` to allow consumers to account for the discrepancy.

---

## Info

### IN-01: `Cargo.toml` `authors` field contains placeholder value

**File:** `src-tauri/Cargo.toml:5`

**Issue:** `authors = ["you"]` is a placeholder. Not a runtime bug, but will appear in compiled binaries and any package metadata.

**Fix:** Replace with the actual author name/email.

---

### IN-02: `mod.rs` re-exports `ActiveWatch` from `pipeline_state`, but `ActiveWatch` is never used outside the module

**File:** `src-tauri/src/pipeline/mod.rs:34`

**Issue:** `pub use pipeline_state::{ActiveWatch, PipelineState}` exports `ActiveWatch` at the pipeline module boundary. `ActiveWatch` is an internal implementation detail (holds task handles, is managed by `PipelineState`). Exporting it widens the public surface unnecessarily.

**Fix:** Remove `ActiveWatch` from the `pub use` re-export if it is not needed by `lib.rs` or future phases.

---

### IN-03: `bindings.ts` imports `InvokeArgs` but never uses it directly

**File:** `src/bindings.ts:8`

**Issue:** `import type { InvokeArgs } from "@tauri-apps/api/core"` is imported but not referenced anywhere in the file (the `invoke` wrapper casts `TAURI_INVOKE` directly). TypeScript would flag this as an unused import.

**Fix:** Remove the unused import:

```typescript
import { invoke as TAURI_INVOKE } from "@tauri-apps/api/core";
// Remove: import type { InvokeArgs } from "@tauri-apps/api/core";
```

Note: this is a generated file — the fix should be applied to the specta generation template or accepted as a known generator artifact.

---

_Reviewed: 2026-04-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
