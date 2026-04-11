---
phase: 05
slug: conflict-resolution-history
status: draft
nyquist_compliant: true
wave_0_complete: true
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
| **Quick run command (Frontend)** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `cd src-tauri && cargo test && cd .. && npx vitest run` |
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
| 01-T1 | 01 | 1 | HIST-01, HIST-02 | T-05-02, T-05-05 | Path traversal validation in BackupManager | unit (Rust) | `cd src-tauri && cargo test backup -- --test-threads=1` | Created in task | ⬜ pending |
| 01-T2 | 01 | 1 | HIST-01, HIST-02, HIST-03, CNFL-04, CNFL-05 | T-05-01, T-05-03, T-05-04 | File size cap, path validation, D-12 notification | unit (Rust) | `cd src-tauri && cargo check && cargo test resolution -- --test-threads=1` | Created in task | ⬜ pending |
| 01-T3 | 01 | 1 | (wiring) | — | Specta registration | compilation | `cd src-tauri && cargo check` | N/A | ⬜ pending |
| 02-T1 | 02 | 1 | CNFL-03, FMON-05 | T-05-08 | Merge correctness, contention score bounds | unit | `npx vitest run src/lib/__tests__/merge.test.ts src/lib/__tests__/contention.test.ts --reporter=verbose` | Created in task (TDD) | ⬜ pending |
| 02-T2 | 02 | 1 | HIST-04 | — | History store fetch/filter correctness | unit | `npx vitest run src/stores/__tests__/historyStore.test.ts --reporter=verbose` | Created in task | ⬜ pending |
| 03-T1 | 03 | 2 | CNFL-04, CNFL-05 | T-05-09 | IntentPanel renders agent intent correctly | unit | `npx vitest run src/views/Conflicts/__tests__/IntentPanel.test.tsx --reporter=verbose` | Created in task | ⬜ pending |
| 03-T2 | 03 | 2 | CNFL-03, CNFL-04, CNFL-05 | T-05-09, T-05-10 | Virtualized diff, no dangerouslySetInnerHTML | compilation + unit | `npx vitest run src/views/Conflicts/__tests__/ && npx tsc --noEmit` | Created in 03-T1 | ⬜ pending |
| 04-T1 | 04 | 2 | FMON-05, VIZN-03 | T-05-13 | Heat map overlay, no user input in render | compilation | `npx tsc --noEmit src/stores/radarStore.ts src/views/Radar/HeatMapOverlay.ts src/views/Radar/RadarCanvas.tsx` | N/A | ⬜ pending |
| 04-T2 | 04 | 2 | HIST-01, HIST-02, HIST-03, HIST-04 | T-05-12 | Virtualized tables, bounded queries | compilation | `npx tsc --noEmit src/views/HistoryView.tsx src/views/History/SessionsTab.tsx src/views/History/ConflictsTab.tsx src/views/History/ApprovalsTab.tsx` | N/A | ⬜ pending |
| 05-T1 | 05 | 3 | (integration) | T-05-14 | 5s timer, bounded map construction | compilation | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-T2 | 05 | 3 | ALL | — | Full feature verification including D-12 | manual + suite | `npx vitest run --reporter=verbose && cd src-tauri && cargo test` | N/A | ⬜ pending |

---

## Wave 0 Requirements

Test files are created within their respective plan tasks (not in a separate Wave 0 plan):

- [x] `src/lib/__tests__/merge.test.ts` — created in Plan 02 Task 1 (TDD, tests written first) — covers CNFL-03
- [x] `src/lib/__tests__/contention.test.ts` — created in Plan 02 Task 1 (TDD, tests written first) — covers FMON-05
- [x] `src/stores/__tests__/historyStore.test.ts` — created in Plan 02 Task 2 — covers HIST-04
- [x] `src/views/Conflicts/__tests__/IntentPanel.test.tsx` — created in Plan 03 Task 1 — covers CNFL-05
- [x] Rust backup tests (`#[cfg(test)]`) — created in Plan 01 Task 1 — covers HIST-01/HIST-02 backup path
- [x] `package.json` — node-diff3, shiki installed in Plan 02 Task 1

Note: CNFL-04 merge state behavior is tested via merge.test.ts (buildMergedContent with resolution choices) and IntentPanel.test.tsx (intent display). The merge state machine in conflictStore is validated via compilation + the end-to-end checkpoint in Plan 05.

HIST-01/HIST-02/HIST-03 Rust storage is verified by `cargo test` (backup tests) and `cargo check` (resolution command compilation). The `list_approval_history` command (HIST-03) reads from Phase 4's existing `approval_requests` table — no new storage needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-way merge UI renders correctly with syntax highlighting | CNFL-03 | Visual correctness requires human inspection | Open conflict resolution with a known diff, verify syntax colors and hunk markers render correctly |
| Heat map colors match Command Horizon palette | VIZN-03/FMON-05 | Color perception is subjective | Enable heat map on radar with known contention data, verify green/amber/red gradient aligns with design system |
| Per-hunk accept/reject produces correct merged file | CNFL-04 | Complex interaction sequence | Create a conflict with 3+ hunks, accept A on some, B on others, edit one manually, verify merged output |
| Agent notification delivered on resolution | D-12 | Requires live agent + comms view inspection | After applying resolution, check COMMS view for chat messages to both agents, check History > Conflicts for notification_status = 'delivered' |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 test files created within their respective plan tasks
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
