---
phase: 10
slug: implement-a-proper-chat-user-interface-for-agents-i-deploy-s
status: planning-complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-17
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (frontend)** | vitest 3.x (existing — see `vitest.config.ts`) |
| **Framework (backend)** | cargo test (existing — `src-tauri/Cargo.toml`) |
| **Config file (FE)** | `vitest.config.ts` |
| **Config file (BE)** | `src-tauri/Cargo.toml` |
| **Quick run command (FE)** | `pnpm vitest run <file-or-pattern>` |
| **Quick run command (BE)** | `cd src-tauri && cargo test --lib <pattern>` |
| **Full suite command (FE)** | `pnpm vitest run` |
| **Full suite command (BE)** | `cd src-tauri && cargo test --workspace` |
| **Estimated runtime (FE)** | ~20 seconds (cold) |
| **Estimated runtime (BE)** | ~90 seconds (cold) |

---

## Sampling Rate

- **After every task commit:** Run scoped quick command for the touched module (FE or BE, per task).
- **After every plan wave:** Run full suite on the modified side(s).
- **Before `/gsd-verify-work`:** Both FE and BE full suites must be green.
- **Max feedback latency:** 90 seconds.

---

## Per-Task Verification Map

Every task's automated verification command, plus the decision(s) and threat(s) it covers.

| Task ID | Plan | Wave | Decision Ref | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|--------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01/T1 | 01 | 0 | D-14, D-21 | T-10-01, T-10-02 | Migration 006 is idempotent + data migration is bound-param SQL | backend unit | `cd src-tauri && cargo test --lib db::events` | ⬜ | ⬜ pending |
| 10-01/T2 | 01 | 0 | D-13, D-14, D-24 | T-10-03, T-10-05 | Backend scaffolds compile; fixtures captured for fuzz/parse tests | backend unit + fixture | `cd src-tauri && cargo build && cargo test --test chat_runtime_smoke` | ⬜ | ⬜ pending |
| 10-01/T3 | 01 | 0 | D-10, D-13, D-20 | — | Frontend scaffolds compile; DeliveryStatus has 4 variants; MasterDetailShell accepts width props | frontend unit | `pnpm vitest run src/components/chat src/components/ui/__tests__/DeliveryStatus.test.tsx src/components/layout/__tests__/MasterDetailShell.test.tsx src/stores/__tests__/chatStore.test.ts && pnpm tsc --noEmit` | ⬜ | ⬜ pending |
| 10-02/T1 | 02 | 1 | D-03, D-14, D-15 | T-10-02, T-10-12 | session_registry + events.rs CRUD with bound-param SQL | backend unit | `cd src-tauri && cargo test --lib chat_runtime::session_registry::tests db::events::tests` | ⬜ | ⬜ pending |
| 10-02/T2 | 02 | 1 | D-06, D-07, D-08, D-10, D-17 | T-10-06, T-10-07, T-10-08, T-10-10, T-10-11 | stream-json parser (never panics on malformed); FIFO outbound with BrokenPipe → unsupported; auto-resume validates UUIDv4 | backend unit + fixture | `cd src-tauri && cargo test --lib chat_runtime::parser chat_runtime::outbound chat_runtime::launcher chat_runtime::supervisor chat_runtime::auto_resume` | ⬜ | ⬜ pending |
| 10-02/T3 | 02 | 1 | D-02, D-08, D-09, D-10 | T-10-09, T-10-12, T-10-13 | send_chat_message_to_agent enforces 256 KiB cap; read-only path inserts unsupported row; duplex path enqueues FIFO frame | backend unit + integration | `cd src-tauri && cargo test --lib chat_runtime::commands` | ⬜ | ⬜ pending |
| 10-03/T1 | 03 | 1 | D-11, D-23 | T-10-14, T-10-15, T-10-16, T-10-17, T-10-19, T-10-20 | MCP initialize issues session id; unknown session → 404; tool inputs validated; atomic MCP config write | backend unit | `cd src-tauri && cargo test --lib mcp::` | ⬜ | ⬜ pending |
| 10-03/T2 | 03 | 1 | D-11 | — | /mcp routes on existing axum router; no regression on /hook or /register | backend integration | `cd src-tauri && cargo test --lib self_register` | ⬜ | ⬜ pending |
| 10-04/T1 | 04 | 2 | D-01, D-02, D-06, D-23 | T-10-21, T-10-22, T-10-25, T-10-26 | ClaudeCodeAdapter long-lived mode; dispatch_chat_notification panic-safe; @user regex bounded | backend unit | `cd src-tauri && cargo test --lib agents::adapter agents::claude_code chat_runtime::notifications chat_runtime::parser::tests::is_awaiting_user_mention` | ⬜ | ⬜ pending |
| 10-04/T2 | 04 | 2 | D-04, D-12, D-24 | T-10-23 | launch_agent routes duplex vs raw-capture correctly; relaunch reactivates archived session | backend integration | `cd src-tauri && cargo test --lib agents::commands::tests` | ⬜ | ⬜ pending |
| 10-04/T3 | 04 | 2 | D-21 | T-10-24 | Phase 4 backend chat commands deleted; bindings.ts regenerated | backend smoke + bindings check | `cd src-tauri && cargo build && grep -c 'send_chat_message\b' src/bindings.ts` | ⬜ | ⬜ pending |
| 10-05/T1 | 05 | 3 | D-10, D-17, D-22, D-24 | T-10-28 | chatStore subscribes to 9 Tauri events with useShallow-friendly selectors | frontend unit | `pnpm vitest run src/stores/__tests__/chatStore.test.ts src/hooks/__tests__/useChatChannel.test.ts` | ⬜ | ⬜ pending |
| 10-05/T2 | 05 | 3 | D-02, D-03, D-05, D-10, D-13, D-15, D-16, D-17 | T-10-27, T-10-29, T-10-31 | Every event card renders per UI-SPEC; ToolUseCard integrates Phase 8 ToolPreview; @user highlighted; XSS-safe (React default escaping) | frontend unit | `pnpm vitest run src/components/chat/__tests__ src/components/ui/__tests__/UnreadBadge.test.tsx src/components/ui/__tests__/CommsTabBar.test.tsx` | ⬜ | ⬜ pending |
| 10-05/T3 | 05 | 3 | D-02, D-04, D-18 | T-10-30 | ChatInput binds to chatStore; AgentChannelList virtualizes; ChatTranscript reverse-scroll with loadOlder; raw_stdout truncation | frontend unit | `pnpm vitest run src/components/chat/__tests__/ChatInput.test.tsx src/components/chat/__tests__/ChatTranscript.test.tsx src/components/chat/__tests__/AgentChannelList.test.tsx` | ⬜ | ⬜ pending |
| 10-06/T1 | 06 | 4 | D-19, D-20, D-22, D-24 | T-10-32, T-10-33, T-10-35 | CommsView tab routing narrows ?tab; ChatView deep-links ?agent; 2-click CLEAR_THREAD; App-root useChatChannel | frontend unit + tsc | `pnpm vitest run src/views/CommsHub/__tests__/ChatView.test.tsx && pnpm tsc --noEmit` | ⬜ | ⬜ pending |
| 10-06/T2 | 06 | 4 | D-21 | T-10-34 | Phase 4 frontend chat surface deleted; no dangling imports; tsc green | frontend file absence + tsc + full vitest | `test ! -f src/views/CommsHub/ChatThread.tsx && test ! -f src/views/CommsHub/ChatInput.tsx && test ! -f src/views/CommsHub/MiniChatCard.tsx && pnpm tsc --noEmit && pnpm vitest run` | ⬜ | ⬜ pending |
| 10-06/T3 | 06 | 4 | D-05, D-16, D-17, D-19, D-20, D-22, D-23, UI-SPEC | — | UAT — human verifies CHAT tab visual/interaction conformance against 10-UI-SPEC | manual | Human execution of checklist in 10-06-PLAN.md Task 3 | ✅ | ✅ green (signed off 2026-04-21; polish → Phase 19) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Nyquist Continuity Audit

No three consecutive tasks lack an automated verify:
- Plan 01: T1 (cargo test), T2 (cargo test), T3 (pnpm vitest) — 3 automated.
- Plan 02: T1 (cargo test), T2 (cargo test), T3 (cargo test) — 3 automated.
- Plan 03: T1 (cargo test), T2 (cargo test) — 2 automated.
- Plan 04: T1 (cargo test), T2 (cargo test), T3 (cargo build + grep) — 3 automated.
- Plan 05: T1 (vitest), T2 (vitest), T3 (vitest) — 3 automated.
- Plan 06: T1 (vitest + tsc), T2 (file absence + tsc + vitest), T3 (manual UAT — HUMAN).

The final task (06/T3) is the only manual verification; every preceding task has an automated verify. Nyquist gap = 1 (acceptable — the checkpoint is the sign-off).

---

## Wave 0 Requirements

Wave 0 seeds the test infrastructure before any production code lands. Populated from Plan 01 task_breakdown.

**Backend (populated by Plan 01 Task 1 + Task 2):**
- [ ] `src-tauri/src/db/migrations/006_agent_events.sql` — CREATE TABLE + one-shot migration from chat_messages (D-14, D-21).
- [ ] `src-tauri/src/db/events.rs` — CRUD skeleton + map_agent_event_row helper.
- [ ] `src-tauri/src/chat_runtime/mod.rs` + submodule scaffolds — types, session_registry, launcher, parser, outbound, supervisor, commands, auto_resume, notifications.
- [ ] `src-tauri/src/mcp/mod.rs` + submodule scaffolds — types, streamable_http, tools, session_config.
- [ ] `src-tauri/tests/chat_runtime_smoke.rs` — public-surface import smoke test.
- [ ] `src-tauri/tests/fixtures/stream_json/single_turn_text.jsonl` — captured init + stream_event deltas + assistant + result.
- [ ] `src-tauri/tests/fixtures/stream_json/multi_turn_persistent.jsonl` — two turns, same session_id.
- [ ] `src-tauri/tests/fixtures/stream_json/tool_use_edit.jsonl` — assistant tool_use block for Edit.
- [ ] `src-tauri/tests/fixtures/stream_json/tool_result.jsonl` — user tool_result block.
- [ ] `src-tauri/tests/fixtures/stream_json/hook_started_response.jsonl` — SessionStart hook metadata.
- [ ] `src-tauri/tests/fixtures/stream_json/result_completed.jsonl` — bare terminal result envelope.
- [ ] `src-tauri/tests/fixtures/stream_json/malformed.jsonl` — 3 deliberately un-parsable lines for parser fuzz tests.

**Frontend (populated by Plan 01 Task 3):**
- [ ] `src/stores/chatStore.ts` — Zustand skeleton (ChatStore interface + create<ChatStore>() stub actions).
- [ ] `src/hooks/useChatChannel.ts` — mount/unmount hook skeleton.
- [ ] `src/components/chat/index.ts` — module re-exports.
- [ ] `src/components/chat/EventCard.tsx` — complete dispatcher (used by Plan 05 tests).
- [ ] `src/components/chat/{UserMessage,AssistantText,ToolUse,ApprovalLink,ToolResult,SessionBoundary,RawStream,SystemNote}Card.tsx` — minimal stubs with data-testid.
- [ ] `src/components/chat/{StreamingCursor,ReadOnlyBadge,ChatInput,AgentChannelList,AgentChannelRow,ChatTranscript}.tsx` — stubs.
- [ ] `src/components/ui/{CommsTabBar,UnreadBadge}.tsx` — stubs.
- [ ] `src/views/CommsHub/ChatView.tsx` — placeholder mount.
- [ ] `src/components/ui/DeliveryStatus.tsx` — MODIFIED: adds `consumed` variant.
- [ ] `src/components/layout/MasterDetailShell.tsx` — MODIFIED: `railWidth?`, `detailWidth?` props.
- [ ] Test-file scaffolds for every new component + store + hook.

**Framework installs:** none — vitest + cargo test already in-tree.

Plan 01's verify command confirms all of the above compile/pass before Wave 1 begins.

---

## Manual-Only Verifications

| Behavior | Decision Ref | Why Manual | Test Instructions |
|----------|--------------|------------|-------------------|
| Full-narration transcript shows tool-use + text + approval links inline with Command Horizon styling | D-05, D-13, D-16, UI-SPEC | Visual conformance requires human eye per gsd-ui-checker six-dimension framing | Launch AITC, deploy a Claude Code agent, run a task that triggers Edit + Bash + PreToolUse approval; verify transcript inlines all four event types with correct spacing, typography, and 60/30/10 color split |
| Streaming tokens render progressively with blinking cursor during assistant turn | D-17, UI-SPEC | Frame-timing + animation correctness is not unit-testable | Launch agent with a prompt that emits a long response; observe in-progress assistant card shows token-by-token updates + blink-cursor animation; confirm cursor disappears on turn completion |
| OS notifications fire only on @-mention / awaiting-user signals, not every turn | D-23 | Native OS notification delivery is host-platform-specific | Send a chat turn; confirm no notification. Trigger an awaiting-user signal (MCP `request_user_input` or @user text); confirm deep-link notification focuses AITC and navigates to the right agent thread |
| Unread counts reset correctly on agent-thread deep-link navigation (not just window focus) | D-22, UI-SPEC | Event-driven navigation timing requires manual confirmation across tray-click paths | With AITC minimized to tray and multiple agents accumulating events, click the tray icon → confirm the Comms dot remains until the specific agent thread is opened |
| Auto-resume fallback produces a seamless "session continues" feel when Claude's long-lived subprocess has exited | D-08 | Cross-phase latency + UX smoothness | Let a session run to `terminal_reason:"completed"`, then send a new message; verify a new `claude --resume` subprocess spawns and the assistant reply appends cleanly with a session-boundary marker per D-03 |
| Two-click CLEAR_THREAD destructive confirmation works per design system | UI-SPEC | Destructive-action UX must be verified against design spec | Click Clear Thread on an agent with events; verify first click shows CONFIRM_CLEAR state with 3-second lapse; second click within the window deletes; clicking elsewhere cancels |

All six manual verifications are covered by the Plan 06/T3 UAT checkpoint.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies populated.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (only 06/T3 is manual).
- [x] Wave 0 covers all MISSING references from Plan 01.
- [x] No watch-mode flags (only `--run` / `-x` equivalent).
- [x] Feedback latency < 90s (backend `cargo test --lib <scope>` ~30s typical; frontend `pnpm vitest run <file>` ~5s typical).
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending — executor runs `/gsd-execute-phase 10` when ready.
