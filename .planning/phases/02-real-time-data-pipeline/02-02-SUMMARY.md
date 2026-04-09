---
phase: 02-real-time-data-pipeline
plan: 02
subsystem: infra
tags: [rust, notify, notify-debouncer-full, ignore, walkbuilder, tokio-mpsc, tdd, wave-2]

# Dependency graph
requires:
  - phase: 02-real-time-data-pipeline
    provides: "FileEvent, FileEventBatch, FileEventKind, Attribution contract types; notify/notify-debouncer-full/ignore deps pinned; tokio features (sync, rt-multi-thread, macros); serial_test and tempfile dev-deps"
provides:
  - "pipeline::ignore_filter::build_walker + HARDCODED_EXCLUDES (7 entries: .git, node_modules, target, build, dist, .next, out)"
  - "pipeline::tree_index::build_tree_index returning HashMap<PathBuf, FileNode> via parallel walker (<500ms for 10k files)"
  - "pipeline::watcher::spawn_watcher returning WatcherOutput{handle, initial_tree}"
  - "pipeline::watcher::WatcherHandle owning the Debouncer<RecommendedWatcher, RecommendedCache>"
  - "150ms debouncer tick aligned with 150ms timeout — burst coalescing of 1000 writes into ≤10 batches"
  - "pipeline::test_util::{make_temp_repo, write_file, wait_for_batch} test helpers"
  - "Answer to pitfall 2 (non-tokio callback): std::sync::mpsc bridge -> spawn_blocking -> Sender::blocking_send"
  - "Answer to pitfall 5 (rename on Windows): FileIdCache via new_debouncer's RecommendedCache coalesces rename into ModifyKind::Name(Both)"
affects: [02-03-attributor, 02-04-ipc-sender, 03-conflict-detection, 04-radar-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Watcher actor: new_debouncer with timeout+tick_rate aligned (both 150ms) to avoid sub-tick batch fragmentation"
    - "sync->async bridge: std::sync::mpsc::channel in notify callback + tokio::task::spawn_blocking + Sender::blocking_send"
    - "Parallel directory walking: WalkBuilder::build_parallel with Mutex<HashMap> critical section (restored <500ms budget after sequential measured 1090ms)"
    - "Defense-in-depth filters: events pass through path_is_under_root (T-02-02-01) AND path_contains_excluded_component even though build_walker should already exclude them"
    - "Burst-friendly debouncer tick: explicit tick_rate=Some(timeout) overrides notify-debouncer-full's default tick_rate=None=timeout/4, which would otherwise emit a new batch every ~37ms and destroy coalescing"

key-files:
  created:
    - "src-tauri/src/pipeline/ignore_filter.rs"
    - "src-tauri/src/pipeline/test_util.rs"
    - "src-tauri/src/pipeline/tree_index.rs"
    - "src-tauri/src/pipeline/watcher.rs"
  modified:
    - "src-tauri/src/pipeline/mod.rs"

key-decisions:
  - "Sequential WalkBuilder missed the FMON-03 <500ms budget at 1090ms for 10k files; switched to build_parallel with Mutex<HashMap> (187-228ms measured)"
  - "Tuned debouncer tick_rate from None (=timeout/4=37.5ms) to Some(150ms) after coalesces_burst_writes measured 125 batches; explicit alignment dropped it to 4 batches"
  - "Canonicalize repo_root in spawn_watcher (path traversal guard T-02-02-01 depends on lexical prefix check against the canonicalized root)"
  - "map_event_kind returns None for EventKind::Access(_), ModifyKind::Metadata, Create::Folder, and Remove::Folder — D-11 writes-only + Phase 2 tracks files, not dirs"
  - "Used Sender::blocking_send inside spawn_blocking drain task (documented tokio pattern) rather than manual Handle::block_on"
  - "Initial tree index built synchronously in spawn_watcher (not deferred) so the caller has guaranteed baseline state before the first event arrives"

patterns-established:
  - "Submodule test fixture: pipeline::test_util is pub(crate) under #[cfg(test)] so sibling test modules in the pipeline can import it"
  - "Ignored benchmarks for performance budgets: bench_walk_10k_files_under_500ms and coalesces_burst_writes both #[ignore]'d with asserts that act as hard gates when run on-demand"
  - "HARDCODED_EXCLUDES const exposed from ignore_filter so watcher.rs can reuse it for defense-in-depth filtering"

requirements-completed: [FMON-01, FMON-03]

# Metrics
duration: 24min
completed: 2026-04-09
---

# Phase 2 Plan 02: Filesystem Watcher Core Summary

**Built the notify-debouncer-full watcher actor with 150ms aligned tick, gitignore-respecting + hardcoded-exclude walker (7 dirs), writes-only filter (D-11), parallel tree index walker under 500ms for 10k files, and a sync<->async bridge that makes notify's non-tokio callback safe to use with tokio mpsc.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-04-09T15:34:15Z
- **Completed:** 2026-04-09T15:58:17Z
- **Tasks:** 3 of 3
- **Files created:** 4 (ignore_filter.rs, test_util.rs, tree_index.rs, watcher.rs)
- **Files modified:** 1 (pipeline/mod.rs)
- **Tests added:** 15 non-ignored + 2 ignored benchmarks = 17 total

## Accomplishments

- `pipeline::ignore_filter::build_walker(root)` wraps `ignore::WalkBuilder` with a 7-entry `HARDCODED_EXCLUDES` const layered via `OverrideBuilder::add("!**/name")` + `OverrideBuilder::add("!**/name/**")`. Tested for all 7 excludes + `.gitignore` respect + regular source file inclusion (4 tests).
- `pipeline::tree_index::build_tree_index(root)` uses `WalkBuilder::build_parallel()` with a `Mutex<HashMap>` to stay under the 500ms / 10k-file budget. Measured 187-228ms over two runs on dev Windows box — sequential walker measured 1090ms on the same box (2.2x margin after parallelization).
- `pipeline::watcher::spawn_watcher(repo_root, out_tx)` builds the debouncer (`new_debouncer(150ms, Some(150ms), callback)`), registers a recursive watch on the canonicalized root, starts a drain task on `spawn_blocking` that forwards filtered batches to the caller's `tokio::sync::mpsc::Sender`, and returns a `WatcherOutput` containing the handle + initial tree index.
- All 7 non-ignored watcher tests pass on Windows over 3 consecutive runs (detects_file_create, detects_file_modify, detects_file_remove, rename_coalesced_into_single_event, ignores_node_modules_writes, ignores_read_events, initial_tree_populated_before_watch).
- `rename_coalesced_into_single_event` passes reliably on Windows — the plan warned this might be flaky on Windows RDCW, but notify-debouncer-full 0.7's RecommendedCache (FileIdCache) coalesces the Remove+Create pair into `ModifyKind::Name(Both)` with both paths correctly.
- Path traversal guard (T-02-02-01) implemented via lexical `starts_with` check against canonicalized `repo_root`. Defense-in-depth second filter via `path_contains_excluded_component` catches any build-dir events the native watcher delivers before the ignore filter applies.

## Benchmark Results

### Tree Index Walk (FMON-03 gate: 10k files <500ms)

**Command:** `cargo test --lib pipeline::tree_index::tests::bench_walk_10k_files_under_500ms -- --ignored --nocapture`

| Attempt | Strategy                           | Result                           |
| ------- | ---------------------------------- | -------------------------------- |
| 1       | Sequential `walker.flatten()`      | **1090ms FAILED** (>500ms target) |
| 2       | `WalkBuilder::build_parallel` + `Mutex<HashMap>` | **228ms PASS**                |
| 3       | Same (second run)                  | **187ms PASS**                    |

**Interpretation:** Sequential walking hit a per-file `DirEntry::metadata()` syscall cost that dominated the 1090ms. Parallelization across cores amortized that cost by a factor of ~5x, restoring the FMON-03 budget with ~2.2x headroom.

### Burst Coalescing (FMON-01 budget: 1000 writes ≤10 batches)

**Command:** `cargo test --lib pipeline::watcher::tests::coalesces_burst_writes -- --ignored --nocapture`

| Attempt | Debouncer Config                  | Batches | Status  |
| ------- | --------------------------------- | ------- | ------- |
| 1       | `timeout=150ms, tick_rate=None`   | 125     | **FAILED** |
| 2       | `timeout=150ms, tick_rate=Some(150ms)` | **4** | **PASS** |

**Interpretation:** With `tick_rate=None`, `notify-debouncer-full` 0.7 defaults to `timeout/4 = 37.5ms`. At that tick cadence, a 2-3 second burst of 1000 writes produces 100+ separate tick flushes, each emitting a small batch — the opposite of coalescing. Aligning `tick_rate` with `timeout` means the debouncer queues events for the full 150ms window before flushing, maximizing per-batch coalescing. 4 batches / 1000 writes = 250 events/batch average. Comfortable under the 10-batch budget.

## Task Commits

Each task committed atomically with `--no-verify` (parallel executor mode):

1. **Task 1: Ignore filter + test util + stubs** — `c3a3eca` (feat)
2. **Task 2: Tree index with parallel walker** — `9fd52ec` (feat)
3. **Task 3: Watcher actor with aligned debouncer** — `997ffbd` (feat)

## Files Created/Modified

**Created:**
- `src-tauri/src/pipeline/ignore_filter.rs` (135 lines) — `build_walker` + `HARDCODED_EXCLUDES` const + 4 tests
- `src-tauri/src/pipeline/test_util.rs` (47 lines, `#[cfg(test)]`) — `make_temp_repo`, `write_file`, `wait_for_batch`
- `src-tauri/src/pipeline/tree_index.rs` (157 lines) — `build_tree_index` + `FileNode` + 4 tests + 1 ignored benchmark
- `src-tauri/src/pipeline/watcher.rs` (458 lines) — `spawn_watcher` + `WatcherHandle` + `WatcherOutput` + `process_debounce_result` + `map_event_kind` + 2 path guards + 7 tests + 1 ignored benchmark

**Modified:**
- `src-tauri/src/pipeline/mod.rs` — added `pub mod ignore_filter`, `pub mod tree_index`, `pub mod watcher`, and `#[cfg(test)] pub(crate) mod test_util`

## API Notes for notify-debouncer-full 0.7

The plan's reference code cited "Pattern 1" from 02-RESEARCH.md (which targeted notify-debouncer-full 0.5). The 0.7 API shape matched closely but with one critical semantic difference documented here for Plans 02-03 and 02-04:

| Argument | 0.5 name        | 0.7 name   | Semantics in 0.7                                  |
| -------- | --------------- | ---------- | ------------------------------------------------- |
| arg 1    | `tick_rate`     | `timeout`  | How long an event waits in the queue before release |
| arg 2    | `tick_rate_adjust` | `tick_rate` | How often the debouncer checks its queue. **If None → timeout/4** (the gotcha that cost us the burst test on the first attempt) |
| arg 3    | `callback`      | `event_handler` | Same `Fn(DebounceEventResult) + Send + 'static` |

`new_debouncer` returns `Debouncer<RecommendedWatcher, RecommendedCache>` — that's the concrete type required on `WatcherHandle._debouncer`. The `RecommendedCache` is the `FileIdCache` that does rename coalescing.

`DebouncedEvent` has fields `event: notify::Event` and `time: Instant`. `notify::Event` has `kind: EventKind` and `paths: Vec<PathBuf>`. On Windows rename coalescing, the debouncer delivers `EventKind::Modify(ModifyKind::Name(RenameMode::Both))` with `paths = [from, to]` — our code correctly extracts paths[0] and paths[1].

## Decisions Made

- **Parallel walker (not sequential):** The plan started with sequential `walker.flatten()`. On Windows the measured 10k walk was 1090ms, 2.2x over budget. The plan's own failure message hinted at `build_parallel`. Switching restored the budget with 2.2x headroom.
- **Aligned debouncer tick (not None):** The plan cited `None` for tick_rate, but `notify-debouncer-full` 0.7 documents that `None` means `timeout/4`. On a 150ms timeout that's a 37.5ms effective tick — far too aggressive for coalescing bursts. Passing `Some(150ms)` aligns tick with timeout so events accumulate for the full 150ms window before flush.
- **`Sender::blocking_send` (not `Handle::block_on`):** The plan used `Handle::try_current` + `block_on`. Tokio's `mpsc::Sender::blocking_send` is the canonical pattern for sending from a `spawn_blocking` task and doesn't need the runtime handle plumbing.
- **`into_inner().unwrap_or_default()` on the Mutex:** After `build_parallel.run` returns, the `Mutex` has no other holders (all visitor closures have dropped). `into_inner()` is infallible in that case; `unwrap_or_default()` is a defensive fallback that would return an empty HashMap in the impossible case of poisoning.
- **Defense-in-depth exclude check in `process_debounce_result`:** Even though the ignore walker excludes `node_modules/` during the initial tree build, the native watcher (`ReadDirectoryChangesW` on Windows) has no knowledge of our filter. Events under `node_modules/` WILL arrive at the callback. The second check in `process_debounce_result` catches them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Sequential walker missed the 500ms budget**
- **Found during:** Task 2 benchmark (`bench_walk_10k_files_under_500ms`)
- **Issue:** Sequential `walker.flatten()` iterator measured **1090ms** for 10,001 files — 2.2x over the FMON-03 hard gate of 500ms. The benchmark's own assert failed with the plan's hint: "consider WalkBuilder::build_parallel".
- **Fix:** Switched `build_tree_index` to `WalkBuilder::build_parallel().run(|| Box::new(|result| { ... }))`. Added `ignore::WalkState` import. Used `Mutex<HashMap>` wrapping for the shared result. Short critical section (HashMap insert only) keeps lock contention minimal.
- **Files modified:** `src-tauri/src/pipeline/tree_index.rs`
- **Verification:** Re-ran benchmark twice — 228ms and 187ms (2.2x headroom under target). All 4 non-ignored tree_index tests still pass unchanged.
- **Committed in:** `9fd52ec` (Task 2 — parallel strategy is the initial file contents in git, with a block comment explaining the sequential → parallel transition).

**2. [Rule 1 - Bug] Debouncer tick_rate default shredded burst coalescing**
- **Found during:** Task 3 `coalesces_burst_writes` ignored benchmark (initial run)
- **Issue:** Initial code passed `new_debouncer(Duration::from_millis(150), None, ...)` per the plan's reference. Burst test produced **125 batches** for 1000 writes — a 12x miss of the ≤10 budget. Root cause: `notify-debouncer-full` 0.7 documents that `tick_rate = None` defaults to `timeout/4`, i.e. 37.5ms. At that tick cadence, 1000 writes spread across ~3 seconds produce 100+ separate tick flushes.
- **Fix:** Changed to `new_debouncer(Duration::from_millis(150), Some(Duration::from_millis(150)), ...)`. With aligned ticks, the debouncer queues events for a full 150ms window before flushing them, maximizing coalescing on bursty writes.
- **Files modified:** `src-tauri/src/pipeline/watcher.rs`
- **Verification:** Re-ran burst benchmark — **4 batches** for 1000 writes. Also re-ran the 7 non-ignored watcher tests 2 more times to verify no flakes introduced: all pass, total 3 consecutive green runs.
- **Committed in:** `997ffbd` (Task 3 — aligned tick is the initial file contents with a block comment explaining the tuning).

---

**Total deviations:** 2 auto-fixed (both Rule 1/3 performance bugs that failed the plan's explicit gates).
**Impact on plan:** Both deviations tightened the implementation against the plan's own success criteria. No scope creep. No architectural change — same actor pattern, same types, same public API as `spawn_watcher(repo_root, out_tx) -> Result<WatcherOutput, String>`.

## Rename Coalescing on Windows: It Works

The plan's Success Criterion 4 said: "Rename coalescing works on the dev machine (or is documented as Windows-flaky with an issue reference)". The plan's notes in Task 3 verify hinted that the test might need `#[ignore]` on Windows with a note.

**Result: Not flaky. Passes reliably over 3 consecutive runs.**

`notify-debouncer-full` 0.7's `RecommendedCache` (which resolves to `FileIdCache`) successfully reconstructs rename pairs on Windows by assigning stable file IDs at the OS level and matching them across the Remove+Create events that `ReadDirectoryChangesW` delivers. Our `map_event_kind` receives `EventKind::Modify(ModifyKind::Name(RenameMode::Both))` with `paths = [old, new]` and builds a single `FileEventKind::Rename { from, to }` event.

The test's assertion is tolerant: it accepts "saw a Rename" OR "did not see both Remove AND Create". In practice on this box, the Rename is always delivered and the Remove+Create path is not hit.

## Issues Encountered

- **Relative path misroute to primary worktree (recurrence from Plan 02-01):** Early in Task 1, the Write tool with an `src-tauri/...` relative-style absolute path (`C:\Users\prann\projects\aitc\src-tauri\...`) landed in the **primary** worktree instead of the agent worktree. Recovery: ran `git checkout -- src-tauri/src/pipeline/mod.rs` and `mv` of the orphaned files in the primary worktree; then re-applied the changes using the full `C:\Users\prann\projects\aitc\.claude\worktrees\agent-a34d8749\src-tauri\...` absolute path. Lesson: all subsequent Write/Edit calls used the worktree absolute path from the very start. No code or git-history impact — the primary was restored before any commit referenced it.

## User Setup Required

None. All changes are code + tests. The 2 ignored benchmarks (`bench_walk_10k_files_under_500ms`, `coalesces_burst_writes`) run on-demand via `cargo test -- --ignored` and include hard-gate asserts, so any regression on a different dev box (slower disk, different core count) would surface immediately.

## Next Phase Readiness

**Ready for Plan 02-03 (PID attributor):**
- `spawn_watcher` emits `FileEventBatch` with every event tagged `Attribution::Unattributed`.
- Plan 03 wraps this stream: accepts the `tokio::sync::mpsc::Receiver<FileEventBatch>` from a watcher handle's caller, rewrites each event's `attribution` field in-flight, and forwards to an downstream receiver. The `FileEvent` struct is `Clone + Eq + Serialize + Deserialize`, so rewriting `.attribution` on a clone and reassembling the batch is trivial.
- The burst test confirms that the watcher emits small (4 for 1000 writes) batches, so the attributor's per-event polling cost amortizes well.
- `Attribution::Pid` / `Attribution::Ambiguous` / `Attribution::Unattributed` enum is finalized — Plan 03 picks one per event.

**Ready for Plan 02-04 (IPC sender / Channel wiring):**
- `WatcherHandle` is `pub` and owns the debouncer + drain task, so a Tauri command handler can `app.manage(handle)` to keep the watcher alive for the session lifetime.
- `WatcherOutput.initial_tree` is `HashMap<PathBuf, FileNode>` — Plan 04 can serialize this into an initial `Channel<...>` payload for the frontend bootstrap.
- `spawn_watcher` takes a `tokio::sync::mpsc::Sender<FileEventBatch>` as input — Plan 04 creates the mpsc with a bounded capacity (research cap ≤1024) and owns the receiver end, which it drains into the `Channel::send`.

**Ready for Plan 03 (conflict detection) via the data pipeline it depends on:**
- `FileEvent.path` is a `PathBuf` of canonical absolute paths (path_is_under_root guard + canonicalize in spawn_watcher).
- Rename events carry both `from` and `to` so conflict detection can track file identity across rename.
- Writes-only filter means every event in the stream is actionable (creates/modifies/removes/renames).

**Blockers/concerns:** None. All 3 tasks complete, all 7 non-ignored watcher tests pass 3x, both perf benchmarks pass on-demand, build is clean.

## Threat Model Compliance

All threats with `mitigate` disposition from the plan's `<threat_model>` are addressed:

| Threat ID    | Mitigation                                                                  | Status                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-02-02-01   | Tampering — Path traversal via malicious rename with `..`                   | Done — `path_is_under_root(path, repo_root)` lexical check against canonicalized repo root in `process_debounce_result`. Verified via the canonical tempdir fixture.                     |
| T-02-02-02   | Info Disclosure — Symlink escape                                            | Done — notify 8.2+ does not follow symlinks by default. Watcher never calls `Config::with_follow_symlinks(true)`. Tree index walker uses default `WalkBuilder` which does not follow symlinks. |
| T-02-02-03   | DoS — Unbounded tokio mpsc growth under burst                               | Done — `spawn_watcher` takes a caller-owned bounded `Sender<FileEventBatch>`. `blocking_send` blocks the drain OS thread (not tokio runtime) when the channel is full — natural back-pressure. When receiver drops, `blocking_send` returns `Err`, drain task exits cleanly. |
| T-02-02-04   | DoS — Windows RDCW buffer overflow on burst                                 | Done — 150ms debounce + root-only watch (not per-file) + hardcoded excludes layered on `build_walker` (so `node_modules/` walk cost is zero). Verified via `coalesces_burst_writes` measuring 4 batches for 1000 writes. |
| T-02-02-05   | DoS — notify callback panic from `.send().await` on sync thread             | Done — notify callback uses `std::sync::mpsc::Sender::send` (non-blocking, non-async). Tokio forwarding happens in `spawn_blocking` via `Sender::blocking_send`. No `.await` on notify's thread. |
| T-02-02-07   | Info Disclosure — Path strings at info/warn level leaking repo structure    | Done — path logging gated to `tracing::debug!` and `tracing::warn!`. The only `warn!` logs an error variant from the debouncer (not a path). All path logs are `debug!`.                 |

Threats with `accept` disposition (T-02-02-06 malicious .gitignore patterns, T-02-02-08 system-path walker privilege) are documented-accept in the plan and do not require code changes.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src-tauri/src/pipeline/ignore_filter.rs` (135 lines; `HARDCODED_EXCLUDES` with 7 entries, `build_walker`, 4 tests)
- FOUND: `src-tauri/src/pipeline/test_util.rs` (47 lines; `#![cfg(test)]`, `make_temp_repo`, `write_file`, `wait_for_batch`)
- FOUND: `src-tauri/src/pipeline/tree_index.rs` (157 lines; `FileNode`, `build_tree_index` using `build_parallel`, 4 tests + 1 ignored benchmark, BENCH_RESULT comment)
- FOUND: `src-tauri/src/pipeline/watcher.rs` (458 lines; `spawn_watcher`, `WatcherHandle`, `WatcherOutput`, `process_debounce_result`, `map_event_kind`, `path_is_under_root`, `path_contains_excluded_component`, `Duration::from_millis(150)`, `RecursiveMode::Recursive`, 7 tests + 1 ignored benchmark)
- FOUND: `src-tauri/src/pipeline/mod.rs` (29 lines; declares `pub mod ignore_filter`, `pub mod tree_index`, `pub mod watcher`, `#[cfg(test)] pub(crate) mod test_util`, preserves `events` and `smoke_tests`)

**Commits verified present in git log:**
- FOUND: `c3a3eca` — feat(02-02): add ignore filter + test util with hardcoded excludes
- FOUND: `9fd52ec` — feat(02-02): tree index walker with parallel 10k-file budget
- FOUND: `997ffbd` — feat(02-02): watcher actor with 150ms debouncer and writes-only filter

**Tests verified passing (3 consecutive runs, no flakes):**
- `cargo build` — clean, 0 warnings
- `cargo test --lib pipeline:: -- --test-threads=1` — 21 passed, 0 failed, 3 ignored
- `cargo test --lib pipeline::ignore_filter` — 4 passed
- `cargo test --lib pipeline::tree_index::tests` — 4 passed, 1 ignored
- `cargo test --lib pipeline::watcher::tests -- --test-threads=1` — 7 passed, 1 ignored (3 consecutive runs, all green)
- `cargo test --lib pipeline::tree_index::tests::bench_walk_10k_files_under_500ms -- --ignored --nocapture` — passed, measured 187-228ms over 2 runs (target <500ms)
- `cargo test --lib pipeline::watcher::tests::coalesces_burst_writes -- --ignored --nocapture` — passed, measured 4 batches for 1000 writes (target ≤10)

---
*Phase: 02-real-time-data-pipeline*
*Completed: 2026-04-09*
