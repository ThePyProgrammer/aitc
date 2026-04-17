# Phase 10: Chat User Interface for Deployed Agents - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a first-class chat UI for AITC-deployed agents so the developer can see every message, tool-use narration, and output in real time and send messages back — without reading subprocess stdout or poking SQLite. Replaces the half-working `ChatThread` / `ChatInput` / `MiniChatCard` buried inside `RequestDetail` (Phase 4 D-13..D-15), with a dedicated chat surface backed by a new `agent_events` transcript model and a long-lived stream-json runtime for Claude Code sessions.

**In scope:**
- New chat surface (tab inside Comms Hub using the Phase 9 `MasterDetailShell` primitive)
- New `agent_events` table + Tauri commands + Zustand store feeding a streaming transcript
- Long-lived interactive Claude Code runtime (`--input-format stream-json --output-format stream-json`) with subprocess stdout capture
- Outbound transport: stdin JSONL frames (primary) + MCP server on the existing self-register axum host (fallback, via lifecycle hooks forcing Claude to poll)
- Inbound transport hybrid: stream-json stdout primary + hook sideband metadata
- Read-only stdout/stderr transcript for Codex / OpenCode / Generic adapters (no outbound)
- Replace and remove Phase 4 embedded chat UI; migrate legacy `chat_messages` into `agent_events`
- Unread badge on the CHAT tab + per-agent unread counts
- OS notifications only on `@-mention` / "awaiting-user" signals
- Auto-resume a new `claude --resume` subprocess when the user sends a message to a session that has exited

**Not in scope (deferred):**
- Chat for passively-detected Claude sessions (carry forward from Phase 8 D-04 semantics; revisit later)
- Multi-pane tiling or unified global feed layouts
- Outbound transport for Codex/OpenCode (no hook/input-stream surface in those tools yet)
- Retention / auto-pruning policies beyond manual "Clear thread"
- Destructive-pattern highlighting inside tool-use cards
- Global `~/.claude/` MCP install (v1 is per-session only)

</domain>

<decisions>
## Implementation Decisions

### Agent Coverage Tier
- **D-01:** Bidirectional chat targets **all AITC-launched agents**. Claude Code gets full duplex (stream-json in/out). Codex / OpenCode / Generic get a read-only transcript from subprocess stdout+stderr capture only. Passively-detected Claude sessions are explicitly out of v1 scope — they would need hook re-install timing that Phase 8 deferred.
- **D-02:** When an agent has no outbound path (Codex/OpenCode/Generic), the chat input is rendered **disabled with a tooltip** explaining why. The agent shows a `READ-ONLY TRANSCRIPT` badge in the master list. Honest expectations; no mystery about why typing doesn't work.
- **D-03:** Chat history is **hybrid: continuous view with session-boundary markers**. Relaunching the same `agent_id` appends a new session segment to the existing thread (agent_events carries `session_id` per row; UI groups by session with visible separators). Matches Slack's day-separator mental model.
- **D-04:** On agent terminate (user click, crash, or completion), the transcript is **archived read-only**: the agent stays in the master list (grayed out), input disabled, transcript viewable. If the user relaunches the same `agent_id`, input reactivates and the new session segment appends to the existing thread (plays with D-03).
- **D-05:** The transcript shows **full narration** — user text, assistant text, tool-use events, and approval-request links — all inline. This is the "stop reading system logs" payoff. Toggleable filtering lives in Claude's Discretion for v1.

### Bidirectional Transport
- **D-06:** Chattable Claude Code sessions run in **long-lived interactive mode**: `claude --input-format stream-json --output-format stream-json`. One subprocess per agent, supervised by AITC's launcher for the lifetime of the agent (no more one-shot `--print` for chattable sessions). This marries streaming stdout (inbound) and stdin JSONL frames (outbound) in one canonical contract.
- **D-07:** **Inbound (Claude → user) is hybrid**:
  - Primary: subprocess stdout as `stream-json` parsed progressively into `agent_events` rows (user turn echo, assistant turn text, tool-use, tool-result).
  - Sideband: Claude Code hooks (planner to verify which — candidates: `UserPromptSubmit`, `Stop`, `Notification`, `SessionStart/End`) POST to the Phase 8 hook sidecar for lifecycle metadata AITC can't derive from stream-json alone (session_id handoff, notification events, clean termination).
- **D-08:** **Outbound (user → Claude) primary transport is stdin JSONL frames** written into the long-lived subprocess. The MCP server (D-11) is the **fallback / catch-all** for cases where Claude would otherwise go idle without consuming the frame — a session lifecycle hook forces Claude to invoke the MCP `get_pending_user_messages` tool at defined points. When the session has already exited (process gone), AITC **auto-resumes** with `claude --resume <session_id> --print "<msg>"` for that specific message, appending the result back into the same `agent_id` thread.
- **D-09:** **Session lifecycle is explicit-only**: the long-lived subprocess runs until the user clicks Terminate in Tower Control, closes AITC, or the process crashes. No idle timeout, no end-of-turn auto-terminate. Mirrors how you'd run Claude Code in a persistent terminal.
- **D-10:** **Outbound backlog is FIFO serial**: each user message becomes one stdin JSONL frame in order. UI renders the user message immediately with `queued` status; flips to `delivered` once the frame is written (and again to `acknowledged`/`consumed` if Claude's turn begins against it). No auto-concatenation, no UI block on pending delivery.
- **D-11:** **MCP server lives on the existing `self_register` axum host** (same port, same process that serves `/register` and `/hook`). Each launched Claude session is wired to this MCP via a per-session `.claude/` config (`claude mcp add` or equivalent JSON config — exact mechanism is planner territory). Single cleanup path, single port, consistent with the Phase 8 sidecar contract.
- **D-12:** **Inbound for Codex/OpenCode/Generic** is raw subprocess stdout+stderr capture, rendered as unstructured transcript lines in the CHAT tab. No per-adapter parser in v1. Each captured line becomes an `agent_events` row with `event_type = raw_stdout` (or `raw_stderr`). The adapter shows the `READ-ONLY TRANSCRIPT` badge (D-02).

### Conversation Model
- **D-13:** The transcript carries four first-class **event types**: `user_text`, `assistant_text`, `tool_use`, `approval_link`. The schema allows additional types (`tool_result`, `session_boundary`, `raw_stdout`, `raw_stderr`, `system_note`) to be added without migration — they render with a generic fallback when unrecognized by the frontend. v1 only requires the first four to render distinctly.
- **D-14:** New table **`agent_events`** with columns: `id INTEGER PRIMARY KEY`, `agent_id TEXT NOT NULL`, `session_id TEXT`, `event_type TEXT NOT NULL`, `payload_json TEXT NOT NULL`, `approval_request_id INTEGER REFERENCES approval_requests(id)` (nullable, used only for `tool_use` / `approval_link`), `created_at TEXT DEFAULT (datetime('now'))`, `sequence_number INTEGER` (monotonic per session, for stream-json ordering stability). Indexed on `(agent_id, created_at)` and `(session_id, sequence_number)`. `chat_messages` is deprecated for chat use in Phase 10 — a one-shot migration moves existing rows into `agent_events` as `user_text` / `assistant_text` events keyed by their original timestamps.
- **D-15:** **Tool-use events are separate transcript entries that link to approval rows** via `approval_request_id` (FK, nullable). An `agent_events` row always records that Claude invoked a tool, regardless of whether it gated an approval. If it did gate, the row carries the FK, and the card links into the approval detail. Decouples transcript persistence from approval-row lifecycle (an abandoned approval still has a transcript entry). Tool-use that did NOT gate (Read/LS/Grep/etc. outside protected paths) still appears in the transcript — that's the "full narration" point from D-05.
- **D-16:** Tool-use events render **collapsed by default**: a one-line card showing `[TOOL_NAME] <file path or input summary>`. Click expands inline to the full preview, reusing the Phase 8 `ToolPreview` registry (`EditPreview`, `BashPreview`, `WritePreview`, `NotebookPreview`, `UnknownToolPreview`, `ProtectedPathPreview`). Keeps the transcript scannable while keeping full fidelity one click away.
- **D-17:** **Assistant text streams token-by-token.** Stream-json chunks parse incrementally; the in-progress assistant event renders with a blinking cursor and updates as chunks arrive. Persistence strategy: buffer in RAM + Zustand, flush to `agent_events` once per turn completion (or on 250ms idle between chunks, whichever first). If AITC crashes mid-stream, the partial turn is lost — acceptable for v1.
- **D-18:** **Retention is indefinite.** `agent_events` rows persist until the user explicitly clicks a per-agent "Clear thread" action. Chat UI uses TanStack Virtual + upward infinite-scroll (load older events on demand, rendering only visible rows). No automatic pruning, no rolling window.

### Chat Surface & Nav
- **D-19:** Primary location is a **new tab inside Comms Hub**: the view gains a top-level `REQUESTS | CHAT` tab switcher. Nav stays flat (no new sidebar entry), and the two sibling views share the Comms mental model ("talking to agents"). Tab state is URL-synced (e.g., `/comms?tab=chat`) so deep-link notifications from other parts of the app can open the right tab.
- **D-20:** The CHAT tab uses the **`MasterDetailShell` primitive from Phase 9**. Left master = agent list (all launched agents ever, grouped by active / archived, with unread counts and last-event preview). Right detail = scrolling transcript + sticky input at bottom. One agent at a time; iMessage/Slack-single-workspace feel.
- **D-21:** **Remove the Phase 4 embedded chat entirely**. Delete `ChatThread`, `ChatInput`, and `MiniChatCard` from `RequestDetail` and `TelemetryPanel`. Update `TelemetryPanel` to drop the `AGENT_CHANNELS` section. Migrate existing `chat_messages` rows into `agent_events` as a one-shot migration; drop or empty `chat_messages` in a later cleanup phase (leave the table but unused for v1). RequestDetail focuses purely on approve/deny/edit going forward.
- **D-22:** **Unread indicators**: the Comms sidebar nav item continues to show the pending-request count (Phase 4), plus a small unread-chat dot when either the CHAT tab or the current request's agent has new events since last view. Inside the CHAT tab, the nav tab label shows `CHAT [N]` where N is the total unread event count across all agents. Each agent in the master list shows its own unread count as a badge. Unread = events arrived while the user was not viewing that agent's transcript. Reuses `PendingCountBadge` / `ConflictNavBadge` patterns.
- **D-23:** **OS notifications for chat only fire on `@-mention` or "awaiting-user" signals.** Every-turn notifications explicitly rejected as noisy. Signal detection is planner territory — candidates: (a) hook emits a `needs_user_input` event; (b) assistant text contains a literal `@user` token; (c) Claude calls the MCP `request_user_input` tool. Reuses Phase 4's `dispatch_approval_notification` plumbing — same deep-link-to-the-specific-agent-thread behavior. Approval notifications (Phase 4/8) continue unchanged.
- **D-24:** **Chat capture runs backend-side regardless of which view is active.** Stream-json parsing, stdout capture, and `agent_events` persistence live in the Tauri backend and emit Tauri events (`agent-event-appended`, `agent-turn-complete`, etc.). A new `chatStore` (Zustand, per-domain pattern from Phase 4) subscribes and maintains per-agent event arrays. UI navigation never affects capture; unread counts accumulate while the view is closed. Matches `pipelineStore` / `conflictStore` / `claudeResourcesStore` patterns.

### Claude's Discretion
- Exact CLAUDE.md or system-prompt text to prime Claude for MCP poll behavior (D-08 fallback path). The MCP-call-forcing hook is the authoritative trigger — the system prompt is belt-and-suspenders and can be tuned in planning.
- Precise stream-json parser details: schema version, partial-fragment reassembly, error recovery on malformed chunks, reconnect behavior if the pipe closes unexpectedly.
- Which Claude Code hooks to actually install for sideband metadata (D-07) — planner verifies current hook availability in Claude Code against the D-07 candidates (`UserPromptSubmit`, `Stop`, `Notification`, `SessionStart/End`) and picks the minimum set that covers session_id capture + graceful termination + @-mention detection (D-23).
- MCP tool names and their JSON schemas beyond the core `get_pending_user_messages`. Candidates: `request_user_input` (to support D-23), `post_assistant_note` (for Claude to annotate the transcript out of band).
- Exact mechanism to detect "session exited" so auto-resume (D-08) knows when to fire: process exit code, stream-json `{type: "result"}` terminal message, or both.
- Supervisor/restart policy if the long-lived subprocess crashes unexpectedly (D-06): auto-restart once with the same `session_id`? Alert the user? Mark session archived?
- `session_id` capture on first launch: parse from stream-json init message, from a stdout banner, or capture via a hook emission (`SessionStart`).
- Exact shape of `agent_events.payload_json` per `event_type`. Suggested baselines: user_text `{content: string}`; assistant_text `{content: string, model?: string}`; tool_use `{tool_name: string, tool_input: object, result?: object}`; approval_link `{approval_request_id: number, tool_name: string, summary: string}`.
- `@-mention` / "awaiting-user" signal convention (D-23): hook-based, text-based, or MCP-tool-based. Planner picks one primary + at most one fallback.
- Master-list sort order in the MasterDetailShell: most-recent-activity (recommended), alphabetical, or by-status. Default likely most-recent-activity.
- Sticky input behavior (autosize, keyboard shortcuts beyond Enter-to-send, Shift-Enter for newline from the existing ChatInput pattern).
- One-shot migration script shape for `chat_messages` → `agent_events` (D-21): where it runs (startup migration in the Rust backend), event_type mapping (direction → user_text/assistant_text), preservation of `approval_request_id` FK.
- Per-session Claude MCP config write location (D-11): `.claude/settings.local.json` (Phase 8 style), `.claude/mcp.json`, or ambient `claude mcp add` CLI invocation at launch.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 10" — User-provided pain statement ("I have to inspect the system logs or some shit") and goal framing
- `.planning/REQUIREMENTS.md` — COMM-04 (freeform text messages to agents — carried forward from Phase 4), no new requirements introduced by Phase 10
- `.planning/PROJECT.md` §"Constraints" — Tauri v2 + React + TypeScript; Windows primary platform; extensible adapter architecture (adapter pattern)

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (badge styling, phosphor accents, mono typography, zero-radius)
- `wireframes/communications_hub/screen.png` — Reference for the 3-panel Comms Hub layout (tab switcher added in D-19)
- `wireframes/communications_hub/code.html` — Comms Hub code reference

### Phase Context (prior decisions that constrain this phase)
- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` — Adapter trait, AgentRegistry, `AITC_PORT` env injection, self-register HTTP server
- `.planning/phases/04-core-ui-views/04-CONTEXT.md` — D-13 dual chat structure (being replaced), D-14 delivery-status semantics (being preserved), D-15 threaded conversations + SQLite persistence (being migrated)
- `.planning/phases/05-conflict-resolution-history/05-CONTEXT.md` — `useSyntaxHighlight` (shiki) for tool-use previews, `HistoryView` pattern for the archived-agent section
- `.planning/phases/06-pipeline-activation-integration-wiring/06-CONTEXT.md` — PASSIVE-{pid} reconciliation, `passive_bridge::bridge_tick` (scope boundary — passive agents OUT of Phase 10)
- `.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/08-CONTEXT.md` — Hook sidecar (`aitc-hook`) binary, waiter registry pattern, `/hook` axum route, `approve_with_edits` flow, `ToolPreview` registry (reused in D-16)
- `.planning/phases/09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b/09-CONTEXT.md` — `MasterDetailShell` primitive (reused in D-20), `claudeResourcesStore` event-emission pattern (analogous to D-24), atomic-write helpers for `.claude/` files (analogous to D-11 MCP config write)

### UI Contract
- `.planning/phases/04-core-ui-views/04-UI-SPEC.md` — Comms Hub visual spec; CHAT tab must extend this
- `.planning/phases/09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b/09-UI-SPEC.md` (if present) — MasterDetailShell spec

### Existing Backend Code
- `src-tauri/src/agents/self_register.rs` — axum router + `Extension` layer; Phase 10 adds MCP endpoint alongside `/register` and `/hook`
- `src-tauri/src/agents/hook_waiters.rs` — Phase 8 waiter registry pattern; analogous pattern for outbound-message waiters if needed
- `src-tauri/src/agents/claude_code.rs` — Claude adapter; `launch()` is rewritten for long-lived stream-json mode in Phase 10
- `src-tauri/src/agents/launcher.rs` — `launch_detached`; needs a variant that pipes stdin+stdout instead of detaching stdio to null
- `src-tauri/src/agents/registry.rs` — AgentRegistry; agent_events rows FK to agent records
- `src-tauri/src/comms/commands.rs` — Existing `send_chat_message`, `list_chat_messages`, `update_message_delivery_status`; replaced / migrated in D-21
- `src-tauri/src/comms/types.rs` — `ChatMessage` struct; new `AgentEvent` / `EventType` types added
- `src-tauri/src/db/migrations/003_comms_chat.sql` — Defines `chat_messages`; Phase 10 adds `006_agent_events.sql` creating `agent_events` and running the migration
- `src-tauri/src/lib.rs` — Command registration; MCP server startup; chatStore event emission

### Existing Frontend Code
- `src/stores/commsStore.ts` — `ApprovalRequest` + legacy `ChatMessage`; Phase 10 adds new `chatStore` for agent_events, removes chat-specific code from commsStore
- `src/views/CommsHub/RequestDetail.tsx` — Remove `ChatThread` + `ChatInput` usages (D-21)
- `src/views/CommsHub/ChatThread.tsx` — Delete after migration
- `src/views/CommsHub/ChatInput.tsx` — Delete after migration (reuse as starting point for new chat input in MasterDetailShell)
- `src/views/CommsHub/MiniChatCard.tsx` — Delete after migration
- `src/views/CommsHub/TelemetryPanel.tsx` — Remove AGENT_CHANNELS section (D-21)
- `src/views/CommsHub/ToolPreview/*` — Phase 8 tool renderers (reused inline in D-16)
- `src/components/ui/MasterDetailShell.tsx` (Phase 9) — Reused in D-20
- `src/components/ui/ScopeChip.tsx`, `UndoToast.tsx`, `ExternalChangeBanner.tsx` (Phase 9) — Reference for new chat-specific micro-components
- `src/components/ui/DeliveryStatus.tsx` — Delivery-status UX (preserved for outbound messages D-10)
- `src/components/ui/StatusBadge.tsx`, `UrgencyBadge.tsx`, `ToolBadge.tsx` — Design-system primitives
- `src/bindings.ts` — Auto-regenerated by tauri-specta after new commands + types

### External Docs (planner will research)
- Claude Code stream-json contract (`--input-format stream-json` / `--output-format stream-json`) — schema, chunk shape, init/terminal messages
- Claude Code hooks reference — current hook names + payload schemas (verify `UserPromptSubmit`, `Stop`, `Notification`, `SessionStart`, `SessionEnd`)
- Claude Code MCP client configuration — `claude mcp add` CLI, `.claude/mcp.json` format, server tool schema
- Claude Code `--resume <session_id>` CLI reference — for the auto-resume fallback (D-08)
- Tauri v2 docs on long-lived subprocess + stdio piping (vs current `launch_detached`)

### Test Infrastructure
- `src-tauri/tests/end_to_end_smoke.rs` — Cross-module smoke pattern; add chat e2e here
- `src/stores/__tests__/commsStore.test.ts` — Zustand testing pattern; replicate for new chatStore
- `src/views/CommsHub/__tests__/*.test.tsx` — Component testing patterns to follow

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MasterDetailShell` (Phase 9) — drop-in layout primitive for the CHAT tab (D-20). Agent list / transcript / sticky input maps directly.
- Phase 8 `ToolPreview` registry (`EditPreview`, `BashPreview`, `WritePreview`, `NotebookPreview`, `UnknownToolPreview`, `ProtectedPathPreview`) — used inline for expanded tool-use cards (D-16).
- Phase 5 `useSyntaxHighlight` (shiki) — for rendering Bash/Write content inside tool-use cards and any code blocks in assistant text.
- Phase 4 `DeliveryStatus` component — preserved for outbound user-message status indicators (queued/delivered) in D-10.
- Phase 8 axum `/hook` router on `self_register.rs` — host the MCP endpoint alongside (D-11). Same port, same `Extension` layer DI pattern.
- Phase 8 `hook_waiters.rs` / waiter-registry pattern — shape for an outbound-message queue per agent (FIFO JSONL frames waiting to be written to stdin).
- `commsStore` Zustand + Tauri event subscription patterns — replicate in a new `chatStore`.
- Phase 9 `atomic_write` + `.claude/` write-fence — pattern for writing per-session MCP config (D-11).
- Phase 4 `dispatch_approval_notification` — reused for chat notifications on awaiting-user events (D-23).
- Phase 9 `ExternalChangeBanner` — pattern if the transcript file ever needs external-change signaling (unlikely in v1 — transcript is DB-backed).
- `PendingCountBadge`, `ConflictNavBadge` — unread count UX (D-22).
- TanStack Virtual (already in stack per PROJECT.md) — upward infinite scroll for transcript (D-18).

### Established Patterns
- **Adapter trait** for per-agent behavior (launch, observe, terminate) — Phase 10 adds inbound/outbound capabilities to the trait (or a capability enum attached to the adapter).
- **axum `Extension` DI** for shared state (registry, pool, waiter registry) — extend with MCP state + chatEventBus.
- **Backend-authoritative writes** for structured events — transcripts are inserted by Rust, frontend only reads + subscribes. Matches the commsStore WR-03 precedent.
- **`#[tauri::command] #[specta::specta]`** with managed State — command surface pattern. New commands: `list_agent_events`, `subscribe_agent_events`, `send_chat_message_to_agent` (replaces legacy `send_chat_message`), `clear_agent_thread`, etc.
- **Tauri `emit`** for push events to frontend — `agent-event-appended`, `agent-turn-started`, `agent-turn-complete`, `agent-session-started`, `agent-session-ended`.
- **Migration-per-feature** in `src-tauri/src/db/migrations/` with `CREATE TABLE` for `agent_events` + `INSERT ... SELECT` for the one-shot `chat_messages` migration (D-21). Suggested name: `006_agent_events.sql`.
- **Store-per-domain Zustand** (`pipelineStore`, `agentStore`, `conflictStore`, `commsStore`, `claudeResourcesStore`) — extend with `chatStore`.
- **`tokio::sync::mpsc`** for async frame queues (outbound JSONL backlog per agent, inbound chunk parser).
- **`tracing`** for structured logging across the long-lived subprocess lifecycle.

### Integration Points
- `self_register.rs::start_registration_server` — add MCP route + extension layer; publish the MCP config path so the Claude launcher can wire it per session.
- `claude_code.rs::launch` — rewrite for long-lived stream-json mode: pipe stdin + stdout, capture `session_id` from init message, register the subprocess handle in a new `chat_runtime::LiveSession` store, start the stream-json parser task.
- `launcher.rs` — add `launch_live_session` alongside `launch_detached` that keeps stdio pipes open and returns handles.
- `comms/commands.rs` — the Phase 4 chat commands become thin wrappers forwarding to the new chat commands (for binding-compat during migration), then removed.
- `RequestDetail.tsx` — remove embedded ChatThread/ChatInput; narrow responsibility to approve/deny/edit surfaces.
- `TelemetryPanel.tsx` — remove `AGENT_CHANNELS` section.
- `src/views/CommsHub/ChatView.tsx` (new) — the CHAT tab's top-level component; hosts MasterDetailShell with agent list + transcript + input.
- `src/stores/chatStore.ts` (new) — per-agent event arrays, subscription, unread counts.
- `src/hooks/useChatChannel.ts` (new) — streaming-subscription hook analogous to `usePipelineChannel`.
- `src/components/chat/*` (new) — `EventCard`, `UserMessageCard`, `AssistantTextCard`, `ToolUseCard`, `ApprovalLinkCard`, `SessionBoundary` (under the chat namespace, not CommsHub, so they're portable if the surface ever moves).

### New Subsystems
- **`src-tauri/src/chat_runtime/`** (or similar) — owns long-lived subprocess supervision, stream-json parser, outbound queue, session_id capture, auto-resume fallback.
- **`src-tauri/src/mcp/`** (or module inside self_register) — AITC-as-MCP-server implementation. Tools: `get_pending_user_messages`, `request_user_input`, possibly `post_assistant_note`.
- **`src-tauri/src/db/events.rs`** — read/write helpers for `agent_events`.

</code_context>

<specifics>
## Specific Ideas

- The phase is fundamentally about replacing a half-working UI (Phase 4's buried ChatThread) with a real one. Treat Phase 4's chat components as scaffolding to be torn down, not a contract to preserve. The one thing to preserve is the DeliveryStatus UX because it sets honest expectations about outbound capability per adapter.
- The long-lived stream-json runtime is a **significant departure** from Phase 3's `launch_detached(stdio=null)`. Planner should flag this in RESEARCH.md and confirm Claude Code's `stream-json` input/output modes are stable enough to build on (not behind an experimental flag).
- MCP-on-self_register is the "already-built HTTP server with shared state" choice — reuses the Phase 8 sidecar lifetime, port cleanup, and waiter-registry plumbing. Per-session MCP config write echoes the Phase 8 `settings.local.json` merge-safe writer pattern (D-01 in 08-CONTEXT).
- `agent_events` is the right primitive — tightly typed `event_type` + JSON payload gives room to add types (tool_result streams, session boundaries, user-edit annotations) without migrations. The `session_id` + `sequence_number` pair anchors ordering stability even across stream-json reconnects.
- Tool-use cards reuse Phase 8's ToolPreview registry, which means new tools added in future (or MCP-provider tools) automatically render in the transcript through `UnknownToolPreview`. Zero extra work for forward compatibility.
- Unread badges on BOTH the Comms nav item (combined: requests + chat) AND the CHAT tab (chat-only) means the user gets the right signal at the right zoom level. Matches the Command Horizon "glanceable → focused" hierarchy.
- OS notifications are deliberately rationed to `@-mention` / awaiting-user signals — every-turn notifications would be worse than silence. This mirrors how Phase 8 scoped its deep-link notifications to blocking approval events only.
- The hybrid-session-tagged history decision (D-03) means a user who relaunches Claude-CC-1 ten times sees one cohesive thread with ten session boundaries — perfect for the "same task across sessions" workflow that triggered this phase's pain point.
- Tearing out the embedded chat (D-21) is non-negotiable for the planner: leaving both chat UIs alive would mean syncing chat_messages and agent_events bi-directionally, which is a bug factory.

</specifics>

<deferred>
## Deferred Ideas

- **Chat for passively-detected Claude sessions** — out of v1 scope (D-01). Would require hook re-install timing that Phase 8 D-04 deferred. Revisit when the passive-hook-install UX is firmed up.
- **Outbound transport for Codex / OpenCode / Generic** — none in v1 (D-12). These tools don't expose a stdin frame protocol or hook surface. Revisit per-adapter as they ship interactive-mode equivalents.
- **Adapter-specific parsers for non-Claude agents** — v1 uses raw stdout/stderr capture (D-12). If Codex/OpenCode start emitting structured output, add parsers then.
- **Multi-pane tiling** and **unified global feed** layouts (Area 4 alternatives to D-20) — single-agent master-detail is the v1 primary. Revisit if users want side-by-side agent comparison in a later phase.
- **Auto-concatenate queued outbound messages** into a single turn (D-10 alt) — rejected for v1 due to context-confusion risk. Serial FIFO only.
- **Auto-prune / rolling-window retention** for agent_events (D-18 alt) — not in v1. Manual "Clear thread" suffices until transcripts become large enough that SQLite feels it.
- **Destructive-pattern highlighting** on tool-use cards (rm / sudo / curl | bash) — out of scope; carries over as a strong Phase 11+ candidate (already deferred from Phase 8).
- **Global `~/.claude/` MCP install** — v1 is per-launched-session MCP config only (D-11). Revisit if users want AITC chat to work when they launch Claude Code manually outside AITC.
- **End-of-turn auto-terminate + auto-resume** session lifecycle (D-09 alt) — rejected. Long-lived sessions are the default.
- **Idle-timeout auto-terminate** (D-09 alt) — rejected. Never close the session without explicit user action.
- **Every-turn OS notifications** (D-23 alt) — rejected as noisy.
- **`chat_messages` hard delete** — Phase 10 deprecates the table but leaves it empty post-migration. A later cleanup phase can drop it.
- **Supervisor-driven restart of crashed long-lived subprocess** — behavior is Claude's Discretion for v1; simple "mark session archived on crash" is an acceptable minimum.
- **In-UI chat search / full-text index** over `agent_events` — out of scope. TanStack Virtual + manual scroll for v1.

</deferred>

---

*Phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s*
*Context gathered: 2026-04-17*
