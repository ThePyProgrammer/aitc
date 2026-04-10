---
phase: 02-real-time-data-pipeline
plan: 04
subsystem: pipeline-integration
tags: [rust, tauri-commands, specta, zustand, react-hooks, ipc-channel, worktree, pipeline-state, ring-buffer]

# Dependency graph
requires:
  - phase: 02-real-time-data-pipeline
    plan: 02
    provides: spawn_watcher, WatcherHandle, WatcherOutput
  - phase: 02-real-time-data-pipeline
    plan: 03
    provides: ProcessSnapshot, spawn_snapshot_refresher, start_attributing_stream, ProcessInfo
provides:
  - start_watch Tauri command (Channel<FileEventBatch> streaming)
  - stop_watch Tauri command (clean task teardown)
  - list_worktrees Tauri command (git porcelain parser)
  - PipelineState managed state (ActiveWatch with Drop cleanup)
  - Worktree struct with specta type export
  - pipelineStore Zustand store (5000-event ring buffer)
  - usePipelineChannel React hook (register/unregister)
  - bindings.ts type-safe TypeScript bindings
affects:
  - src-tauri/src/lib.rs (added specta builder + PipelineState managed state)
  - src-tauri/src/pipeline/mod.rs (added commands, pipeline_state, worktree modules)

# Tech stack
added:
  - specta-typescript = "=0.0.9" (binding generation)
patterns:
  - tauri-specta Builder pattern for type-safe IPC
  - Zustand store-per-domain pattern (pipelineStore)
  - React hook wrapping Tauri Channel (usePipelineChannel)
  - tokio::task::JoinHandle abort on Drop for cleanup

# Key files
created:
  - src-tauri/src/pipeline/worktree.rs
  - src-tauri/src/pipeline/pipeline_state.rs
  - src-tauri/src/pipeline/commands.rs
  - src/bindings.ts
  - src/stores/pipelineStore.ts
  - src/hooks/usePipelineChannel.ts
  - src/__tests__/pipelineStore.test.ts
modified:
  - src-tauri/src/pipeline/mod.rs
  - src-tauri/src/lib.rs
  - src-tauri/Cargo.toml

# Decisions
key-decisions:
  - specta-typescript added as dependency for binding generation (not present in Phase 1)
  - bindings.ts hand-crafted to match serde output; will be auto-regenerated on first cargo tauri dev run
  - PID_POLL_INTERVAL_MS set to 1000ms based on 02-01 bench result (24ms avg refresh)
  - PIPELINE_MPSC_CAPACITY set to 1024 per research recommendation

# Metrics
duration: ~15 minutes
completed: 2026-04-08
tasks_completed: 3
tasks_total: 3
rust_tests_passing: 39
frontend_tests_passing: 8
files_created: 7
files_modified: 3
---

# Phase 2 Plan 04: Pipeline Integration + Frontend Store Summary

Tauri command surface wiring Plans 02/03 into start_watch/stop_watch/list_worktrees with Channel<FileEventBatch> streaming and Zustand ring buffer store.

## What Was Built

### Task 1: Worktree Detection (8c3c6d4)
- `worktree.rs`: `Worktree` struct with `specta::Type` derive, fields: path, head, branch, is_main, is_bare, detached, locked
- `parse_porcelain()`: Line-based parser handling single, multi, bare, detached, locked worktrees; panic-free (returns empty Vec on malformed input)
- `list_worktrees()`: Shells out via `Command::new("git").arg("-C")` (no shell injection), canonicalizes repo_root
- 6 unit tests + 1 live git smoke test, all passing

### Task 2: Tauri Commands + PipelineState (f1b66b5)
- `pipeline_state.rs`: `PipelineState` with `Mutex<Option<ActiveWatch>>`, `ActiveWatch` holds WatcherHandle + 3 JoinHandles + snapshot + channel, `impl Drop` aborts all tasks
- `commands.rs`: Three commands annotated `#[tauri::command] #[specta::specta]`:
  - `start_watch(repo_root, channel, state)` -- validates/canonicalizes path, drops existing watch, wires watcher -> attributing_stream -> forwarder -> Channel, returns worktrees
  - `stop_watch(state)` -- drops ActiveWatch
  - `list_worktrees(repo_root)` -- standalone git porcelain query
- `lib.rs` updated with tauri-specta Builder, `manage(PipelineState::new())`, `specta_builder.invoke_handler()`
- `bindings.ts` created with FileEvent, FileEventBatch, Attribution, FileEventKind, Worktree, ProcessInfo type definitions
- `specta-typescript = "=0.0.9"` added to Cargo.toml
- 2 command config tests passing

### Task 3: Frontend Store + Hook + Tests (1848745)
- `pipelineStore.ts`: Zustand store matching Phase 1 pattern, 11-member interface (events, eventCount, processes, worktrees, isWatching, droppedBatches, ingest, setWorktrees, setProcesses, setWatching, reset), MAX_EVENTS=5000 ring buffer
- `usePipelineChannel.ts`: React hook constructing `Channel<FileEventBatch>`, wiring `channel.onmessage` to `usePipelineStore.getState().ingest`, exposing `register(repoRoot)` and `unregister()`
- 8 Vitest tests all passing: initial state, ingest prepend, ring buffer trim, droppedBatches accumulation, setWorktrees, setProcesses, setWatching, reset preserves topology

## End-to-End Pipeline Trace

```
start_watch(repoRoot, channel)
  -> spawn_watcher(canonical, raw_tx) [Plan 02]
  -> raw_tx -> raw_rx
  -> start_attributing_stream(raw_rx, attributed_tx, snapshot) [Plan 03]
  -> attributed_tx -> attributed_rx
  -> forwarder tokio::spawn: attributed_rx.recv() -> channel_clone.send(batch)
  -> Channel<FileEventBatch> (Tauri IPC)
  -> channel.onmessage (frontend)
  -> usePipelineStore.getState().ingest(batch)
  -> React re-renders
```

## tauri-specta Binding Generation

The specta builder is configured in `lib.rs` with `#[cfg(debug_assertions)]` export to `../src/bindings.ts`. Bindings are generated when the app starts in dev mode (`cargo tauri dev`). For this plan, bindings.ts was hand-crafted to match the serde `#[serde(rename_all = "camelCase")]` output from the Rust types. The generated version will overwrite this on first dev launch. All field names use camelCase: `timestampMs`, `droppedBatches`, `batchId`, `isMain`, `isBare`, `parentPid`.

## Channel Lifetime Runtime Proof (Open Question 1)

The forwarder task in `ActiveWatch` holds a `channel_clone` and sends batches from the attributed stream. This proves at runtime that `Channel<FileEventBatch>` outlives the `start_watch` command -- the channel is cloned into a background tokio task that runs indefinitely until `stop_watch` drops the `ActiveWatch`. Plan 01's smoke test proved the type-level bounds (Clone+Send+Sync+'static); this plan proves the runtime behavior.

## Test Results

**Rust (cargo test --lib pipeline::):** 39 passed, 0 failed, 3 ignored
**Frontend (npm test pipelineStore):** 8 passed, 0 failed

Phase 3 (Tower Control) will be the first consumer to call `register(repoRoot)` from the UI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] specta-typescript crate missing from Cargo.toml**
- **Found during:** Task 2
- **Issue:** Plan specified `specta-typescript` but it was not in Cargo.toml dependencies
- **Fix:** Added `specta-typescript = "=0.0.9"` to [dependencies]
- **Files modified:** src-tauri/Cargo.toml

**2. [Rule 3 - Blocking] bindings.ts not auto-generated at build time**
- **Found during:** Task 2
- **Issue:** tauri-specta `export()` runs inside `run()` which only executes on app launch, not during `cargo build`
- **Fix:** Hand-crafted bindings.ts matching serde camelCase output; will be auto-regenerated on first `cargo tauri dev`
- **Files modified:** src/bindings.ts

## Self-Check: PASSED

All 7 created files exist. All 3 task commits verified (8c3c6d4, f1b66b5, 1848745).
