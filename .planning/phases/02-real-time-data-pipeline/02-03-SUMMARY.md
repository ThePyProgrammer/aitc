---
phase: 02-real-time-data-pipeline
plan: 03
subsystem: infra
tags: [rust, sysinfo, pid-attribution, tokio-mpsc, process-snapshot, tdd]

# Dependency graph
requires:
  - phase: 02-real-time-data-pipeline
    provides: "FileEvent, FileEventBatch, Attribution contract types; sysinfo 0.38 pinned; tokio features (sync, rt-multi-thread, macros)"
provides:
  - "pipeline::process_snapshot::ProcessSnapshot with new(), refresh(), candidates(), attribute()"
  - "pipeline::process_snapshot::AGENT_NAME_ALLOWLIST: claude, claude-code, codex, opencode"
  - "pipeline::process_snapshot::ProcessInfo (specta::Type, camelCase serde) for frontend"
  - "pipeline::process_snapshot::CandidateProc internal struct (cwd is non-optional, None-cwd skipped)"
  - "pipeline::process_snapshot::start_attributing_stream wrapping FileEventBatch receiver"
  - "pipeline::process_snapshot::spawn_snapshot_refresher at configurable interval"
  - "Attribution heuristic: cwd prefix match returns Pid/Unattributed/Ambiguous"
  - "ProcessRefreshKind narrowed to cwd(Always) + cmd(OnlyIfNotSet) + exe(OnlyIfNotSet)"
affects: [02-04-ipc-sender, 03-conflict-detection, 04-radar-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ProcessSnapshot polls sysinfo on independent tick, not per-event — amortizes PEB-read cost"
    - "CandidateProc.cwd is PathBuf (not Option<PathBuf>): the None-cwd filter happens at insertion, so attribute() never needs to unwrap"
    - "start_attributing_stream read-locks snapshot once per batch (not per event) to minimize RwLock contention"
    - "Allowlist match is lowercased substring: proc.name().to_string_lossy().to_lowercase().contains(allowed)"

key-files:
  created:
    - "src-tauri/src/pipeline/process_snapshot.rs"
  modified:
    - "src-tauri/src/pipeline/mod.rs"

key-decisions:
  - "1000ms polling cadence confirmed: Plan 01 benchmark measured 24ms avg (well under 50ms target), no need to bump to 2000ms"
  - "CandidateProc made pub struct (with pub fields) for test fixture construction via snapshot_with_candidates helper"
  - "Added an extra test (skips_candidates_with_none_cwd_via_structural_filter) beyond the plan's 8 to verify the structural invariant that CandidateProc.cwd is non-Optional"
  - "Allowlist extending for Phase 3 is a one-line change to AGENT_NAME_ALLOWLIST const"

requirements-completed: [FMON-02]

# Metrics
duration: 12min
completed: 2026-04-10
---

# Phase 2 Plan 03: ProcessSnapshot with PID Attribution and AttributingStream Summary

**Built ProcessSnapshot polling sysinfo with narrowed ProcessRefreshKind (cwd always, cmd/exe once), cwd-prefix attribution heuristic returning Pid/Unattributed/Ambiguous, an AttributingStream wrapper that rewrites FileEventBatch attributions in-flight, and a configurable snapshot refresher -- 10 tests passing including 2 tokio async tests.**

## Performance

- **Duration:** 12 min (effective task execution; build/test compilation was ~6min additional)
- **Started:** 2026-04-10T03:06:24Z
- **Completed:** 2026-04-10T03:18:00Z
- **Tasks:** 1 of 1
- **Files created:** 1 (process_snapshot.rs, 310 lines)
- **Files modified:** 1 (pipeline/mod.rs, +5 lines)
- **Tests added:** 10 (8 sync + 2 tokio::test)

## Accomplishments

- `ProcessSnapshot::new()` creates an empty snapshot; `refresh()` polls sysinfo with `ProcessRefreshKind::nothing().with_cwd(UpdateKind::Always).with_cmd(UpdateKind::OnlyIfNotSet).with_exe(UpdateKind::OnlyIfNotSet)` to minimize Windows PEB-read cost
- `AGENT_NAME_ALLOWLIST: &[&str] = &["claude", "claude-code", "codex", "opencode"]` with case-insensitive substring matching (process.name().to_lowercase().contains(allowed))
- `attribute(event_path)` returns `Attribution::Pid(n)` for exactly 1 cwd prefix match, `Attribution::Unattributed` for 0, `Attribution::Ambiguous(vec)` for 2+
- Processes with `cwd() == None` (Windows PEB read failure) silently skipped per D-06 -- enforced structurally since `CandidateProc.cwd` is `PathBuf` not `Option<PathBuf>`
- `start_attributing_stream(in_rx, out_tx, snapshot)` spawns a tokio task that read-locks the snapshot once per batch (not per event) and rewrites all event attributions
- `spawn_snapshot_refresher(snapshot, interval)` spawns an independent tokio task that write-locks and refreshes the snapshot on a configurable cadence
- `ProcessInfo` struct derives `specta::Type` with `serde(rename_all = "camelCase")` for frontend consumption -- `parent_pid` serializes as `parentPid`
- `pipeline/mod.rs` re-exports `ProcessSnapshot`, `ProcessInfo`, `AGENT_NAME_ALLOWLIST`, `spawn_snapshot_refresher`, `start_attributing_stream` for downstream consumption

## Task Commits

1. **Task 1: ProcessSnapshot with allowlist filter and attribute() heuristic** -- `cbb8877` (feat)

## Files Created/Modified

**Created:**
- `src-tauri/src/pipeline/process_snapshot.rs` (310 lines) -- ProcessSnapshot, CandidateProc, ProcessInfo, AGENT_NAME_ALLOWLIST, start_attributing_stream, spawn_snapshot_refresher, 10 unit tests

**Modified:**
- `src-tauri/src/pipeline/mod.rs` (35 lines, was 30) -- added `pub mod process_snapshot;` and `pub use process_snapshot::{...}` re-exports; preserved all existing module declarations (events, ignore_filter, tree_index, watcher, test_util, smoke_tests)

## Polling Cadence Decision

**Plan 01 Wave 0 BENCH_RESULT:** sysinfo refresh averaged **24ms** on 417 processes (dev Windows box, rustc 1.94.1).

- Target: <50ms (to justify 1Hz polling)
- Measured: 24ms -- target met with 2x headroom
- **Decision: 1000ms polling cadence is correct.** No need to bump to 2000ms.

Plan 04 should use `spawn_snapshot_refresher(snapshot, Duration::from_millis(1000))`.

## sysinfo API Compatibility Notes

The plan's reference code (based on 02-RESEARCH.md Pattern 3, which was written against sysinfo 0.32 docs) compiled cleanly against sysinfo 0.38.4 with zero API changes needed:

| API Surface | 0.32 Reference | 0.38.4 Actual | Status |
|-------------|----------------|---------------|--------|
| `System::new()` | Same | Same | OK |
| `refresh_processes_specifics(ProcessesToUpdate, bool, ProcessRefreshKind)` | Same | Same | OK |
| `Process::name() -> &OsStr` | Same | Same | OK |
| `Process::cwd() -> Option<&Path>` | Same | Same | OK |
| `Process::exe() -> Option<&Path>` | Same | Same | OK |
| `Process::parent() -> Option<Pid>` | Same | Same | OK |
| `Pid::as_u32()` | Same | Same | OK |
| `ProcessRefreshKind::nothing().with_cwd(UpdateKind)` | Same | Same | OK |

No sysinfo API shape deviations from the research document.

## Test Binary Allowlist Matching

The `refresh_populates_candidates_when_allowlist_matches` test uses the first 4 characters of the test binary name (`aitc`) as a custom allowlist entry. This makes `refresh()` find the test runner process itself as a candidate. The test does not assert a specific candidate count because the PEB-read visibility of the test process's cwd is environment-dependent on Windows, but it confirms that `refresh()` completes without panicking and returns a valid `Vec<ProcessInfo>`.

## Extending the Allowlist

Adding new agent types in Phase 3 requires a one-line change:

```rust
pub const AGENT_NAME_ALLOWLIST: &[&str] = &["claude", "claude-code", "codex", "opencode", "new-agent"];
```

No other changes to `process_snapshot.rs` are needed. Phase 3 may also convert this to a runtime-configurable allowlist if the adapter pattern requires dynamic registration.

## Deviations from Plan

None -- plan executed exactly as written. The sysinfo 0.38 API matched the reference code from the plan verbatim. One additional test was added (`skips_candidates_with_none_cwd_via_structural_filter`) beyond the plan's 8 specified tests, verifying the structural invariant that `CandidateProc.cwd` is non-Optional.

## Threat Model Compliance

All threats with `mitigate` disposition from the plan's `<threat_model>` are addressed:

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-02-03-01 | Info Disclosure -- enumerating other users' cwd/cmd/exe | Done -- sysinfo uses `PROCESS_QUERY_LIMITED_INFORMATION` by default; returns None for inaccessible processes. `cwd() == None` processes are skipped (not emitted). AGENT_NAME_ALLOWLIST restricts exposure to only agent-like processes. |
| T-02-03-02 | Info Disclosure -- ProcessInfo fields leaked to webview | Done -- only allowlisted processes (agents the user launched) appear in candidates. Non-agent processes never appear. |
| T-02-03-03 | Spoofing -- malicious binary renamed to claude.exe | Done -- Phase 2 best-effort acknowledged (D-06). No destructive actions taken on attributed events; worst case is incorrect UI display. Phase 3 adapters will verify via parent-pid + spawn-path. |
| T-02-03-04 | DoS -- sysinfo refresh cost at 1Hz | Done -- ProcessRefreshKind narrowed to cwd+cmd+exe only. Plan 01 benchmark proved 24ms avg (<50ms target). Plan 04 will use 1000ms interval. |

Threats with `accept` disposition (T-02-03-05 symlink escape, T-02-03-06 cwd prefix false positive, T-02-03-07 build-time type exposure) are documented-accept in the plan and require no code changes.

## Next Phase Readiness

**Ready for Plan 02-04 (IPC sender / Channel wiring):**
- `start_attributing_stream` accepts the `mpsc::Receiver<FileEventBatch>` from the watcher (Plan 02-02) and forwards attributed batches to a new `mpsc::Sender<FileEventBatch>` that Plan 04 owns
- `spawn_snapshot_refresher` takes `Arc<RwLock<ProcessSnapshot>>` and a `Duration` -- Plan 04 passes `Duration::from_millis(1000)` and holds the JoinHandle in WatcherHandle
- `ProcessInfo` is `specta::Type` -- Plan 04's tauri-specta binding generation will automatically include it
- `AGENT_NAME_ALLOWLIST` is `pub` for Plan 04 to reference in documentation/logging

**Ready for Plan 03 (conflict detection):**
- Attributed `FileEvent`s carry `Attribution::Pid(n)` which conflict detection can use to determine "which agent touched this file"
- `Attribution::Ambiguous(vec)` signals multi-agent contention on the same path -- conflict detection should treat this as a potential conflict

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src-tauri/src/pipeline/process_snapshot.rs`
- FOUND: `src-tauri/src/pipeline/mod.rs` (contains `pub mod process_snapshot;` and `pub use process_snapshot::{...}`)

**Commits verified present:**
- FOUND: `cbb8877` (feat(02-03): add ProcessSnapshot with PID attribution and AttributingStream)

**Tests verified passing:**
- `cargo build` -- clean, 0 warnings
- `cargo test --lib pipeline::process_snapshot -- --test-threads=1` -- 10 passed, 0 failed, 0 ignored
- `cargo test --lib pipeline:: -- --test-threads=1` -- 31 passed, 0 failed, 3 ignored (all pre-existing benchmarks)

**Grep verifications:**
- `AGENT_NAME_ALLOWLIST` count: 3 (>= 2 required)
- `Attribution::Pid|Attribution::Unattributed|Attribution::Ambiguous` count: 8 (>= 3 required)
- `refresh_processes_specifics` count: 1 (== 1 required)

---
*Phase: 02-real-time-data-pipeline*
*Completed: 2026-04-10*
