---
phase: 06
slug: pipeline-activation-integration-wiring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend) + cargo test (Rust backend) |
| **Config file** | `vitest.config.ts` + `src-tauri/Cargo.toml` |
| **Quick run command** | `npm run test:unit -- --run` (frontend) / `cd src-tauri && cargo test --lib` (Rust) |
| **Full suite command** | `npm test -- --run && cd src-tauri && cargo test` |
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
| 06-01-01 | 01 | 0 | FMON-01 | — | N/A | unit | `cd src-tauri && cargo test --lib repo_resolution` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | FMON-01, AGNT-03 | — | N/A | unit | `npm run test:unit -- --run src/stores/repoStore.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | FMON-01 | — | N/A | unit | `npm run test:unit -- --run src/providers/RepoSessionProvider.test.tsx` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 1 | HIST-01 | — | N/A | unit | `cd src-tauri && cargo test --lib session_lifecycle` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 2 | AGNT-03, FMON-02 | — | N/A | unit | `cd src-tauri && cargo test --lib passive_scan_bridge` | ❌ W0 | ⬜ pending |
| 06-04-02 | 04 | 2 | AGNT-03 | — | N/A | unit | `cd src-tauri && cargo test --lib agent_registry::merge_by_pid` | ❌ W0 | ⬜ pending |
| 06-05-01 | 05 | 2 | HIST-01, FMON-02 | — | N/A | unit | `cd src-tauri && cargo test --lib forwarder::record_session_file` | ❌ W0 | ⬜ pending |
| 06-06-01 | 06 | 3 | FMON-01, FMON-03 | — | N/A | unit | `npm run test:unit -- --run src/stores/radarStore.test.ts` | ❌ W0 | ⬜ pending |
| 06-06-02 | 06 | 3 | FMON-01 | — | N/A | integration | `npm run test:unit -- --run src/providers/RepoSessionProvider.integration.test.tsx` | ❌ W0 | ⬜ pending |
| 06-07-01 | 07 | 3 | FMON-01, FMON-04 | — | N/A | e2e-smoke | `cd src-tauri && cargo test --test end_to_end_smoke -- --ignored` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/tests/common/mod.rs` — shared test helpers (tempdir repo fixtures, fake ProcessSnapshot)
- [ ] `src-tauri/src/pipeline/repo_resolution.rs` — unit test stubs for CWD detection + persistence (FMON-01)
- [ ] `src-tauri/src/db/session.rs` — test stubs for `ensure_open_session` / `close_session` (HIST-01)
- [ ] `src/stores/repoStore.test.ts` — stubs for repo state management (FMON-01)
- [ ] `src/providers/RepoSessionProvider.test.tsx` — stubs for mount lifecycle (FMON-01)
- [ ] `src/providers/RepoSessionProvider.integration.test.tsx` — integration smoke test
- [ ] `src-tauri/tests/end_to_end_smoke.rs` — ignored e2e test for full pipeline activation
- [ ] `vitest.config.ts` — verify exists; add jsdom env if missing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native folder picker dialog appears when CWD is not a git repo | FMON-01 | Tauri dialog plugin requires real window + OS native dialog | 1. Launch app from non-git directory. 2. Verify folder picker appears. 3. Select a git repo. 4. Verify watch starts. |
| Persisted repo auto-opens on next launch | FMON-01 | Requires two app launches separated by termination | 1. Open repo A, close app. 2. Re-launch. 3. Verify repo A is active without prompting. |
| "Change repo" action in UI switches watch targets | FMON-01 | Requires interactive UI navigation | 1. Open repo A. 2. Click "Change repo". 3. Select repo B. 4. Verify old watch stopped, new watch active. |
| Pause/resume toggle stops/resumes file events | FMON-01 | Requires live UI interaction and file write observation | 1. Open repo. 2. Click pause. 3. Modify a file. 4. Verify no new events. 5. Click resume. 6. Modify file. 7. Verify events flow. |
| Radar treemap updates live when files change | FMON-01 | Visual reactivity only verifiable by eye | 1. Open repo with watch active. 2. Externally modify a file. 3. Verify treemap reflects new state within 1s. |
| Passive agent detection in Tower Control | AGNT-03 | Requires a real allowlisted process running | 1. Launch claude-code externally. 2. Verify passive agent appears in Tower Control as "unidentified". 3. Self-register agent. 4. Verify entries merge. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
