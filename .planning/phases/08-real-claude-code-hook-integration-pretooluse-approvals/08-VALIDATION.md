---
phase: 8
slug: real-claude-code-hook-integration-pretooluse-approvals
status: draft
nyquist_compliant: true
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
| **Full suite command** | `cd src-tauri && cargo build -p aitc-hook && cargo test --workspace && cd .. && pnpm vitest run && pnpm tsc --noEmit` |
| **Estimated runtime** | ~45s quick; ~3–5 min full (sidecar build included) |

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
| 01-T1 | 08-01 | 0 | Workspace + sidecar crate builds; envelope stubs are RED | T-08-00a | Cargo workspace isolation | unit (lib contract lock) | `cd src-tauri && cargo check --workspace && cargo test -p aitc-hook --test envelope_shapes 2>&1 | grep -qE "FAILED\|passed"` | ❌ W0 (creates src-tauri/aitc-hook/*, envelope_shapes.rs) | ⬜ pending |
| 01-T2 | 08-01 | 0 | Module stubs + DB migration 005 + bundle/capability config | T-08-00b, T-08-00c, T-08-00d | Narrow shell:allow-execute scope; atomic tmp+rename stubs | unit (should_panic markers) + migration apply | `cd src-tauri && cargo test --lib agents::hook_waiters agents::hook_install pipeline::port_file comms::app_settings db` | ❌ W0 (creates all stub files + 005 migration) | ⬜ pending |
| 01-T3 | 08-01 | 0 | Frontend ToolPreview registry + commsStore type extension | n/a (wave 0 UI contract) | No dangerouslySetInnerHTML in stubs | component (vitest) + store type check (tsc) | `pnpm vitest run src/views/CommsHub/__tests__/ToolPreview.test.tsx src/stores/__tests__/commsStore.test.ts && pnpm tsc --noEmit` | ❌ W0 (creates ToolPreview/*, test files) | ⬜ pending |
| 02-T1 | 08-02 | 1 | WaiterRegistry full impl + port_file + app_settings bootstrap + ApprovalRequest extension | T-08-02 | Mutex-guarded state; Pitfall 5 full-PID use | unit | `cd src-tauri && cargo test --lib agents::hook_waiters pipeline::port_file comms::app_settings comms::commands` | ❌ W0 (extends existing) | ⬜ pending |
| 02-T2 | 08-02 | 1 | /hook axum route + drop-guard + pass-through + passive stub + rate-limit + body limit | T-08-01, T-08-03, T-08-04, T-08-05 | 127.0.0.1 bind, 2 MB body cap, PID liveness check, is_object() validation | unit (axum integration) | `cd src-tauri && cargo test --lib agents::self_register::tests` | ❌ W0 (extends self_register.rs) | ⬜ pending |
| 02-T3 | 08-02 | 1 | Tauri commands approve/deny/approve_with_edits signal waiters + terminate force-deny + e2e smokes | T-08-02b, T-08-Rate | Pitfall 8 rows_affected guard, force-deny before kill | integration | `cd src-tauri && cargo test --test end_to_end_smoke` | ❌ W0 (extends end_to_end_smoke.rs) | ⬜ pending |
| 03-T1 | 08-03 | 1 | Sidecar lib.rs: envelope builders, port resolution, AitcDecision deser | T-08-06, T-08-11 | Port bounds check; deprecated-decision locked out | unit | `cd src-tauri && cargo test -p aitc-hook --test envelope_shapes` | ❌ W0 (Plan 01 created; Plan 03 fills bodies) | ⬜ pending |
| 03-T2 | 08-03 | 1 | Sidecar main.rs: stdin→POST→stdout/exit + fail-safe-deny subprocess tests | T-08-fail, T-08-07 | Every error returns exit 2 | integration (real subprocess + mock server) | `cd src-tauri && cargo test -p aitc-hook --test sidecar_roundtrip` | ❌ W0 (Plan 03 creates) | ⬜ pending |
| 04-T1 | 08-04 | 2 | hook_install merge semantics, atomic write, idempotent upsert, stale-path heal, startup auto-heal | T-08-08, T-08-P6 | Hand-rolled merge preserves user entries; aitc-hook suffix match heals paths | unit | `cd src-tauri && cargo test --lib agents::hook_install comms::app_settings` | ❌ W0 (Plan 01 stubs; Plan 04 bodies) | ⬜ pending |
| 04-T2 | 08-04 | 2 | Claude launch install + passive consent event + consent commands + bundle config finalization + startup auto-heal | T-08-09, T-08-EoP | D-23 bypass chip check; dedup sentinel written on emit | integration | `cd src-tauri && cargo test --test end_to_end_smoke -- passive_ claude_launch_ startup_auto_heal_` | ❌ W0 (Plan 04 extends) | ⬜ pending |
| 05-T1 | 08-05 | 2 | ToolBadge + ApprovalRequestCard preview line + abandoned-row chrome + commsStore invoke plumbing + RequestQueue bump | T-08-10 | No dangerouslySetInnerHTML on tool_input; abandoned row non-interactive | component (vitest + RTL) | `pnpm vitest run src/components/ui/__tests__/ToolBadge.test.tsx src/views/CommsHub/__tests__/ApprovalRequestCard.test.tsx src/stores/__tests__/commsStore.test.ts` | ❌ W0 (Plan 05 creates) | ⬜ pending |
| 05-T2 | 08-05 | 2 | Per-tool renderers (Edit/Write/Bash/Notebook/ProtectedPath/Unknown) + ShowAllToggle + RequestDetail slot swap | T-08-10 | shiki HTML is the only dangerouslySetInnerHTML source | component | `pnpm vitest run src/views/CommsHub/__tests__/ToolPreview.test.tsx src/views/CommsHub/__tests__/BashPreview.test.tsx src/views/CommsHub/__tests__/EditPreview.test.tsx` | ❌ W0 (Plan 05 creates) | ⬜ pending |
| 05-T3 | 08-05 | 2 | DontAskAgainCheckbox + ApprovalActions extension + PassiveHookConsentDialog + deepLinkNotification + App mount | T-08-11, T-08-12 | 1s focus rate-limit; DENY never passes alwaysAllowForSession | component + lib unit | `pnpm vitest run src/views/CommsHub/__tests__/DontAskAgainCheckbox.test.tsx src/views/CommsHub/__tests__/ApprovalActions.test.tsx src/views/CommsHub/__tests__/PassiveHookConsentDialog.test.tsx src/lib/__tests__/deepLinkNotification.test.ts` | ❌ W0 (Plan 05 creates) | ⬜ pending |
| 06-T1 | 08-06 | 3 | Real sidecar binary drives real /hook; allow + allow_with_edits + deny + abandon roundtrips | T-08-E1, T-08-E2 | E2E guard against cross-plan regression | integration (cross-crate) | `cd src-tauri && cargo build -p aitc-hook && cargo test --test hook_e2e_with_real_sidecar` | ❌ W0 (Plan 06 creates) | ⬜ pending |
| 06-T2 | 08-06 | 3 | Manual UAT + visual verification checklist against 08-UI-SPEC | T-08-Viz | Covers onClick + Windows-only paths + visual regression | manual UAT | `tests/manual/phase-08-uat.md` checklist — tester signs off every section | ❌ W0 (Plan 06 creates) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src-tauri/aitc-hook/Cargo.toml` + `src/main.rs` + `src/lib.rs` scaffold (Plan 01 Task 1)
- [x] `src-tauri/src/agents/hook_waiters.rs` stub with `HookWaiters::new()` + RED tests (Plan 01 Task 2)
- [x] `src-tauri/src/agents/hook_install.rs` stub for settings.local.json merge helper + RED tests (Plan 01 Task 2)
- [x] `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` (adds `tool_name`, `tool_input_json`, `session_id`, and 'abandoned' status) (Plan 01 Task 2)
- [x] `src-tauri/src/pipeline/port_file.rs` stub for `~/.aitc/port` writer + `Drop` cleanup (Plan 01 Task 2)
- [x] Test fixtures: `src-tauri/tests/fixtures/pretool_use_stdin.json` + `expected_permission_decision.json` (Plan 01 Task 2)
- [x] `src/views/CommsHub/ToolPreview.tsx` stub + per-tool renderer registry (Plan 01 Task 3)
- [x] Vitest: `src/views/CommsHub/__tests__/ToolPreview.test.tsx` (Plan 01 Task 3)
- [x] Vitest extension: `src/stores/__tests__/commsStore.test.ts` — add pretool_use type assertions (Plan 01 Task 3)

*If Wave 0 leaves a stub without a corresponding test/fixture, the check fails for that row.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Claude Code PreToolUse → AITC approval → Claude proceeds | Phase goal | Requires a real `claude` binary and a terminal; cannot run in CI without leaking API keys | See `tests/manual/phase-08-uat.md` §A |
| Client-disconnect cleanup | D-09 | Needs an OS-level process kill while waiter is blocked | `tests/manual/phase-08-uat.md` §G |
| Passive-detection consent prompt | D-04 | Requires a manually-launched `claude` outside AITC | `tests/manual/phase-08-uat.md` §F |
| Deep-link OS notification | D-18 | Tauri notifications with onClick payload are platform-specific; Linux may be best-effort only | `tests/manual/phase-08-uat.md` §I |
| Windows `taskkill` + force-deny ordering | D-10 | Needs Windows build | `tests/manual/phase-08-uat.md` §J |
| Visual verification against 08-UI-SPEC | n/a | Human-only | `tests/manual/phase-08-uat.md` §L |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags in task commands
- [x] Feedback latency < 60s for quick run
- [x] `nyquist_compliant: true` set in frontmatter once planner fills the per-task table

**Approval:** pending checker review
