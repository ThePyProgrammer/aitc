---
phase: 3
slug: agent-management-conflict-detection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (built-in), Frontend: vitest (existing from Phase 1) |
| **Config file** | `src-tauri/Cargo.toml` (Rust tests), `vitest.config.ts` (frontend) |
| **Quick run command** | `cargo test -p aitc --lib -- --test-threads=1` |
| **Full suite command** | `cargo test -p aitc && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p aitc --lib -- --test-threads=1`
- **After every plan wave:** Run `cargo test -p aitc && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | AGNT-04 | — | N/A | unit | `cargo test agent::adapter` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | AGNT-04 | — | N/A | unit | `cargo test agent::registry` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | AGNT-02 | T-03-01 | Subprocess spawned with restricted env | integration | `cargo test agent::launch` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | AGNT-03 | — | N/A | integration | `cargo test agent::detect` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | AGNT-06 | T-03-02 | Graceful termination before force kill | integration | `cargo test agent::terminate` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | AGNT-07 | — | N/A | unit | `cargo test agent::state` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | AGNT-05 | — | N/A | unit | `cargo test agent::intent` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 2 | CNFL-01 | — | N/A | unit | `cargo test conflict::detect` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 2 | CNFL-02 | — | N/A | integration | `cargo test conflict::alert` | ❌ W0 | ⬜ pending |
| 03-04-03 | 04 | 2 | CNFL-06 | — | N/A | unit | `cargo test conflict::engine` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 3 | AGNT-01 | — | N/A | integration | `npx vitest run --reporter=verbose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/agent/mod.rs` — agent module scaffold with adapter trait
- [ ] `src-tauri/src/agent/tests/` — test stubs for adapter, registry, launch, detect, state, intent, terminate
- [ ] `src-tauri/src/conflict/tests/` — test stubs for detect, alert, engine
- [ ] `src/stores/__tests__/agentStore.test.ts` — frontend store test stubs

*Existing test infrastructure from Phase 1/2 covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent manifest shows live data in Tower Control view | AGNT-01 | Requires running agents + UI visual check | Launch 2+ agents, verify manifest updates in real time |
| Native OS notification on conflict | CNFL-02 | OS notification requires desktop interaction | Trigger conflict, verify OS notification appears |
| Self-registration HTTP endpoint discovery | AGNT-03 | Requires external agent process with AITC_PORT | Launch agent externally, verify it self-registers |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
