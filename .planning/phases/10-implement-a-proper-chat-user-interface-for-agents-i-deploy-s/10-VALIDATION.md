---
phase: 10
slug: implement-a-proper-chat-user-interface-for-agents-i-deploy-s
status: draft
nyquist_compliant: false
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
| **Quick run command (BE)** | `cd src-tauri && cargo test --lib --test <pattern>` |
| **Full suite command (FE)** | `pnpm vitest run` |
| **Full suite command (BE)** | `cd src-tauri && cargo test --workspace` |
| **Estimated runtime (FE)** | ~15 seconds |
| **Estimated runtime (BE)** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run scoped quick command for the touched module (FE or BE, per task)
- **After every plan wave:** Run full suite on the modified side(s)
- **Before `/gsd-verify-work`:** Both FE and BE full suites must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Generated during planning — planner populates this table from each plan's tasks. Each row maps one task to its automated verification command.

| Task ID | Plan | Wave | Decision Ref | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|--------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (populated in planning) | | | | | | | | ⬜ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 seeds the test infrastructure before any production code lands. Populated during planning. Expected scaffolds (from RESEARCH.md suggested wave structure):

- [ ] `src-tauri/tests/chat_runtime_smoke.rs` — end-to-end smoke against a mocked or real `claude` subprocess
- [ ] `src-tauri/src/chat_runtime/parser.rs` test module — fixtures seeded from the captured stream-json envelope shapes
- [ ] `src-tauri/src/chat_runtime/outbound.rs` test module — FIFO queue + delivery-status transitions
- [ ] `src-tauri/src/db/events.rs` test module — agent_events read/write helpers + migration idempotency
- [ ] `src-tauri/src/mcp/` test module — JSON-RPC surface (initialize / tools/list / tools/call) + `Mcp-Session-Id` handling
- [ ] `src/stores/__tests__/chatStore.test.ts` — per-agent arrays, streaming appends, unread counts, selector stability
- [ ] `src/hooks/__tests__/useChatChannel.test.ts` — subscription lifecycle + event application
- [ ] `src/views/CommsHub/__tests__/ChatView.test.tsx` — master-detail routing, archived-agent UX, tab switch preservation
- [ ] `src/components/chat/__tests__/` — `EventCard` / `UserMessageCard` / `AssistantTextCard` / `ToolUseCard` / `ApprovalLinkCard` / `SessionBoundary` rendering + streaming cursor
- [ ] `src/components/ui/__tests__/DeliveryStatus.test.tsx` — ensure existing coverage extends to new `consumed` variant
- [ ] Stream-json fixture JSONL files under `src-tauri/tests/fixtures/stream_json/` — captured init, assistant deltas, tool_use, tool_result, result, hook_started/hook_response

*If none: will be marked "Existing infrastructure covers all phase decisions" after planning.*

---

## Manual-Only Verifications

| Behavior | Decision Ref | Why Manual | Test Instructions |
|----------|--------------|------------|-------------------|
| Full-narration transcript shows tool-use + text + approval links inline with Command Horizon styling | D-05, D-13, D-16, UI-SPEC | Visual conformance requires human eye per `gsd-ui-checker` six-dimension framing | Launch AITC, deploy a Claude Code agent, run a task that triggers Edit + Bash + PreToolUse approval; verify transcript inlines all four event types with correct spacing, typography, and 60/30/10 color split |
| Streaming tokens render progressively with blinking cursor during assistant turn | D-17, UI-SPEC | Frame-timing + animation correctness is not unit-testable | Launch agent with a prompt that emits a long response; observe in-progress assistant card shows token-by-token updates + `blink-cursor` animation; confirm cursor disappears on turn completion |
| OS notifications fire only on @-mention / awaiting-user signals, not every turn | D-23 | Native OS notification delivery is host-platform-specific | Send a chat turn; confirm no notification. Trigger an awaiting-user signal (MCP `request_user_input` or @user text); confirm deep-link notification focuses AITC and navigates to the right agent thread |
| Unread counts reset correctly on agent-thread deep-link navigation (not just window focus) | D-22, UI-SPEC | Event-driven navigation timing requires manual confirmation across tray-click paths | With AITC minimized to tray and multiple agents accumulating events, click the tray icon → confirm the Comms dot remains until the specific agent thread is opened |
| Auto-resume fallback produces a seamless "session continues" feel when Claude's long-lived subprocess has exited | D-08 | Cross-phase latency + UX smoothness | Let a session run to `terminal_reason:"completed"`, then send a new message; verify a new `claude --resume` subprocess spawns and the assistant reply appends cleanly with a session-boundary marker per D-03 |
| Two-click CLEAR_THREAD destructive confirmation works per design system | UI-SPEC | Destructive-action UX must be verified against design spec | Click Clear Thread on an agent with events; verify first click shows CONFIRM_CLEAR state with 3-second lapse; second click within the window deletes; clicking elsewhere cancels |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
