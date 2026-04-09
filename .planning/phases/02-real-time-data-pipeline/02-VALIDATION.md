---
phase: 02
slug: real-time-data-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-09
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (native, already wired) / Frontend: `vitest` (from Phase 1) |
| **Config file** | `src-tauri/Cargo.toml` / `vitest.config.ts` |
| **Quick run command** | `cd src-tauri && cargo test --lib -- --test-threads=1` |
| **Full suite command** | `cd src-tauri && cargo test && cd .. && npm test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick test command for the module touched
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

*Populated by planner — each task gets a row with requirement mapping, threat ref, and automated command.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | FMON-01/02/03/04 | TBD | TBD | unit/integration | `cargo test` | TBD | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src-tauri/Cargo.toml` — add `notify ^8.2`, `notify-debouncer-full ^0.7`, `sysinfo ^0.38`, `ignore ^0.4` dependencies
- [ ] `src-tauri/src/watcher/mod.rs` — module stub for filesystem watcher
- [ ] `src-tauri/tests/` or inline `#[cfg(test)] mod tests` — test scaffolding
- [ ] Smoke test: `tauri::ipc::Channel<T>` outlives a command invocation (per RESEARCH.md open question 1)
- [ ] Benchmark: `sysinfo refresh_processes_specifics` cost on Windows dev box (target <50ms, per RESEARCH.md open question 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| File watcher under 10k+ file codebase | FMON-03 | Requires large real codebase; automated perf test planned for CI later | Point watcher at a 10k+ file repo, monitor CPU/memory for 5 minutes during active edits |
| PID attribution accuracy with real Claude Code session | FMON-02 | Requires running an actual agent | Launch Claude Code, edit files, verify events attributed to the correct PID in Tower Control view |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
