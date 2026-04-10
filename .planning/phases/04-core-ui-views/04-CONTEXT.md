# Phase 4: Core UI Views - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver two flagship interactive views — Communications Hub (approval queue with code diffs, approve/deny/ask-more-info/approve-with-edit workflow, threaded agent chat) and Airspace Radar (treemap-based spatial codebase map with agent dots on Canvas 2D, zoom/pan navigation, trajectory lead lines) — plus native OS notification delivery for urgent agent events. This phase transforms the app from a monitoring dashboard into an interactive command center.

</domain>

<decisions>
## Implementation Decisions

### Comms Hub Layout
- **D-01:** 3-panel layout matching the wireframe — request queue (left), request detail with code diff (center), telemetry + mini agent chats (right)
- **D-02:** Right panel contains system load metrics (CPU, memory), telemetry feed (connected agents, recent file events), and mini expandable chat cards for each active agent
- **D-03:** Request queue uses color-coded status badges (green/amber/red) indicating urgency, sorted chronologically with most recent at top. Reuses Phase 3 `StatusBadge` component patterns
- **D-04:** Code diffs shown as inline diff with syntax highlighting — green/red highlighted lines in a monospace code block (JetBrains Mono per design system). Matches COMM-03 requirement

### Approval Workflow
- **D-05:** "Approve with edit" (COMM-06) uses inline editing in the diff view — user clicks a line to make it editable, modifies code directly in the approval detail panel, then confirms with "Approve with edits" button
- **D-06:** "Ask for more info" (COMM-02) reveals an inline text input in the detail panel — user types their question, sends it, request stays in pending state
- **D-07:** Approval request sources: Claude Code generates real requests via its hooks system (pre_tool_use interception). Other agents (Codex, OpenCode, generic) get synthetic approval requests when they write to user-configured "protected" paths (e.g., `/src/config.ts`, `/migrations/**`, `/package.json`)
- **D-08:** Approval response delivery: Claude Code receives approve/deny response via hook system (blocks agent until user decides). Other agents: decision is logged in database, OS notification shown, but agent cannot be blocked — approval becomes an audit trail + alert. Display delivery status per agent type

### Radar Spatial Mapping
- **D-09:** Treemap layout algorithm — directories become nested rectangles, files become cells within directory regions. Agent dots positioned on the cells they're actively touching. Matches VIZN-05 "directories = regions, files = points". Powered by Phase 2's file tree index (D-12)
- **D-10:** Agent dots are colored per-agent with subtle pulse animation. Lead lines connect dots to recently-touched files with timestamps (VIZN-02 trajectory). Hover shows tooltip with agent ID, status, active file count, and intent
- **D-11:** Full zoom + pan navigation — mouse wheel to zoom, click-drag to pan. Essential for 10k+ file codebases (VIZN-04). Progressive detail: 1x shows directory labels + agent dots, 3x shows file names + lead lines, 8x shows individual file details + full trajectory
- **D-12:** Right-side collapsible agent manifest panel matching wireframe — lists all agents with status (mini Tower Control). Click agent to highlight on radar. Shows agent details and alert log

### Agent Chat Interface
- **D-13:** Dual chat structure matching wireframe — inline message input at bottom of detail panel for the selected agent/request, plus mini chat cards in the right sidebar showing recent messages from all agents. Click mini card to expand to full chat in detail panel
- **D-14:** Message delivery: Claude Code via hooks system (bidirectional — agent receives in context, can respond via hook output). Other agents: messages queued in AITC database, adapter polls if capable. If agent can't receive, logged as session note. Show delivery status indicator: ✔ delivered | ⏳ queued | ✖ unsupported
- **D-15:** Threaded conversations — full chat thread per agent showing message history in a scrollable timeline with user and agent messages. Messages persist in SQLite for session history (feeds into Phase 5 HIST-03)

### Native OS Notifications
- **D-16:** Implements Phase 3's configurable per-state notification settings (D-09). Fires native OS notifications + system tray alerts when agent requires user action (COMM-05). Ties into the approval request flow — new pending request triggers notification

### Claude's Discretion
- Treemap algorithm specifics (squarified treemap vs strip treemap vs slice-and-dice)
- Canvas 2D render loop optimization (requestAnimationFrame, dirty region tracking, offscreen buffering)
- Protected path configuration UI (simple list editor vs glob pattern builder)
- Chat message persistence schema (new migration for messages table)
- Mini chat card expand/collapse animation treatment
- Telemetry feed data sources and refresh interval
- Color assignment strategy for agent dots (fixed palette vs hash-based)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wireframes
- `wireframes/communications_hub/screen.png` — Communications Hub wireframe (3-panel layout, approval cards, chat interface, telemetry panel)
- `wireframes/communications_hub/code.html` — Communications Hub code reference
- `wireframes/airspace_radar/screen.png` — Airspace Radar wireframe (agent dots on dark space, right-side manifest, trajectory lines)
- `wireframes/airspace_radar/code.html` — Airspace Radar code reference

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (colors, typography, elevation, components, do's/don'ts)

### Technology Stack
- `CLAUDE.md` — Technology stack decisions including Canvas 2D, visx scales, React-Konva for interactive overlays, Motion for animations, TanStack Virtual for large lists

### Existing Backend Code
- `src-tauri/src/agents/mod.rs` — Agent module structure (adapter, registry, launcher, notifications, self-register)
- `src-tauri/src/agents/commands.rs` — Agent Tauri commands (list_agents, launch_agent, terminate_agent, update_agent_intent)
- `src-tauri/src/agents/registry.rs` — Agent registry implementation
- `src-tauri/src/agents/notifications.rs` — OS notification infrastructure
- `src-tauri/src/conflict/mod.rs` — Conflict detection module (engine, types, commands)
- `src-tauri/src/pipeline/events.rs` — FileEvent, FileEventBatch, Attribution types
- `src-tauri/src/pipeline/pipeline_state.rs` — ActiveWatch, PipelineState (file tree index)
- `src-tauri/src/db/migrations/001_initial_schema.sql` — Existing schema (agent_sessions, conflict_events, approval_requests tables)

### Existing Frontend Code
- `src/stores/agentStore.ts` — Agent Zustand store (AgentInfo type, fetchAgents, launchAgent, terminateAgent, polling)
- `src/stores/conflictStore.ts` — Conflict Zustand store (ConflictAlert type, subscribeToEvents, dismissConflict)
- `src/stores/pipelineStore.ts` — Pipeline Zustand store (file event streaming pattern)
- `src/views/CommsView.tsx` — Current placeholder (empty state with blinking cursor)
- `src/views/RadarView.tsx` — Current placeholder (pulse animation with concentric circles)
- `src/views/TowerControl/` — Tower Control components (AgentManifest, AgentRow, ConflictBanner, DeployDialog — reusable patterns)
- `src/components/ui/StatusBadge.tsx` — Status badge component (reuse for approval request badges)
- `src/components/ui/ConflictNavBadge.tsx` — Nav badge pattern (reuse for comms pending count badge)
- `src/components/ui/RadarPulse.tsx` — Radar pulse animation component
- `src/hooks/usePipelineChannel.ts` — Channel-based streaming hook pattern

### Phase Context
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` — Phase 1 decisions (sidebar, command palette, window chrome, system tray)
- `.planning/phases/02-real-time-data-pipeline/02-CONTEXT.md` — Phase 2 decisions (Channel IPC, file tree index on startup — D-12 powers radar)
- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` — Phase 3 decisions (agent registry, adapter architecture, conflict engine, configurable notifications)

### UI Contract
- `.planning/phases/01-foundation-app-shell/01-UI-SPEC.md` — Phase 1 UI design contract (spacing, color tokens, component specs — pattern for Phase 4 UI spec)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StatusBadge` component — reuse for approval request status badges in the queue
- `ConflictNavBadge` — pattern for adding a pending-request count badge on the Comms nav item
- `AgentManifest` / `AgentRow` in TowerControl — reusable for the radar's right-side agent manifest panel
- `DeployDialog` — agent launch dialog, reusable from Comms Hub
- `RadarPulse` — existing pulse animation, can be integrated into radar agent dots
- `agentStore` — already has AgentInfo type, fetchAgents, startPolling — Comms Hub and Radar consume this
- `conflictStore` — already has real-time event subscription via listen() — pattern for approval request events
- `usePipelineChannel` hook — streaming pattern for new approval/chat event channels

### Established Patterns
- **Zustand store per domain:** sidebarStore, paletteStore, pipelineStore, agentStore, conflictStore → new commsStore, radarStore
- **Tauri commands:** `#[tauri::command] #[specta::specta]` with managed state, registered via tauri-specta
- **IPC streaming:** `tauri::ipc::Channel<T>` for high-throughput events (file events) — use for approval request streaming
- **Real-time events:** `listen()` for conflict-detected events — use for approval request notifications
- **Agent polling:** 2s interval via `startPolling()` in agentStore — radar can share this data

### Integration Points
- `src/views/CommsView.tsx` — Replace placeholder with full Communications Hub
- `src/views/RadarView.tsx` — Replace placeholder with Canvas 2D treemap radar
- `src-tauri/src/agents/notifications.rs` — Extend with native OS notification delivery
- `src-tauri/src/db/migrations/` — New migration for approval_requests enrichment and chat_messages table
- `src-tauri/src/agents/commands.rs` — New commands for approval workflow (approve, deny, ask_more, approve_with_edit)
- `src/stores/` — New commsStore.ts (approval queue + chat state), radarStore.ts (spatial layout + viewport state)

</code_context>

<specifics>
## Specific Ideas

- The treemap radar powered by Phase 2's file tree index means no redundant directory scan — the spatial layout data already exists in memory
- Agent manifest panel in the radar mirrors Tower Control data — both consume the same agentStore, keeping state consistent across views
- Inline diff editing for "approve with edit" keeps the user in flow — no modal interruption, modifications happen directly in the code preview
- Delivery status indicators (✔ delivered | ⏳ queued | ✖ unsupported) set honest expectations about chat capabilities per agent type
- Protected path configuration enables synthetic approval requests for non-hook agents, making the Comms Hub useful even when only running Codex/OpenCode
- Mini chat cards in the right sidebar provide ambient awareness of all agent communications without switching contexts

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-core-ui-views*
*Context gathered: 2026-04-10*
