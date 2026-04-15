---
phase: 8
slug: real-claude-code-hook-integration-pretooluse-approvals
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Fill Per-Task map during planning; gsd-planner populates every task row.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | `cargo test` (Rust backend + sidecar), `vitest` (frontend), shared mocks via `tauri::test` + existing `sqlx::sqlite::SqlitePoolOptions::connect("sqlite::memory:")` pattern from `self_register.rs` |
| **Config files** | `src-tauri/Cargo.toml` (workspace includes new `aitc-hook/` crate), `vitest.config.ts`, `tauri.conf.json` (sidecar entry) |
| **Quick run command** | `cd src-tauri && cargo test --lib hook -- --test-threads=4` for backend; `cd .. && pnpm vitest run src/views/CommsHub src/stores/commsStore` for frontend |
| **Full suite command** | `cd src-tauri && cargo test --workspace && cd .. && pnpm vitest run && pnpm tsc --noEmit` |
| **Estimated runtime** | ~45s quick; ~3–4 min full |

---

## Sampling Rate

- **After every task commit:** Run quick run command for the module the task touched.
- **After every plan wave:** Run full suite command.
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 60 seconds for quick run.

---

## Per-Task Verification Map

> Planner populates this table while drafting each PLAN.md. Rows must cite the task id, plan, wave, covered requirement/behavior, secure behavior (if applicable), test type, automated command, and whether the test file exists today. Use `❌ W0` for files that Wave 0 creates.

| Task ID | Plan | Wave | Requirement / Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|------------------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _filled by planner_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/aitc-hook/Cargo.toml` + `src/main.rs` scaffold (new sidecar crate)
- [ ] `src-tauri/src/agents/hook_waiters.rs` stub with `HookWaiters::new()` + `Drop` guard
- [ ] `src-tauri/src/agents/hook_install.rs` stub for settings.local.json merge helper
- [ ] `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` (adds `tool_name`, `tool_input_json`, `session_id`, and 'abandoned' status)
- [ ] `src-tauri/src/pipeline/port_file.rs` stub for `~/.aitc/port` writer + `Drop` cleanup
- [ ] Test fixtures: `src-tauri/tests/fixtures/pretool_use_stdin.json` + `expected_permission_decision.json`
- [ ] `src/views/CommsHub/ToolPreview.tsx` stub + per-tool renderer registry
- [ ] Vitest: `src/views/CommsHub/__tests__/ToolPreview.test.tsx`
- [ ] Vitest extension: `src/stores/__tests__/commsStore.test.ts` — add pretool_use type assertions

*If Wave 0 leaves a stub without a corresponding test/fixture, the check fails for that row.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Claude Code PreToolUse → AITC approval → Claude proceeds | Phase goal | Requires a real `claude` binary and a terminal; cannot run in CI without leaking API keys | 1. `pnpm tauri dev`. 2. Launch a Claude Code agent from Tower Control with no bypass chip. 3. Verify `.claude/settings.local.json` exists in the target repo with the AITC PreToolUse entry pointing at the bundled `aitc-hook` binary. 4. Have Claude attempt an Edit — AITC Comms queue shows a new `pretool_use` row with tool badge + first-line preview. 5. Approve — Claude proceeds, applies the edit. 6. Trigger a Bash call — approve_with_edits path is disabled for Bash, approve-only succeeds. 7. Deny a Write — Claude logs the block reason from stderr. |
| Client-disconnect cleanup | D-09 | Needs an OS-level process kill while waiter is blocked | 1. Start a Claude agent, let it block on PreToolUse. 2. `kill -9 {claude_pid}` externally. 3. Within 2s, the pending row transitions to `abandoned` in the UI; no orphaned waiter in the HashMap. |
| Passive-detection consent prompt | D-04 | Requires a manually-launched `claude` outside AITC | 1. Start AITC, then `claude --print "test"` in another terminal (do NOT launch via Tower). 2. `passive_bridge::bridge_tick` detects the process; AITC shows a native dialog prompting "Install hook in {repo}?". 3. Accept → settings.local.json is written into that repo only; decline → remembered in app_settings, prompt not shown again for that repo. |
| Deep-link OS notification | D-18 | Tauri notifications with onClick payload are platform-specific; Linux may be best-effort only | 1. Minimize AITC. 2. Have Claude trigger a PreToolUse. 3. Native toast appears. 4. Click toast → AITC window focuses, navigates to /comms, selects the specific request row. Record platform behavior. |
| Windows `taskkill` + force-deny ordering | D-10 | Needs Windows build | On Windows: 1. Launch Claude, let it block on PreToolUse. 2. Click Terminate in Tower Control. 3. Verify: waiter fires deny BEFORE taskkill /PID /T /F kills Claude; Claude receives the deny JSON on stdout (not EPIPE). |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags in task commands
- [ ] Feedback latency < 60s for quick run
- [ ] `nyquist_compliant: true` set in frontmatter once planner fills the per-task table

**Approval:** pending
