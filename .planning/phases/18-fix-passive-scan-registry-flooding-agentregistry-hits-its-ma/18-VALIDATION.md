---
phase: 18
slug: fix-passive-scan-registry-flooding-agentregistry-hits-its-ma
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-04-21
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust built-in `#[test]` / `#[tokio::test]` inside `mod tests` blocks |
| **Config file** | `src-tauri/Cargo.toml` (no separate test harness) |
| **Quick run command** | `cd src-tauri && cargo test --lib pipeline::passive_bridge::tests agents::registry::tests -- --nocapture` |
| **Full suite command** | `cd src-tauri && cargo test --lib` |
| **Estimated runtime** | ~2 seconds quick / 5–15 seconds full (varies on cold vs warm target/) |

---

## Sampling Rate

- **After every task commit:** Run the quick command (targeted tests for the modules touched). Bounded by `ProcessSnapshot::from_candidates_for_test` — zero real process spawning, deterministic.
- **After every plan wave:** Run the full suite so registry/self_register/launcher cross-module regressions surface immediately.
- **Before `/gsd-verify-work`:** Full suite green + `npm run build` (to regenerate `src/bindings.ts` via tauri-specta and confirm no IPC type drift).
- **Max feedback latency:** ≤ 15 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-* | 01 (passive-bridge filter) | 1 | D-01, D-02, AGNT-03 | T-18-01 (unbounded registry / DoS) | Parent-PID filter drops subprocess children; externally-launched agents still register; cwd-scope preserved | unit | `cargo test --lib pipeline::passive_bridge::tests::parent_in_candidate_list_drops_subprocess_children -- --nocapture` | will be new in `passive_bridge.rs` | ⬜ pending |
| 18-01-* | 01 (passive-bridge filter) | 1 | D-02 | T-18-01 | Orphaned child (`parent = None`) still registered — never dropped by the new filter | unit | `cargo test --lib pipeline::passive_bridge::tests::orphaned_child_with_no_parent_registers -- --nocapture` | new | ⬜ pending |
| 18-01-* | 01 (passive-bridge filter) | 1 | D-02 | T-18-01 | Child whose parent is cwd-filtered gets promoted (registered as top-level) | unit | `cargo test --lib pipeline::passive_bridge::tests::child_of_cwd_filtered_parent_is_promoted -- --nocapture` | new | ⬜ pending |
| 18-01-* | 01 (passive-bridge filter) | 1 | D-01, D-02 | T-18-01 | Regression: 1 parent + 50 allowlisted subprocess children → exactly 1 PASSIVE entry, zero capacity errors | regression | `cargo test --lib pipeline::passive_bridge::tests::flood_regression_parent_plus_many_children -- --nocapture` | new | ⬜ pending |
| 18-01-* | 01 (passive-bridge filter) | 1 | AGNT-03 | — | Externally-launched claude with non-candidate parent (e.g., shell PID 1) still registers as PASSIVE | unit | `cargo test --lib pipeline::passive_bridge::tests::externally_launched_with_shell_parent_still_registers -- --nocapture` | new | ⬜ pending |
| 18-02-* | 02 (registry stats + capacity counter) | 1 | D-03, D-04 | T-18-02 (diagnostic lock contention / DoS) | At-capacity insert returns error and increments `capacity_hits_since_start` atomic | unit | `cargo test --lib agents::registry::tests::capacity_hit_increments_counter -- --nocapture` | new in `registry.rs` | ⬜ pending |
| 18-02-* | 02 (registry stats + capacity counter) | 1 | D-04 | T-18-02 | `snapshot_stats()` counts KAGENT + PASSIVE + launched separately and reports atomic value | unit | `cargo test --lib agents::registry::tests::snapshot_stats_counts_by_prefix_and_atomic -- --nocapture` | new | ⬜ pending |
| 18-03-* | 03 (Tauri command wiring) | 2 | D-04 | — | `get_registry_stats` Tauri command returns `RegistryStats`; specta binding emits matching TS type in `src/bindings.ts` | build + binding check | `cd src-tauri && cargo build --lib && grep -q 'RegistryStats' ../src/bindings.ts` | new in `agents/commands.rs` + `lib.rs` | ⬜ pending |
| 18-04-* | 04 (doc / rationale) | 2 | D-03 | — | `MAX_AGENTS = 1000` doc comment cites hotfix commit + Phase 18 rationale (not just the history) | grep | `grep -A6 "MAX_AGENTS: usize = 1000" src-tauri/src/agents/registry.rs \| grep -q "Phase 18"` | `registry.rs` edit | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Sampling continuity note: every task above has an automated verify; no three-consecutive-task gap.

---

## Wave 0 Requirements

- [x] `ProcessSnapshot::from_candidates_for_test` exists at `src-tauri/src/pipeline/process_snapshot.rs:234` — ready to seed deterministic parent-child fixtures.
- [x] `seeded_snapshot(vec![cand(...)])` helper pattern established at `src-tauri/src/pipeline/passive_bridge.rs:252–263` — template for new tests.
- [x] `#[tokio::test]` is the idiom used throughout (`bridge_tick` is async).
- [x] Registry test scaffolding (`AgentRegistry::new()` + test adapters) already exists in `src-tauri/src/agents/registry.rs` `mod tests`.

Optional additions (Claude's Discretion per D-05):
- Small helper `cand_with_parent(pid, name, parent_pid)` in the `mod tests` of `passive_bridge.rs` to keep parent-carrying fixtures readable. Not a new test file — just a helper.

*All phase requirements have fixture support on disk; no missing scaffolding.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Run AITC against a dev machine with 3+ concurrent `claude --input-format stream-json` sessions and confirm the registry does not approach 1000 entries after 10 minutes of use | D-01 field validation (no more flooding in practice) | Requires live CLI + Tauri runtime; too heavyweight for CI; Phase 10 e2e chat smoke test exercises the live path but not the long-run soak | (1) Open AITC against repo. (2) Spawn 3 chat sessions in parallel. (3) Let them idle / exchange a few messages over 10 min. (4) `cargo run --example dump_registry_stats` (or invoke `get_registry_stats` via dev tools) — expect `passive_count ≤ 5`, `capacity_hits_since_start == 0`. |

All automated behaviors remain automated. The manual check is optional soak-test evidence, not a phase gate.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (none — Wave 0 is already complete)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (flip after planner lands and task IDs are final)

**Approval:** pending
