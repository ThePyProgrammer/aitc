---
phase: 06
slug: pipeline-activation-integration-wiring
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-12
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (frontend) + cargo test (Rust backend) |
| **Config file** | `vitest.config.ts` + `src-tauri/Cargo.toml` |
| **Quick run command** | `npm run test -- --run <path>` (frontend) / `cd src-tauri && cargo test --lib <module>` (Rust) |
| **Full suite command** | `npm run test -- --run && cd src-tauri && cargo test` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick command (frontend or Rust based on files modified)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | FMON-01 | T-06-01-01 | Tauri dialog plugin init path accepts only user-selected folders | unit | `cd src-tauri && cargo check --lib` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 0 | FMON-01, HIST-01 | — | N/A (scaffolding) | scaffold | `cd src-tauri && cargo check --lib && npm run test -- --run src/stores/__tests__/repoStore.test.ts src/providers/__tests__/` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | FMON-01, FMON-04 | T-06-02-01 | Path canonicalization blocks traversal via symlinks | unit | `cd src-tauri && cargo test --lib repo_session` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | FMON-01 | — | N/A | unit | `npm run test -- --run src/stores/__tests__/repoStore.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 1 | FMON-01, FMON-04 | — | N/A | unit | `npm run test -- --run src/providers/__tests__/RepoSessionProvider.test.tsx` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 2 | HIST-01 | T-06-03-01 | sqlx parameterized queries prevent SQL injection on session mutations | unit | `cd src-tauri && cargo test --lib db::session` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 2 | AGNT-03 | — | N/A | unit | `cd src-tauri && cargo test --lib agents::registry::find_agent_by_pid agents::registry::reap_passive_agents` | ❌ W0 | ⬜ pending |
| 06-03-03 | 03 | 2 | AGNT-03, HIST-01 | T-06-03-03 | HTTP self-register validates PID against live process table | unit | `cd src-tauri && cargo test --lib self_register` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 3 | AGNT-03, FMON-02 | — | N/A | unit | `cd src-tauri && cargo test --lib pipeline::passive_bridge` | ❌ W0 | ⬜ pending |
| 06-04-02 | 04 | 3 | AGNT-03, HIST-01, FMON-02 | T-06-04-02 | Attributed batch writes to session_files only after FK-valid session exists | unit | `cd src-tauri && cargo test --lib pipeline::commands::tests::persist_attributed_batch_records_files_for_matched_pid` | ❌ W0 | ⬜ pending |
| 06-04-03 | 04 | 3 | FMON-01, FMON-02, HIST-01 | — | N/A | integration | `cd src-tauri && cargo test --test end_to_end_smoke -- --ignored` | ❌ W0 | ⬜ pending |
| 06-05-01 | 05 | 4 | FMON-01, FMON-03 | — | N/A | unit | `npm run test -- --run src/stores/__tests__/radarStore.test.ts` | ❌ W0 | ⬜ pending |
| 06-05-02 | 05 | 4 | FMON-01 | — | N/A | unit | `npm run test -- --run src/components/topbar/__tests__/` | ❌ W0 | ⬜ pending |
| 06-05-03 | 05 | 4 | FMON-01, FMON-04 | — | N/A | e2e | `cd src-tauri && cargo test --test end_to_end_smoke` | ❌ W0 | ⬜ pending |
| 06-05-04 | 05 | 4 | FMON-01, FMON-03, FMON-04 | — | N/A (human checkpoint) | manual | See Manual-Only Verifications below | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Plan-to-wave map (authoritative): 06-01 → wave 0; 06-02 → wave 1; 06-03 → wave 2; 06-04 → wave 3; 06-05 → wave 4.

---

## Wave 0 Requirements

Plan 06-01 scaffolds the following files so that every task listed above has a file to verify against.

- [ ] `src-tauri/src/repo_session.rs` — stub for CWD resolution and folder-picker Tauri commands (FMON-01)
- [ ] `src-tauri/src/db/session.rs` — stub for `ensure_open_session`, `close_session`, `record_session_file_internal` (HIST-01)
- [ ] `src-tauri/tests/common/mod.rs` — shared helpers (tempdir repo fixtures, fake ProcessSnapshot) for all integration tests
- [ ] `src-tauri/tests/end_to_end_smoke.rs` — `#[ignore]`d e2e scaffold used by 06-04-03 and 06-05-03
- [ ] `src/stores/repoStore.ts` — stub Zustand store for repo state (FMON-01)
- [ ] `src/stores/__tests__/repoStore.test.ts` — Vitest stubs for repo state transitions
- [ ] `src/providers/RepoSessionProvider.tsx` — pass-through stub provider (FMON-01)
- [ ] `src/providers/__tests__/RepoSessionProvider.test.tsx` — mount-lifecycle stubs
- [ ] `src/providers/__tests__/RepoSessionProvider.integration.test.tsx` — integration smoke stub
- [ ] `tauri-plugin-dialog` installed and registered in `src-tauri/src/lib.rs`

---

## Manual-Only Verifications

These cover the Task 06-05-04 human-verify checkpoint and any behavior that cannot be exercised from CI.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native folder picker dialog appears when CWD is not a git repo | FMON-01 | Tauri dialog plugin requires real window + native OS dialog | 1. Launch app from non-git directory. 2. Verify folder picker appears. 3. Select a git repo. 4. Verify watch starts. |
| Persisted repo auto-opens on next launch | FMON-01 | Requires two separate app launches | 1. Open repo A, close app. 2. Re-launch from any CWD. 3. Verify repo A is active without prompting. |
| "Change repo" action switches watch targets | FMON-01 | Requires interactive UI navigation | 1. Open repo A. 2. Click "Change repo" in TopBar. 3. Select repo B. 4. Verify old watch stopped, new watch active, radar reflects repo B. |
| Pause/resume toggle stops/resumes file events | FMON-01 | Requires live UI interaction + file-system observation | 1. Open repo. 2. Click Pause. 3. Modify a file. 4. Verify no new events appear in pipelineStore. 5. Click Resume. 6. Modify file. 7. Verify events flow. |
| Radar treemap updates live when files change | FMON-01, FMON-03 | Visual reactivity only verifiable by eye | 1. Open repo with watch active. 2. Externally modify a file. 3. Verify treemap reflects change within ~1s. |
| Passive agent detection + merge on self-registration | AGNT-03 | Requires a real allowlisted process | 1. Launch `claude-code` externally. 2. Verify a PASSIVE-<pid> entry appears in Tower Control as "unidentified". 3. Have it self-register. 4. Verify the PASSIVE entry is removed and a KAGENT entry takes its place. |
| Worktree detection for `git worktree add` sub-trees | FMON-04 | Requires a repo with multiple worktrees created via `git worktree` | 1. In a test repo, run `git worktree add ../repo-wt2 main`. 2. Open the main repo in AITC. 3. Verify both worktrees appear in `pipelineStore.worktrees` / TopBar. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (task 06-05-04 is a human-verify checkpoint — covered by Manual-Only table)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
