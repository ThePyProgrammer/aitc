---
phase: 02
slug: real-time-data-pipeline
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-09
updated: 2026-04-09
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (native, already wired) / Frontend: `vitest` (from Phase 1) |
| **Config file** | `src-tauri/Cargo.toml` / `vitest.config.ts` |
| **Quick run command (Rust)** | `cd src-tauri && cargo test --lib pipeline:: -- --test-threads=1` |
| **Quick run command (Frontend)** | `npm test -- --run src/__tests__/pipelineStore.test.ts` |
| **Full suite command** | `cd src-tauri && cargo test && cd .. && npm test` |
| **Estimated runtime** | ~60 seconds (Rust) + ~10 seconds (frontend) |

---

## Sampling Rate

- **After every task commit:** Run quick test command for the module touched (e.g., `cargo test --lib pipeline::watcher::tests -- --test-threads=1`)
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | FMON-01/02/03/04 | T-02-01-01, T-02-01-02 | Pinned crate versions prevent dep tampering; cargo registry supply chain | build | `cd src-tauri && cargo build` | ❌ Wave 0 (creates Cargo.toml entries) | ⬜ pending |
| 02-01-T2 | 01 | 1 | FMON-01/02/03/04 | — | Type contracts serializable without code injection vectors | unit (Rust) | `cd src-tauri && cargo test --lib pipeline::events::tests -- --test-threads=1` | ❌ Wave 0 | ⬜ pending |
| 02-01-T3 | 01 | 1 | FMON-02/03 | T-02-01-03, T-02-01-04 | Benchmark fails hard at ≥500ms avg refresh (DoS mitigation); no PII in bench output | unit+bench (Rust) | `cd src-tauri && cargo test --lib pipeline::smoke_tests -- --test-threads=1` + `cargo test --lib pipeline::smoke_tests::bench_sysinfo_refresh_cost -- --ignored --nocapture` | ❌ Wave 0 | ⬜ pending |
| 02-02-T1 | 02 | 2 | FMON-01/03 | T-02-02-06 | Gitignore crate handles malicious patterns safely; hardcoded excludes layered on top | unit (Rust) | `cd src-tauri && cargo test --lib pipeline::ignore_filter -- --test-threads=1` | ❌ Wave 0 | ⬜ pending |
| 02-02-T2 | 02 | 2 | FMON-03 | — | Tree walk bounded by HARDCODED_EXCLUDES + gitignore; 500ms performance budget | unit+bench (Rust) | `cd src-tauri && cargo test --lib pipeline::tree_index -- --test-threads=1` + `cargo test --lib pipeline::tree_index::tests::bench_walk_10k_files_under_500ms -- --ignored --nocapture` | ❌ Wave 0 | ⬜ pending |
| 02-02-T3 | 02 | 2 | FMON-01/03 | T-02-02-01, T-02-02-02, T-02-02-03, T-02-02-04, T-02-02-05 | Path traversal blocked via path_is_under_root; symlinks not followed; non-tokio bridge prevents panic; 150ms debounce mitigates Windows RDCW overflow; bounded mpsc | integration (Rust) | `cd src-tauri && cargo test --lib pipeline::watcher::tests -- --test-threads=1` | ❌ Wave 0 | ⬜ pending |
| 02-03-T1 | 03 | 2 | FMON-02 | T-02-03-01, T-02-03-02, T-02-03-03, T-02-03-04 | Only allowlisted agent processes exposed; cwd=None processes skipped (Windows PEB fail); ProcessRefreshKind narrowed to mitigate DoS | unit+async (Rust) | `cd src-tauri && cargo test --lib pipeline::process_snapshot -- --test-threads=1` | ❌ Wave 0 | ⬜ pending |
| 02-04-T1 | 04 | 3 | FMON-04 | — | Worktree parser is panic-free (empty Vec on malformed input); Command::arg prevents shell injection | unit (Rust) | `cd src-tauri && cargo test --lib pipeline::worktree -- --test-threads=1` | ❌ Wave 0 | ⬜ pending |
| 02-04-T2 | 04 | 3 | FMON-01/02/03/04 | T-02-04-01, T-02-04-02, T-02-04-04, T-02-04-07, T-02-04-08, T-02-04-10 | repo_root canonicalized + exists/is_dir check; git invoked via Command::arg; start_watch drops existing ActiveWatch before starting new; forwarder exits cleanly on dead channel | integration (Rust) | `cd src-tauri && cargo test --lib pipeline::commands pipeline::pipeline_state -- --test-threads=1 && cargo build` | ❌ Wave 0 | ⬜ pending |
| 02-04-T3 | 04 | 3 | FMON-01/02/03/04 | T-02-04-03 | MAX_EVENTS ring buffer caps React render cost | unit (frontend) | `npm test -- --run src/__tests__/pipelineStore.test.ts` | ❌ Wave 0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src-tauri/Cargo.toml` — add `notify 8`, `notify-debouncer-full 0.7`, `sysinfo 0.38`, `ignore 0.4`, `tracing 0.1`, `chrono 0.4`, plus dev deps `tempfile 3`, `serial_test 3` (Plan 01 Task 1)
- [ ] `src-tauri/src/pipeline/mod.rs` — module stub declaring all submodules (Plan 01 Task 2)
- [ ] `src-tauri/src/pipeline/events.rs` — FileEvent/FileEventBatch/FileEventKind/Attribution type contracts (Plan 01 Task 2)
- [ ] `src-tauri/src/pipeline/smoke_tests.rs` — Wave 0 smoke tests: Channel type-level lifetime + sysinfo cost benchmark (Plan 01 Task 3)
- [ ] `src-tauri/src/pipeline/test_util.rs` — make_temp_repo, write_file, wait_for_batch helpers (Plan 02 Task 1)
- [ ] Smoke test: `tauri::ipc::Channel<T>` implements Clone+Send+Sync+'static (runtime confirmation in Plan 04 Task 2 via forwarder)
- [ ] Benchmark: `sysinfo refresh_processes_specifics` cost on Windows dev box (target <50ms, hard blocker at ≥500ms)
- [ ] Benchmark: `build_tree_index` for 10k files (target <500ms, hard fail otherwise)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| File watcher under 10k+ file codebase | FMON-03 | Requires large real codebase; automated perf test planned for CI later | Point watcher at a 10k+ file repo (e.g., this one with node_modules excluded), invoke `start_watch` from the Phase 3 Tower Control UI or a dev REPL, monitor CPU/memory for 5 minutes during active edits |
| PID attribution accuracy with real Claude Code session | FMON-02 | Requires running an actual agent | Launch Claude Code in the watched repo, edit files, verify events in the Zustand store's processes list show attribution to the claude PID (read from React DevTools) |
| Windows ReadDirectoryChangesW overflow under bursts | FMON-01/03 | Windows-only, hardware-dependent | Run a codemod that writes 10,000 files in <5 seconds; verify the number of events delivered to the store is within 5% of the number of files touched. If drift is >10%, reconciliation pass is needed (Phase 3 concern). |
| Rename coalescing on Windows | FMON-01 | Windows RDCW delivers Rename as Remove+Create more often than Linux/macOS — coalescer behavior is OS-specific | The `rename_coalesced_into_single_event` test is best-effort on Windows; if it flakes, mark `#[ignore]` and verify manually by renaming a file in Explorer and checking the Zustand store receives a single Rename event (not Remove+Create) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has a cargo test or npm test command)
- [x] Wave 0 covers all MISSING references (events.rs types, test_util, tempfile/serial_test deps)
- [x] No watch-mode flags (all commands use --run, -- --test-threads=1, no --watch)
- [x] Feedback latency < 60s (Rust suite ~60s, frontend <10s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (ready for planner self-review / checker pass)
