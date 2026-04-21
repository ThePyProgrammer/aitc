---
phase: 10
plan: 06
task: 3
type: checkpoint:human-verify
gate: blocking
state: approved
created: 2026-04-21
signed_off_at: 2026-04-21
signed_off_by: prannaya@subs.pragnition.ai
---

# Phase 10 Plan 06 Task 3 — UAT Checkpoint

**Status:** AWAITING DEVELOPER SIGN-OFF

This checkpoint cannot be automated. The executor has completed Tasks 1 + 2 (automated) and is pausing here for human verification of the chat surface against `10-UI-SPEC.md`.

---

## What Was Built

Phase 10 delivers a first-class CHAT tab inside Communications Hub with:

- `REQUESTS | CHAT` tab bar (URL-synced via `?tab=chat` / `?tab=requests`).
- CHAT tab: `MasterDetailShell` with 280px agent-channel list rail + flexing detail pane containing scrolling transcript + sticky input.
- Full narration surface: `user_text` / `assistant_text` / `tool_use` / `approval_link` / `tool_result` / `session_boundary` / `raw_stdout` / `raw_stderr` / `system_note` event cards.
- Streaming assistant turns with 2px `bg-primary` blinking cursor.
- Tool-use collapsed-by-default (36px row) with Motion-animated expand to inline Phase 8 `ToolPreview`.
- Deep-link approval rows — approval_link cards navigate to `/comms?tab=requests&request={id}`.
- Unread badges at three levels (CHAT tab label, per-agent row, Sidebar COMMS dot).
- OS notifications on `@user` mentions (via Phase 8 notification-clicked / tray-icon-clicked plumbing).
- Long-lived Claude Code `stream-json` subprocess + per-agent MCP server + auto-resume.
- All Phase 4 embedded chat artifacts DELETED (ChatThread.tsx, old ChatInput.tsx, MiniChatCard.tsx, commsStore chat fields).

---

## How to Verify

Run `pnpm tauri dev` from the repo root and walk the 25-step checklist below.

### Setup

1. [ ] Launch AITC; open Tower Control.
2. [ ] Deploy a Claude Code agent with intent "write a short poem then wait for me".
3. [ ] Within 30 seconds, navigate to COMMS → CHAT tab; observe: `SESSION_STARTED · <uuid8>` boundary → streaming assistant text with blinking primary cursor → completed turn (cursor disappears).

### Navigation

4. [ ] Click the sidebar COMMS nav item. Small primary dot visible if chat events accumulated before navigation (empty is also acceptable).
5. [ ] CommsView shows a top tab bar with `REQUESTS` and `CHAT` buttons. Click CHAT.
6. [ ] URL becomes `/comms?tab=chat`. Refresh — CHAT tab still selected.
7. [ ] Press `[` or `]` (with no input focused) — tab cycles between REQUESTS and CHAT.

### Master list (280px rail)

8. [ ] `AGENT_CHANNELS` header + Claude agent row visible.
9. [ ] Row layout — agent ID in JB Mono bold + `CLAUDE_CODE` chip in primary colorway + unread badge + last-event preview + relative timestamp.
10. [ ] Click the row — selected row gets `border-l-2 border-primary` and agent ID turns primary.

### Detail pane header

11. [ ] Header shows agent ID + `RUNNING` status badge + `SESSION · <uuid8>` pill + `CLEAR_THREAD` button right-aligned.

### Transcript

12. [ ] Transcript body shows the conversation. Event types render per UI-SPEC:
    - [ ] User messages → right-aligned bubble on `bg-surface-container`
    - [ ] Assistant messages → left-aligned bubble on `bg-surface-container-high`
    - [ ] Tool use → collapsed 36px row with `[EDIT] src/path` summary + chevron
    - [ ] Click tool use — expands into the Phase 8 `ToolPreview` body
13. [ ] Session_boundary rows render as full-width `outline-variant/20` hairline with centered label.

### Streaming

14. [ ] Send a new message via ChatInput ("what's your favourite colour"). Message appears with `QUEUED` → flips `DELIVERED` → `CONSUMED` when Claude's turn completes. Assistant response streams token-by-token with blinking cursor; cursor disappears on turn complete.

### Read-only adapter (optional — skip if no codex CLI available)

15. [ ] Deploy a Codex agent with intent "pwd". In CHAT master list it shows with `CODEX` tertiary chip + `READ-ONLY_TRANSCRIPT` badge.
16. [ ] Click the row. Detail header shows `READ-ONLY_TRANSCRIPT` badge. ChatInput disabled with tooltip "... does not expose an inbound message channel ...". Transcript shows `raw_stdout` lines in terminal-tail aesthetic.

### Unread + notifications

17. [ ] Navigate to a different view (TOWER). Trigger activity on the Claude agent (send another message). Return to COMMS → CHAT. Agent row's unread badge incremented while away.
18. [ ] Select the agent. Unread resets to 0.
19. [ ] Trigger an @user mention: send a message like "please ping me with @user when done". OS notification fires; clicking brings AITC forward and lands on that agent's CHAT thread.

### Destructive action (CLEAR_THREAD)

20. [ ] Click `CLEAR_THREAD`. Button flips to `CONFIRM_CLEAR` in error red. Wait 3+ seconds without clicking — reverts. Click again twice quickly — transcript clears, `agent-thread-cleared` event fires.

### Archive / terminate

21. [ ] Terminate the Claude agent from Tower Control. CHAT tab row moves to `ARCHIVED` section (collapsible). Detail pane shows archived state. Input disabled with "relaunch agent to reactivate" tooltip. Transcript stays visible (read-only mode).

### Phase 4 removal verification

22. [ ] On REQUESTS tab, open a pending approval. Detail pane shows approve/deny/edit actions only — NO embedded ChatThread or ChatInput at the bottom.
23. [ ] Right TelemetryPanel shows SystemLoad + TelemetryFeed only — NO AGENT_CHANNELS block.

### Visual contract (spot-check 10-UI-SPEC)

24. [ ] Visual dimensions pass:
    - [ ] 60/30/10 split visible (surface tiers dominate; text in on-surface-variant; accents only on tab underline, selected row, unread badge, streaming cursor, delivery-status icons, @user mentions)
    - [ ] No rounded corners anywhere
    - [ ] No borders where tonal shift is used
    - [ ] Space Grotesk UPPERCASE + tracking-widest on every label
    - [ ] JetBrains Mono everywhere for body text, agent IDs, file paths

### Failure modes

25. [ ] If any step above fails, describe which UI-SPEC dimension it violates (Copywriting / Visuals / Color / Typography / Spacing / Registry-Safety). Then resume planning/revision as appropriate.

---

## Resume Signal

- Type `approved` when all items pass → Phase 10 is marked COMPLETE.
- Describe deviations + which items failed → spawn a follow-up revision plan to patch the gaps.

---

## Checkpoint Sign-off

- [x] UAT walkthrough completed
- [x] Date completed: 2026-04-21
- [x] Signed off by: prannaya@subs.pragnition.ai
- [x] Result: `approved` (with follow-up polish scoped to Phase 19)

**Notes:**

Data is streaming end-to-end. Agent deploys, shows up in both Tower and
CHAT, session_boundary fires, assistant turns stream token-by-token,
tool invocations land as tool_use rows, user→agent messages deliver via
stdin JSONL. Phase 10 core contract met.

### Follow-ups captured in Phase 19 (chat transcript polish)

Four UAT-surfaced UI gaps that don't block Phase 10 completion but
want addressing before Phase 10 can be called "finished-finished":

1. **Repeated assistant_text chunks** — aggregator emits one row per
   content_block_delta flush; contiguous chunks within a turn should
   merge into a single transcript row.
2. **Tool-use card richness** — TOOL · EDIT path shows a raw truncation;
   need MultiEdit hunk counts, Write diff preview, Bash exit-code/output,
   codey-details-summary aesthetic.
3. **Markdown rendering** — `whitespace-pre-wrap` shows literal \`\`\`
   fences, `*` emphasis, `-` lists. Integrate react-markdown + remark-gfm
   + existing shiki code highlighting.
4. **SessionStart hook noise** — 4× [HOOK_STARTED] + 4× [HOOK_RESPONSE]
   per boot. Filter in parser or collapse into a single system_note row.

### In-session bug fixes during UAT (landed against Phase 10)

- `62612b3` raised `MAX_AGENTS` 100 → 1000 so launches aren't blocked
  by passive-scan flooding. Real fix for the passive flooding is Phase 18.
- `8084bcf` chatStore.fetchChannels() after launch_agent so the CHAT tab
  master list surfaces new agents without waiting for stream-json init.
- `fc3f944` initial intent delivered via stdin JSONL instead of positional
  argv — Claude was hanging post-SessionStart waiting for an input frame.
- `33940b3` codey-playground flat-row transcript refactor (user ask).
- `bb24daf` MasterDetailShell fills parent height instead of hardcoding
  viewport-56px so the REQUESTS|CHAT tab bar doesn't scroll off.
- `9c2f4e8` CommsView overflow-hidden + textarea blink removal +
  CLAUDE label continuation suppression.
- `dcd5554` tool_use/tool_result payload keys corrected from camelCase
  to snake_case so cards actually render tool name + summary instead of
  "UNKNOWN".
