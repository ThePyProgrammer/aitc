# Phase 6: Pipeline Activation + Integration Wiring - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect all cross-phase integration points so the app works end-to-end: file watcher pipeline activates from the UI when a repository is opened, passive agent detection bridges ProcessSnapshot PIDs to the AgentRegistry, session file tracking populates via the Rust pipeline, and the radar treemap displays live file tree data while a watch is active.

This phase wires existing backend commands to existing frontend stores/hooks. No new major features — pure integration and activation of what Phases 1-5 built.

</domain>

<decisions>
## Implementation Decisions

### Repo Open Flow
- **D-01:** Auto-detect git repo root from CWD on startup. If CWD is not a git repo, show a native folder picker dialog as fallback.
- **D-02:** Persist last-opened repo path across app launches (SQLite or local config). On next launch, auto-open the persisted repo unless CWD points to a different git repo.
- **D-03:** Provide a "Change repo" option (sidebar or title bar) to switch repos without restarting the app. Stops current watch, opens picker, starts new watch.

### Pipeline Activation
- **D-04:** Auto-start file watcher when a repo is opened, with a pause/resume toggle. User can pause monitoring (useful during large git operations) and resume without losing pipeline state.
- **D-05:** Claude's Discretion — mount point for `usePipelineChannel`. Claude decides where to wire the hook (App-level root vs. dedicated provider) during planning, ensuring the pipeline persists across view navigation.

### PID-to-Agent Bridging
- **D-06:** Passively-detected PIDs from ProcessSnapshot appear as "unidentified" agents on the radar and tower manifest — NOT auto-registered with derived names. They show as unnamed dots until the agent self-registers via HTTP.
- **D-07:** When a self-registered agent's PID matches a previously passive-detected PID, merge the entries into one. No duplicate agents in the tower manifest.

### Live Data Refresh
- **D-08:** Radar treemap updates are event-driven from the pipeline. When `pipelineStore` ingests file events, `radarStore` reacts to update affected tree nodes. No polling — changes appear immediately via Zustand subscribe() or lightweight effect.
- **D-09:** Session file tracking is backend-driven. The Rust pipeline calls `record_session_file` internally when processing file events — no frontend IPC calls needed. DB stays accurate even if frontend disconnects.

### Claude's Discretion
- D-05 (usePipelineChannel mount point) — Claude has flexibility on exact wiring location.
- Implementation details for pause/resume toggle UI placement.
- Exact mechanism for CWD detection (Tauri API vs. env var).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline Architecture
- `src-tauri/src/pipeline/commands.rs` — Pipeline Tauri commands (start_watch, stop_watch, get_tree_index)
- `src-tauri/src/pipeline/mod.rs` — Pipeline module structure and ActiveWatch lifecycle

### Frontend Integration Points
- `src/hooks/usePipelineChannel.ts` — Existing hook for Channel<T> IPC (defined but never invoked)
- `src/stores/pipelineStore.ts` — Ring buffer store for file events + worktree list
- `src/stores/radarStore.ts` — Tree index data + viewport (currently static fetch on mount)
- `src/stores/agentStore.ts` — Agent list + polling (2s interval via startPolling())

### Agent Detection
- `src-tauri/src/pipeline/snapshot.rs` — ProcessSnapshot with PID allowlist
- `src-tauri/src/agents/` — Agent registry and adapter pattern

### Session/History
- `src-tauri/src/db/` — SQLite schema including record_session_file command

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `usePipelineChannel` hook — fully implemented Channel<T> bridge, just needs to be imported and invoked
- `pipelineStore.ingest()` — ring buffer ingestion already wired to the hook's onmessage callback
- `radarStore.fetchTreeIndex()` — existing IPC call to `get_tree_index`, needs to become reactive
- `agentStore.startPolling()` — 2s polling loop, already works for self-registered agents
- All Tauri commands registered in `lib.rs` with TypeScript bindings generated via tauri-specta

### Established Patterns
- Channel-based IPC (`tauri::ipc::Channel<T>`) for high-throughput streaming (Phase 2 decision — NOT app.emit())
- One Zustand store per domain (Phase 1 pattern)
- Agent adapter trait with GenericAdapter for extensibility (Phase 3)
- Self-registration via HTTP POST to localhost on AITC_PORT (Phase 3)

### Integration Points
- App shell (root component) — where pipeline hook should mount
- TowerControl view — needs to display both self-registered and passive agents
- RadarView — needs reactive tree index updates from pipeline events
- Sidebar/title bar — where repo switch control goes

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-pipeline-activation-integration-wiring*
*Context gathered: 2026-04-12*
