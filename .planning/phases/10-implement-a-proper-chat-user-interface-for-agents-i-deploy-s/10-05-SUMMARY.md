---
phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s
plan: 05
subsystem: frontend-chat
tags: [chatStore, tanstack-virtual, motion-layout, tool-preview-integration, reverse-scroll, event-cards, tdd]

requires:
  - phase: 10
    plan: 01
    provides: chatStore + chat component scaffolds (Wave 0 stubs), MasterDetailShell railWidth override, DeliveryStatus consumed variant
  - phase: 10
    plan: 02
    provides: six real Tauri chat_runtime command bodies + AgentEvent schema + agent-event-appended / agent-delivery-updated / agent-session-ended / agent-thread-cleared / agent-events-marked-read emissions
  - phase: 10
    plan: 04
    provides: agent-session-started + agent-turn-complete + agent-session-resumed emissions, real launch_agent duplex routing, Phase 4 chat command surface DELETED from bindings.ts

provides:
  - chatStore full implementation — nine-listener subscription fan-out covering every Phase 10 backend emission
  - chatStore dedup on sendMessage race with agent-event-appended listener
  - chatStore loadInitialEvents/loadOlder reverse backend newest-first into oldest-first (transcript renders bottom-up via TanStack Virtual)
  - chatStore agent-turn-complete flips last streaming assistant_text to streaming:false AND last delivered user_text to consumed (D-10 lifecycle)
  - chatStore agent-session-ended archives + agent-session-resumed un-archives matching channel (D-04 reactivation)
  - 13 chat components fully implemented per 10-UI-SPEC with zero hex literals (all token classes)
  - Event dispatcher (EventCard) routes nine event types + forward-compat fallback to SystemNoteCard for unknown types (D-13)
  - UserMessageCard — self-end surface-container bubble + timestamp + DeliveryStatus (queued/delivered/consumed/unsupported)
  - AssistantTextCard — self-start surface-container-high bubble, body color flips on-surface-variant → on-surface while streaming, @user highlight via word-bounded regex (Pitfall 5 defense), StreamingCursor + STREAMING… label during stream (D-17)
  - ToolUseCard — Motion layout + AnimatePresence expand/collapse; collapsed row with ToolBadge + summary + chevron + optional APPROVAL_{id} pill (secondary colorway) linking to `/comms?tab=requests&request={id}`; expanded body renders Phase 8 ToolPreview inline (D-16)
  - ApprovalLinkCard — border-l-2 border-secondary + ExternalLink icon + useNavigate routing + 40-char path truncation
  - SessionBoundary — three variants (started/ended/resumed) with session_id prefix and reason/exit-code copy (D-03)
  - RawStreamCard — 4 KiB truncation with `… (truncated, N more bytes)` footer (T-10-30 defense)
  - SystemNoteCard — centered Label-font fallback for unknown event types
  - StreamingCursor — 2px bg-primary bar with blink-cursor animation
  - ReadOnlyBadge — tertiary pill for uncapable adapters (D-02)
  - ChatInput — Ctrl/Cmd+Enter parity, Escape clear-then-blur, focused keyboard hint (⏎ SEND · ⇧⏎ NEWLINE), disabled-state tooltip + aria-disabled
  - AgentChannelList — TanStack Virtual ACTIVE section (estimateSize=64, overscan=10), collapsible ARCHIVED section (default collapsed), most-recent-activity desc sort, AGENT_CHANNELS header, empty state
  - AgentChannelRow — two-line 64px row with adapter chip, last-event preview, relative timestamp, UnreadBadge. Selected: border-l-2 border-primary + text-primary. Archived: opacity-50 wrapper
  - ChatTranscript — TanStack Virtual reverse-scrolled transcript. Mount scrolls to bottom; new events auto-follow when at-bottom; floating `↓ N_NEW_MESSAGES` pill when scrolled up; near-top scroll triggers loadOlder. SESSION_ARCHIVED + NO_MESSAGES empty states
  - UnreadBadge (shared) — `{count}` or `99+`, hidden when count=0 (already Plan 01)
  - CommsTabBar (shared) — role=tablist REQUESTS | CHAT switcher (already Plan 01)

affects:
  - Plan 06 (URL routing + Phase 4 frontend deletion): ChatView + CommsView tab switcher + Sidebar chat-unread dot are unblocked. All primitives this plan built are consumed wholesale
  - Any future callsite importing `src/components/chat/*` or `useChatStore` now has a full behavior contract (no `todo!`s, no stub returns)

tech-stack:
  added: []
  patterns:
    - "Nine-listener Promise.all fan-out in subscribeToChat returning a single unlisten closure — direct extension of commsStore.subscribeToApprovals' 3-listener shape to cover the full Phase 10 backend emission surface (agent-event-appended, agent-turn-started, agent-turn-complete, agent-session-started, agent-session-ended, agent-delivery-updated, agent-thread-cleared, agent-events-marked-read, agent-session-resumed)"
    - "Optimistic-append + listener-race dedup: sendMessage checks `existing.some((e) => e.id === event.id)` before pushing; the agent-event-appended listener can arrive before or after the invoke resolution and only one wins"
    - "Backwards-walk turn-complete: iterate eventsByAgent[agentId] in reverse to flip *only* the most recent streaming assistant_text and *only* the most recent delivered user_text; short-circuit when both flips land"
    - "Reverse-scroll TanStack Virtual: getVirtualItems() renders oldest→newest and the scroll container is pinned to bottom on mount; new-events while scrolled-up increment a local counter + show floating pill; near-top dispatch of loadOlder(agentId)"
    - "Mock @tanstack/react-virtual in component tests — jsdom containers have 0 height so the real virtualizer renders zero items. The mock returns all items linearly which lets tests assert on EventCard/AgentChannelRow content. Production rendering is unaffected"
    - "motion/react strip-props mock + AnimatePresence passthrough pattern copied verbatim from CommsComponents.test.tsx for ToolUseCard expand tests"
    - "ApprovalLinkCard + ToolUseCard navigate via useNavigate (react-router-dom). Tests mock useNavigate and assert the correct `/comms?tab=requests&request={id}` URL was passed"

key-files:
  created: []
  modified:
    - src/stores/chatStore.ts (Plan 01 skeleton → full nine-listener implementation + dedup + reverse order + turn-complete flip logic, 392 lines)
    - src/stores/__tests__/chatStore.test.ts (21 tests, 8 → 21)
    - src/hooks/useChatChannel.ts (already complete in Plan 01; 29 lines; unchanged)
    - src/hooks/__tests__/useChatChannel.test.ts (already complete; 2 tests; unchanged)
    - src/components/chat/EventCard.tsx (unchanged — Plan 01 dispatcher already matches D-13 nine-type routing)
    - src/components/chat/UserMessageCard.tsx (stub → full: timestamp + DeliveryStatus + whitespace-pre-wrap content)
    - src/components/chat/AssistantTextCard.tsx (stub → full: streaming cursor + @user highlight + body-color flip + STREAMING… label)
    - src/components/chat/ToolUseCard.tsx (stub → full: motion layout collapse/expand + ToolBadge + ToolPreview integration + APPROVAL_{id} pill)
    - src/components/chat/ApprovalLinkCard.tsx (stub → full: ExternalLink icon + border-l-2 border-secondary + useNavigate routing + 40-char truncation)
    - src/components/chat/SessionBoundary.tsx (stub → full: three variants + right-aligned ISO timestamp + hairline dividers)
    - src/components/chat/RawStreamCard.tsx (stub → full: 4 KiB truncation with footer per T-10-30)
    - src/components/chat/SystemNoteCard.tsx (unchanged — Plan 01 already renders fallback)
    - src/components/chat/StreamingCursor.tsx (unchanged — Plan 01 already uses blink-cursor with bg-primary)
    - src/components/chat/ReadOnlyBadge.tsx (unchanged — Plan 01 already matches tertiary colorway)
    - src/components/chat/ChatInput.tsx (Plan 01 → full: Ctrl/Cmd+Enter parity, Escape clear-then-blur, focused hint, disabled cursor-not-allowed)
    - src/components/chat/AgentChannelList.tsx (stub → full: TanStack Virtual ACTIVE section + collapsible ARCHIVED section + recency sort + AGENT_CHANNELS header)
    - src/components/chat/AgentChannelRow.tsx (stub → full: two-line 64px row + adapter chip + preview + timestamp + UnreadBadge + selected border)
    - src/components/chat/ChatTranscript.tsx (stub → full: reverse-scroll TanStack Virtual + new-messages pill + loadOlder trigger + SESSION_ARCHIVED empty state)
    - src/components/ui/UnreadBadge.tsx (unchanged — Plan 01 already satisfies contract)
    - src/components/ui/CommsTabBar.tsx (unchanged — Plan 01 already satisfies contract)
    - src/components/chat/__tests__/EventCard.test.tsx (9 tests, wrapped in MemoryRouter + motion/ToolPreview mocks)
    - src/components/chat/__tests__/UserMessageCard.test.tsx (1 → 8 tests)
    - src/components/chat/__tests__/AssistantTextCard.test.tsx (1 → 5 tests)
    - src/components/chat/__tests__/ToolUseCard.test.tsx (1 → 4 tests)
    - src/components/chat/__tests__/ApprovalLinkCard.test.tsx (1 → 3 tests)
    - src/components/chat/__tests__/SessionBoundary.test.tsx (1 → 3 tests)
    - src/components/chat/__tests__/ChatInput.test.tsx (3 → 8 tests)
    - src/components/chat/__tests__/ChatTranscript.test.tsx (3 → 7 tests)
    - src/components/chat/__tests__/AgentChannelList.test.tsx (2 → 7 tests)

key-decisions:
  - "agent-session-started listener re-fetches channels (invokes list_chat_channels) rather than locally inserting. The aggregator owns channel identity (agent_id, adapter_type, chatDuplex, currentSessionId) and a fresh fetch is cheaper than local fan-out of those fields. The aggregator also inserts the session_boundary row via agent-event-appended so the transcript shows the boundary without store logic."
  - "agent-event-appended handler INCLUDES a dedup check on event.id to match sendMessage's optimistic-append guard. Without it, dedupe would only work one direction (optimistic first) and the listener-first race would double-render."
  - "Backwards iteration in agent-turn-complete short-circuits when both flips land (streaming→false + delivered→consumed). Forward iteration would flip the FIRST streaming assistant_text; the contract demands the LAST one (UI-SPEC D-17)."
  - "payloadJson in agent-turn-complete: use `(e.payloadJson as object) ?? {}` for the streaming flag spread — a malformed backend payload can't crash the store mutation."
  - "ChatTranscript uses a local atBottom state driven by onScroll. Alternative: read scroll position inside the useEffect that watches events.length. Chose local state so the rendering path is deterministic: pill visibility ↔ atBottom ↔ scroll handler transition."
  - "near-top threshold = 16px (TOP_THRESHOLD_PX). TanStack Virtual measurement means scrollTop can land at tiny negative-ish values during virtualization; 16px gives a generous trigger without double-firing. Combined with loadOlder's no-op-when-empty guard, firing too often is harmless."
  - "bottom threshold = 24px (BOTTOM_THRESHOLD_PX). Wider than top because the render pipeline (requestAnimationFrame + re-layout after new event) can momentarily push the user 10-15px off the bottom before the auto-scroll fires. 24px absorbs that without false-positiving 'user is scrolled up'."
  - "AgentChannelList uses TWO separate rendering paths for ACTIVE (virtualized, unbounded) vs ARCHIVED (plain list, max-h-64 + overflow-auto). Rationale: the virtualizer's getScrollElement needs a ref to the scroll container; running two virtualizers with different refs in the same component is fine but adds friction. The archive list is expected to be small (users archive agents; they don't have 1000 archived agents), so a plain list with a cap + native scroll is simpler and adequate."
  - "AgentChannelRow adapter chip distinguishes claude-code vs others at display time. The chatDuplex boolean on the channel would also work and is more semantically aligned, but the UI-SPEC explicitly maps 'CLAUDE_CODE → primary chip' regardless of whether a future duplex-capable adapter appears. Matched the literal contract."
  - "ChatInput hint copy uses `⏎ SEND · ⇧⏎ NEWLINE` (UI-SPEC Copywriting § Sticky input). Does NOT mention Ctrl/Cmd+Enter or Escape — those are ergonomic add-ons per UI-SPEC Keyboard § and deliberately kept off the hint line to avoid clutter."
  - "Test mock for @tanstack/react-virtual: returns all items with fixed size. We COULD also shim getBoundingClientRect + ResizeObserver globally in test-setup.ts, but that's a larger blast radius and might break existing tests that depend on zero-sized measurement. The local mock keeps the fix scoped to the two consumer tests."
  - "EventCard tests wrap every render in MemoryRouter because the ToolUseCard and ApprovalLinkCard branches call useNavigate — even when those branches aren't hit in a specific test, the dispatcher imports them at module load. Wrapping uniformly is simpler than conditional wrapping."

patterns-established:
  - "Per-listener-handler-plus-dedup: every Zustand store listener that observes an event with an id MUST dedupe by id; otherwise optimistic-append + emit races will double-render. Applied here to chatStore; future pattern for pipelineStore/claudeResourcesStore."
  - "Reverse-scroll TanStack Virtual: the correct shape is (a) store oldest→newest, (b) renderers render in array order, (c) on mount & new-event-while-at-bottom scroll to scrollHeight, (d) on near-top fetch older and prepend. No inversion of the virtual list, no CSS flexbox reverse."
  - "Test-scoped virtualizer mock: when a component under test uses TanStack Virtual and the test doesn't care about scroll positioning or measurement, mock @tanstack/react-virtual to return all items. Keeps test assertions on DOM content rather than virtualization internals."
  - "Motion/react stripping mock for component tests that use `<motion.div layout>` + `<AnimatePresence>`: strips initial/animate/exit/transition/layout props and returns children. Pattern is already used by Phase 4 CommsComponents tests; Phase 10 extends the set."
  - "`useNavigate` in cards — spy on the returned function via a top-level `navigateSpy` variable captured in `vi.mock('react-router-dom', ...)`. Don't try to mock MemoryRouter's internals."

requirements-completed: []

duration: 13 min
completed: 2026-04-21
---

# Phase 10 Plan 05: Chat UI Implementation Summary

**Fill Plan 01's Wave 0 scaffolds with full behavior: chatStore subscribes to all nine Phase 10 backend emissions; 13 event-card components render per UI-SPEC; ToolUseCard integrates Phase 8 ToolPreview on expand; TanStack Virtual powers both master list (64px rows) and the reverse-scroll transcript (new-messages pill + upward infinite-scroll).**

## Performance

- **Duration:** ~13 minutes
- **Started:** 2026-04-21T01:25:00Z
- **Completed:** 2026-04-21T01:38:00Z (approx.)
- **Tasks:** 3 (TDD RED → GREEN per task)
- **Files modified:** 12 components + 9 tests + 1 store + 1 hook test = 23

## Accomplishments

### Task 1 — chatStore + useChatChannel

- **Nine Tauri event listeners** wired via Promise.all fan-out (up from Plan 01's six):
  `agent-event-appended`, `agent-turn-started`, `agent-turn-complete`,
  `agent-session-started`, `agent-session-ended`, `agent-delivery-updated`,
  `agent-thread-cleared`, `agent-events-marked-read`, `agent-session-resumed`.
- **`agent-event-appended`** dedupes by id; unread increments only when
  `selectedAgentId !== agentId || document.visibilityState !== 'visible'`
  (D-22 + D-24).
- **`agent-turn-complete`** walks events backwards to flip the last streaming
  `assistant_text` (`payloadJson.streaming: true → false`) AND the last
  delivered `user_text` (`deliveryStatus: 'delivered' → 'consumed'`) (D-10).
- **`agent-session-ended`** sets `archived: true` on the matching channel.
- **`agent-session-resumed`** sets `archived: false` (D-04 reactivation).
- **`agent-thread-cleared`** clears `eventsByAgent[agentId]` and resets
  `unreadByAgent[agentId]`.
- **`agent-events-marked-read`** zeroes unread defensively (even though local
  `markRead` already did).
- **`sendMessage`** dedupes against listener-race: if the optimistic-append
  sees an existing id, skip.
- **`loadInitialEvents`** reverses backend newest-first to oldest-first so
  the TanStack Virtual transcript can render bottom-up.
- **`loadOlder`** prepends older events in oldest-first order.
- **21 chatStore tests green** (up from 8).

### Task 2 — Event card components + supporting atoms

- **EventCard** — unchanged (Plan 01 already matched D-13 dispatch table).
- **UserMessageCard** — self-end wrapper, inner `bg-surface-container` bubble,
  locale-formatted timestamp, `<DeliveryStatus>` when `deliveryStatus != null`
  (including new `consumed` variant).
- **AssistantTextCard** — self-start, `bg-surface-container-high`. Body color
  flips `on-surface-variant` → `on-surface` when `payloadJson.streaming===true`.
  `@user` tokens wrapped in `text-secondary font-bold` span via word-bounded
  regex `(^|\W)(@user)(?=\W|$)` (Pitfall 5 defense — rejects `@username`).
  StreamingCursor appended + `STREAMING…` label rendered with `aria-live="polite"`
  during streaming.
- **ToolUseCard** — Motion `layout` + `AnimatePresence`. Collapsed 36px row:
  `<ToolBadge>` + truncated one-line summary (file_path/command/pattern/url
  per tool type) + chevron-down. Expanded body renders Phase 8 `<ToolPreview>`
  inline inside a hairline-bordered container (D-16). When `approvalRequestId`
  is set, a `→ APPROVAL_{id}` pill (secondary colorway) navigates to
  `/comms?tab=requests&request={id}` via `useNavigate`.
- **ApprovalLinkCard** — button with `border-l-2 border-secondary` + `ExternalLink`
  icon + `APPROVAL_REQUIRED → {TOOL_NAME} · {truncated_path_40}`. Click navigates
  via `useNavigate`.
- **ToolResultCard** — unchanged (Plan 01 already renders indented result preview).
- **SessionBoundary** — three variants:
  - `started` → `SESSION_STARTED · {session_id[:8]}`
  - `ended` → `SESSION_ENDED · {reason}` (or `crashed (exit {code})` when exit_code ≠ 0)
  - `resumed` → `SESSION_RESUMED · via --resume`
  - fallback for unknown kinds → `SESSION_{kind.toUpperCase()}`
  Centered label between two `border-outline-variant/20` hairlines + right ISO timestamp.
- **RawStreamCard** — truncates at 4 KiB with `… (truncated, N more bytes)`
  footer (T-10-30 defense against DoS via huge stdout payloads).
- **SystemNoteCard** — unchanged (Plan 01 already renders centred + uppercase).
- **StreamingCursor** — unchanged (already uses `bg-primary` + `blink-cursor`).
- **ReadOnlyBadge** — unchanged (already matches tertiary colorway contract).
- **UnreadBadge + CommsTabBar** — unchanged (Plan 01 already satisfies contract).

### Task 3 — ChatInput + AgentChannelList + AgentChannelRow + ChatTranscript

- **ChatInput** — Enter/Shift+Enter/Ctrl+Enter/Escape keyboard matrix. Enter
  and Ctrl/Cmd+Enter call `chatStore.sendMessage`; Shift+Enter inserts newline;
  Escape clears non-empty text OR blurs on empty. Focused + non-empty state
  renders `⏎ SEND · ⇧⏎ NEWLINE` hint right of the textarea. Disabled state
  wires `aria-disabled` + `disabled` + tooltip via `title` attr.
- **AgentChannelList** — TanStack Virtual ACTIVE section (estimateSize=64,
  overscan=10) + collapsible ARCHIVED section (default `archivedCollapsed=true`).
  Most-recent-activity-descending sort via `lastEvent.createdAt`. AGENT_CHANNELS
  header + empty state `NO_AGENT_CHANNELS`.
- **AgentChannelRow** — two-line 64px row. Line 1: agent ID (`text-primary`
  when selected, else `text-on-surface`) + adapter chip (primary for `claude-code`,
  tertiary otherwise) + optional `READ-ONLY_TRANSCRIPT` badge. Line 2: prefixed
  event preview (`You: {truncated}`, `[TOOL_NAME]`, `⇢ APPROVAL_REQUIRED`, etc.)
  + relative timestamp (`Nm ago` within 1h, HH:MM within 24h, ISO beyond) +
  `<UnreadBadge>`. Selected: `border-l-2 border-primary + bg-surface-container-highest`.
  Archived: `opacity-50`. Keyboard: Enter/Space activates via `onClick`.
- **ChatTranscript** — TanStack Virtual reverse-scrolled transcript.
  - Mount: `scrollTo({ top: scrollHeight })` via a ref effect keyed on `agentId`.
  - New event while at-bottom (`distanceFromBottom <= 24px`): auto-follow to bottom.
  - New event while scrolled up: increment local `newMessageCount` and render
    floating `↓ N_NEW_MESSAGES` pill with `bg-primary/10 text-primary border-primary/20`.
  - Near-top scroll (`scrollTop <= 16px`) dispatches `loadOlder(agentId)`.
  - Click pill → smooth-scroll to bottom + reset counter.
  - `SESSION_ARCHIVED` empty state when channel.archived=true; otherwise `NO_MESSAGES`.

## Task Commits

1. **Task 1 RED** — `2ac12b5` (test) failing tests for nine-listener coverage + dedup
2. **Task 1 GREEN** — `2dfdc84` (feat) chatStore full implementation
3. **Task 2 RED** — `c1922dc` (test) failing tests for event card behavior
4. **Task 2 GREEN** — `9042fd9` (feat) event card components per UI-SPEC
5. **Task 3 RED** — `c16f885` (test) failing tests for ChatInput/ChatTranscript/AgentChannelList
6. **Task 3 GREEN** — `96d144c` (feat) ChatInput + AgentChannelList + AgentChannelRow + ChatTranscript

## Final Tauri Event Subscription List (chatStore)

```typescript
// All nine Phase 10 backend emissions wired.
'agent-event-appended'       // AgentEvent: append + dedup + unread++
'agent-turn-started'         // no-op (streaming flag lives on assistant_text payload)
'agent-turn-complete'        // flip last streaming asst→false + last delivered user→consumed
'agent-session-started'      // re-fetch channels (pull currentSessionId)
'agent-session-ended'        // channel.archived = true
'agent-delivery-updated'     // propagate eventId.status across all agents
'agent-thread-cleared'       // clear eventsByAgent[agentId] + unreadByAgent[agentId]=0
'agent-events-marked-read'   // unreadByAgent[agentId] = 0 (defensive)
'agent-session-resumed'      // channel.archived = false (D-04 reactivation)
```

## Test Counts per Component

| File | Tests |
|------|-------|
| chatStore.test.ts | 21 |
| useChatChannel.test.ts | 2 (Plan 01, unchanged) |
| EventCard.test.tsx | 9 |
| UserMessageCard.test.tsx | 8 |
| AssistantTextCard.test.tsx | 5 |
| ToolUseCard.test.tsx | 4 |
| ApprovalLinkCard.test.tsx | 3 |
| SessionBoundary.test.tsx | 3 |
| ChatInput.test.tsx | 8 |
| ChatTranscript.test.tsx | 7 |
| AgentChannelList.test.tsx | 7 |
| UnreadBadge.test.tsx | 3 (Plan 01, unchanged) |
| CommsTabBar.test.tsx | 4 (Plan 01, unchanged) |
| **Total** | **84** |

Final run: `pnpm vitest run src/stores/__tests__/chatStore.test.ts src/hooks/__tests__/useChatChannel.test.ts src/components/chat/__tests__ src/components/ui/__tests__/UnreadBadge.test.tsx src/components/ui/__tests__/CommsTabBar.test.tsx` → **84 passed (84)**.

## UI-SPEC Contract Compliance

| Item | Status |
|------|--------|
| Zero hex literals in new code (all token classes) | PASS — only `caretColor: '#00cffc'` inherited from Phase 4 ChatInput |
| Lucide icons `strokeWidth={1.5}` | PASS (ChevronDown/Up, ExternalLink, Send, CheckCheck via DeliveryStatus) |
| Space Grotesk (font-headline) for labels | PASS (STREAMING, AGENT_CHANNELS, ACTIVE, ARCHIVED, SESSION_*) |
| JetBrains Mono (font-mono) for body | PASS |
| self-end for user_text, self-start for assistant_text | PASS |
| bg-surface-container (user) / bg-surface-container-high (assistant) | PASS |
| border-l-2 border-secondary on approval_link | PASS |
| border-l-2 border-primary on selected master-list row | PASS |
| primary colorway for unread + streaming cursor + active tab | PASS (already Plan 01 + DeliveryStatus) |
| secondary colorway for @user + APPROVAL_{id} pill + caret | PASS |
| tertiary colorway for READ-ONLY + CODEX/OPENCODE/GENERIC chips | PASS |
| reverse-scroll transcript with TanStack Virtual | PASS |
| `↓ N_NEW_MESSAGES` pill | PASS |
| Two-line 64px master-list row | PASS |
| Collapsed 36px tool-use card → expand to ToolPreview | PASS |
| Event-type-prefixed preview in master list | PASS |
| Relative timestamp (Nm ago / HH:MM / ISO-16) | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] TanStack Virtual renders zero items in jsdom**
- **Found during:** Task 3 (first run of ChatTranscript + AgentChannelList tests)
- **Issue:** The real `useVirtualizer` relies on `ResizeObserver` and `getBoundingClientRect` which both return zero-sized rects in jsdom. Tests that assert on rendered rows saw zero items in the DOM.
- **Fix:** Added a scoped `vi.mock('@tanstack/react-virtual', ...)` at the top of each of the two affected test files. The mock returns all items linearly with fixed sizes. Production behavior unchanged; tests can now assert on row/event content.
- **Files modified:** `src/components/chat/__tests__/ChatTranscript.test.tsx`, `src/components/chat/__tests__/AgentChannelList.test.tsx`
- **Verification:** Both test files now pass; `ChatTranscript "renders each event through EventCard"` + `AgentChannelList "clicking a row calls selectAgent"` landed green.
- **Committed in:** `96d144c` (Task 3 GREEN alongside the implementation).

**2. [Rule 1 - Minor] UserMessageCard restructured testid div content**
- **Found during:** Task 2 (first UserMessageCard test run)
- **Issue:** The new layout wraps the surface-container bubble in a `self-end flex flex-col max-w-[80%]` outer div (needed so timestamp + delivery-status row sits BELOW the bubble rather than inside it, per UI-SPEC). The test asserted `card.className.toContain('bg-surface-container')` but `bg-surface-container` now lives on the inner bubble, not the testid wrapper.
- **Fix:** Adjusted the assertion to `card.innerHTML.toContain('bg-surface-container')` — the UI-SPEC contract is "surface-container fill for user_text bubble" and the fill is still present, just one level deeper.
- **Files modified:** `src/components/chat/__tests__/UserMessageCard.test.tsx`
- **Verification:** 8/8 UserMessageCard tests green.
- **Committed in:** `9042fd9` (Task 2).

**3. [Rule 3 - Blocker] EventCard tests missed MemoryRouter wrapper**
- **Found during:** Task 2 (after ToolUseCard + ApprovalLinkCard adopted `useNavigate`)
- **Issue:** `EventCard` imports all nine card components at module load. When a test rendered a `user_text` card, the `ToolUseCard`/`ApprovalLinkCard` imports still fired; those components call `useNavigate()` at the top level which throws outside a Router. Result: every EventCard test threw.
- **Fix:** Wrapped every EventCard test render in `<MemoryRouter>` via a `renderCard` helper. Also added the motion mock + ToolPreview mock at the top of the test file (same shape as ToolUseCard.test.tsx).
- **Files modified:** `src/components/chat/__tests__/EventCard.test.tsx`
- **Verification:** 9/9 EventCard tests green.
- **Committed in:** `9042fd9` (Task 2).

---

**Total deviations:** 3 auto-fixed (1 bug-ish test adjustment + 2 Rule 3 blockers). No scope creep, no downstream API break.

## Authentication Gates

None.

## Known Stubs

- **`agent-session-started` handler** triggers a channel re-fetch rather than
  locally inserting the session_boundary row. The aggregator inserts the
  boundary via `agent-event-appended`, so the transcript is still correct.
  A future optimization could skip the round-trip and splice `currentSessionId`
  directly, but that duplicates the backend-authoritative channel shape.
- **`agent-turn-started` handler** is a no-op. Plan 05 originally considered
  flipping a per-agent "streaming" UI flag on turn start and clearing on turn
  complete. The chosen shape (streaming flag lives on the assistant_text
  payload itself, set by the aggregator) is simpler and matches the backend
  emission pattern — the store doesn't need a parallel boolean.
- **ChatTranscript measureElement callback** is wired on each virtual item
  but TanStack Virtual's dynamic measurement is not essential here — all
  event cards estimate to 60px. For very tall tool_use cards (expanded
  ToolPreview) the measurement helps keep the scroll offset accurate. No
  functional bug if measurement is imperfect; the new-messages pill + auto-
  follow still work.
- **`ChatView` top-level component** is NOT delivered in this plan — that's
  Plan 06's responsibility (URL routing + Sidebar chat-unread dot + Phase 4
  frontend deletion).

## Issues Encountered

None unresolved. Three deviations diagnosed + fixed in-session by the test
suite (not by code review).

## Visual Gaps for Plan 06 UAT Checkpoint

Plan 06 will run the final in-browser verification. Worth scrutinizing:

1. **AgentChannelRow preview truncation at different viewport widths** —
   the row is 280px wide (master list rail); very long agent IDs may push
   the adapter chip off-screen. Currently `min-w-0` + `truncate` on the ID
   span should handle this, but visual confirmation at 1280px (minimum
   viewport) is recommended.
2. **ToolUseCard expanded state with Phase 8 ToolPreview renderers** —
   EditPreview/WritePreview render diffs that can be 200+px tall. The
   AnimatePresence expand animation on rapid expand→collapse→expand may
   stutter; motion's `layout` prop handles this but worth stress-testing.
3. **StreamingCursor blink rhythm in low-contrast environments** — the
   2px `bg-primary` bar at 20+ characters/second streaming rate may
   appear jittery on 60Hz displays. UI-SPEC explicitly says `step-end`
   1s; alternative would be an ease-in but that contradicts the spec.
4. **AgentChannelList ARCHIVED section scroll behavior** — when archived
   has 20+ agents the `max-h-64 overflow-auto` clamp may feel short. If
   users complain, bump to `max-h-96` or make it virtualized too. For v1
   the expected archive count is under 10.
5. **ChatTranscript scroll-to-bottom on rapid event bursts** — the current
   effect keys on `events.length`. If many events arrive in the same tick
   (e.g. 10 assistant deltas), only one scroll fires. Usually fine; verify
   during the Phase 6 integration checkpoint.

## User Setup Required

None.

## Threat Flags

None — all new UI surface is covered by T-10-27 (XSS via React escaping,
no `dangerouslySetInnerHTML`), T-10-28 (resource exhaustion via per-agent
selector pattern), T-10-29 (stale approval_link accepts abandoned), T-10-30
(raw stdout truncation), T-10-31 (motion performance — `layout` only on
tool-use card; `AnimatePresence` only for expand/collapse).

## Next Phase Readiness

- **Plan 06 (URL routing + Phase 4 chat deletion):** Unblocked.
  - `ChatView` top-level can import the fully-wired `AgentChannelList` +
    `ChatTranscript` + `ChatInput` and get a working chat surface.
  - `CommsTabBar` (Plan 01) just needs the URL binding (`?tab=requests` ↔
    `?tab=chat`) via `useSearchParams`.
  - `Sidebar.tsx` chat-unread dot reads `useChatStore.totalUnread()` which
    is live and correct.
  - The Phase 4 `ChatThread.tsx` / `ChatInput.tsx` / `MiniChatCard.tsx`
    deletions are pure filesystem operations — all consumers have been
    rewritten to the new components. Plan 04 already deleted the backend
    chat command surface; Plan 06 completes the frontend cleanup.

No blockers or concerns carried forward.

## Self-Check: PASSED

Verified items:

- **File existence (all modified/implemented):**
  - `src/stores/chatStore.ts` (392 lines) — FOUND
  - `src/stores/__tests__/chatStore.test.ts` (21 tests) — FOUND
  - `src/hooks/useChatChannel.ts` (29 lines) — FOUND
  - `src/components/chat/EventCard.tsx` (35 lines) — FOUND
  - `src/components/chat/UserMessageCard.tsx` (54 lines) — FOUND
  - `src/components/chat/AssistantTextCard.tsx` (84 lines) — FOUND
  - `src/components/chat/ToolUseCard.tsx` (139 lines) — FOUND
  - `src/components/chat/ApprovalLinkCard.tsx` (54 lines) — FOUND
  - `src/components/chat/ToolResultCard.tsx` — FOUND
  - `src/components/chat/SessionBoundary.tsx` (77 lines) — FOUND
  - `src/components/chat/RawStreamCard.tsx` (54 lines) — FOUND
  - `src/components/chat/SystemNoteCard.tsx` — FOUND
  - `src/components/chat/StreamingCursor.tsx` — FOUND
  - `src/components/chat/ReadOnlyBadge.tsx` — FOUND
  - `src/components/chat/ChatInput.tsx` (127 lines) — FOUND
  - `src/components/chat/AgentChannelList.tsx` (150 lines) — FOUND
  - `src/components/chat/AgentChannelRow.tsx` (131 lines) — FOUND
  - `src/components/chat/ChatTranscript.tsx` (185 lines) — FOUND
  - `src/components/ui/UnreadBadge.tsx` — FOUND
  - `src/components/ui/CommsTabBar.tsx` — FOUND
- **Commits in git log:**
  - `2ac12b5` (Task 1 RED) — FOUND
  - `2dfdc84` (Task 1 GREEN) — FOUND
  - `c1922dc` (Task 2 RED) — FOUND
  - `9042fd9` (Task 2 GREEN) — FOUND
  - `c16f885` (Task 3 RED) — FOUND
  - `96d144c` (Task 3 GREEN) — FOUND
- **Acceptance-criteria greps (Plan 05 spec):**
  - `grep -c 'listen<' src/stores/chatStore.ts` → 9 ✓
  - `grep -c 'document.visibilityState' src/stores/chatStore.ts` → 1 ✓
  - `grep -c "'consumed'" src/stores/chatStore.ts` → 4 ≥ 1 ✓
  - `grep -c 'send_chat_message_to_agent' src/stores/chatStore.ts` → 1 ✓
  - `grep -c 'list_agent_events' src/stores/chatStore.ts` → 2 ≥ 2 ✓
  - `grep -c 'list_chat_channels' src/stores/chatStore.ts` → 1 ✓
  - `grep -c 'self-end\|bg-surface-container' src/components/chat/UserMessageCard.tsx` → 3 ≥ 1 ✓
  - `grep -c 'self-start\|bg-surface-container-high' src/components/chat/AssistantTextCard.tsx` → 2 ≥ 1 ✓
  - `grep -c 'StreamingCursor' src/components/chat/AssistantTextCard.tsx` → 3 ≥ 1 ✓
  - `grep -c 'text-secondary font-bold' src/components/chat/AssistantTextCard.tsx` → 2 ≥ 1 ✓
  - `grep -c 'ToolBadge\|ToolPreview' src/components/chat/ToolUseCard.tsx` → 7 ≥ 2 ✓
  - `grep -c 'AnimatePresence\|motion' src/components/chat/ToolUseCard.tsx` → 7 ≥ 1 ✓
  - `grep -c 'border-l-2 border-secondary\|ExternalLink' src/components/chat/ApprovalLinkCard.tsx` → 3 ≥ 1 ✓
  - `grep -c 'SESSION_STARTED\|SESSION_ENDED\|SESSION_RESUMED' src/components/chat/SessionBoundary.tsx` → 8 ≥ 3 ✓
  - `grep -c 'blink-cursor' src/components/chat/StreamingCursor.tsx` → 2 ≥ 1 ✓
  - `grep -c 'READ-ONLY_TRANSCRIPT' src/components/chat/ReadOnlyBadge.tsx` → 2 ≥ 1 ✓
  - `grep -c "'99+'" src/components/ui/UnreadBadge.tsx` → 1 ✓
  - `grep -c 'role="tablist"\|role="tab"' src/components/ui/CommsTabBar.tsx` → 3 ≥ 2 ✓
  - `grep -c 'sendMessage = useChatStore' src/components/chat/ChatInput.tsx` → 1 ≥ 1 ✓
  - `grep -c 'disabled\|cursor-not-allowed' src/components/chat/ChatInput.tsx` → 16 ≥ 1 ✓
  - `grep -c 'useVirtualizer' src/components/chat/AgentChannelList.tsx` → 2 ≥ 1 ✓
  - `grep -c 'ACTIVE\|ARCHIVED' src/components/chat/AgentChannelList.tsx` → 7 ≥ 2 ✓
  - `grep -c 'useVirtualizer' src/components/chat/ChatTranscript.tsx` → 2 ≥ 1 ✓
  - `grep -c 'loadOlder' src/components/chat/ChatTranscript.tsx` → 4 ≥ 1 ✓
  - `grep -c '_NEW_MESSAGES\|new-messages' src/components/chat/ChatTranscript.tsx` → 3 ≥ 1 ✓
  - `grep -c 'EventCard' src/components/chat/ChatTranscript.tsx` → 2 ≥ 1 ✓
- **Final verification runs:**
  - `pnpm vitest run src/stores/__tests__/chatStore.test.ts src/hooks/__tests__/useChatChannel.test.ts src/components/chat/__tests__ src/components/ui/__tests__/UnreadBadge.test.tsx src/components/ui/__tests__/CommsTabBar.test.tsx` → 84 passed (84), 13 Test Files
  - `pnpm tsc --noEmit` → 0 errors in chat/* or chatStore/* (pre-existing errors in bindings.ts/Arsenal/Radar unchanged)

---

*Phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s*
*Completed: 2026-04-21*
