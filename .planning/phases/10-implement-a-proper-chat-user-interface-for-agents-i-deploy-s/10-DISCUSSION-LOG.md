# Phase 10: Chat UI for Deployed Agents - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 10 — Implement a proper chat user interface for agents I deploy
**Areas discussed:** Agent Coverage Tier, Bidirectional Transport, Conversation Model, Chat Surface & Nav

---

## Gray-Area Selection

**Question:** Which gray areas to discuss?

| Option | Description | Selected |
|--------|-------------|----------|
| Chat Surface & Nav | Where the chat lives and what happens to the embedded RequestDetail chat | ✓ |
| Bidirectional Transport | How inbound + outbound messages actually flow between UI and running agents | ✓ |
| Conversation Model | What counts as a "message" and what the storage looks like | ✓ |
| Agent Coverage Tier | Which agents get bidirectional chat at v1, and degraded UX for uncapable ones | ✓ |

All four areas selected.

---

## Agent Coverage Tier

### Q1. Which agents get bidirectional chat at v1?

| Option | Description | Selected |
|--------|-------------|----------|
| Claude Code only (Recommended) | Hook-capable only; others read-only. Smallest scope. | |
| All AITC-launched agents | Claude full-duplex; others degraded. ~2x backend work. | ✓ |
| All agents incl. passive | Plus passively-detected Claude. Biggest surface. | |

### Q2. Uncapable-agent UX

| Option | Description | Selected |
|--------|-------------|----------|
| Hide the input entirely (Recommended) | Read-only-transcript badge | |
| Show disabled input with tooltip | Consistent layout; tooltip explains why | ✓ |
| Queue for next-run | Ill-defined semantics for one-shots | |

### Q3. History continuity across re-launches

| Option | Description | Selected |
|--------|-------------|----------|
| Continuous per-agent-id (Recommended) | Relaunch shows full thread | |
| Per-session transcript | Each launch = new transcript | |
| Hybrid: continuous view, session-tagged | Unified thread with boundary markers | ✓ |

### Q4. On agent terminate

| Option | Description | Selected |
|--------|-------------|----------|
| Archive read-only, allow relaunch (Recommended) | Grayed out, input disabled; relaunch reactivates | ✓ |
| Keep live, queue outbound | Blurs terminated vs alive | |
| Hide from chat list entirely | Cleaner but breaks continuous view | |

### Q5. Show internal narration or user-facing text only?

| Option | Description | Selected |
|--------|-------------|----------|
| Full narration (Recommended) | Tool-use + text inline | ✓ |
| User-facing text only | Ignores phase goal | |
| Toggleable (default on) | Both camps happy | |

---

## Bidirectional Transport

### Q1. Inbound for Claude Code

| Option | Description | Selected |
|--------|-------------|----------|
| Capture subprocess stdout (Recommended) | stream-json piped to agent_events | |
| New hooks (UserPromptSubmit + Stop + Notification) | Uniform with Phase 8, narrower coverage | |
| Both: stdout primary, hooks for metadata | More moving parts, catches everything | ✓ |

### Q2. Outbound for Claude Code (initial)

| Option | Description | Selected |
|--------|-------------|----------|
| Resume-session with prompt (Recommended) | claude --resume per message | |
| MCP server (AITC as tool provider) | Claude polls AITC MCP tool | ✓ |
| Long-lived --input-format stream-json | Persistent stdin JSONL frames | |

### Q3. Inbound for Codex / OpenCode / Generic

| Option | Description | Selected |
|--------|-------------|----------|
| Stdout/stderr capture only (Recommended) | Raw transcript lines, read-only badge | ✓ |
| Adapter-specific parser per agent | Uncertain payoff | |
| Nothing until hooks exist | Defeats "stop reading logs" goal | |

### Q4. MCP-as-outbound trigger mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Poll tool + CLAUDE.md priming (Recommended) | System-prompt instructs Claude to poll | |
| Session lifecycle hook calls tool | Hook forces Claude to invoke MCP tool | ✓ |
| Interactive-mode session keeps polling | Long-running session with MCP access | |

### Q5. If session has ended, what happens when user sends?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-resume a new subprocess (Recommended) | claude --resume seamless | ✓ |
| Queue until user manually relaunches | Explicit but friction | |
| Reject with clear error | Honest but breaks feel | |

### Q6. Primary runtime mode

| Option | Description | Selected |
|--------|-------------|----------|
| Long-lived interactive (stream-json in/out) (Recommended) | stdin JSONL + stdout stream-json | ✓ |
| One-shot --print, resume-on-message | Fresh subprocess per message | |
| Headless agentic loop (Agent SDK embed) | Max control, big dep surface | |

### Q7. Session lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Never implicit — only explicit terminate (Recommended) | Runs until user clicks Terminate | ✓ |
| Auto-terminate after idle timeout | Saves tokens, surprises user | |
| End-of-turn auto-terminate + auto-resume | Session churn | |

### Q8. Outbound backlog

| Option | Description | Selected |
|--------|-------------|----------|
| Serial queue, FIFO (Recommended) | One JSONL frame at a time, in order | ✓ |
| Auto-concatenate into single turn | Fewer turns, context confusion | |
| Block UI until prior delivered | Sluggish | |

### Q9. MCP server hosting

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing self_register HTTP server (Recommended) | Single port, single process | ✓ |
| Separate MCP sidecar binary | Cleaner separation, more parts | |
| Defer MCP to a future phase | Drop catch-all safety net | |

---

## Conversation Model

### Q1. Event types in the transcript (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| User text messages | Always | ✓ |
| Agent text replies (Recommended) | Assistant turn text | ✓ |
| Tool-use events (Recommended) | Compact cards inline | ✓ |
| Approval request links (Recommended) | Inline cards linking to PreToolUse rows | ✓ |

### Q2. Storage

| Option | Description | Selected |
|--------|-------------|----------|
| New agent_events table, deprecate chat_messages for chat (Recommended) | Clean long-term schema | ✓ |
| Extend chat_messages with event_type + payload_json | Less disruptive, overloaded table | |
| Two tables side-by-side | More joins, redundant bookkeeping | |

### Q3. Tool-use ↔ approval_request linkage

| Option | Description | Selected |
|--------|-------------|----------|
| Separate transcript entry with link (Recommended) | FK on agent_events, transcript survives | ✓ |
| Same row | Couples schemas, awkward for ungated tools | |
| Hide tool-use that didn't gate | Fights narration goal | |

### Q4. Tool-use rendering default

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed card with expand (Recommended) | Scannable, full fidelity one click away | ✓ |
| Inline full preview | Rich but very long | |
| Icon-only pill, side panel | Extra click for anything | |

### Q5. Streaming

| Option | Description | Selected |
|--------|-------------|----------|
| Stream partial tokens (Recommended) | Live-typing feel, matches Claude Code | ✓ |
| Complete-message only | Simpler, feels static | |

### Q6. Retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep forever, paginate in UI (Recommended) | TanStack Virtual + manual Clear thread | ✓ |
| Rolling window (30 days) | Bounded DB, loses context | |
| Keep user text forever, prune tool-use older than N days | Split retention | |

---

## Chat Surface & Nav

### Q1. Primary location

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated /chat route in sidebar (Recommended) | Top-level nav entry | |
| New tab inside Comms Hub | REQUESTS / CHAT tab switcher | ✓ |
| Expand into Tower Control detail panel | Consolidates in Tower | |

### Q2. Fate of Phase 4 embedded chat

| Option | Description | Selected |
|--------|-------------|----------|
| Remove entirely (Recommended) | Single source of truth | ✓ |
| Keep as shortcut, read-only | Preview + "Open in Chat" link | |
| Keep everything and dual-source | Bug factory | |

### Q3. Layout of the dedicated chat view

| Option | Description | Selected |
|--------|-------------|----------|
| MasterDetailShell: agent list / transcript (Recommended) | Reuses Phase 9 primitive | ✓ |
| Multi-pane tiling | Power-user, narrow-display hostile | |
| Unified global feed with filters | ATC vibe but hard to follow | |

### Q4. Unread indicators

| Option | Description | Selected |
|--------|-------------|----------|
| Count badge + sidebar dot (Recommended) | Combined count, per-agent counts | ✓ |
| Dot-only, no count | Glanceable, loses precision | |
| No indicators | Worst UX | |

### Q5. OS notifications

| Option | Description | Selected |
|--------|-------------|----------|
| Only for @-mentions or 'awaiting-user' states (Recommended) | Rationed to meaningful events | ✓ |
| Every assistant turn | Noisy | |
| No chat notifications | Least distracting | |

### Q6. Background capture

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — store-driven, all events captured regardless of view (Recommended) | Unread accumulates while closed | ✓ |
| Only when window is foreground | Pauses capture on minimize | |

---

## Claude's Discretion

Areas where the user deferred to planner/Claude:
- Exact CLAUDE.md / system-prompt text for MCP-poll priming
- Precise stream-json parser schema version + reconnect behavior
- Which Claude Code hooks to actually install for sideband metadata (D-07)
- MCP tool names + JSON schemas beyond `get_pending_user_messages`
- Session-exit detection mechanism
- Supervisor/restart policy for crashed long-lived subprocess
- `session_id` capture on first launch
- Exact `agent_events.payload_json` shape per `event_type`
- `@-mention` / "awaiting-user" signal convention
- Master-list sort order
- Sticky input keyboard behavior
- Migration script shape for `chat_messages` → `agent_events`
- Per-session MCP config write location

## Deferred Ideas

- Passive-detected Claude chat
- Outbound for Codex/OpenCode/Generic
- Adapter-specific parsers
- Multi-pane tiling / unified global feed
- Auto-concatenate queued messages
- Auto-prune / rolling-window retention
- Destructive-pattern highlighting on tool-use cards
- Global ~/.claude/ MCP install
- End-of-turn auto-terminate + auto-resume
- Idle-timeout auto-terminate
- Every-turn OS notifications
- Hard delete of chat_messages table
- Supervisor-driven crash restart
- In-UI chat search / full-text index
