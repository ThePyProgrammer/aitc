# Phase 10: Chat User Interface for Deployed Agents — Research

**Researched:** 2026-04-17
**Domain:** Long-lived interactive Claude Code runtime + first-class chat UI built on an `agent_events` transcript backed by the existing self-register axum host (new MCP endpoint), TanStack-Virtual transcript, Motion v12 animations, and Zustand per-domain store.
**Confidence:** HIGH (stream-json wire format was captured empirically against Claude Code 2.1.112 installed locally; hook and MCP contracts were cross-verified against `code.claude.com/docs` and against `src-tauri/src/agents/*` for precedent)

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

> Copied verbatim from `10-CONTEXT.md`. These are NOT negotiable and the planner MUST honor them.

**Agent Coverage Tier**
- **D-01:** Bidirectional chat targets all AITC-launched agents. Claude Code gets full duplex (stream-json in/out). Codex / OpenCode / Generic get a read-only transcript from subprocess stdout+stderr capture only. Passively-detected Claude sessions are explicitly out of v1 scope.
- **D-02:** When an agent has no outbound path (Codex/OpenCode/Generic), the chat input is rendered disabled with a tooltip and the row shows a `READ-ONLY TRANSCRIPT` badge.
- **D-03:** Hybrid continuous view with session-boundary markers. Relaunching the same `agent_id` appends a new session segment to the existing thread; `agent_events` carries `session_id` per row.
- **D-04:** On agent terminate, the transcript is archived read-only; the agent stays in the master list (grayed out). Relaunching the same `agent_id` reactivates the input and appends a new session segment.
- **D-05:** Transcript shows full narration — user text, assistant text, tool-use events, and approval-request links — inline.

**Bidirectional Transport**
- **D-06:** Chattable Claude Code sessions run in long-lived interactive mode: `claude --input-format stream-json --output-format stream-json`. One subprocess per agent, supervised by AITC's launcher for the lifetime of the agent.
- **D-07:** Inbound is hybrid — subprocess stdout as stream-json is primary; Claude Code hooks sidebanded via the Phase 8 `/hook` host serve lifecycle metadata.
- **D-08:** Outbound primary is stdin JSONL frames. MCP server is the fallback / catch-all forced via a lifecycle hook; when the session has exited, AITC auto-resumes with `claude --resume <session_id> --print "<msg>"`.
- **D-09:** Session lifecycle is explicit-only — no idle timeout, no end-of-turn auto-terminate.
- **D-10:** Outbound backlog is FIFO serial — one stdin frame per user message, in order, with delivery states queued → delivered → consumed (Claude's turn began against it) or unsupported.
- **D-11:** MCP server lives on the existing `self_register` axum host (same port, same process, alongside `/register` and `/hook`). Each launched Claude session is wired to this MCP via per-session config.
- **D-12:** Inbound for Codex/OpenCode/Generic is raw subprocess stdout+stderr capture as `raw_stdout` / `raw_stderr` events.

**Conversation Model**
- **D-13:** Four first-class event types: `user_text`, `assistant_text`, `tool_use`, `approval_link`. Schema is extensible (`tool_result`, `session_boundary`, `raw_stdout`, `raw_stderr`, `system_note`) with generic fallback rendering.
- **D-14:** New table `agent_events` with columns: `id`, `agent_id`, `session_id`, `event_type`, `payload_json`, `approval_request_id` (nullable FK), `created_at`, `sequence_number`. Indexed on `(agent_id, created_at)` and `(session_id, sequence_number)`. One-shot migration of existing `chat_messages` rows.
- **D-15:** Tool-use events link to approval rows via `approval_request_id` (FK, nullable). Every tool invocation records a transcript entry regardless of gating.
- **D-16:** Tool-use events render collapsed by default — one-line `[TOOL_NAME] summary`. Click expands inline to the Phase 8 `ToolPreview` registry.
- **D-17:** Assistant text streams token-by-token with blinking cursor; buffer in RAM + Zustand, flush to `agent_events` once per turn completion (or 250ms idle between chunks).
- **D-18:** Retention is indefinite; manual per-agent "Clear thread" only. TanStack Virtual + upward infinite-scroll.

**Chat Surface & Nav**
- **D-19:** Primary location is a new tab inside Comms Hub (`REQUESTS | CHAT` switcher). Tab state is URL-synced.
- **D-20:** CHAT tab uses the Phase 9 `MasterDetailShell` primitive (master = agent list, detail = transcript + sticky input).
- **D-21:** Remove the Phase 4 embedded chat entirely (delete `ChatThread`, `ChatInput`, `MiniChatCard`; remove `AGENT_CHANNELS` from `TelemetryPanel`). Migrate existing `chat_messages` into `agent_events`.
- **D-22:** Unread indicators: Comms sidebar dot + CHAT tab label `CHAT [N]` + per-agent unread badges.
- **D-23:** OS notifications for chat fire ONLY on `@user` mention or "awaiting-user" signal. Every-turn notifications explicitly rejected.
- **D-24:** Chat capture runs backend-side regardless of which view is active. Tauri events: `agent-event-appended`, `agent-turn-started`, `agent-turn-complete`, `agent-session-started`, `agent-session-ended`.

### Claude's Discretion

> Planner picks within each of these; research below makes recommendations.

- Exact CLAUDE.md / system-prompt text priming MCP poll behaviour (D-08 fallback).
- Stream-json parser details: partial-fragment reassembly, error recovery, reconnect.
- Which Claude Code hooks to install for sideband metadata (D-07) — candidates `UserPromptSubmit`, `Stop`, `Notification`, `SessionStart/End`.
- MCP tool names beyond `get_pending_user_messages`. Candidates `request_user_input`, `post_assistant_note`.
- "Session exited" detection mechanism (exit code, stream-json `{type:"result"}`, or both).
- Supervisor/restart policy on crash.
- `session_id` capture mechanism.
- Exact `agent_events.payload_json` shape per `event_type`.
- `@user` / awaiting-user detection (hook-based, text-based, or MCP-tool-based).
- Master-list sort order (recommended: most-recent-activity).
- Sticky input autosize / keyboard shortcuts beyond Enter-to-send.
- One-shot migration script shape (D-21).
- Per-session MCP config write location (D-11).

### Deferred Ideas (OUT OF SCOPE)

- Chat for passively-detected Claude sessions.
- Multi-pane tiling or unified global feed layouts.
- Outbound transport for Codex/OpenCode.
- Retention / auto-pruning beyond manual "Clear thread".
- Destructive-pattern highlighting inside tool-use cards.
- Global `~/.claude/` MCP install (v1 is per-session only).
- Auto-concatenate queued outbound messages.
- Every-turn OS notifications.
- Supervisor auto-restart (v1: mark archived on crash).
- In-UI chat search / full-text index over `agent_events`.
- `chat_messages` hard-delete (table left empty post-migration).

---

## Phase Requirements

**No new REQ-IDs introduced by Phase 10.** COMM-04 ("User can send freeform text messages to an agent via the Communications Hub chat interface", carried forward from Phase 4) is addressed implicitly by the new chat surface. Phase scope is authoritative from CONTEXT.md + UI-SPEC.md.

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-04 | User can send freeform text messages to an agent via the Communications Hub chat interface. | Long-lived stream-json runtime (D-06) + stdin JSONL frame writer (D-08); new MCP server on self-register host for fallback; auto-resume `--resume --print` path when session has exited. |

---

## Project Constraints (from CLAUDE.md)

- Tauri v2 + React 19.2 + TypeScript 5 + Vite 8.
- shadcn/ui explicitly rejected — Command Horizon is custom, no `components.json`, no registry blocks.
- Tailwind v4 `@theme` tokens only; no literal hex.
- Zero-radius corners globally, No-Line Rule (tonal shifts, not borders), thin-stroke Lucide icons (`strokeWidth={1.5}`).
- Space Grotesk (labels UPPERCASE, tracking-widest) + JetBrains Mono (body).
- Zustand store-per-domain; backend parses, frontend renders.
- `#[tauri::command] #[specta::specta]` + tauri-specta for all IPC.
- sqlx + migration-per-feature in `src-tauri/src/db/migrations/`.
- `tokio::sync::mpsc` and `tokio::sync::oneshot` patterns already established.
- GSD Workflow Enforcement — go through `/gsd-execute-phase` before edits.

---

## Summary

Phase 10 replaces the half-working Phase-4 embedded chat (buried inside `RequestDetail`) with a first-class CHAT tab inside the Communications Hub. The technical core is a long-lived `claude --input-format stream-json --output-format stream-json --verbose` subprocess per chattable Claude agent, piped bidirectionally into a new `chat_runtime` module in the Rust backend. stream-json NDJSON chunks are parsed progressively into a new `agent_events` table; user messages become stdin JSONL frames. A new `aitc-chat` MCP server is hosted on the existing self-register axum port as a fallback path and as the surface for the `request_user_input` tool (drives `@user` OS notifications). The frontend composes Phase 9's `MasterDetailShell` (with a rail-width override), new `chat/*` components, and TanStack Virtual upward infinite-scroll.

**Primary recommendation:** Build the long-lived runtime as a new `chat_runtime` module mirroring Phase 8's sidecar-adjacent shape (`launcher::launch_live_session` + supervisor task + outbound mpsc + stream-json parser task). Host the MCP endpoint on the existing `self_register` router (`POST /mcp` + `GET /mcp` per Streamable HTTP spec) using `rmcp 1.5` as the Rust SDK, and wire per-session MCP registration via the `--mcp-config <json>` + `--strict-mcp-config` CLI flags (rather than `claude mcp add` which would pollute `~/.claude.json` globally). Tear out `ChatThread` / `ChatInput` / `MiniChatCard` in one migration wave to avoid dual-source-of-truth bugs.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Long-lived Claude subprocess supervision | Rust backend (new `chat_runtime`) | — | stdin/stdout piping, process lifecycle, exit detection all need native syscalls and must survive across frontend remounts. [VERIFIED: launcher.rs + hook_waiters.rs precedent] |
| stream-json NDJSON parsing | Rust backend (`chat_runtime::parser`) | — | D-07 primary transport; keeps parsing off the frontend per WR-03 "backend parses, frontend renders" precedent. [CITED: CONTEXT.md D-24] |
| `agent_events` persistence | Rust backend (`db/events.rs`) + SQLite (WAL) | — | Single writer via sqlx matches Phase 4-8 pattern; indexed reads via new Tauri commands. [VERIFIED: 003/005 migrations] |
| Outbound FIFO backlog per agent | Rust backend (`chat_runtime::outbound`) with `tokio::sync::mpsc` | — | D-10 serial delivery lock-in; mpsc gives natural backpressure + ordering. [VERIFIED: existing `tokio::sync::mpsc` + `oneshot` precedent] |
| MCP server host | Rust backend (self_register axum router + new `mcp/` module) | — | D-11 lock; same port, single cleanup, reuses Extension-based DI. [CITED: self_register.rs build_router] |
| Per-session MCP config write | Rust backend (`mcp::session_config`) | — | Same shape as Phase 8 `hook_install.rs` atomic-tmp-rename pattern. [VERIFIED: hook_install.rs] |
| Hook sideband ingestion | Rust backend — Phase 8 `/hook` route extended (or second sidecar handler) | — | D-07 sideband; hook events arrive via existing sidecar POST path or via inline stream-json `type:"system", subtype:"hook_started"` lines. [VERIFIED: captured stream-json output contains `hook_started`/`hook_response` system events when `--verbose` is passed] |
| Chat UI (transcript, master list, input, tabs) | Frontend React | — | UI-SPEC lock; built with MasterDetailShell + TanStack Virtual + Motion. |
| `chatStore` per-agent event arrays + unread counts | Frontend Zustand | — | D-24 event-emission lock, matches `claudeResourcesStore` pattern. |
| Tauri event bus (`agent-event-appended`, etc.) | Tauri IPC | — | Standard backend→frontend push; frontend subscribes via `listen()`. [VERIFIED: Phase 4 + 8 precedent] |
| OS notification on `@user` | Rust (reuses Phase 4 `dispatch_approval_notification`) | — | D-23 lock, same plumbing. [VERIFIED: comms/commands.rs existing path] |

---

## Standard Stack

### Core (already installed — no new deps required)

| Library | Version (verified) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| React | 19.2.x | UI framework | Project lock. [VERIFIED: package.json] |
| TypeScript | 5.8.x | Type safety | Project lock. [VERIFIED: package.json] |
| Vite | 8.x | Dev server / build | Project lock. [VERIFIED: package.json] |
| Zustand | 5.0.12 | Store-per-domain | Matches `commsStore`, `pipelineStore`, `claudeResourcesStore`. [VERIFIED: package.json] |
| Tailwind CSS | 4.2.x with `@theme` tokens | Styling | Command Horizon token contract. [VERIFIED: theme.css] |
| Lucide React | 1.8.x (dep pinned `^1.7.0`) | Icons (Send, Check, CheckCheck, X, Clock, ChevronDown/Up, ExternalLink) | Thin-stroke configurable. All icons needed by UI-SPEC already available. [VERIFIED: npm view lucide-react@latest → 1.8.0; ^1.7.0 satisfies] |
| Motion | 12.38.0 (dep pinned `^12.0.0`) | Layout / AnimatePresence | For card expand, tool-use collapse/expand, toast entry, new-messages pill. [VERIFIED: npm view motion@latest → 12.38.0] |
| @tanstack/react-virtual | 3.13.23 | Upward infinite-scroll transcript + virtualized master list | Headless, supports inverted/reverse scroll pattern (chat mental model). [VERIFIED: package.json; confirmed via TanStack/virtual discussion #1013 + GitHub issue #1082] |
| Shiki | 4.0.2 | Code highlighting inside `AssistantTextCard` inline code and Bash/Write ToolPreview | Already used by Phase 5 `useSyntaxHighlight`. [VERIFIED: package.json] |
| @tauri-apps/api | 2.x | IPC (`invoke`, `listen`, `Channel<T>`) | Project lock. [VERIFIED] |

### Backend (Rust) — no new crates required for the core path

| Crate | Version | Purpose | Why Standard |
|-------|---------|---------|--------------|
| tokio | 1.x (process, sync, macros) | Async runtime + `Command::spawn` + `mpsc`/`oneshot` | Already the backbone. [VERIFIED: Cargo.toml] |
| axum | 0.8 | HTTP router (extend with `/mcp` route) | Already hosts `/register` + `/hook`. [VERIFIED: self_register.rs] |
| sqlx | 0.8 (sqlite, runtime-tokio) | Migrations + typed queries | Already used for every table. [VERIFIED: Cargo.toml] |
| serde / serde_json | 1.x | Stream-json parsing + payload_json (de)serialization | Standard. [VERIFIED] |
| specta / tauri-specta | 2.0-rc.21 / 2.0-rc.22 | Type-safe IPC bindings | All commands regenerate `src/bindings.ts`. [VERIFIED] |
| tracing | 0.1 | Structured logs for subprocess lifecycle events | Standard. [VERIFIED] |
| chrono | 0.4 | Timestamp helpers | Standard. [VERIFIED] |

### Optional / Recommended Addition (for the MCP server)

| Crate | Version | Purpose | Why |
|-------|---------|---------|-----|
| `rmcp` | `=1.5.0` | Official-style Rust MCP SDK with axum Streamable-HTTP transport adapter | Official `modelcontextprotocol/rust-sdk` crate. Exposes `transport-streamable-http-server` feature that drops directly onto an axum `Router`. Alternative: hand-roll the minimal MCP JSON-RPC endpoint ourselves (3–4 methods: `initialize`, `tools/list`, `tools/call`, `notifications/initialized`) which is a few hundred lines and avoids an alpha-ish external dep. [CITED: crates.io `rmcp 1.5.0`; CITED: MCP spec 2025-03-26 transports doc; CITED: Shuttle blog "How to Build a Streamable HTTP MCP Server in Rust" (2025-10-29)] |

**Planner Decision Point:** Adopt `rmcp` OR hand-roll. Recommend **hand-roll** for v1 — the MCP tool surface is tiny (2–3 tools, no subscriptions/resources), the wire format is JSON-RPC over HTTP POST with optional SSE upgrade, and avoiding the dep keeps the MCP endpoint inside `src-tauri/src/mcp/` with zero external drift risk. Migrate to `rmcp` later if the tool surface grows. [ASSUMED: tradeoff — recommendation only]

### Already Consumed (deleted / modified)

| Component | Action |
|-----------|--------|
| `src/views/CommsHub/ChatThread.tsx` | Delete (D-21) |
| `src/views/CommsHub/ChatInput.tsx` | Delete, logic migrated to `src/components/chat/ChatInput.tsx` (D-21) |
| `src/views/CommsHub/MiniChatCard.tsx` | Delete (D-21) |
| `src/views/CommsHub/TelemetryPanel.tsx` | Remove `AGENT_CHANNELS` section only; `SystemLoad` + `TelemetryFeed` stay. |
| `src/views/CommsHub/RequestDetail.tsx` | Remove embedded ChatThread + ChatInput usages. |
| `src/components/ui/DeliveryStatus.tsx` | Extend with fourth variant `consumed` (`CheckCheck` icon, primary color). |
| `src/components/layout/MasterDetailShell.tsx` | Add optional `railWidth?: number` and `detailWidth?: number | 'flex'` props. |
| `src/components/layout/Sidebar.tsx` | Add small primary dot on COMMS nav item driven by `chatStore.totalUnread`. |
| `src/stores/commsStore.ts` | Remove `messages` map, `sendMessage`, `fetchMessages`, and the `ChatMessage` type (all moved to `chatStore`). |
| `src-tauri/src/comms/commands.rs` | Remove `send_chat_message`, `list_chat_messages`, `update_message_delivery_status` (replaced by new `chat_commands`). |
| `src-tauri/src/comms/types.rs` | Keep `ChatMessage` only if any migration code still references it transiently; otherwise remove after migration commits. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Long-lived stream-json subprocess (D-06) | Per-message `claude --resume --print` fork/exec | Rejected: every message incurs Claude CLI startup (~2s cold), loses streaming UX, conflicts with D-09 persistent session. `--resume --print` is still needed for the auto-resume fallback path when the long-lived process has exited. |
| MCP over HTTP (D-11) | MCP over stdio transport | Rejected: stdio transport would require a *second* subprocess launched by Claude per session that talks to AITC via Unix/Windows pipes; doesn't compose with the single long-lived Claude process already owning the stdio pipes. Streamable HTTP on 127.0.0.1 fits the existing self_register host exactly. [VERIFIED: MCP spec 2025-03-26 supports Streamable HTTP as a first-class transport] |
| `rmcp` SDK | Hand-rolled JSON-RPC on axum | Tradeoff as above — 3 tools is small enough to hand-roll; rmcp brings the full MCP state machine but also its version churn. |
| `tauri_plugin_shell::sidecar` for launching Claude | `tokio::process::Command` directly | `tokio::process::Command` is what `launcher.rs::launch_detached` already uses; sidecar API is for bundled AITC-owned binaries (like `aitc-hook`), not for spawning end-user installed `claude`. Keep the existing pattern. |
| Hand-rolled chat message store | react-query / @tanstack/query | Overkill — events are Tauri-push, not request/response. Zustand `store-per-domain` is the locked pattern. [VERIFIED: commsStore + claudeResourcesStore + pipelineStore] |

**Installation:** No new `npm install` required for the frontend. Backend MCP hand-roll requires no new Rust crates. (If planner elects `rmcp`: `cargo add rmcp --features "server,macros,transport-streamable-http-server"`.)

**Version verification:** Ran `npm view motion version` (12.38.0), `npm view @tanstack/react-virtual version` (3.13.23), `npm view zustand version` (5.0.12), `npm view lucide-react version` (1.8.0). All existing pinned ranges satisfy.

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── AITC Tauri Process ───────────────────────────┐
│                                                                           │
│  ┌──────────────── Rust Backend ────────────────┐                         │
│  │                                              │                         │
│  │ launcher::launch_live_session()              │                         │
│  │   │                                          │                         │
│  │   ▼                                          │                         │
│  │ chat_runtime::LiveSession (per agent)        │                         │
│  │  ├─ tokio::process::Child                    │                         │
│  │  │   ├─ stdin  ◀── outbound::mpsc::Receiver  │ ◀── send_chat_message   │
│  │  │   ├─ stdout ──▶ parser::StreamJsonReader  │ ──▶ AgentEvent stream   │
│  │  │   └─ stderr ──▶ raw_stderr event stream   │                         │
│  │  ├─ supervisor::wait_for_exit (on-exit emit) │                         │
│  │  └─ session_id (captured from init msg)      │                         │
│  │                      │                       │                         │
│  │                      ▼                       │                         │
│  │ db/events.rs::insert_agent_event             │                         │
│  │   (single writer, sqlx, WAL)                 │                         │
│  │                      │                       │                         │
│  │                      ▼                       │                         │
│  │ app.emit("agent-event-appended", ev)         │                         │
│  │                                              │                         │
│  └──────────────────────┬───────────────────────┘                         │
│                         │                                                 │
│  ┌──────────────────────▼───── axum (self_register) ─────┐                │
│  │  POST /register  (Phase 3)                            │                │
│  │  POST /hook      (Phase 8, long-held)                 │                │
│  │  POST /mcp       (Phase 10, Streamable HTTP)   ◀──┐   │                │
│  │  GET  /mcp       (Phase 10, SSE upgrade)       ◀──┤   │                │
│  │  DELETE /mcp     (Phase 10, session teardown)  ◀──┤   │                │
│  └───────────────────────────────────────────────────│───┘                │
│                                                      │                    │
│                                                      │                    │
│  ┌──── Frontend React ─────┐                         │                    │
│  │ chatStore (Zustand)     │                         │                    │
│  │   ├─ events[agent_id]   │                         │                    │
│  │   ├─ channels[]         │                         │                    │
│  │   ├─ unread[agent_id]   │                         │                    │
│  │   └─ sendMessage()  ────┼──▶ invoke("send_chat_message_to_agent")      │
│  │                         │                         │                    │
│  │ ChatView                │                         │                    │
│  │   ├─ MasterDetailShell  │ (rail 280 / detail flex)│                    │
│  │   ├─ AgentChannelList   │ (TanStack Virtual)      │                    │
│  │   └─ ChatTranscript     │ (TanStack Virtual, reverse)                  │
│  └─────────▲───────────────┘                         │                    │
│            │ listen("agent-event-appended")          │                    │
│            │                                         │                    │
└────────────┼─────────────────────────────────────────┼────────────────────┘
             │                                         │
             │                                         │
    ┌────────┴────────┐                       ┌────────┴────────┐
    │  AITC UI        │                       │  claude         │
    │  (user reads    │                       │  (subprocess)   │
    │   + types)      │                       │                 │
    └─────────────────┘                       │  stdin: JSONL   │
                                              │  stdout:JSONL   │
                                              │  reads --mcp-   │
                                              │  config to POST │
                                              │  /mcp on self-  │
                                              │  register host  │
                                              └─────────────────┘
```

Data flow for a user message:
1. User types in `ChatInput` → `chatStore.sendMessage(agentId, content)`.
2. Frontend optimistic-appends a `user_text` event with `deliveryStatus='queued'`, calls `invoke('send_chat_message_to_agent', { agentId, content })`.
3. Backend `send_chat_message_to_agent` looks up the agent's outbound mpsc sender, inserts a new `user_text` row into `agent_events`, pushes a JSONL frame `{"type":"user","message":{"role":"user","content":[{"type":"text","text":...}]}}` into the channel.
4. `chat_runtime::outbound_writer_task` drains the channel, writes one line to `child.stdin`, flushes. Emits `agent-delivery-updated` with `status='delivered'`.
5. Claude begins responding → stream-json `{type:"assistant", ...}` + `{type:"stream_event", ...}` deltas arrive on stdout.
6. `parser::StreamJsonReader` inserts `assistant_text` (flushed on turn completion), tool-use events, etc., emits `agent-event-appended` per row.
7. When the turn completes (`{type:"result", terminal_reason:"completed"}`), backend emits `agent-turn-complete` and flips the preceding user message to `deliveryStatus='consumed'`.

Data flow for OS notification on `@user` mention:
1. `parser` observes `@user` token in a flushed `assistant_text` payload (regex match); OR MCP tool `request_user_input` is invoked by Claude and routed into the same path.
2. Backend calls `dispatch_approval_notification`-style helper with deep-link payload `?tab=chat&agent={agent_id}`.
3. Click → brings AITC to foreground, navigates to that agent's transcript.

### Recommended Project Structure

```
src-tauri/src/
  chat_runtime/              # NEW - long-lived Claude supervisor
    mod.rs                   # LiveSession type + public API
    launcher.rs              # launch_live_session(opts) -> LiveSession
    parser.rs                # stream-json NDJSON line reader
    outbound.rs              # serial FIFO mpsc writer to stdin
    supervisor.rs            # wait-for-exit + session_id capture
    commands.rs              # Tauri commands (send_chat_message_to_agent,
                             #                 clear_agent_thread,
                             #                 list_agent_events,
                             #                 relaunch_agent_session)
    types.rs                 # AgentEvent, EventType, ChatSessionHandle
  mcp/                       # NEW - AITC-as-MCP-server
    mod.rs                   # router + Extension wiring
    streamable_http.rs       # POST/GET/DELETE handlers + session-id header
    tools.rs                 # get_pending_user_messages, request_user_input,
                             #   [optional] post_assistant_note
    session_config.rs        # write per-session .claude/ mcp-config file
  db/
    events.rs                # NEW - read/write helpers for agent_events
    migrations/
      006_agent_events.sql   # NEW - CREATE TABLE + INSERT ... SELECT from chat_messages

src/
  stores/
    chatStore.ts             # NEW
  hooks/
    useChatChannel.ts        # NEW - streams backend events into chatStore
  views/CommsHub/
    CommsView.tsx            # MODIFY - add CommsTabBar + route body on ?tab=
    ChatView.tsx             # NEW - CHAT tab top-level
    RequestDetail.tsx        # MODIFY - remove embedded chat
    TelemetryPanel.tsx       # MODIFY - remove AGENT_CHANNELS section
    ChatThread.tsx           # DELETE
    ChatInput.tsx            # DELETE (logic moves to src/components/chat/ChatInput.tsx)
    MiniChatCard.tsx         # DELETE
  components/
    chat/                    # NEW - all chat-specific cards
      AgentChannelList.tsx
      AgentChannelRow.tsx
      ChatTranscript.tsx
      EventCard.tsx
      UserMessageCard.tsx
      AssistantTextCard.tsx
      ToolUseCard.tsx
      ApprovalLinkCard.tsx
      ToolResultCard.tsx
      SessionBoundary.tsx
      RawStreamCard.tsx
      SystemNoteCard.tsx
      StreamingCursor.tsx
      ReadOnlyBadge.tsx
      ChatInput.tsx          # rewritten from Phase 4
    ui/
      CommsTabBar.tsx        # NEW
      UnreadBadge.tsx        # NEW
      DeliveryStatus.tsx     # MODIFY (add 'consumed' variant)
    layout/
      MasterDetailShell.tsx  # MODIFY (railWidth / detailWidth props)
      Sidebar.tsx            # MODIFY (add COMMS unread dot)
```

### Pattern 1: Long-Lived Claude Subprocess with Piped Stdio

**What:** Spawn `claude --input-format stream-json --output-format stream-json --verbose [--include-partial-messages] [--mcp-config /path/to/session-mcp.json --strict-mcp-config] <intent>` via `tokio::process::Command` with all three pipes `Stdio::piped()`. Keep stdin open for the lifetime of the agent; Claude terminates only when stdin is closed OR it emits `{type:"result", terminal_reason:"completed"}` after processing its final turn. To keep a persistent multi-turn session, **do not close stdin** — keep writing frames as the user sends messages.

**When to use:** Any Claude Code agent AITC launches that the user wants to chat with (D-01 tier 1: claude-code adapter only in v1).

**Empirical verification (captured 2026-04-17 against Claude Code 2.1.112 installed at `/home/prannayag/.local/bin/claude`):**

Input (piped twice, 8 seconds apart, no stdin close between them):
```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"say NUM=1 nothing else"}]}}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"say NUM=2 nothing else"}]}}
```

Output (key lines only):
```
{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup",...,"session_id":"84f2955e-a011-4568-a704-3792d0633841"}
{"type":"system","subtype":"init","cwd":"/tmp","session_id":"84f2955e-...","tools":[...],"mcp_servers":[],"model":"claude-opus-4-7[1m]","permissionMode":"default","slash_commands":[...],"claude_code_version":"2.1.112",...}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"NUM"}},"session_id":"84f2955e-..."}
{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_01...","role":"assistant","content":[{"type":"text","text":"NUM=1"}],...},"session_id":"84f2955e-..."}
{"type":"result","subtype":"success","is_error":false,"duration_ms":2223,"num_turns":1,"result":"NUM=1","stop_reason":"end_turn","session_id":"84f2955e-...","terminal_reason":"completed",...}
... (repeat for NUM=2 on the SAME session_id) ...
{"type":"result","subtype":"success",...,"result":"NUM=2","session_id":"84f2955e-...","terminal_reason":"completed"}
```

Two turns, **same `session_id`**, two independent `{type:"result", terminal_reason:"completed"}` envelopes. The process remained alive the entire time and only exited when stdin closed at the end of the test. This validates D-06 / D-09 lock.

**Example (Rust, spawn + pipe):**
```rust
// Source: /home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/launcher.rs (existing pattern)
// + tokio docs (docs.rs/tokio/latest/tokio/process/struct.Command.html)
use tokio::process::Command;
use std::process::Stdio;

let mut cmd = Command::new("claude");
cmd.args(&[
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",                 // required with stream-json output
    "--include-partial-messages", // enables token-level deltas (D-17)
    "--mcp-config", &mcp_config_path,
    "--strict-mcp-config",       // only this MCP config, no ambient ~/.claude.json
    &intent,                     // prompt as positional arg
])
.current_dir(&cwd)
.env("AITC_PORT", aitc_port.to_string())
.stdin(Stdio::piped())
.stdout(Stdio::piped())
.stderr(Stdio::piped());

#[cfg(windows)]
{
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
}

let mut child = cmd.spawn()?;
let stdin  = child.stdin.take().expect("piped stdin");
let stdout = child.stdout.take().expect("piped stdout");
let stderr = child.stderr.take().expect("piped stderr");

// Three independent tasks:
tokio::spawn(stream_json_reader(stdout, agent_id.clone(), event_sender.clone()));
tokio::spawn(raw_stderr_reader(stderr, agent_id.clone(), event_sender.clone()));
tokio::spawn(outbound_writer(stdin, outbound_rx, delivery_tx));
tokio::spawn(supervisor(child, agent_id.clone(), exit_tx));
```

### Pattern 2: stream-json NDJSON Parser (serde_json incremental)

**What:** Read `tokio::io::BufReader<ChildStdout>` line-by-line with `lines()`, parse each line as `serde_json::Value`, dispatch on the `type` field to the event-building branch. Malformed lines are logged via `tracing::warn!` and skipped (don't fail the whole stream).

**When to use:** The primary inbound parser. Empirically, a single turn emits:
- `{type:"system", subtype:"hook_started" | "hook_response"}` per pre-turn hook
- `{type:"system", subtype:"init", session_id, cwd, tools, mcp_servers, model, permissionMode, slash_commands, claude_code_version, ...}` — **FIRST init message carries `session_id`** (D-07 session_id capture point)
- `{type:"system", subtype:"status", status:"requesting"}` (internal heartbeat)
- `{type:"stream_event", event:{type:"message_start"|"content_block_start"|"content_block_delta"|"content_block_stop"|"message_delta"|"message_stop"}, session_id, parent_tool_use_id}` — token deltas (only when `--include-partial-messages`)
- `{type:"assistant", message:{role:"assistant", content:[{type:"text",text:...} | {type:"tool_use",id,name,input:...}], ...}, session_id}` — one per assistant sub-turn
- `{type:"user", message:{role:"user", content:[{type:"tool_result",tool_use_id,content,is_error}], ...}}` — tool results re-ingested into Claude's context (emitted *as if* from user role, but they're tool outputs)
- `{type:"rate_limit_event", rate_limit_info:{...}}`
- `{type:"result", subtype:"success"|"error_during_execution", is_error, duration_ms, num_turns, result, stop_reason, session_id, total_cost_usd, usage, permission_denials, terminal_reason:"completed"|...}` — **terminal envelope** signalling end-of-turn (D-07 turn-complete signal)

**Example (Rust):**
```rust
// Source: derived from captured stream-json output + tokio::io::AsyncBufReadExt docs
use tokio::io::{AsyncBufReadExt, BufReader};

async fn stream_json_reader(
    stdout: tokio::process::ChildStdout,
    agent_id: String,
    sink: mpsc::Sender<StreamEvent>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut session_id: Option<String> = None;
    let mut pending_assistant_text: String = String::new();
    let mut pending_sequence: i64 = 0;

    while let Ok(Some(line)) = lines.next_line().await {
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(agent_id = %agent_id, err = %e, line = %line,
                               "malformed stream-json line, skipping");
                continue;
            }
        };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "system" => match v.get("subtype").and_then(|s| s.as_str()).unwrap_or("") {
                "init" => {
                    session_id = v.get("session_id").and_then(|s| s.as_str()).map(String::from);
                    let _ = sink.send(StreamEvent::SessionStarted { session_id: session_id.clone().unwrap() }).await;
                }
                "hook_started" | "hook_response" => {
                    // Sideband hook metadata — mined for session_id cross-check,
                    // awaiting-user detection when hook_name is Notification:idle_prompt.
                    dispatch_hook_event(&v, &sink).await;
                }
                _ => { /* status heartbeats — ignore */ }
            },
            "stream_event" => {
                // Token deltas: accumulate into pending_assistant_text, emit throttled
                // AssistantTextDelta events (D-17). Flush to DB on message_stop / result.
                if let Some(delta) = extract_text_delta(&v) {
                    pending_assistant_text.push_str(&delta);
                    let _ = sink.send(StreamEvent::AssistantDelta { delta }).await;
                }
            }
            "assistant" => {
                // Full assistant sub-turn. Content can be text or tool_use.
                // Emit one agent_events row per content block.
                emit_assistant_blocks(&v, session_id.as_deref(), &sink, &mut pending_sequence).await;
            }
            "user" => {
                // tool_result payload — emit as tool_result event linked by tool_use_id.
                emit_tool_result(&v, session_id.as_deref(), &sink, &mut pending_sequence).await;
            }
            "result" => {
                // Terminal envelope — flush any buffered text, emit TurnComplete.
                let _ = sink.send(StreamEvent::TurnComplete {
                    terminal_reason: v.get("terminal_reason").and_then(|r| r.as_str()).unwrap_or("unknown").into(),
                    is_error: v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false),
                }).await;
            }
            "rate_limit_event" => { /* emit SystemNote */ }
            _ => { /* forward-compatibility: emit SystemNote with raw JSON */ }
        }
    }
    // EOF on stdout => subprocess closed its side.
    let _ = sink.send(StreamEvent::StdoutClosed).await;
}
```

### Pattern 3: Outbound FIFO Serial Writer (`tokio::sync::mpsc`)

**What:** Single-writer task owns `child.stdin`. Receives `OutboundFrame { content: String, message_id: i64 }` from an `mpsc::Receiver`. For each frame: (1) serialize to the stream-json user message envelope, (2) write line + newline + flush, (3) emit `agent-delivery-updated { message_id, status: 'delivered' }`.

**When to use:** The sole path for outbound `send_chat_message_to_agent` (D-08 + D-10).

**Envelope shape (verified empirically):**
```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<user content>"}]}}
```
Newline-terminated, UTF-8. Claude accepts either one-line compact JSON or escaped multi-line strings as long as each JSONL line is a complete object.

**Example (Rust):**
```rust
use tokio::io::AsyncWriteExt;

async fn outbound_writer(
    mut stdin: tokio::process::ChildStdin,
    mut rx: mpsc::Receiver<OutboundFrame>,
    delivery: mpsc::Sender<DeliveryUpdate>,
) {
    while let Some(frame) = rx.recv().await {
        let envelope = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": frame.content}],
            }
        });
        let mut line = serde_json::to_string(&envelope).expect("serialize");
        line.push('\n');
        match stdin.write_all(line.as_bytes()).await {
            Ok(()) => {
                let _ = stdin.flush().await;
                let _ = delivery.send(DeliveryUpdate {
                    message_id: frame.message_id,
                    status: "delivered".into(),
                }).await;
            }
            Err(e) => {
                tracing::warn!(err = %e, "stdin write failed — subprocess likely exited");
                let _ = delivery.send(DeliveryUpdate {
                    message_id: frame.message_id,
                    status: "unsupported".into(), // session dead; planner may treat as signal to auto-resume
                }).await;
                break;
            }
        }
    }
    // Dropping stdin closes Claude's input — intentional on graceful shutdown.
}
```

### Pattern 4: Session Exit Detection + Auto-Resume Fallback (D-08 dual)

**What:** Two independent signals observe subprocess lifecycle:
1. `{type:"result", terminal_reason:"completed"}` on stdout = one turn completed, subprocess may or may not exit (it stays alive in persistent stream-json mode).
2. `child.wait()` returning (or stdin write failing with `BrokenPipe`) = subprocess is truly gone.

Mark the `LiveSession` as `archived` on (2); on next `send_chat_message_to_agent` while `archived`, fall back to `claude --resume <session_id> --print "<msg>" --output-format stream-json --verbose`. Capture that subprocess's stdout/stderr as a one-shot stream; flush result into the same `agent_id` thread with a `SESSION_RESUMED · via --resume` `session_boundary` event prepended.

**When to use:** Auto-resume (D-08 fallback). Also used when the user sends a message to an agent whose long-lived subprocess crashed.

**Verified:** `claude --resume <UUID> --print "say RESUMED" --output-format json` succeeds with a single JSON envelope on stdout containing the same `session_id` and `terminal_reason:"completed"`. For stream-json output, pass `--output-format stream-json --verbose` to get incremental deltas; the subprocess then exits cleanly after emitting `{type:"result"}`.

### Pattern 5: MCP Streamable HTTP on the Existing axum Router

**What:** Extend `build_router` in `src-tauri/src/agents/self_register.rs` with three new routes:

```rust
Router::new()
    .route("/register", post(register_agent))                  // Phase 3
    .route("/hook",     post(hook_handler::<R>))               // Phase 8
    .route("/mcp",      post(mcp_post_handler::<R>))           // Phase 10 — MCP JSON-RPC
    .route("/mcp",      get(mcp_get_handler::<R>))             // Phase 10 — MCP SSE upgrade
    .route("/mcp",      delete(mcp_delete_handler::<R>))       // Phase 10 — MCP session teardown
    .layer(...)
```

The MCP JSON-RPC surface for v1:
- `initialize` → return `{protocolVersion, capabilities: {tools: {}}, serverInfo: {name: "aitc-chat", version: "0.1"}}` and set the `Mcp-Session-Id` response header to a fresh UUID tied to the Claude session_id (so the same Claude process always gets the same MCP session back).
- `tools/list` → return the 2-tool surface below.
- `tools/call` → dispatch to the tool impls.
- `notifications/initialized` → ack.

**Tool surface (v1):**

| Tool | Input schema | Behaviour |
|------|--------------|-----------|
| `get_pending_user_messages` | `{}` (no args) | Returns any queued outbound user messages for this MCP session that haven't yet been consumed via stdin. This is the D-08 fallback for when Claude would otherwise idle. Returns `{messages: [{id, content, created_at}]}`. |
| `request_user_input` | `{prompt: string, default?: string}` | Registers an awaiting-user event, fires the OS notification via `dispatch_approval_notification`, and blocks (long-held) until the user responds from the CHAT tab via a new `respond_to_mcp_request` Tauri command. [ASSUMED: long-held pattern mirrors Phase 8 `/hook` — same AbandonGuard + oneshot pattern applies] |

**Per-session MCP config write (D-11):**

Write `<cwd>/.claude/aitc-mcp-config.json` (or a tmp location outside the repo to avoid polluting git) containing:
```json
{
  "mcpServers": {
    "aitc-chat": {
      "type": "http",
      "url": "http://127.0.0.1:<AITC_PORT>/mcp",
      "headers": {
        "X-AITC-Session": "<uuid-per-launch>"
      }
    }
  }
}
```

Launch Claude with `--mcp-config <path> --strict-mcp-config` to scope the server to this launch only and avoid contaminating the user's `~/.claude.json` or `.mcp.json`. **Prefer `--mcp-config` over `claude mcp add --scope local`** — the latter writes to `~/.claude.json` and persists across AITC uninstalls. [VERIFIED: `claude --mcp-config` + `--strict-mcp-config` documented in cli-reference; VERIFIED: MCP docs — local scope is stored in `~/.claude.json`]

### Pattern 6: Reverse Infinite Scroll with TanStack Virtual (D-18)

**What:** The transcript virtualizer runs in reverse orientation — newest event pinned to the bottom, scrolling up triggers `loadOlder(agent_id)`. Use `useVirtualizer` with `count = events.length`, anchor scroll to bottom on mount, observe the first rendered index — when it falls below a threshold (e.g., last 5 items), dispatch a page fetch that prepends older `agent_events` rows to the store.

**When to use:** The main `ChatTranscript` component.

**Example (React):**
```tsx
// Source: tanstack.com/virtual — React Infinite Scroll example,
// adapted for reverse scroll per TanStack/virtual discussion #1013.
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';

export function ChatTranscript({ agentId }: { agentId: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const events = useChatStore((s) => s.events[agentId]) ?? [];
  const loadOlder = useChatStore((s) => s.loadOlder);

  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,     // assistant bubble heuristic; dynamic measurement adjusts
    overscan: 10,
    getItemKey: (i) => events[i].id,
  });

  // Anchor to bottom on initial mount.
  useEffect(() => {
    parentRef.current?.scrollTo({ top: parentRef.current.scrollHeight });
  }, [agentId]);

  // Upward infinite scroll — when the top item is nearly visible, load older.
  useEffect(() => {
    const first = rowVirtualizer.getVirtualItems()[0];
    if (first && first.index < 5 && events.length > 0) {
      loadOlder(agentId, events[0].id);
    }
  }, [rowVirtualizer.getVirtualItems(), agentId, events]);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto min-h-0">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            ref={rowVirtualizer.measureElement}
            data-index={vi.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vi.start}px)`,
            }}
          >
            <EventCard event={events[vi.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Pattern 7: Zustand Per-Agent Event Arrays with Stable Selectors

**What:** `chatStore` keeps `events: Record<AgentId, AgentEvent[]>` and `unread: Record<AgentId, number>`. Selectors must return **same-reference arrays** for unchanged agents — so per-agent event updates only re-render the active agent's transcript, not every agent card.

Use the pattern: `const events = useChatStore(useShallow((s) => s.events[agentId] ?? EMPTY));` where `EMPTY` is a module-level `[]` constant. Alternatively, compose `useChatStore.subscribe` with a selector. [ASSUMED: Zustand 5 supports `useShallow`; verify in planning]

**Why it matters:** With Claude streaming 50+ deltas per second, cascade re-renders across every mounted card would collapse the UI. The `AgentChannelList` must subscribe only to `channels[]`, not the full `events` map.

### Anti-Patterns to Avoid

- **Do not use `tauri-plugin-shell::sidecar` for spawning Claude.** That API is for AITC-owned bundled binaries (like `aitc-hook`). Claude is end-user installed; spawn via `tokio::process::Command` exactly like `launcher.rs::launch_detached` already does.
- **Do not use `claude mcp add --scope local` programmatically.** That writes to `~/.claude.json` and persists. Use `--mcp-config <json> --strict-mcp-config` on the launch command line so the MCP registration is ephemeral to that one launch.
- **Do not parse stream-json on the frontend.** WR-03 / backend-authoritative lock. Parsing 50 deltas/sec in a React state update is a guaranteed jank vector.
- **Do not close stdin between messages.** Doing so terminates the Claude subprocess; new messages would require a full `--resume` relaunch. [VERIFIED empirically: stdin close → Claude emits final `terminal_reason:"completed"` + exits.]
- **Do not flush every token delta to SQLite.** Buffer assistant text in RAM + Zustand, flush one row per turn (D-17). Writes/sec per agent at token granularity would saturate SQLite.
- **Do not render tool-use cards expanded by default.** D-16 lock — collapsed by default, one click to expand.
- **Do not use `react-query` or similar request libraries.** Events are Tauri push, not request/response. Adds bundle weight and cognitive overhead with zero upside.
- **Do not forget the migration is one-shot.** The `006_agent_events.sql` migration runs once; subsequent launches skip the `INSERT ... SELECT` via the standard `migrations` tracking table. Don't add cleanup code that deletes `chat_messages` — leave the table empty for a later Phase (deferred).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| stream-json NDJSON parsing | A streaming JSON parser or hand-written state machine. | `tokio::io::BufReader::lines()` + `serde_json::from_str` per line. | Stream-json is strictly line-delimited JSON; each line is a complete object. `lines()` + `from_str` is two lines of code and handles partial-line buffering correctly. |
| FIFO outbound queue | A hand-written `VecDeque<Mutex<...>>` + semaphore. | `tokio::sync::mpsc::channel(capacity)`. | Used by every other Phase 3-9 subsystem. Natural backpressure, correctness audited by tokio team. [VERIFIED: Cargo.toml already pulls tokio::sync] |
| MCP server protocol state machine | From-scratch JSON-RPC over HTTP with manual session tracking. | Recommended: hand-roll the 3-method surface (initialize, tools/list, tools/call) using existing axum handlers + `Mcp-Session-Id` header. Fallback: `rmcp 1.5` crate with the Streamable-HTTP axum adapter. | The MCP tool surface is small enough that an rmcp dep is overkill for v1, but do *not* invent a transport — use the 2025-03-26 Streamable HTTP contract verbatim. |
| Text highlighting inside assistant bubbles | A regex-matching + span-wrapping highlighter. | `useSyntaxHighlight` (Phase 5, shiki-based) for fenced code blocks; a simple regex `/@user\b/` for `@user` highlighting is acceptable — it's one-token, not multi-line. | Phase 5 already ships it. |
| Message virtualization | A hand-written absolute-positioned scroll container with IntersectionObserver. | `@tanstack/react-virtual` (already in stack). | Already solves reverse-scroll + dynamic measurement + overscan. [VERIFIED: package.json] |
| OS notification dispatch | `tauri-plugin-notification` reinvented. | `dispatch_approval_notification` (Phase 4) — extend the deep-link payload to carry `?tab=chat&agent={agent_id}` for chat notifications. | Identical UX already wired. |
| Session-boundary UI | A per-event "is this the first event after a session boundary?" check in the render path. | Emit an explicit `session_boundary` event into `agent_events` when the stream-json `init` message arrives (`SESSION_STARTED`) and when `child.wait()` returns (`SESSION_ENDED`). | Explicit event row means the transcript is self-describing; no UI-side inference. |
| Approval-request correlation | A lookup table mapping tool invocations to approval rows. | Use the already-present `approval_requests.hook_session_id` + `tool_name` to find the row at write-time; store the `approval_request_id` FK directly on the `agent_events` row at insert-time. | D-14 / D-15 lock; FK-driven. |
| Per-agent unread counts | Compute on every render by filtering events. | Maintain `unread: Record<AgentId, number>` in the store; increment on inbound event when `selectedAgentId !== agentId || !isWindowFocused`; reset on `markRead(agentId)`. | O(1) update, no cost per render. |

**Key insight:** Almost every subsystem in Phase 10 has an exact precedent in Phases 2–9. The novel work is (a) the long-lived subprocess supervisor, (b) the stream-json parser, (c) the MCP server, and (d) the new view surface. Everything else is composition of existing primitives.

---

## Runtime State Inventory

Phase 10 is NOT a rename / refactor / migration-of-strings phase. It IS a migration-of-rows phase (`chat_messages → agent_events`) plus a create-new-tables phase, so the runtime-state categories are partially applicable.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `chat_messages` table in `aitc.db` contains any rows written by Phase 4 chat commands. Schema: `(id, agent_id, direction, content, delivery_status, approval_request_id, created_at)`. | One-shot data migration in `006_agent_events.sql`: `INSERT INTO agent_events (agent_id, session_id, event_type, payload_json, approval_request_id, created_at, sequence_number) SELECT agent_id, NULL, CASE direction WHEN 'outbound' THEN 'user_text' ELSE 'assistant_text' END, json_object('content', content), approval_request_id, created_at, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at) FROM chat_messages;`. Leaves the source table intact but unused. |
| Live service config | None — AITC is a desktop-local app. No cloud-side rename needed. | None. |
| OS-registered state | None. No tray task names, no pm2 processes, no launchd plists touch anything chat-related. | None. |
| Secrets / env vars | None. `AITC_PORT` env var is preserved as-is. No new secrets. | None. |
| Build artifacts | `src/bindings.ts` will regenerate after adding new `#[tauri::command] #[specta::specta]` functions. `cargo build` must pass before bindings regenerate. | Standard `pnpm tauri dev` or `cargo build --manifest-path src-tauri/Cargo.toml` triggers tauri-specta regeneration. No stale artifacts to clean. |

**Nothing found in OS-registered state / secrets:** verified by grep — no `.plist`, no `.service`, no Windows Task Scheduler reference, no pm2 config.

---

## Environment Availability

Only the user's target machine matters for runtime. Planning machine availability is informational.

| Dependency | Required By | Available on Dev Machine | Version | Fallback |
|------------|------------|--------------------------|---------|----------|
| Claude Code CLI (`claude`) | End users at launch-time | ✓ | 2.1.112 | Agent launch fails gracefully with user-visible error (already handled by `launcher.rs`). |
| Node 18+ | Dev only (Vite / TanStack Virtual build) | ✓ | v25+ (see npm output) | n/a — dev dep |
| Rust toolchain (tokio, axum, sqlx, serde_json, tracing, chrono, glob) | Everything backend | ✓ | Workspace already compiles | n/a |
| `rmcp` crate (optional) | Only if planner chooses SDK over hand-roll | ✗ (not installed) | 1.5.0 available on crates.io | Hand-roll is the recommended path; `rmcp` is optional. |
| SQLite (via sqlx) | Data layer | ✓ | — | No fallback; project lock. |

**Missing with no fallback:** None.
**Missing with fallback:** `rmcp` (hand-roll recommended regardless).

**End-user machine note:** The user's `claude` binary must support `--input-format stream-json` + `--output-format stream-json` + `--verbose` + `--mcp-config` + `--strict-mcp-config` + `--include-partial-messages` + `--session-id <uuid>` + `--resume <id>`. All flags verified present in 2.1.112 (`claude --help`). Older Claude Code (pre-2.0) lacks `--mcp-config`. Planner should add a minimum-version check at launch time and surface a friendly error if the installed `claude` is too old (query `claude --version`, parse SemVer).

---

## Common Pitfalls

### Pitfall 1: Turn-Complete Detection Ambiguity

**What goes wrong:** Treating any `{type:"result"}` as "session is done, kill subprocess" — it's actually "this TURN is done". The process stays alive waiting for the next `{type:"user"}` frame on stdin.

**Why it happens:** The terminology `terminal_reason:"completed"` looks like process termination. It's not; it's turn termination within a persistent session.

**How to avoid:** Treat `{type:"result"}` as a TurnComplete signal only. Session ends when `child.wait()` returns OR when stdin write fails with `BrokenPipe`.

**Warning signs:** The subprocess spawning rate grows linearly with messages sent — a tell that each message is triggering a process-restart flow instead of staying in the persistent session.

### Pitfall 2: Hook-Event Leakage into `assistant_text` Events

**What goes wrong:** The `--verbose` flag inlines `{type:"system", subtype:"hook_started" | "hook_response"}` lines into the same stdout stream. If the parser misroutes these into `assistant_text`, they render as "agent messages" polluting the transcript.

**Why it happens:** Both `assistant` and `system` carry non-trivial payloads; a sloppy `type` dispatcher that falls through to `assistant` as default will misclassify.

**How to avoid:** Explicit match on `ty == "assistant"` only; any unknown `type` goes to `system_note` or is dropped with a `tracing::warn!`. (Pattern 2 code above enforces this.)

**Warning signs:** Hook-related JSON shows up rendered as user-facing text in the transcript during the first smoke test.

### Pitfall 3: stdin Write Race with Subprocess Exit

**What goes wrong:** The outbound writer task writes a frame to `child.stdin` while the supervisor task sees `child.wait()` return. The write fails with `BrokenPipe`; if unhandled, the sender's send future never completes and the frame is lost silently.

**Why it happens:** No explicit coordination between writer and supervisor.

**How to avoid:** Wrap every `stdin.write_all` in a `match`; on `BrokenPipe`, immediately emit `DeliveryUpdate { status: "unsupported" }` for that `message_id`, break the loop. The supervisor task meanwhile marks the session archived. The next `send_chat_message_to_agent` call then sees the archived session and routes to the auto-resume fallback.

**Warning signs:** "Message sent" UI state but no `delivered` confirmation; spinning queued forever.

### Pitfall 4: MCP Session-ID Mismatch Between Claude Restart and AITC Restart

**What goes wrong:** Claude caches the MCP `Mcp-Session-Id` from a previous AITC run. After AITC restarts, the MCP server doesn't know that session. Per the MCP spec, a 404 response should force Claude to re-initialize, but timing could race.

**Why it happens:** MCP sessions persist in Claude's session-memory. AITC's MCP state is in-memory and dies with the process.

**How to avoid:** (a) Always serve 404 for unknown `Mcp-Session-Id` — the MCP spec mandates this re-initializes the session from Claude's side. (b) Rotate the AITC port on each launch (the self_register falls back to OS-assigned), so stale URLs fail fast. (c) For the long-lived Claude session, the subprocess dies when AITC dies (because stdin/stdout pipes close), so MCP session staleness is naturally bounded. [CITED: MCP spec 2025-03-26 "When a client receives HTTP 404 in response to a request containing an Mcp-Session-Id, it MUST start a new session"]

**Warning signs:** MCP tool calls return 404 with no recovery.

### Pitfall 5: @user Regex False Positives

**What goes wrong:** The planner's "look for `@user` literal token in assistant text" approach fires on occurrences inside code blocks (e.g., `@user_id = 42` in a SQL snippet) or inside markdown (`See @user docs`).

**Why it happens:** Simple-regex detection doesn't know about code fences.

**How to avoid:** Options in priority order:
1. **Prefer MCP tool `request_user_input`** — unambiguous semantic signal from Claude, no regex heuristic. This is the recommended primary path.
2. Fall back to regex `/(?<!\w)@user(?!\w)/` only at the end of a completed assistant turn (not per-delta).
3. Optionally augment with the `Notification` hook payload's `notification_type:"idle_prompt"` (Claude's own idle signal) — captured via sideband hook.

**Warning signs:** Spurious OS notifications firing mid-conversation when no actual user-input is needed.

### Pitfall 6: WAL Mode Write Contention Under Streaming Load

**What goes wrong:** Every token delta flushed to SQLite saturates the single-writer lock; the main thread stalls while the chat_runtime task is fighting for write access.

**Why it happens:** SQLite has a single-writer lock even in WAL mode; 50 inserts/sec/agent × N agents easily hits contention.

**How to avoid:** Per D-17 (already decided), flush `assistant_text` once per turn or at 250ms idle — not per-delta. Tool-use events are naturally low-frequency (one per tool invocation) and fine to flush immediately. User messages are even lower frequency. This keeps steady-state write rate at ~1-5 rows/sec/agent.

**Warning signs:** UI-side file watcher or other backend tasks stall while a chat is streaming.

### Pitfall 7: Approval-Link Orphan Rows

**What goes wrong:** A Claude tool invocation gates an approval (Phase 8 path), the user denies / abandons, but the `agent_events` tool_use row still has `approval_request_id` pointing at an abandoned approval. Clicking it deep-links to a dead request.

**Why it happens:** `agent_events` records the tool invocation at the moment stream-json emits `{type:"assistant", content:[{type:"tool_use",...}]}`; the approval row's fate is decided later.

**How to avoid:** (a) Live approval_requests table already has a `status` column (`pending`/`approved`/`denied`/`abandoned`). The click handler on `ApprovalLinkCard` should fetch the current status and render the REQUESTS tab with whichever state the request is in — abandoned rows are already grayed out per Phase 8 UX. (b) Optionally, on `approval-resolved` events with `status='abandoned'`, backend could emit an `agent-event-updated` that flips the tool_use card into a "request was abandoned" visual. Deferred to planner's discretion.

**Warning signs:** Clicking `→ APPROVAL_42` lands the user on an empty-state or missing-row REQUESTS view.

### Pitfall 8: Zustand Selector Cascades on Streaming Updates

**What goes wrong:** Every `agent-event-appended` event triggers a full `chatStore` update; components subscribing to `events[otherAgentId]` re-render because the parent `events` object got a new reference.

**Why it happens:** Default Zustand selectors use `Object.is` equality; replacing `events` replaces the reference.

**How to avoid:** Use `useShallow` (Zustand 5) for any component reading `events[agentId]`, or subscribe to the specific agent's array via a selector. Use `useChatStore.subscribe` for imperative updates (e.g., scroll-to-bottom) to avoid re-render entirely.

**Warning signs:** Frame drops when one agent is streaming while five other agents are visible in the master list.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Frontend framework | Vitest 3.x (with @testing-library/react, jsdom) — project lock [VERIFIED: package.json] |
| Backend framework | `cargo test` with `tokio::test`, `tauri::test::mock_app`, `sqlx::sqlite::SqlitePoolOptions` — project lock |
| Config file | `vite.config.ts` (Vitest config embedded) / `Cargo.toml` [tests] target |
| Quick run command (frontend) | `npm test -- --run src/stores/__tests__/chatStore.test.ts src/components/chat/__tests__/*.test.tsx` |
| Quick run command (backend) | `cargo test --manifest-path src-tauri/Cargo.toml chat_runtime::` |
| Full suite | `npm test -- --run && cargo test --manifest-path src-tauri/Cargo.toml --workspace` |

### Phase Requirements → Test Map

| Req / Decision | Behavior | Test Type | Automated Command | File |
|----------------|----------|-----------|-------------------|------|
| D-06 | `claude --input-format stream-json` subprocess stays alive across turns | integration (backend, real subprocess) | `cargo test --manifest-path src-tauri/Cargo.toml chat_runtime::test_long_lived_session -- --ignored` (ignored by default, run against real claude binary in CI matrix where available) | `src-tauri/src/chat_runtime/tests.rs` |
| D-07 primary | `stream_json_reader` parses init, assistant, stream_event, result envelopes into `StreamEvent` correctly | unit | `cargo test --manifest-path src-tauri/Cargo.toml chat_runtime::parser::tests` | `src-tauri/src/chat_runtime/parser.rs #[cfg(test)]` |
| D-08 outbound | Single `send_chat_message_to_agent` writes one stream-json frame to `child.stdin` and emits `delivery=delivered` | unit (with mock stdin) | `cargo test --manifest-path src-tauri/Cargo.toml chat_runtime::outbound::tests::writes_frame_per_message` | `src-tauri/src/chat_runtime/outbound.rs #[cfg(test)]` |
| D-08 auto-resume | When `LiveSession::archived`, `send_chat_message_to_agent` falls back to `claude --resume --print` | unit (with mocked launcher) | `cargo test --manifest-path src-tauri/Cargo.toml chat_runtime::auto_resume_on_archived` | `src-tauri/src/chat_runtime/supervisor.rs #[cfg(test)]` |
| D-10 FIFO | Two messages queued before the first is delivered → second waits for the first | unit | `cargo test chat_runtime::outbound::tests::fifo_ordering` | — |
| D-11 MCP | `POST /mcp` with an `initialize` JSON-RPC returns `Mcp-Session-Id` header and `{protocolVersion,...}` body | integration (axum test server) | `cargo test --manifest-path src-tauri/Cargo.toml mcp::tests::initialize_sets_session_header` | `src-tauri/src/mcp/tests.rs` |
| D-11 MCP 404 | `POST /mcp` with unknown `Mcp-Session-Id` returns 404 | integration | `cargo test mcp::tests::unknown_session_returns_404` | — |
| D-11 tool call | MCP `tools/call` on `get_pending_user_messages` returns queued messages | integration | `cargo test mcp::tests::get_pending_messages_returns_queued` | — |
| D-12 raw stdout | `claude`-other adapter's stdout lines insert `raw_stdout` events | unit | `cargo test chat_runtime::test_raw_stdout_capture_for_codex` | — |
| D-13 event types | Each event_type has a unique rendered component | unit (RTL) | `npm test -- src/components/chat/__tests__/EventCard.test.tsx` | `src/components/chat/__tests__/EventCard.test.tsx` |
| D-14 migration | Running migration 006 on a DB with existing `chat_messages` moves rows into `agent_events` | unit (sqlx in-memory) | `cargo test db::migrations::tests::phase_10_chat_message_migration` | `src-tauri/src/db/events.rs #[cfg(test)]` |
| D-15 approval_link FK | `tool_use` event with approval_request_id renders `→ APPROVAL_{id}` pill that links to `?tab=requests&request={id}` | unit (RTL) | `npm test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | — |
| D-16 collapse/expand | ToolUseCard toggles expanded state on click | unit (RTL with Motion) | `npm test -- ToolUseCard.test.tsx` | — |
| D-17 streaming | `AssistantTextCard` in `streaming` status renders blinking cursor; flushes to DB on TurnComplete | unit + integration | `npm test -- AssistantTextCard.test.tsx` / `cargo test chat_runtime::flush_on_turn_complete` | — |
| D-18 retention / infinite scroll | TanStack Virtual loads older page when scrolled near top | unit (RTL) | `npm test -- ChatTranscript.test.tsx` | — |
| D-19 tab state | `?tab=chat` renders ChatView, `?tab=requests` preserves existing behaviour | unit | `npm test -- CommsView.test.tsx` | — |
| D-20 MasterDetailShell widths | `<MasterDetailShell railWidth={280} detailWidth="flex">` applies correct widths | unit (DOM snapshot) | `npm test -- MasterDetailShell.test.tsx` | — |
| D-21 deletions | Phase 4 `ChatThread` / `ChatInput` / `MiniChatCard` no longer imported anywhere | static (grep) | `! grep -rn "from.*ChatThread\|from.*MiniChatCard" src/ --include='*.tsx' --include='*.ts'` — should return empty | manual grep assertion in Plan verification |
| D-22 unread counts | Incoming event on unselected agent increments unread; `markRead` resets | unit | `npm test -- chatStore.test.ts::unread_counter` | — |
| D-23 @user notification | `dispatch_notification` fires only on matching regex / MCP tool call | integration | `cargo test chat_runtime::at_user_mention_fires_notification` | — |
| D-24 backend-side capture | chat_runtime keeps streaming even when no frontend subscriber | integration | `cargo test chat_runtime::captures_without_subscriber` | — |

### Sampling Rate

- **Per task commit:** `npm test -- --run src/{stores,components/chat}/__tests__/` (≤ 10s) and `cargo test chat_runtime:: mcp:: db::events::` (≤ 30s).
- **Per wave merge:** `npm test -- --run && cargo test --manifest-path src-tauri/Cargo.toml --workspace` (≤ 4 min cold).
- **Phase gate:** Full suite green + manual UAT checkpoint against `10-UI-SPEC.md` (planner decides on checkpoint scope).

### Wave 0 Gaps

- [ ] `src-tauri/src/chat_runtime/mod.rs` + `types.rs` — module scaffold.
- [ ] `src-tauri/src/chat_runtime/parser.rs` — stream-json parser with `#[cfg(test)]` suite seeded by captured envelope fixtures.
- [ ] `src-tauri/src/chat_runtime/tests.rs` — integration harness.
- [ ] `src-tauri/src/mcp/mod.rs` + `streamable_http.rs` + `tools.rs` — MCP server scaffold.
- [ ] `src-tauri/src/db/events.rs` — `agent_events` read/write helpers.
- [ ] `src-tauri/src/db/migrations/006_agent_events.sql` — new table + one-shot migration.
- [ ] `src/stores/chatStore.ts` — Zustand store skeleton.
- [ ] `src/hooks/useChatChannel.ts` — mirror `useClaudeResourcesChannel` shape.
- [ ] `src/components/chat/` directory with stub exports for all components listed in UI-SPEC.
- [ ] `src/views/CommsHub/ChatView.tsx` — top-level CHAT tab component.
- [ ] `src/components/ui/CommsTabBar.tsx` + `UnreadBadge.tsx`.
- [ ] Test fixture: captured stream-json envelope at `src-tauri/tests/fixtures/stream_json_single_turn.jsonl` (copy from empirical capture above).
- [ ] Framework install: none — Vitest and cargo test already present.

---

## Code Examples

### Streaming envelope fixtures (copy into test fixtures)

```jsonl
// Source: empirical capture 2026-04-17 against Claude Code 2.1.112
{"type":"system","subtype":"init","cwd":"/tmp","session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7","tools":["Bash","Edit","Read","Write","..."],"mcp_servers":[],"model":"claude-opus-4-7[1m]","permissionMode":"default","claude_code_version":"2.1.112","uuid":"855e569a-..."}
{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-4-7","id":"msg_017pTBm93vejH2pi8QVfg18p","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{...}}},"session_id":"0d836c4f-..."}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"0d836c4f-..."}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"O"}},"session_id":"0d836c4f-..."}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"K"}},"session_id":"0d836c4f-..."}
{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_017pTBm93vejH2pi8QVfg18p","type":"message","role":"assistant","content":[{"type":"text","text":"OK"}],...},"session_id":"0d836c4f-..."}
{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"0d836c4f-..."}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null,"stop_details":null},"usage":{...}},"session_id":"0d836c4f-..."}
{"type":"stream_event","event":{"type":"message_stop"},"session_id":"0d836c4f-..."}
{"type":"result","subtype":"success","is_error":false,"duration_ms":2223,"num_turns":1,"result":"OK","stop_reason":"end_turn","session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7","total_cost_usd":0.299,"terminal_reason":"completed"}
```

### SQLite migration (verified schema shape)

```sql
-- Source: 10-CONTEXT.md D-14 + project migration precedent (003_comms_chat.sql, 005_pretool_use_hooks.sql)
-- File: src-tauri/src/db/migrations/006_agent_events.sql

CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    approval_request_id INTEGER REFERENCES approval_requests(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sequence_number INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_events_agent_time
    ON agent_events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq
    ON agent_events(session_id, sequence_number);

-- One-shot migration from chat_messages (D-21).
-- Leaves source rows intact; future cleanup phase may drop the table.
INSERT INTO agent_events (agent_id, session_id, event_type, payload_json, approval_request_id, created_at, sequence_number)
SELECT
    agent_id,
    NULL,
    CASE direction WHEN 'outbound' THEN 'user_text' ELSE 'assistant_text' END,
    json_object('content', content),
    approval_request_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at)
FROM chat_messages;
```

### Tauri command (send_chat_message_to_agent) — shape only

```rust
// Source: pattern derived from src-tauri/src/comms/commands.rs::approve_request
#[tauri::command]
#[specta::specta]
pub async fn send_chat_message_to_agent<R: tauri::Runtime>(
    agent_id: String,
    content: String,
    pool: tauri::State<'_, sqlx::SqlitePool>,
    sessions: tauri::State<'_, Arc<chat_runtime::LiveSessionRegistry>>,
    app: tauri::AppHandle<R>,
) -> Result<i64, String> {
    // 1. Insert user_text row; capture id and session_id.
    let (message_id, session_id) = crate::db::events::insert_user_text(
        &pool, &agent_id, &content,
    ).await?;

    // 2. Look up the agent's live session.
    let session = sessions.get(&agent_id).await;

    match session {
        Some(s) if !s.is_archived() => {
            // 3a. Live path: push onto outbound mpsc. Delivery confirm fires async.
            s.send_outbound(chat_runtime::OutboundFrame { message_id, content })
                .await
                .map_err(|e| format!("outbound enqueue failed: {e}"))?;
        }
        _ => {
            // 3b. Archived path: --resume --print fallback.
            chat_runtime::auto_resume_send(&agent_id, &content, session_id.as_deref(), &app, &pool).await?;
        }
    }

    // 4. Emit the optimistic row to the frontend.
    let _ = app.emit("agent-event-appended", serde_json::json!({
        "agent_id": &agent_id,
        "message_id": message_id,
    }));

    Ok(message_id)
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `claude -p "prompt"` one-shot subprocess | `claude --input-format stream-json --output-format stream-json` long-lived session | Claude Code v1.x → v2.x (stabilized alongside `--include-partial-messages` and `--replay-user-messages`) | Enables persistent chat without fork/exec overhead per message. |
| `claude mcp add` per-user MCP state | `--mcp-config <json> --strict-mcp-config` per-launch | Claude Code ≥ 1.x | Ephemeral MCP registration without polluting `~/.claude.json`. Critical for a desktop app that shouldn't leave user state behind. |
| HTTP+SSE dual-endpoint MCP transport (2024-11-05 spec) | Streamable HTTP single-endpoint transport (2025-03-26 spec) | Spring 2025 | One endpoint, POST = JSON-RPC, GET = SSE subscription, DELETE = session teardown. Simpler and currently the officially recommended transport. [CITED: MCP spec 2025-03-26] |
| SessionStart hooks installed via settings.local.json | SessionStart events inlined in stream-json stdout with `--verbose` | Claude Code 2.x | AITC can sideband lifecycle metadata WITHOUT installing yet another hook — just parse the `{type:"system", subtype:"hook_started", hook_name:"SessionStart:..."}` lines already in stdout. Installed hooks remain the authoritative path for custom hook scripts. [VERIFIED empirically] |
| Legacy `chat_messages` table (Phase 4) | `agent_events` transcript table (Phase 10) | This phase | Richer event vocabulary, forward-extensible `event_type`, explicit session_id + sequence_number for ordering stability across stream reconnects. |

**Deprecated / outdated:**
- Claude Code SSE MCP transport (`--transport sse`) — warned as deprecated by the official docs; use HTTP transport. [CITED: code.claude.com/docs/en/mcp]
- Phase 4's `ChatThread` / `MiniChatCard` embedded chat — explicitly replaced (D-21).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hand-rolling the MCP server is a better v1 choice than adopting `rmcp`. | Standard Stack / Patterns | If the tool surface grows quickly, we re-implement work the SDK already does. Mitigation: keep the MCP module boundaries clean so swapping in `rmcp` later is a module-scale change. |
| A2 | Zustand 5 `useShallow` is available and adequate for per-agent selector stability. | Pitfalls / Anti-Patterns | If not, alternative is a hand-written `subscribe` pattern; minor refactor. |
| A3 | MCP `request_user_input` long-hold pattern mirrors Phase 8 `/hook` (AbandonGuard + oneshot). | Pattern 5 | If the MCP client disconnects differently, AbandonGuard may fire incorrectly. Mitigation: hold the hold for a conservative timeout (e.g., 5 min) before abandoning, with explicit user-action-completed signalling from the frontend. |
| A4 | TanStack Virtual's reverse-scroll anchoring works smoothly with dynamic-height measurements for chat bubbles + tool-use expand/collapse. | Pattern 6 | If scroll jumps occur during heavy streaming, may need to implement `scrollMargin` or pin-to-bottom heuristics. TanStack virtual discussion #1013 confirms this works but is non-trivial; allocate a small polish buffer in Wave 3. |
| A5 | Auto-resume via `claude --resume <uuid> --print "<msg>"` appends to the same session file and preserves full context. | Pattern 4 | Session-continuity-across-resume is a documented feature but the corner cases (concurrent resumes, deleted project dir) are not fully tested here. Mitigation: display a clear `SESSION_RESUMED · via --resume` session_boundary event so the user knows what happened. |
| A6 | The `@user` regex heuristic is a reasonable fallback if MCP `request_user_input` isn't adopted by the Claude system prompt. | Pitfall 5 | False positives lead to noisy notifications. Mitigation: end-of-turn-only matching; start disabled and enable after the MCP path is proven. |
| A7 | Rust `rmcp 1.5` alpha-grade status. | Standard Stack alt | Version churn risk. Mitigation: hand-roll path sidesteps this entirely. |
| A8 | Windows `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS` flags don't interfere with piped stdio (the existing `launch_detached` succeeds without issues). | Pattern 1 | If the detached flag prevents pipe inheritance on Windows, the launcher variant may need different flags. Mitigation: test on Windows before finalizing launcher variant (Plan 01 Wave 0 smoke). |

---

## Open Questions (RESOLVED)

All four open items are resolved below. Each resolution is authoritative for Phase 10 execution. Re-opens require a new RESEARCH delta before modifying plans.

1. **Does the Claude Code `--verbose` stream continue to inline `Notification`-class hook events when they fire mid-session (e.g., idle_prompt), or only at SessionStart?**
   - What we know: Empirically, SessionStart `hook_started`/`hook_response` lines appear in `--verbose` output at startup. The `--include-hook-events` flag also exists for broader hook surfacing.
   - RESOLVED: Plan 02 executes a 5-minute smoke during Wave 1 development (long-session `claude -p --input-format stream-json --output-format stream-json --include-hook-events`, provoke a permission-prompt tool call without `--dangerously-skip-permissions`) to verify `Notification` events appear in stdout. If they do, AITC's `chat_runtime::parser` handles them inline and NO file-based hook install is needed for chat. If they do NOT, `Notification` hook is installed via `hook_install.rs` (merge-safe upsert) with the sidecar forwarding to a new `/hook/notification` route. Default assumption for planning: `--include-hook-events` surfaces them inline (matches SessionStart precedent) — Plan 02's smoke test is a confirm-or-correct step, not a scope blocker. If the smoke flips the assumption, Plan 04 absorbs the hook install as an additive task.

2. **Does `--strict-mcp-config` completely suppress the user's existing `.mcp.json` and `~/.claude.json` MCP servers, or only override them by name?**
   - What we know: Docs say "Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations." [CITED: CLI reference]
   - RESOLVED: Treat the docs statement as authoritative — `--strict-mcp-config` suppresses all other sources. Plan 02 uses the unique MCP server name `aitc-chat` (no plausible collision) and passes `--strict-mcp-config` on every launch. No additional runtime check; if a user plugin collides (unlikely), Plan 04 auto-terminate and log `MCP_NAME_COLLISION` as a Claude's-Discretion error path.

3. **What exactly triggers `terminal_reason:"completed"` vs other terminal reasons?**
   - What we know: `completed` fires on clean turn end with `stop_reason:"end_turn"`. Presumably other reasons exist (`max_turns`, `error`, user abort).
   - RESOLVED: Parse defensively. `chat_runtime::parser` treats ANY `{type:"result"}` envelope as a `TurnComplete` event regardless of `terminal_reason` value. The `terminal_reason` string is passed through verbatim to `agent_events.payload_json` for UI surfacing (`SESSION_ENDED · <reason>` per 10-UI-SPEC Session Boundary copywriting). No enum exhaustiveness is required in the Rust side — `String` with `_ =>` fallback on any reason-based UI switch.

4. **How does MCP session teardown behave when the Claude subprocess exits unexpectedly (without sending DELETE /mcp)?**
   - What we know: The MCP spec says clients SHOULD send DELETE when leaving; it's not mandatory.
   - RESOLVED: Low-priority cleanup. v1 ships without the 15-minute idle sweep; orphan MCP sessions accumulate but are bounded by the number of Claude launches per AITC session (small — single-digit typical). Plan 03 does NOT implement the sweep. If orphan accumulation becomes a problem in practice, add the sweep in a follow-up Phase 11+ task. Recorded as a deferred operational cleanup in 10-CONTEXT.md (already covered by "Supervisor/restart policy" Claude's-Discretion line).

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | AITC is single-user + localhost. MCP endpoint binds to 127.0.0.1 only (precedent: `self_register.rs`); no authn layer beyond loopback isolation. |
| V3 Session Management | yes | MCP `Mcp-Session-Id` header is a UUIDv4 generated server-side; return 404 on unknown session (spec-mandated). [CITED: MCP spec 2025-03-26] |
| V4 Access Control | yes | `request_user_input` MCP tool long-holds until the user explicitly responds from the CHAT tab; no other actor can respond. Waiter-registry pattern from Phase 8 (same AbandonGuard model). |
| V5 Input Validation | yes | Chat messages serialized via `serde_json` — inputs must be UTF-8 strings; maximum per-message length enforced (recommend 256 KiB per frame to match the Phase 8 2 MiB body cap scaled for chat). |
| V6 Cryptography | no | No cryptographic material in scope; all local-loopback. |
| V9 Communications | yes | All MCP traffic is loopback (127.0.0.1). No TLS required. |
| V12 Files and Resources | yes | Per-session MCP config written atomically (tmp + rename), same as `hook_install.rs`. |

### Known Threat Patterns for Phase 10

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt-injection via `raw_stdout` from Codex/OpenCode causing the user to click into a faked approval link | Spoofing | Render `raw_stdout` / `raw_stderr` events in a visually-distinct surface (per UI-SPEC: `bg-surface-container-lowest`, no bubble chrome, Data font). `ApprovalLinkCard` uses backend-provided `approval_request_id` only — user-facing "APPROVAL_REQUIRED" text in raw stdout is rendered as plain text, not as a clickable card. |
| Disk-full or write-failure on per-session MCP config file leaking privileged state | Information Disclosure / Tampering | Atomic tmp-rename write (never a partial file). Delete on session end. [VERIFIED: hook_install.rs precedent] |
| Long-running MCP session leaking user messages to a stale Claude subprocess after AITC restart | Information Disclosure | Rotate AITC port on restart (already true — OS-assigned fallback). Return 404 on unknown session_id. Clean up MCP session state on subprocess exit. |
| `send_chat_message_to_agent` called with enormous content payload DOS'ing SQLite or stdin | DoS | Enforce a `const MAX_CHAT_MESSAGE_BYTES: usize = 256 * 1024;` at the Tauri command boundary; reject longer messages with a clear UI error. |
| Tool-use `approval_link` FK referencing abandoned rows misleads user into thinking an action is still pending | Repudiation / UI confusion | ApprovalLinkCard fetches current status before routing; abandoned/resolved rows render grayed-out per Phase 8 convention. |
| Malformed stream-json chunk causing panic in parser | DoS | Parser MUST NOT panic on invalid JSON — only `tracing::warn!` + skip. Tests include a fuzz case with intentionally-malformed lines. (See Pitfall "Hook-Event Leakage" + Pattern 2 code.) |

---

## Sources

### Primary (HIGH confidence — verified empirically or on official docs)

- **Empirical capture** — `/tmp/streamtest.sh` against `claude` 2.1.112 installed at `/home/prannayag/.local/bin/claude`; captured output at `~/.claude/projects/-home-prannayag-pragnition-htx-aitc/1dbfd328-.../tool-results/bis38v7gr.txt` (single-turn) and `bxid2rw6n.txt` (multi-turn persistence, two `{type:"result"}` envelopes on the same session_id).
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — all flag semantics (`--input-format`, `--output-format`, `--verbose`, `--include-partial-messages`, `--replay-user-messages`, `--mcp-config`, `--strict-mcp-config`, `--resume`, `--session-id`, `--fork-session`).
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — full event list including UserPromptSubmit, SessionStart (with `source: "startup"|"resume"|"clear"|"compact"`), SessionEnd (with `why_session_ended`), Stop, Notification (with `notification_type: "permission_prompt"|"idle_prompt"|"auth_success"|"elicitation_dialog"`), PreToolUse/PostToolUse, TeammateIdle (closest idle-detect signal).
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — `claude mcp add` subcommand, scopes (local/project/user), transports (stdio/http/sse), `.mcp.json` format, per-project config, precedence rules, plugin MCP configs.
- [Model Context Protocol spec 2025-03-26 — Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — Streamable HTTP endpoint contract, `Mcp-Session-Id` header, 404-on-unknown-session mandate, POST/GET/DELETE verbs.
- **Codebase precedent** — `src-tauri/src/agents/launcher.rs` (launch_detached + spawn_stdout_reader), `src-tauri/src/agents/self_register.rs` (axum build_router pattern, `/hook` long-held HTTP), `src-tauri/src/agents/hook_waiters.rs` (waiter registry + oneshot pattern), `src-tauri/src/agents/hook_install.rs` (atomic merge-safe JSON writer), `src-tauri/src/db/migrations/003_comms_chat.sql` + `005_pretool_use_hooks.sql`, `src/stores/commsStore.ts`, `src/hooks/usePipelineChannel.ts`, `src/components/layout/MasterDetailShell.tsx`, `src/views/CommsHub/ToolPreview/` registry.

### Secondary (MEDIUM confidence — cross-verified multiple sources)

- [GitHub issue anthropics/claude-code#24594](https://github.com/anthropics/claude-code/issues/24594) — confirms stream-json format is undocumented, cross-referenced by the fact that we captured it empirically.
- [TanStack/virtual Discussion #1013](https://github.com/TanStack/virtual/discussions/1013) — reverse-scroll + dynamic-size messaging UI pattern.
- [tokio::process::Command docs](https://docs.rs/tokio/latest/tokio/process/struct.Command.html) — piped stdio, `child.stdin.take()`, `AsyncWriteExt::write_all`.
- [MCP Rust SDK (rmcp) crates.io page](https://crates.io/crates/rmcp) — version 1.5.0, axum Streamable-HTTP server adapter.
- [Shuttle blog — How to Build a Streamable HTTP MCP Server in Rust (2025-10-29)](https://www.shuttle.dev/blog/2025/10/29/stream-http-mcp) — concrete axum+rmcp example.

### Tertiary (LOW confidence — used only where nothing better exists)

- [Medium: Reverse Infinite Scroll in react using TanStack Virtual (Rahul Moghariya)](https://medium.com/@rmoghariya7/reverse-infinite-scroll-in-react-using-tanstack-virtual-11a1fea24042) — implementation hints; only a starting point.
- [GitHub issue ruvnet/ruflo — Stream-JSON Chaining wiki](https://github.com/ruvnet/ruflo/wiki/Stream-Chaining) — third-party stream-json schema description; consistent with empirical capture.

---

## Metadata

**Confidence breakdown:**
- Stream-json wire format: HIGH — captured empirically, cross-verified with GitHub issue #24594 and third-party wiki.
- Claude Code hooks surface: HIGH — official docs + empirical SessionStart inline in stdout.
- MCP server contract: HIGH — 2025-03-26 spec + Claude Code `claude mcp` CLI verified locally.
- Long-lived subprocess lifecycle: HIGH — verified empirically (two-turn persistence).
- `--resume --print` semantics: HIGH — verified empirically against a captured session_id.
- Tauri v2 subprocess piping: HIGH — existing `launcher.rs` already demonstrates the pattern.
- `agent_events` migration + schema: HIGH — derived directly from CONTEXT D-14 + codebase migration precedents.
- Reverse-scroll TanStack Virtual: MEDIUM — pattern exists and is documented but has known scroll-anchor edge cases; allocate polish buffer.
- MCP hand-roll vs `rmcp`: MEDIUM — recommendation based on tool surface size; can pivot.
- `@user` / awaiting-user signal detection: MEDIUM — MCP tool is the clean path; regex fallback is heuristic.
- Windows piped-stdio + DETACHED_PROCESS interaction: MEDIUM — existing code detaches but this phase keeps the subprocess parented; planner should smoke-test on Windows.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (fast-moving area — stream-json is officially undocumented; check for new docs at monthly cadence).
