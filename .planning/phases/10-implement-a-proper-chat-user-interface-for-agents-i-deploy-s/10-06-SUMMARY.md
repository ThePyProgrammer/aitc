---
phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s
plan: 06
subsystem: frontend-integration
tags: [comms-view, chat-view, tab-routing, url-sync, d-21-deletions, sidebar-dot, uat-checkpoint]

requires:
  - phase: 10
    plan: 01
    provides: MasterDetailShell railWidth/detailWidth overrides, CommsTabBar stub, ChatView stub, chatStore skeleton
  - phase: 10
    plan: 04
    provides: AdapterCapabilities trait + chat_duplex routing; Phase 4 chat backend command surface DELETED
  - phase: 10
    plan: 05
    provides: chatStore nine-listener fan-out + 13 chat components + AgentChannelList + ChatTranscript + ChatInput

provides:
  - CommsView REQUESTS | CHAT tab switcher (URL-synced via useSearchParams, replace mode)
  - "?tab=" narrow to 'chat' | 'requests' literal union at parse time (T-10-33 mitigation)
  - "?agent=" deep-link validated against chatStore.channels before selectAgent (T-10-32)
  - "[" / "]" keyboard shortcut cycles REQUESTS ↔ CHAT when no input focused
  - Phase 4 request-queue keyboard shortcuts (ArrowUp/Down/Enter/a/d/Escape) gated to REQUESTS tab only
  - ChatView DetailPane header — agent ID (JB Mono bold) + StatusBadge (status→variant mapping) + optional READ-ONLY_TRANSCRIPT badge + SESSION·{id[:8]} pill + right-aligned CLEAR_THREAD button
  - ClearThreadButton 2-click destructive confirm (T-10-35): first click flips to CONFIRM_CLEAR in bg-error-container/text-on-error for 3s; second click in window fires chatStore.clearThread; auto-revert on timeout; clearTimeout on unmount
  - ChatInput disabled state + tooltip derivation (archived vs non-duplex adapters) per D-02 / D-04
  - useChatChannel mounted once at App root (D-24) — chat listeners fire regardless of active view
  - Initial fetchChannels on App mount so Sidebar unread dot + master list are populated before /comms navigation
  - Sidebar ChatUnreadDot — 6px bg-primary dot appears when chatStore.totalUnread() > 0 AND current location is not /comms?tab=chat (D-22)
  - Phase 4 embedded chat surface DELETED (D-21): ChatThread.tsx, ChatInput.tsx (old), MiniChatCard.tsx, RequestDetail embedded chat JSX, TelemetryPanel AGENT_CHANNELS section, commsStore ChatMessage type + messages/sendMessage/fetchMessages

affects:
  - Phase 10 end-to-end feature ready for human UAT (Task 3 checkpoint)
  - Future regression risk: any new commsStore consumer must use chatStore for chat; the deleted fields will surface immediately as TypeScript errors

tech-stack:
  added: []
  patterns:
    - "useSearchParams `replace: true` — tab + agent query updates REPLACE the history entry rather than pushing a new one (matches Arsenal's tab pattern; prevents back-button pollution from selection churn)"
    - "Narrow untrusted query param to a literal union BEFORE passing to any consumer: `const activeTab: CommsTab = tab === 'chat' ? 'chat' : 'requests'`. Default falls through to the safe value. Mirrored for `?agent=` with channel-existence guard."
    - "2-click destructive button ref-clearing timeout: cleanup effect `return () => clearTimeout(timerRef.current)` prevents late-firing state updates after unmount; click-branch clearTimeout before firing action prevents double-fire if user clicks faster than 3s window"
    - "App-root `useChatChannel` + initial `fetchChannels` shape: subscribers set before first navigation so the Sidebar dot is accurate on Radar view (not just /comms). Mirrors Phase 8 `mountDeepLink` pattern."
    - "Sidebar dot gate: read `useLocation()` + parse `search` to detect `?tab=chat`, then suppress the dot when user is already on CHAT. Per-component search parse rather than router-level state so the dot is reactive to tab cycling."
    - "channel.status → StatusBadge variant via switch table covering running/idle/waiting/conflict/error/terminated with `idle` fallback for forward-compatibility. Keeps StatusBadge contract unchanged — no new variant introduced for CHAT tab."

key-files:
  created:
    - .planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-06-CHECKPOINT.md  # UAT checklist for Task 3 human-verify
  modified:
    - src/views/CommsView.tsx               # tab switcher + URL sync + keyboard cycling + REQUESTS-tab-gated Phase 4 shortcuts
    - src/views/CommsHub/ChatView.tsx       # full DetailPane header + ClearThreadButton + deep-link ?agent= selection + URL sync
    - src/views/CommsHub/__tests__/ChatView.test.tsx  # 11 tests (was 2) covering tab routing, deep-link, duplex/readonly/archived states, CLEAR_THREAD 2-click behaviour
    - src/components/layout/Sidebar.tsx     # ChatUnreadDot component + COMMS slot wiring
    - src/App.tsx                           # useChatChannel() at App root + initial fetchChannels (D-24)
    - src/views/CommsHub/RequestDetail.tsx  # REMOVED ChatThread/ChatInput imports + JSX (D-21)
    - src/views/CommsHub/TelemetryPanel.tsx # REMOVED AGENT_CHANNELS section + MiniChatCard (D-21)
    - src/stores/commsStore.ts              # REMOVED ChatMessage / messages / sendMessage / fetchMessages (D-21)
    - src/stores/__tests__/commsStore.test.ts  # dropped sendMessage/fetchMessages tests; trimmed reset assertion
    - src/views/CommsHub/__tests__/CommsComponents.test.tsx  # dropped ChatThread/ChatInput/MiniChatCard describes; added DeliveryStatus consumed-variant assertion; trimmed TelemetryPanel to SystemLoad+TelemetryFeed + AGENT_CHANNELS-absence assertion
  deleted:
    - src/views/CommsHub/ChatThread.tsx     # Phase 4 embedded transcript (superseded by components/chat/ChatTranscript.tsx)
    - src/views/CommsHub/ChatInput.tsx      # Phase 4 approval-detail-footer input (superseded by components/chat/ChatInput.tsx)
    - src/views/CommsHub/MiniChatCard.tsx   # Phase 4 telemetry-panel per-agent chat card (replaced by first-class CHAT tab)

key-decisions:
  - "Task 2 commits got folded inside upstream commit 972642f (Phase 11-02 sibling-agent race) — the Task 2 deletions and edits landed atomically in that single commit rather than as a standalone Task 2 commit. The final git log reads as:
      * 7d1e3a0 chore(10-06) — AGENT_CHANNELS scrub (Task 2 polish)
      * b09a53b docs — README refresh (unrelated parallel work)
      * 972642f feat(11-02) — Phase 11 makeGraphSimCore + SIBLING AGENT FOLDED MY TASK 2 DELETIONS INTO THIS COMMIT
      * 7437507 feat(11-02) — BufferPool
      * 05764ac feat(10-06) — Task 1 CommsView + ChatView + Sidebar + App (clean)
      * 52b95db test(10-06) — Task 1 RED (clean)
    Net effect is correct (all Task 2 acceptance criteria green, tsc clean, vitest green) but the Task 2 git commit attribution got absorbed by a neighbor. No rewrite attempted — upstream commit is shared history."
  - "Tab cycling via [ / ] chosen to mirror the existing Phase 5 HistoryView tab shape and the terminal-emulator muscle memory, avoiding conflict with Cmd/Ctrl+[ which is usually browser-back. No modifier needed because tab scope is already inside CommsView, not global."
  - "setSearchParams with `replace: true` for both tab changes and agent selection. PushState would add a new history entry on every AgentChannelRow click — noisy for the browser back stack and makes the back button behave unexpectedly. Replace matches HistoryView's pattern."
  - "Deep-link useEffect runs on `channels` dependency (not just mount) because chatStore may populate channels asynchronously after fetchChannels resolves. If the notification-click routes the user to /comms?tab=chat&agent=X before the store populates, the URL is set but the agent is unknown; when channels arrive, the effect re-evaluates and selects. `selectedAgentId === agentFromQuery` short-circuit prevents a selection-flap loop."
  - "ClearThreadButton renders 'bg-error-container text-on-error' for CONFIRM state — these are Command Horizon semantic tokens already defined in Phase 0 tailwind config, not new tokens. Matches Phase 4 Deny button colorway verbatim."
  - "ChatUnreadDot omitted (returns null) when totalUnread=0 OR onChatTab. The combined condition means even if you're on a /comms other-tab (i.e. REQUESTS), the dot still shows if there's chat activity — correct per UI-SPEC §Sidebar COMMS nav dot: 'combined unread indicator per D-22'."
  - "CommsComponents.test.tsx rewritten from scratch rather than spot-edited. The old file had 193 lines of describe-block structure for the deleted components + intricate motion/react mocks wrapped around ChatThread/MiniChatCard. Keeping only DeliveryStatus + TelemetryPanel assertions (which do NOT need the motion mock since AGENT_CHANNELS was deleted) cut the file to 60 lines; the Write tool is faster and less error-prone here than a sequence of Edits."
  - "ClearThread button uses `void clearThread(agentId)` (fire-and-forget) rather than awaiting the Promise. Reason: the click handler returns void (button onClick signature); awaiting would require an async handler + React 19 transitions. The button is already disabled for the 3s CONFIRM window, and any clearThread error sets store.error. No race."
  - "StatusBadge 'terminated' variant reused (Phase 5 addition). No new variant added for CHAT — archived channels keep their last-known status from the registry (usually 'running' at termination instant). UI contract: archive state is signalled by opacity + ReadOnlyBadge elsewhere, not by the StatusBadge color."
  - "Task 3 UAT checkpoint: executor CANNOT automate visual verification against 10-UI-SPEC.md (color contrast, typography rendering, 60fps streaming cursor, OS notification, etc.). The checkpoint file records the full 25-step UAT checklist; developer runs `pnpm tauri dev` and signs off per item. Phase 10 is marked 'Ready for human UAT' in STATE/ROADMAP rather than 'Complete' until the checkpoint clears."

requirements-completed: []

duration: 14 min
completed: 2026-04-21
---

# Phase 10 Plan 06: Chat Integration + Phase 4 Deletions Summary

**Final Phase 10 integration — CHAT tab wired into CommsView with URL-synced state, full ChatView detail-pane header + CLEAR_THREAD 2-click confirm, App-root chat subscription so events capture regardless of view, Sidebar unread dot, and every Phase 4 embedded chat artifact DELETED per D-21. Task 3 is a human-verify UAT checkpoint — cannot be auto-completed; checkpoint file written for the developer to run through `pnpm tauri dev`.**

## Performance

- **Duration:** ~14 minutes
- **Started:** 2026-04-21T01:47:28Z
- **Completed:** 2026-04-21T02:01:34Z (automation portion — UAT pending)
- **Tasks automated:** 2 (Task 1 + Task 2); Task 3 checkpoint file written
- **Files modified:** 7 source + 3 tests + 3 deletions = 13

## Accomplishments

### Task 1 — CommsView tab routing + ChatView full pane + App-root chat subscribe + Sidebar dot

**CommsView.tsx** rewritten around a URL-synced tab switcher:
- `activeTab: 'requests' | 'chat'` narrowed from `searchParams.get('tab')` at parse time (T-10-33 mitigation)
- `CommsTabBar` renders above the body with real counts: `pendingRequests` from commsStore, `unreadChat` from chatStore
- Body conditionally renders `<ChatView />` or the existing 3-panel REQUESTS layout (unchanged on REQUESTS tab)
- `[` / `]` cycle tabs via a top-level keydown listener that ignores events originating in inputs/textareas/contenteditable
- Phase 4 keyboard shortcuts (ArrowUp/Down/Enter/a/d/Escape) now guarded with `if (activeTab !== 'requests') return` so they don't fire on the CHAT tab
- Empty state (NO_PENDING_REQUESTS) preserved but now shown INSIDE the body slot so the tab bar stays visible

**ChatView.tsx** fleshed out from Plan 01's 22-line stub to a full detail-pane implementation:
- Deep-link effect: reads `?agent=` on mount / channel-arrival, validates against `chatStore.channels` (T-10-32), calls `selectAgent` only for known IDs
- URL-sync effect: when `selectedAgentId` changes, updates `?tab=chat&agent={id}` via `setSearchParams({ replace: true })`
- `DetailPane` sub-component:
  - Empty state: blinking secondary-colored cursor + `SELECT_AGENT_CHANNEL` label
  - Populated: agent ID (mono bold) + `<StatusBadge>` mapped via `statusToVariant` + optional `<ReadOnlyBadge />` (when `!chatDuplex`) + `SESSION · {id[:8]}` pill + right-aligned `<ClearThreadButton />`
  - Transcript slot: `<ChatTranscript agentId={agentId} />`
  - Footer input: `<ChatInput />` with derived `disabled` / `disabledTooltip` / `placeholder` (archived → relaunch tooltip; read-only → "does not expose an inbound message channel" tooltip)
- `ClearThreadButton` inline component:
  - First click: `setConfirming(true)` + 3000ms timeout that reverts to default
  - Second click within window: `clearTimeout` + `void clearThread(agentId)`
  - Unmount cleanup clears the timer ref
  - Classes flip between `text-on-surface-variant hover:text-on-surface` and `bg-error-container text-on-error`

**Sidebar.tsx** extended:
- New `ChatUnreadDot` component reads `useChatStore.totalUnread()` + `useLocation()` and returns a 6px `bg-primary` square when unread > 0 AND user is not on `/comms?tab=chat`
- Inserted next to `<PendingCountBadge />` inside the COMMS nav item render path (wrapped in fragment)

**App.tsx** extended:
- New effect calls `useChatChannel().subscribe()` and `useChatStore.getState().fetchChannels()` at mount
- Ensures D-24 holds: the Sidebar unread dot is accurate even when the user is on Radar/Tower/etc. and has never opened /comms

**Tests (ChatView.test.tsx):** 11 tests (was 2 after Plan 01). Covers:
1. MasterDetailShell hierarchy + 280px rail + no detail aside
2. Empty state (SELECT_AGENT_CHANNEL)
3. Full detail-pane header rendering with SESSION pill + CLEAR_THREAD
4. Duplex agent — enabled input, no READ-ONLY badge
5. Read-only adapter (!chatDuplex) — READ-ONLY_TRANSCRIPT badge + disabled input
6. Archived channel — disabled input + relaunch tooltip
7. CLEAR_THREAD first click → CONFIRM_CLEAR
8. CLEAR_THREAD auto-revert after 3s (fake timers)
9. CLEAR_THREAD second click → chatStore.clearThread(agentId)
10. Deep-link `?agent=KAGENT-1` → selectAgent('KAGENT-1')
11. Deep-link `?agent=UNKNOWN` → selectAgent NOT called (T-10-32)

All pass. `@tanstack/react-virtual` mocked at file scope (all-items linear renderer) + `motion/react` mocked (props stripped).

### Task 2 — Phase 4 chat deletions (D-21)

**Deletions:**
- `src/views/CommsHub/ChatThread.tsx` (73 lines)
- `src/views/CommsHub/ChatInput.tsx` (71 lines — old Phase 4 version; new version at `src/components/chat/ChatInput.tsx` unchanged)
- `src/views/CommsHub/MiniChatCard.tsx` (101 lines)

**RequestDetail.tsx scrub:**
- Removed `import { ChatThread } from './ChatThread';`
- Removed `import { ChatInput } from './ChatInput';`
- Removed the two trailing JSX blocks (chat thread + chat input) from the approval detail body

**TelemetryPanel.tsx scrub:**
- Removed `import { useAgentStore } from '../../stores/agentStore';`
- Removed `import { MiniChatCard } from './MiniChatCard';`
- Removed the `AGENT_CHANNELS` section header + empty state + `.map(MiniChatCard)` block
- Comment scrubbed of literal `AGENT_CHANNELS` token so the grep acceptance criteria returns 0

**commsStore.ts cleanup:**
- Removed `export interface ChatMessage`
- Removed `messages: Record<string, ChatMessage[]>` field
- Removed `sendMessage` + `fetchMessages` action signatures + implementations
- Removed `messages: {}` from initial state + `reset()` clause
- Removed the COMM-03 comment from the store header; added D-21 note pointing consumers at chatStore

**commsStore.test.ts cleanup:**
- Removed `ChatMessage` type import
- Removed `mockMessage` fixture
- Removed `sendMessage calls invoke send_chat_message` test
- Removed `fetchMessages calls invoke list_chat_messages` test
- Removed `messages: { 'agent-001': [mockMessage] }` setup + `expect(state.messages).toEqual({})` assertion from reset test

**CommsComponents.test.tsx rewritten (60 lines, was 193):**
- Removed `ChatThread`, `MiniChatCard`, `ChatMessage`, `AgentInfo`, `useCommsStore`, `useAgentStore` imports
- Deleted `describe('ChatThread', ...)` block (3 tests)
- Deleted `describe('MiniChatCard', ...)` block (3 tests)
- Retained `describe('DeliveryStatus', ...)` + added `consumed` variant assertion (D-10 lifecycle; Plan 01 addition)
- Trimmed `describe('TelemetryPanel', ...)` to assert SystemLoad + TelemetryFeed presence + AGENT_CHANNELS absence
- Retained the `motion/react` mock (TelemetryFeed may use motion transitions via other components; defensive)

**Final acceptance greps:**
- `test ! -f src/views/CommsHub/ChatThread.tsx` → PASS
- `test ! -f src/views/CommsHub/ChatInput.tsx` → PASS
- `test ! -f src/views/CommsHub/MiniChatCard.tsx` → PASS
- `grep -c 'ChatThread\|MiniChatCard' src/views/CommsHub/RequestDetail.tsx` → 0 ✓
- `grep -c 'from.*CommsHub/ChatInput' src/views/CommsHub/RequestDetail.tsx` → 0 ✓
- `grep -c 'AGENT_CHANNELS\|MiniChatCard' src/views/CommsHub/TelemetryPanel.tsx` → 0 ✓
- `grep -c 'messages: Record\|sendMessage:\|fetchMessages:\|interface ChatMessage' src/stores/commsStore.ts` → 0 ✓
- `grep -rn 'from.*CommsHub/ChatThread\|from.*CommsHub/MiniChatCard' src/` → 0 matches ✓
- `pnpm tsc --noEmit` clean for all Plan 06 surface (pre-existing errors in bindings.ts/Arsenal/Radar unchanged — out of scope per Memory rule 'Only fix own bugs')
- `pnpm vitest run` — 123 passing in CommsHub/stores/ChatView suites; full-suite shows 4 pre-existing failures (agentStore launchAgent options signature drift + MasterDetailShell old class-name assertions + HeatMapOverlay Plan 06 color mismatch), confirmed pre-existing by re-running against the pre-Plan 06 baseline.

### Task 3 — UAT checkpoint (human-verify, blocking)

**Not automated.** A fresh 25-step UAT checklist was written to
`.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-06-CHECKPOINT.md`
covering every dimension of 10-UI-SPEC.md (Setup, Navigation, Master list, Detail pane, Streaming, Read-only adapter, Unread + notifications, Destructive action, Archive / terminate, Phase 4 removal verification, Visual contract, Failure modes). Developer runs `pnpm tauri dev`, walks the list, and signs off with `approved` — or reports deviations for a follow-up fix.

## Task Commits

1. **Task 1 RED** — `52b95db` (test) failing ChatView tests for tab routing + deep-link + CLEAR_THREAD
2. **Task 1 GREEN** — `05764ac` (feat) CommsView tab routing + ChatView full pane + App-root useChatChannel + Sidebar unread dot
3. **Task 2** — `972642f` (feat — upstream co-committed with Phase 11-02 sibling-agent work; see Decisions note)
4. **Task 2 polish** — `7d1e3a0` (chore) scrub AGENT_CHANNELS token from TelemetryPanel comment

## URL Schema (final)

```
/comms                             → default REQUESTS tab
/comms?tab=requests                → explicit REQUESTS tab
/comms?tab=chat                    → CHAT tab, no agent selected
/comms?tab=chat&agent={agent_id}   → CHAT tab, specific agent selected (used by OS notification deep-links per D-23)
/comms?tab=requests&request={id}   → REQUESTS tab with specific approval selected (from Phase 4; unchanged)
/comms?tab=requests&request={id}  ← approval_link card → navigateTo target (Phase 10 Plan 05 ApprovalLinkCard)
```

Unknown `?tab=` values fall back to `requests`. Unknown `?agent=` values are ignored (T-10-32) — no auto-clean of the URL (polish candidate; not required by Plan 06).

## Sample End-to-End Event Trace — user sends "what time is it" → Claude streams "It's 14:30." reply

```json
// 1. User types in ChatInput, hits Enter.
//    ChatInput.handleSend → chatStore.sendMessage('KAGENT-1', 'what time is it').
//    Frontend invokes the backend command:
{ invoke: 'send_chat_message_to_agent', args: { agentId: 'KAGENT-1', content: 'what time is it' } }

// 2. Backend writes a row to agent_events (user_text, delivered) and emits:
{ event: 'agent-event-appended', payload: {
    id: 142, agentId: 'KAGENT-1', sessionId: 'abcdef12-...', eventType: 'user_text',
    payloadJson: { content: 'what time is it' }, approvalRequestId: null,
    sequenceNumber: null, createdAt: '2026-04-21T14:30:00Z', deliveryStatus: 'delivered'
}}
//    chatStore optimistic-append + agent-event-appended listener dedupes by id.

// 3. Backend's aggregator sees the stdin-writer flush the JSONL, emits:
{ event: 'agent-turn-started', payload: { agentId: 'KAGENT-1', sessionId: 'abcdef12-...' } }
//    chatStore listener no-ops (streaming flag lives on assistant_text payload, not store).

// 4. Claude starts streaming. The parser turns `AssistantDelta` frames into a single
//    assistant_text row with streaming: true; the aggregator emits:
{ event: 'agent-event-appended', payload: {
    id: 143, agentId: 'KAGENT-1', sessionId: 'abcdef12-...', eventType: 'assistant_text',
    payloadJson: { content: "It's 14:30.", streaming: true, model: 'claude-sonnet-4-5' },
    approvalRequestId: null, sequenceNumber: 1, createdAt: '2026-04-21T14:30:02Z',
    deliveryStatus: null
}}
//    AssistantTextCard renders with StreamingCursor + STREAMING... label; body color = on-surface.

// 5. Claude completes its turn. Aggregator flushes the terminal `{type:"result"}` envelope:
{ event: 'agent-turn-complete', payload: {
    agentId: 'KAGENT-1', sessionId: 'abcdef12-...',
    terminalReason: 'end_turn', isError: false
}}
//    chatStore walks events backwards → flips #143 streaming→false AND #142 deliveryStatus→'consumed'.

// 6. Delivery watcher sees the outbound row was picked up by Claude, emits:
{ event: 'agent-delivery-updated', payload: { eventId: 142, status: 'consumed' } }
//    Redundant with step 5's flip (both apply — idempotent by design).

// End state:
//   events[KAGENT-1] = [
//     { id: 142, user_text, content: 'what time is it', deliveryStatus: 'consumed' },   // CheckCheck green
//     { id: 143, assistant_text, content: "It's 14:30.", streaming: false }            // cursor gone
//   ]
//   channels[KAGENT-1].lastEvent = #143
//   unreadByAgent[KAGENT-1] = 0 (agent was selected + focused during receive)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] CommsTabBar prop mismatch between plan action snippet and actual component API**
- **Found during:** Task 1 GREEN (CommsView.tsx)
- **Issue:** The plan's action snippet passes `chatUnread={...}` but the actual Plan 05 `CommsTabBar` component accepts `unreadChat` + requires an `onTabChange` callback.
- **Fix:** Used the real component API — `unreadChat={chatUnread} pendingRequests={pendingRequests} onTabChange={setTab}`. Created a local `setTab` useCallback that wraps `setSearchParams` with `replace: true`.
- **Files modified:** `src/views/CommsView.tsx`
- **Committed in:** `05764ac` (Task 1 GREEN).

**2. [Rule 3 - Blocker] ChatView test `screen.getByText` ambiguous — agent ID + READ-ONLY_TRANSCRIPT appear in BOTH master-list row and detail header**
- **Found during:** Task 1 GREEN (first test run)
- **Issue:** After the real AgentChannelList renders with the mocked virtualizer, the selected channel's agentId appears in both the master-list row and the detail-pane header. `getByText` throws "Found multiple elements". Same for the READ-ONLY_TRANSCRIPT badge (AgentChannelRow + ReadOnlyBadge in detail-pane).
- **Fix:** Changed assertions to `getAllByText(...).length >= 1` for strings that intentionally appear in multiple UI regions. Kept `getByText` for truly unique elements (SESSION pill, CLEAR_THREAD, CONFIRM_CLEAR).
- **Files modified:** `src/views/CommsHub/__tests__/ChatView.test.tsx`
- **Committed in:** `05764ac` (Task 1 GREEN).

**3. [Sibling-agent race] Task 2 deletions folded into Phase 11 commit 972642f**
- **Found during:** Task 2 commit attempt
- **Issue:** While running `pnpm vitest run` for Task 2 verification, a parallel Phase 11-02 executor committed its own graphSimCore work AND inadvertently staged + committed my Task 2 deletions + edits under its own commit message. My subsequent `git commit` call found an empty staging area.
- **Fix:** Verified all Task 2 deletions + source modifications landed correctly in the working tree + git log (via grep/`test -f` checks). Committed a small scrub (`7d1e3a0`) for the one remaining `AGENT_CHANNELS` reference in a TelemetryPanel comment. Did NOT attempt a history rewrite — `972642f` is already shared upstream history and the content is correct, only the commit message attribution is off.
- **Net effect:** All acceptance criteria pass. Task 2 is complete on disk and in the log; the commit just sits under a different message.
- **Committed in:** `972642f` (content) + `7d1e3a0` (polish).

**4. [Rule 3 - Cleanup] `graphSimCore.ts` appears modified in `git status` after each full-suite run**
- **Found during:** Task 2 verification
- **Issue:** Running `pnpm vitest run` writes to `src/workers/graphSimCore.ts` (some in-progress Phase 11 test fixture or watch-mode artifact).
- **Fix:** Kept the file OUT of every Plan 06 commit (`git add` explicitly excluded it). When Phase 11 lands its own feature commit, graphSimCore will converge on disk.
- **No file modifications by Plan 06.**

## Authentication Gates

None.

## Known Stubs

None introduced by Plan 06. Prior-plan stubs (from 10-05-SUMMARY Known Stubs) unchanged: `agent-session-started` re-fetches channels, `agent-turn-started` is a no-op, `ChatTranscript measureElement` is best-effort. All are deliberate and not blocking for this phase.

## Issues Encountered

- **Sibling-agent race on commit:** Phase 11-02 executor ran concurrently and absorbed my Task 2 staged files into its own commit. Resolved by accepting the upstream commit as-is (content correct, message misleading) rather than rewriting shared history. Documented in decisions + deviations.

## Remaining TODO / todo! markers

Scanned `grep -rn 'todo!\|TODO\|FIXME' src/ src-tauri/src/` — all pre-existing and NOT introduced by Plan 06:
- Phase 11 Wave 1+ stubs (graphSimCore, graphSim.worker) — to be fleshed out in Phase 11 Plans 02-04
- Phase 8/9 prior-plan TODO breadcrumbs — out of scope

No Plan 06 code ships with TODOs.

## Threat Flags

None new. All Plan 06 surface is covered by the plan's `<threat_model>`:
- T-10-32 (agent-id injection via `?agent=`) mitigated by channel-existence check
- T-10-33 (tab-query injection) mitigated by literal-union narrowing
- T-10-34 (dangling Phase 4 imports) mitigated by `pnpm tsc --noEmit` clean
- T-10-35 (CLEAR_THREAD destructive action) mitigated by 2-click confirm + auto-revert

## User Setup Required

None for Task 1/2. Task 3 (UAT) requires developer to:
1. `pnpm tauri dev` in the repo root
2. Walk the 25-step UAT checklist in `10-06-CHECKPOINT.md`
3. Report `approved` to mark Phase 10 complete, or describe deviations for a follow-up revision task

## Next Phase Readiness

- Phase 10 **automation portion COMPLETE**. Frontend + backend are fully wired end-to-end per D-01 → D-24.
- Phase 10 **human UAT PENDING**. Task 3 checkpoint file written.
- No blockers for Phase 11+ — the chat surface is orthogonal to the Radar/Graph work (Plan 06 touched zero Radar/graph code).

## Self-Check: PASSED

Verified items:

- **File existence:**
  - `src/views/CommsView.tsx` — FOUND (tab switcher + URL sync)
  - `src/views/CommsHub/ChatView.tsx` — FOUND (full DetailPane + ClearThreadButton)
  - `src/views/CommsHub/__tests__/ChatView.test.tsx` — FOUND (11 tests, all passing)
  - `src/components/layout/Sidebar.tsx` — FOUND (ChatUnreadDot wired)
  - `src/App.tsx` — FOUND (useChatChannel mounted)
  - `src/views/CommsHub/RequestDetail.tsx` — FOUND (chat scrub applied)
  - `src/views/CommsHub/TelemetryPanel.tsx` — FOUND (AGENT_CHANNELS scrub applied)
  - `src/stores/commsStore.ts` — FOUND (ChatMessage + messages/sendMessage/fetchMessages removed)
  - `src/stores/__tests__/commsStore.test.ts` — FOUND (deleted-field tests removed)
  - `src/views/CommsHub/__tests__/CommsComponents.test.tsx` — FOUND (rewrite to 60 lines)
  - `.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-06-CHECKPOINT.md` — FOUND (UAT checklist)
- **File deletions (acceptance):**
  - `test ! -f src/views/CommsHub/ChatThread.tsx` → PASS
  - `test ! -f src/views/CommsHub/ChatInput.tsx` → PASS
  - `test ! -f src/views/CommsHub/MiniChatCard.tsx` → PASS
- **Commits in git log:**
  - `52b95db` (Task 1 RED) — FOUND
  - `05764ac` (Task 1 GREEN) — FOUND
  - `972642f` (Task 2 content, absorbed by sibling commit) — FOUND
  - `7d1e3a0` (Task 2 polish) — FOUND
- **Acceptance-criteria greps (Plan 06 spec):**
  - `grep -n '<ChatView' src/views/CommsView.tsx` → 2 matches (import + JSX) ✓
  - `grep -n 'CommsTabBar' src/views/CommsView.tsx` → 2 matches ✓
  - `grep -n 'railWidth=\\{280\\}\\|detailWidth="flex"' src/views/CommsHub/ChatView.tsx` → 2 matches ✓
  - `grep -n 'CLEAR_THREAD\\|CONFIRM_CLEAR' src/views/CommsHub/ChatView.tsx` → 3 matches ✓
  - `grep -n 'useChatChannel' src/App.tsx` → 2 matches ✓
  - `grep -n 'ChatUnreadDot\\|chatStore.*totalUnread\\|useChatStore.*totalUnread' src/components/layout/Sidebar.tsx` → 3 matches ✓
  - `grep -c 'ChatThread\\|MiniChatCard' src/views/CommsHub/RequestDetail.tsx` → 0 ✓
  - `grep -c 'from.*CommsHub/ChatInput' src/views/CommsHub/RequestDetail.tsx` → 0 ✓
  - `grep -c 'AGENT_CHANNELS\\|MiniChatCard' src/views/CommsHub/TelemetryPanel.tsx` → 0 ✓
  - `grep -c 'messages: Record\\|sendMessage:\\|fetchMessages:\\|interface ChatMessage' src/stores/commsStore.ts` → 0 ✓
  - `grep -rn 'from.*CommsHub/ChatThread\\|from.*CommsHub/MiniChatCard' src/` → 0 matches ✓
- **Final verification runs:**
  - `pnpm vitest run src/views/CommsHub/__tests__/ChatView.test.tsx` → 11/11 passing
  - `pnpm vitest run src/views/CommsHub/__tests__/ src/stores/__tests__/commsStore.test.ts src/stores/__tests__/chatStore.test.ts` → 123/123 passing
  - `pnpm vitest run` (full suite) → 4 failures (all pre-existing; confirmed against baseline), 502 passing
  - `pnpm tsc --noEmit` → 0 new errors (6 pre-existing errors in bindings/Arsenal/Radar unchanged — out-of-scope per Memory rule)

---

*Phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s*
*Plan 06 automation completed: 2026-04-21*
*UAT pending — see `10-06-CHECKPOINT.md`*
