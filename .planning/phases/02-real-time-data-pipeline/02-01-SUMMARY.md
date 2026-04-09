---
phase: 02-real-time-data-pipeline
plan: 01
subsystem: infra
tags: [rust, cargo, notify, notify-debouncer-full, sysinfo, ignore, tauri-ipc-channel, specta, serde, tdd]

# Dependency graph
requires:
  - phase: 01-foundation-app-shell
    provides: Tauri v2 backend skeleton, lib.rs module pattern (mod db; mod tray;), sqlx + tauri-specta already wired
provides:
  - Phase 2 Rust dependencies pinned and resolved (notify 8.2, notify-debouncer-full 0.7, sysinfo 0.38, ignore 0.4, chrono with serde, tracing)
  - src-tauri/src/pipeline/ module scaffold with public type contract
  - FileEvent, FileEventBatch, FileEventKind, Attribution (serde + specta::Type derives, camelCase tagged enums)
  - Answer to research Open Question 1 (Channel<FileEventBatch> is Clone+Send+Sync+'static) verified at compile time
  - Answer to research Open Question 2 (sysinfo refresh cost: 24ms avg on 417 processes, safely under 50ms target) measured and persisted
  - Rust dev-dependency baseline (tempfile 3, serial_test 3) for filesystem-fixture tests used in plans 02-02..02-04
affects: [02-02-watcher, 02-03-attributor, 02-04-ipc-sender, 03-conflict-detection, 04-radar-visualization]

# Tech tracking
tech-stack:
  added:
    - "notify 8.2.0 (cross-platform filesystem watcher)"
    - "notify-debouncer-full 0.7.0 (event batching + rename coalescing via FileIdCache)"
    - "sysinfo 0.38.4 (process enumeration for PID attribution)"
    - "ignore 0.4.25 (ripgrep's .gitignore-aware directory walker)"
    - "tracing 0.1.44 (structured logging)"
    - "chrono 0.4.44 with serde feature (timestamp_ms serialization)"
    - "tempfile 3.27.0 (dev-dependency, temp repo fixtures)"
    - "serial_test 3.4.0 (dev-dependency, serialize filesystem tests)"
  patterns:
    - "Module root pattern: mod.rs re-exports types from submodules (pub use events::{...})"
    - "Tagged discriminated unions: #[serde(tag = \"kind\", content = \"value\", rename_all = \"camelCase\")] for Attribution"
    - "Kind-tagged unions: #[serde(tag = \"kind\", rename_all = \"camelCase\")] for FileEventKind (struct-variant Rename carries from/to)"
    - "Wave 0 module-level #![allow(dead_code)] for contract types that downstream plans will consume"
    - "#[ignore]'d Rust benchmarks: cargo test pattern for on-demand perf checks with persisted BENCH_RESULT comments"
    - "Type-level assertion pattern: assert_clone/send/sync/static<T>() functions to prove trait bounds at compile time"

key-files:
  created:
    - "src-tauri/src/pipeline/mod.rs"
    - "src-tauri/src/pipeline/events.rs"
    - "src-tauri/src/pipeline/smoke_tests.rs"
  modified:
    - "src-tauri/Cargo.toml"
    - "src-tauri/Cargo.lock"
    - "src-tauri/src/lib.rs"

key-decisions:
  - "Pinned notify-debouncer-full to 0.7.0 (research override of CLAUDE.md's stale ^0.4 — v0.7 is the version that pairs with notify 8.2)"
  - "Expanded tokio feature set to include sync, rt-multi-thread, macros for the actor pattern in Plan 02-02"
  - "Suppress dead-code warnings at pipeline module level during Wave 0 since types are scaffolded for Plans 02-02..02-04 consumption"
  - "Persist sysinfo benchmark result (24ms avg on 417 processes) in smoke_tests.rs BENCH_RESULT comment rather than a side channel, so Plan 02-03 can read it from source of truth"
  - "Channel lifetime verified at type level only in Wave 0; the full runtime test (send from a later scope after command drops) is deferred to Plan 02-04 Task 2 where an actual Tauri command exists"

patterns-established:
  - "Pipeline submodule layout: src-tauri/src/pipeline/{mod.rs,events.rs,smoke_tests.rs} with smoke_tests as #[cfg(test)] only"
  - "Downstream consumption: crate::pipeline::{Attribution, FileEvent, FileEventBatch, FileEventKind} via re-export at module root"
  - "Wave 0 gating: smoke tests answer research Open Questions before Waves 1-3 build architecture on assumptions"

requirements-completed: [FMON-01, FMON-02, FMON-03, FMON-04]

# Metrics
duration: 34min
completed: 2026-04-09
---

# Phase 2 Plan 01: Phase 2 Dependencies, Pipeline Module Scaffold, and Wave 0 Validation Summary

**Pinned notify 8.2 + notify-debouncer-full 0.7 (research override) + sysinfo 0.38, scaffolded the `pipeline` module with `FileEvent`/`FileEventBatch` contract types, and proved both research open questions (Channel lifetime at type level; sysinfo refresh measured at 24ms avg — well under the 50ms target).**

## Performance

- **Duration:** 34 min (includes one-time 2m40s rustc toolchain update from 1.87 -> 1.94.1 required by sysinfo 0.38)
- **Started:** 2026-04-09T14:45:56Z
- **Completed:** 2026-04-09T15:20:56Z
- **Tasks:** 3 of 3
- **Files modified:** 6 (2 modified, 3 created, Cargo.lock regenerated)
- **Tests added:** 6 non-ignored + 1 ignored benchmark = 7 total

## Accomplishments

- All Phase 2 Rust dependencies pinned at research-verified versions and resolved by Cargo.lock (notify 8.2.0, notify-debouncer-full 0.7.0, sysinfo 0.38.4, ignore 0.4.25, chrono 0.4.44, tracing 0.1.44, tempfile 3.27.0, serial_test 3.4.0)
- `src-tauri/src/pipeline/` module exists and is registered in `lib.rs` alongside `db` and `tray` — downstream plans can import via `crate::pipeline::{...}` without further work
- Type contract (`FileEvent`, `FileEventBatch`, `FileEventKind`, `Attribution`) defined with `serde + specta::Type` so Plan 02-04 gets automatic TypeScript bindings via tauri-specta
- Research Open Question 1 resolved: `tauri::ipc::Channel<FileEventBatch>` is `Clone + Send + Sync + 'static` — verified at compile time via the `assert_clone/send/sync/static` pattern. Plan 02-02 can safely clone a channel into its tokio actor
- Research Open Question 2 resolved: sysinfo refresh averaged **24ms** over 5 samples on 417 processes (Windows 11, rustc 1.94.1). Comfortably under the 50ms target; Plan 02-03 may proceed with 1000ms polling without tuning. Persisted in `smoke_tests.rs` `BENCH_RESULT` comment as source of truth
- 6 unit tests passing (4 events-tests + 2 smoke-tests); benchmark ignored-by-default so CI doesn't pay its cost

## Task Commits

Each task was committed atomically with `--no-verify` (parallel executor mode):

1. **Task 1: Add Phase 2 Rust dependencies to Cargo.toml** - `efc71cf` (chore)
2. **Task 2: Scaffold pipeline module with FileEvent/FileEventBatch types** - `f7ffe8e` (feat)
3. **Task 3: Wave 0 smoke tests — Channel lifetime + sysinfo benchmark** - `ba2eeff` (test)

## Files Created/Modified

**Created:**
- `src-tauri/src/pipeline/mod.rs` — module root with submodule declarations, public re-exports, and `#![allow(dead_code)]` gate for Wave 0 scaffolding
- `src-tauri/src/pipeline/events.rs` — `FileEvent`, `FileEventBatch`, `FileEventKind`, `Attribution` with serde + specta derives; `FileEvent::new` constructor stamping `chrono::Utc::now().timestamp_millis()`; 4 inline unit tests
- `src-tauri/src/pipeline/smoke_tests.rs` — Wave 0 smoke tests for Channel trait bounds and sysinfo benchmark; module-level `BENCH_RESULT` comment persists the measured 24ms number

**Modified:**
- `src-tauri/Cargo.toml` — added 6 production deps + 2 dev deps; expanded tokio features (`sync`, `rt-multi-thread`, `macros`); explanatory comment for notify-debouncer-full version override
- `src-tauri/Cargo.lock` — regenerated by `cargo build` with all new deps locked
- `src-tauri/src/lib.rs` — added `mod pipeline;` between `mod db;` and `mod tray;`

## Dependency Resolution (from Cargo.lock)

| Crate | Requested | Resolved | Notes |
|-------|-----------|----------|-------|
| notify | `"8"` | 8.2.0 | Current stable; pulls notify-types 2.1.0 |
| notify-debouncer-full | `"0.7"` | 0.7.0 | Released 2026-01-23; pulls file-id 0.2.3 |
| sysinfo | `"0.38"` | 0.38.4 | Required rustc 1.88+ (see Deviations) |
| ignore | `"0.4"` | 0.4.25 | ripgrep's walker |
| tracing | `"0.1"` | 0.1.44 | |
| chrono | `"0.4"` with `serde` | 0.4.44 | Serialize support for `timestamp_ms` field |
| tempfile | `"3"` (dev) | 3.27.0 | |
| serial_test | `"3"` (dev) | 3.4.0 | |

## Benchmark Result (Wave 0 Open Question 2)

**Command:** `cargo test --lib pipeline::smoke_tests::bench_sysinfo_refresh_cost -- --ignored --nocapture`

**Raw output:**
```
bench_sysinfo_refresh_cost: 417 processes, avg=24ms, samples=[34, 22, 19, 21, 26]
```

**Interpretation:**
- Target: <50ms per refresh (to justify 1Hz polling)
- Warning zone: 50-500ms (would suggest 2000ms polling)
- Blocker: ≥500ms (would peg a CPU core at 1Hz)
- **Measured: 24ms** — target met with 2x headroom
- **Plan 02-03 recommendation:** Proceed with 1000ms polling cadence as originally designed. No need to narrow `ProcessRefreshKind` or apply a name allowlist for cost reasons (though an allowlist is still desirable for accuracy per research A2)

**Environment:** Windows 11 Home, rustc 1.94.1, 417 running processes at time of measurement. The number should be revalidated on developer machines with meaningfully different process counts or hardware generations.

## Channel Lifetime Test (Wave 0 Open Question 1)

**What was proven:** `tauri::ipc::Channel<FileEventBatch>` satisfies `Clone + Send + Sync + 'static` at compile time via the type-level assertion pattern:

```rust
fn assert_clone<T: Clone>() {}
fn assert_send<T: Send>() {}
fn assert_sync<T: Sync>() {}
fn assert_static<T: 'static>() {}
assert_clone::<tauri::ipc::Channel<FileEventBatch>>();
assert_send::<tauri::ipc::Channel<FileEventBatch>>();
assert_sync::<tauri::ipc::Channel<FileEventBatch>>();
assert_static::<tauri::ipc::Channel<FileEventBatch>>();
```

This works because internally `Channel<T>` holds `Arc<ChannelInner> + PhantomData<T>`, and `ChannelInner` holds `Box<dyn Fn(...) + Send + Sync + 'static>` callbacks. `FileEventBatch` is a plain owned struct of primitives, so the bounds propagate cleanly.

**What was NOT proven (deferred to Plan 02-04 Task 2):**
- Whether `Channel::send()` errors or silently drops when the webview unmounts
- Whether a cloned channel can `send()` successfully after the original command scope has ended

These require a live Tauri runtime + webview, which is outside this plan's scope. Plan 02-04 will register a real command, clone the channel into a tokio task, drop the command scope, and assert `send()` still delivers.

## Decisions Made

- **Upgraded rustc 1.87 -> 1.94.1** via `rustup update stable` rather than pinning sysinfo to 0.36. The plan's must_haves explicitly require sysinfo 0.38, and the upgrade is a pure environment change with no code impact. Current stable is 1.94.1 (Mar 2026).
- **Module-level `#![allow(dead_code)]` in pipeline/mod.rs** rather than per-item `#[allow]` — simpler, and all types in the module are contract types that Plans 02-02..02-04 will consume.
- **Empty `smoke_tests.rs` placeholder created in Task 2** then fully populated in Task 3 — necessary because Task 2's `cargo test` verification requires the module to compile, and `mod.rs` declares `mod smoke_tests;`. Both commits land in history; the placeholder is visible only in `f7ffe8e` briefly.
- **`Attribution` uses tag+content serde form** (`{"kind":"pid","value":1234}`) rather than external tagging (`{"pid":1234}`) for TypeScript ergonomics — tag+content maps directly to a discriminated union with narrow-able `kind` field in TS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Upgraded rustc toolchain to unblock sysinfo 0.38**
- **Found during:** Task 1 (`cargo build` after adding Phase 2 deps)
- **Issue:** `rustc 1.87.0 is not supported by the following package: sysinfo@0.38.4 requires rustc 1.88`. The full 0.37+ minor line of sysinfo requires rustc 1.88, and the plan must_haves pin sysinfo to 0.38.
- **Fix:** Ran `rustup update stable`, which moved the toolchain from 1.87.0 (May 2025) to 1.94.1 (Mar 2026). All existing phase-1 code compiles unchanged; no source edits required.
- **Files modified:** None (environment-only change).
- **Verification:** `cargo build` succeeded after the update in 5m 36s, compiling all new deps (notify 8.2.0, notify-debouncer-full 0.7.0, sysinfo 0.38.4, ignore 0.4.25, chrono 0.4.44). All pre-existing phase-1 deps recompiled cleanly.
- **Committed in:** Environment change is not in git; the resulting Cargo.lock is part of `efc71cf` (Task 1 commit).

**2. [Rule 2 - Missing Critical] Module-level `#![allow(dead_code)]` gate in pipeline/mod.rs**
- **Found during:** Task 2 (`cargo build` after creating the types)
- **Issue:** Because the types in `events.rs` are a pure contract for Plans 02-02..02-04 to consume, `cargo build` emitted 7 warnings (unused imports in the re-export, `enum ... is never used`, `struct ... is never constructed`, `associated function ... is never used`). Warnings are not errors, but leaving 7 dead-code warnings on a scaffolding commit would leak into every future `cargo build` between Wave 0 and Wave 1.
- **Fix:** Added `#![allow(dead_code)] #![allow(unused_imports)]` at the top of `pipeline/mod.rs` with a docstring explaining this is Wave 0 scaffolding. Downstream plans (02-02..02-04) will naturally "use" these types and can remove the allows when they do so.
- **Files modified:** `src-tauri/src/pipeline/mod.rs`
- **Verification:** `cargo build` reports 0 warnings after the change. `cargo test --lib pipeline::` still passes 6/6 non-ignored tests.
- **Committed in:** `f7ffe8e` (Task 2 commit — the allows are part of the initial mod.rs contents in git).

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both fixes were necessary to meet the plan's must-haves (sysinfo 0.38 pinned, build clean). Neither introduced scope creep. The rustc upgrade is environmental and reversible; the dead-code gate is self-limiting to the pipeline module and gets naturally removed as Plans 02-02..02-04 consume the types.

## Issues Encountered

- **Relative path misroute to primary worktree:** Early in Task 1, the `Edit` tool with a short path matched the primary worktree's `Cargo.toml` rather than this agent's worktree. Recovery: `git checkout -- src-tauri/Cargo.toml` in the primary worktree, then re-applied the edit using the absolute worktree path. Lesson: only absolute worktree paths for Edit/Write on this machine. No code or history impact — the primary worktree was restored before any commit referenced it.
- **Cargo test with multiple TESTNAME arguments:** `cargo test --lib foo::bar foo::baz` is not valid syntax (`cargo test` accepts a single positional filter). Worked around by using the common prefix `pipeline::smoke_tests::` which matches both non-ignored tests.

## User Setup Required

None — no external service configuration required. The sysinfo benchmark's 24ms result is machine-specific; it should be revalidated by any future developer with meaningfully different hardware, but this is a soft check (the `#[ignore]`'d benchmark can be rerun at any time).

## Next Phase Readiness

**Ready for Plan 02-02 (filesystem watcher actor):**
- `notify 8.2.0` and `notify-debouncer-full 0.7.0` resolved and compiling
- `FileEvent` / `FileEventBatch` contract types exist, can be constructed by the watcher's debouncer callback
- `tokio` has `sync`, `rt-multi-thread`, and `macros` features for `tokio::sync::mpsc::channel`, `tokio::spawn`, and `#[tokio::main]`/`#[tokio::test]`

**Ready for Plan 02-03 (PID attribution):**
- `sysinfo 0.38.4` resolved and compiling; API (`ProcessesToUpdate`, `ProcessRefreshKind`, `UpdateKind`, `refresh_processes_specifics`) verified against current docs via the smoke benchmark
- Benchmark result (24ms avg, 417 processes) persisted in `smoke_tests.rs` — Plan 02-03 can quote it directly when defending the 1000ms polling cadence choice
- `Attribution::{Pid, Ambiguous, Unattributed}` contract type exists; Plan 02-03's attributor returns instances of this enum directly

**Ready for Plan 02-04 (Channel IPC sender):**
- `Channel<FileEventBatch>` proven `Clone + Send + Sync + 'static` — safe to store in app state and clone into the sender actor
- `FileEventBatch` serializes cleanly with the expected camelCase field names (`batchId`, `droppedBatches`, `events`) — verified by the serde roundtrip smoke test
- Runtime Channel lifetime test (drop command scope, send from later scope) is explicitly deferred here and tracked as Plan 02-04 Task 2 scope — no ambiguity about where the work lives

**Blockers/concerns:** None. All Wave 0 validation work is complete; Waves 1-3 can proceed without needing to revisit assumptions.

## Threat Model Compliance

All threats with `mitigate` disposition from the plan's `<threat_model>` are addressed:

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-02-01-01 (Tampering — dep versions) | Pin minor versions, no `*` wildcards | Done — `notify = "8"`, `notify-debouncer-full = "0.7"`, `sysinfo = "0.38"`, `ignore = "0.4"` are all minor-pinned; Cargo.lock committed (`efc71cf`) |
| T-02-01-03 (Info disclosure — sysinfo benchmark in CI logs) | Benchmark prints count only, not names/paths; `#[ignore]`'d | Done — `bench_sysinfo_refresh_cost` only prints `process_count` (an integer) and timing samples. Marked `#[ignore]` so default `cargo test` skips it in CI |
| T-02-01-04 (DoS — sysinfo refresh cost) | Benchmark fails hard at ≥500ms; warns at ≥50ms | Done — `assert!(avg_ms < 500, ...)` is the hard gate; measured 24ms on this box so the gate is dormant but lives on for future environments |

## Self-Check: PASSED

**Files verified present:**
- FOUND: src-tauri/Cargo.toml (with `notify = "8"`, `notify-debouncer-full = "0.7"`, `sysinfo = "0.38"`, `ignore = "0.4"`, dev-deps `tempfile = "3"` and `serial_test = "3"`)
- FOUND: src-tauri/Cargo.lock (with resolved versions notify 8.2.0, notify-debouncer-full 0.7.0, sysinfo 0.38.4, ignore 0.4.25, tempfile 3.27.0, serial_test 3.4.0, tracing 0.1.44, chrono 0.4.44)
- FOUND: src-tauri/src/lib.rs (contains `mod pipeline;`)
- FOUND: src-tauri/src/pipeline/mod.rs (22 lines; declares `pub mod events`, `#[cfg(test)] mod smoke_tests`, re-exports all 4 types)
- FOUND: src-tauri/src/pipeline/events.rs (141 lines; `FileEvent`, `FileEventBatch`, `FileEventKind`, `Attribution` with 4 derives of specta::Type, 4 inline unit tests)
- FOUND: src-tauri/src/pipeline/smoke_tests.rs (162 lines; `channel_type_is_clone_send_sync_static`, `file_event_batch_serializes_for_channel_transport`, `#[ignore]`'d `bench_sysinfo_refresh_cost`; BENCH_RESULT comment with 24ms value)

**Commits verified present in git log:**
- FOUND: efc71cf (chore(02-01): add phase 2 real-time data pipeline dependencies)
- FOUND: f7ffe8e (feat(02-01): scaffold pipeline module with FileEvent contract types)
- FOUND: ba2eeff (test(02-01): add Wave 0 smoke tests for Channel lifetime and sysinfo cost)

**Tests verified passing:**
- `cargo test --lib pipeline::` — 6 passed, 0 failed, 1 ignored (the benchmark)
- `cargo test --lib pipeline::smoke_tests::bench_sysinfo_refresh_cost -- --ignored --nocapture` — 1 passed, prints "417 processes, avg=24ms, samples=[34, 22, 19, 21, 26]"
- `cargo build` — clean, 0 warnings

---
*Phase: 02-real-time-data-pipeline*
*Completed: 2026-04-09*
