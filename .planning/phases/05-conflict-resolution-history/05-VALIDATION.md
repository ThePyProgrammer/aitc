---
phase: 05
slug: conflict-resolution-history
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (native) / Frontend: `vitest` (from Phase 1) |
| **Config file** | `src-tauri/Cargo.toml` / `vitest.config.ts` |
| **Quick run command (Rust)** | `cd src-tauri && cargo test --lib -- --test-threads=1` |
| **Quick run command (Frontend)** | `npm test -- --run` |
| **Full suite command** | `cd src-tauri && cargo test && cd .. && npm test` |
| **Estimated runtime** | ~90 seconds (Rust) + ~15 seconds (frontend) |

---

## Sampling Rate

- **After every task commit:** Run quick test command for the module touched
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CNFL-03/04/05, FMON-05, VIZN-03, HIST-01/02/03/04 | TBD | TBD | unit/integration | `cargo test` / `npm test` | TBD | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src-tauri/Cargo.toml` — add diff/merge crates if needed
- [ ] `package.json` — add `node-diff3`, `shiki` (if chosen by planner)
- [ ] `src-tauri/src/db/migrations/` — new migration for session_files, conflict_resolutions tables
- [ ] Frontend test stubs for merge UI, heat map, history view

*Populated by planner — each task gets a row with requirement mapping.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-way merge UI renders correctly with syntax highlighting | CNFL-03 | Visual correctness requires human inspection | Open conflict resolution with a known diff, verify syntax colors and hunk markers render correctly |
| Heat map colors match Command Horizon palette | VIZN-03/FMON-05 | Color perception is subjective | Enable heat map on radar with known contention data, verify green/amber/red gradient aligns with design system |
| Per-hunk accept/reject produces correct merged file | CNFL-04 | Complex interaction sequence | Create a conflict with 3+ hunks, accept A on some, B on others, edit one manually, verify merged output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
