---
phase: 17
slug: conflict-triggered-pretooluse-gating-replace-tool-category-g
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Extracted from `17-RESEARCH.md §Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (built-in, no extra install) + existing vitest for frontend |
| **Config file** | none — per-module `#[cfg(test)]` submodules (`conflict::engine::tests::phase17`, `agents::self_register::tests::phase17`, `agents::bash_paths::tests`) |
| **Quick run command (engine)** | `cargo test --package aitc --lib conflict::engine::tests::phase17 -- --nocapture` |
| **Quick run command (hook handler)** | `cargo test --package aitc --lib agents::self_register::tests::phase17 -- --nocapture` |
| **Quick run command (bash_paths)** | `cargo test --package aitc --lib agents::bash_paths::tests -- --nocapture` |
| **Full backend suite** | `cargo test --package aitc --lib` |
| **Integration / e2e** | `cargo test --package aitc --tests -- --ignored` |
| **Frontend typecheck** | `cd src && npx tsc --noEmit` |
| **Frontend tests** | `npm run test` (vitest) |
| **Binding regen** | `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` (canonical, Phase 18 D-03) |
| **Estimated runtime (quick)** | ~15s |

---

## Sampling Rate

- **After every task commit:** `cargo test --package aitc --lib conflict::engine agents::bash_paths agents::self_register` (~15s)
- **After every plan wave:** `cargo test --package aitc --all-targets` + `cd src && npx tsc --noEmit && npm run test`
- **Before `/gsd-verify-work` (phase gate):** Full suite GREEN + manual UAT with two Claude Code sessions editing the same file (real-world conflict detection sanity check)
- **Max feedback latency:** 15s for the quick loop; 120s for the full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-WX-YY (CNFL-01) | WX | W | CNFL-01 | T-17-01 | `could_conflict_with` returns the OTHER agent when a write is in window | unit | `cargo test conflict::engine::tests::phase17::could_conflict_with_returns_other_agent` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-04) | WX | W | D-04 | T-17-02 | Liveness gate — agents removed from registry don't trigger conflict | integration | `cargo test agents::self_register::tests::phase17::hook_allows_when_conflicting_agent_was_removed` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-05) | WX | W | D-05 | T-17-03 | Self-write suppression — agent doesn't conflict with itself | unit | `cargo test conflict::engine::tests::phase17::could_conflict_with_excludes_self` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-06) | WX | W | D-06 | — | Read/LS/Grep/Glob/WebFetch/WebSearch pass through (no conflict check) | integration | `cargo test agents::self_register::tests::hook_allows_passthrough_tools_without_row` (EXTEND existing) | ✅ | ⬜ pending |
| 17-WX-YY (D-07) | WX | W | D-07 | T-17-04 | protected_paths still gates; `gate_reason='protected_path'` | integration | `cargo test agents::self_register::tests::hook_gates_protected_path_even_on_read` (EXTEND to assert gate_reason) | ✅ | ⬜ pending |
| 17-WX-YY (D-08) | WX | W | D-08 | — | Always-allow cache short-circuits before conflict query | integration | `cargo test agents::self_register::tests::hook_honors_always_allow_fast_path` (EXISTING) | ✅ | ⬜ pending |
| 17-WX-YY (D-11) | WX | W | D-11 | T-17-05 | Bash safelist instant-allows (`git status`, `ls`, `pwd`, redirects-aware) | unit | `cargo test agents::bash_paths::tests::safelist_*` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-12) | WX | W | D-12 | T-17-06 | Bash verb dispatch extracts targets for `cp`/`mv`/`rm`/`tee`/redirects/`sed -i` | unit | `cargo test agents::bash_paths::tests::verb_dispatch_*` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-10) | WX | W | D-10 | T-17-07 | Bash `ParseFailed` → Allow (no gate row); covers heredocs, pipelines, unterminated quotes | integration | `cargo test agents::self_register::tests::phase17::bash_parse_failure_allows` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-14/D-15) | WX | W | CNFL-01/02/06 | T-17-08 | Two-agent end-to-end: engine query path returns conflicting agent; gate row written with `conflict_with_agent_id` + `gate_reason='file_conflict'` | integration | `cargo test agents::self_register::tests::phase17::hook_gates_edit_when_other_agent_recently_wrote_same_path` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-20) | WX | W | D-20 | T-17-09 | Migration 007 adds `conflict_with_agent_id` + `gate_reason` columns; sets `pretool_gated_tools='[]'` | integration | `cargo test db::migrations::tests::migration_007_applies` (new) | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-21) | WX | W | D-21 | — | `create_approval_request_internal` persists conflict metadata through to the row | integration | `cargo test agents::self_register::tests::phase17::gate_row_carries_conflict_with_agent_id` | ❌ W0 | ⬜ pending |
| 17-WX-YY (D-22) | WX | W | D-22 | — | `ApprovalRequestCard` renders `⚠ CONFLICT with {agent}` on `gateReason='file_conflict'`; `🔒 PROTECTED path` on `gateReason='protected_path'`; nothing on legacy rows | frontend | `cd src && npm run test -- ApprovalRequestCard` | ❌ W0 | ⬜ pending |
| 17-WX-YY (window) | WX | W | CNFL-01 | — | Window boundary: write 6s ago (outside 5s default) does NOT gate | unit | `cargo test conflict::engine::tests::phase17::could_conflict_with_respects_window` | ❌ W0 | ⬜ pending |
| 17-WX-YY (latency) | WX | W | D-15 | T-17-10 | Lock-wait latency under synthetic 100-batch burst stays <10ms p99 | unit | `cargo test conflict::engine::tests::phase17::lock_contention_under_burst` (new, #[ignore] by default — opt-in perf test) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Wave numbers (WX / YY) are filled in by the planner during PLAN.md generation. The Req IDs and secure behaviors are locked by this document.*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/agents/bash_paths.rs` — new module: `extract_target_paths(command, cwd) -> BashParseResult { Safelisted | Targets(Vec<PathBuf>) | ParseFailed }`, plus `mod tests` with safelist + verb-dispatch coverage (D-09..D-13)
- [ ] `src-tauri/src/agents/mod.rs` — `pub mod bash_paths;`
- [ ] `src-tauri/src/conflict/engine.rs` — `pub fn could_conflict_with(&self, path, except_agent_id, now_ms, window_ms) -> Option<String>` + 5 new unit tests in `mod tests::phase17` (D-14/D-05; research §1 locks the `window_ms` parameter addition)
- [ ] `src-tauri/src/db/migrations/007_conflict_gating.sql` — `ALTER TABLE approval_requests ADD COLUMN conflict_with_agent_id TEXT` + `ADD COLUMN gate_reason TEXT` + `UPDATE app_settings SET value='[]' WHERE key='pretool_gated_tools'` (D-18/D-20)
- [ ] `src-tauri/src/agents/self_register.rs::tests::make_hook_pool` — extend test schema to include the new columns (research §6 Test schema)
- [ ] `src-tauri/Cargo.toml` — promote `shlex` from transitive to `[dependencies]` (version `1.3.0`, already in Cargo.lock); add `path-clean = "1.0"` (research §3)
- [ ] `src/components/ui/ConflictChip.tsx` OR inline rendering in `ApprovalRequestCard.tsx` (planner discretion per D-22 "Claude's Discretion")
- [ ] `src/bindings.ts` — regenerate via canonical command after Rust changes (`ApprovalRequest` gains `conflictWithAgentId?: string` + `gateReason?: 'file_conflict' | 'protected_path' | 'unknown'` fields)

*Framework install: none — `cargo test` + existing vitest cover every dimension. No new test framework required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-world two-session UAT | phase-gate | Requires two live Claude Code sessions + file-watcher + OS notification to validate the full loop end-to-end (automated tests mock pieces) | Launch two Claude Code KAGENT sessions in the same repo. Ask one to edit `foo.rs`. Ask the second to edit the same `foo.rs`. Verify: (1) first session returns cleanly, (2) second session's PreToolUse surfaces an approval row with `⚠ CONFLICT with KAGENT-{A}` line, (3) approving allows the tool call, (4) denying produces fail-safe deny in Claude. |
| Solo-session noise regression | performance | "It got quieter" is the phase's success criterion but needs a human side-by-side to confirm | Run a 10-minute solo Claude Code session on a typical edit/test/build workflow with Phase 17 code. Compare approval-row count to a baseline run on Phase 8 code. Expect zero approval rows on disjoint files; compare to baseline's "every Edit/Write/Bash prompts". |
| Deep-link OS notification still works | D-23 | Native notification click → window-focus → route is OS-layer; mocks can't simulate the click | Trigger a conflict gate with `AITC_NOTIFICATION_DEBUG=1`. Click the native notification. Verify window focuses and `/comms?requestId=X` selects the row. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify commands mapped in the per-task table above (planner fills in Task IDs)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (research §Sampling Rate locks the 15s quick loop)
- [ ] Wave 0 covers every MISSING reference (❌ W0 row in the table)
- [ ] No watch-mode flags (`cargo test --nocapture`, NOT `cargo-watch`)
- [ ] Feedback latency <15s for quick loop (estimated; enforce via CI time budget)
- [ ] `nyquist_compliant: true` set in frontmatter once planner validates this document against PLAN.md task IDs

**Approval:** pending — planner writes Task IDs into the map, flips `nyquist_compliant: true` after verifying coverage.

---

## Latency & Tracing Contract (Dimension 8 — Observability)

Locked from `17-RESEARCH.md §1 Lock granularity` and §Tracing Keys:

| Key | Level | Where | Fields |
|-----|-------|-------|--------|
| `kind = "bash_parse"` | debug | `bash_paths.rs` | `command_len`, `tokens`, `result` (`Safelisted` / `Targets(N)` / `ParseFailed`) |
| `kind = "hook_gate"` | info | `self_register.rs` (new gate branch) | `reason`, `agent`, `file`, `conflict_with` |
| `kind = "hook_allow"` | debug | `self_register.rs` (post-predicate) | `agent`, `tool`, `reason` (`passthrough` / `safelisted` / `no_conflict`) |
| `kind = "hook_lock_wait"` | debug | `self_register.rs` | `elapsed_us` |
| `kind = "conflict_query"` | trace | `engine.rs::could_conflict_with` | `path`, `except_agent`, `found` |

**Latency guard:** `hook_lock_wait` p99 must stay ≤50µs under steady state and <10ms under a synthetic 100-batch burst. If UAT logs show >1ms p99 steady state, the planner adds an investigation task for split-lock or per-path mutex.
