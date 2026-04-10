# Phase 3: Agent Management + Conflict Detection - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver an agent registry with an extensible adapter architecture (Rust trait + config-driven GenericAdapter), agent launch/observe capabilities (detached subprocess + hybrid scan/self-registration), agent state tracking and intent surfacing, and a Rust-powered conflict detection engine that flags overlapping file writes between concurrent agents. This phase makes agents first-class managed entities and enables real-time conflict awareness.

</domain>

<decisions>
## Implementation Decisions

### Agent Adapter Architecture
- **D-01:** Hybrid trait + config pattern — Core `AgentAdapter` Rust trait for complex agent-specific logic (Claude Code, Codex, OpenCode), plus a `GenericAdapter` that reads simpler agent definitions from a config file (JSON/TOML)
- **D-02:** Compiled-in modules only for v1 — all adapters (including GenericAdapter) are compiled into the binary. No dynamic plugin system. Adding a new Rust adapter means a code change + rebuild
- **D-03:** GenericAdapter supports full feature parity — detect, launch, state, and intent via configurable rules (process name patterns, launch commands, regex patterns for state/intent parsing). Not a second-class citizen

### Agent Launch & Observe
- **D-04:** Launch via detached subprocess — spawn agent CLI as a detached child process, track PID, monitor stdout/stderr. Agent survives AITC restart
- **D-05:** Hybrid detection: process scanning as baseline (enhances Phase 2's `ProcessSnapshot` + `AGENT_NAME_ALLOWLIST`), plus optional self-registration via local HTTP endpoint for richer metadata
- **D-06:** Self-registration uses a localhost HTTP server run by AITC. Agents POST metadata on start. Port discoverable via `AITC_PORT` environment variable

### Agent State & Intent
- **D-07:** Adapter-driven state determination — each adapter implements `get_state()`. Rich adapters (Claude Code, Codex, OpenCode) parse agent-specific signals (hooks output, process args, exit codes). Generic adapters use configurable rules (regex on stdout, process alive = Running, exit = Done)
- **D-08:** Hybrid intent surfacing — adapters extract intent automatically when possible (Claude Code hooks → task description, Codex CLI args → prompt, OpenCode config → task). If no intent available (generic agent, parse failure), prompt user to manually label the session
- **D-09:** Configurable per-state OS notifications — user configures which state transitions (Running, Idle, Waiting, Conflict, Error) trigger native OS notifications. In-app indicator updates always happen for all state changes

### Conflict Detection Engine
- **D-10:** Fixed default conflict window (e.g., 5 seconds), user-configurable in settings. Two agents writing the same file within the window = conflict
- **D-11:** Alert via visual badge on Conflicts nav item + conflict row in conflicts list + agent status change to "Conflict" in Tower Control. Plus optional native OS notification (ties into D-09 configurable notification settings). No modal interruption
- **D-12:** Per-file detection granularity with hunk hints — detect at file level (simple, no content diffing), but capture byte ranges or line counts each agent touched when available. Phase 5 merge UI can use these hints for smarter presentation

### Claude's Discretion
- Conflict window default value (5s suggested, Claude can adjust based on research)
- HTTP server framework choice for the self-registration endpoint (e.g., axum, warp, hyper)
- Config file format for GenericAdapter definitions (JSON vs TOML)
- State polling interval for adapter-driven state checks
- Stdout/stderr capture strategy for launched subprocesses (ring buffer, log file, etc.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Technology Stack
- `CLAUDE.md` — Technology stack decisions including Rust crates, React/Zustand patterns, Tauri v2 APIs

### Existing Backend Code
- `src-tauri/src/pipeline/mod.rs` — Phase 2 pipeline module structure (watcher, events, process_snapshot, worktree)
- `src-tauri/src/pipeline/events.rs` — `FileEvent`, `FileEventBatch`, `Attribution` types — the event contract Phase 3 conflict detection consumes
- `src-tauri/src/pipeline/process_snapshot.rs` — `ProcessSnapshot`, `ProcessInfo`, `AGENT_NAME_ALLOWLIST` — Phase 3 enhances this for richer agent detection
- `src-tauri/src/pipeline/commands.rs` — `start_watch`, `stop_watch`, `list_worktrees` Tauri commands — pattern for new Phase 3 commands
- `src-tauri/src/pipeline/pipeline_state.rs` — `ActiveWatch`, `PipelineState` — managed state pattern
- `src-tauri/src/db/mod.rs` — SQLite pool initialization, migration pattern
- `src-tauri/src/db/migrations/001_initial_schema.sql` — Existing schema with `agent_sessions`, `conflict_events`, `approval_requests` tables — Phase 3 may need new migrations to enrich these
- `src-tauri/src/lib.rs` — App setup, plugin registration, `app.manage()` state injection

### Existing Frontend Code
- `src/stores/pipelineStore.ts` — Zustand store for file event pipeline — pattern for new agent/conflict stores
- `src/stores/sidebarStore.ts` — Zustand store pattern reference
- `src/stores/paletteStore.ts` — Zustand store pattern reference

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (for conflict badges, agent status indicators)
- `wireframes/agent_control_tower/` — Tower Control wireframe (agent manifest layout reference)

### Phase Context
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` — Phase 1 decisions (sidebar, command palette, window chrome, system tray)
- `.planning/phases/02-real-time-data-pipeline/02-CONTEXT.md` — Phase 2 decisions (event delivery via Channel, PID correlation strategy, writes-only tracking, worktree detection)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProcessSnapshot` + `AGENT_NAME_ALLOWLIST` in `process_snapshot.rs` — Phase 3 enriches this into a full agent registry. The process scanning logic becomes the baseline detection path
- `FileEvent` / `FileEventBatch` types in `events.rs` — Conflict engine consumes these directly. Attribution field links events to agents
- `agent_sessions` table in SQLite — Already has agent_id, agent_type, status fields. May need migration to add adapter_type, intent, config_source columns
- `conflict_events` table in SQLite — Already has session references and file_path. May need migration to add conflict_window_ms, hunk_hints columns
- Zustand store pattern (sidebar, palette, pipeline) — New agentStore and conflictStore follow the same pattern

### Established Patterns
- **Tauri commands:** `#[tauri::command] #[specta::specta]` annotated async functions in a `commands.rs` module, registered via `tauri-specta`
- **Managed state:** `app.manage(State)` in lib.rs, accessed via `tauri::State<'_, T>` in commands
- **IPC streaming:** `tauri::ipc::Channel<T>` for high-throughput Rust→frontend streaming (Phase 2 pattern)
- **Async runtime:** tokio for all backend async work, `spawn_blocking` for CPU-intensive ops (sysinfo refresh)
- **Store pattern:** Zustand with selectors, one store per domain

### Integration Points
- `src-tauri/src/lib.rs` — Register new agent management and conflict detection modules, inject managed state
- `src-tauri/Cargo.toml` — Add HTTP server crate for self-registration endpoint (e.g., axum)
- `src-tauri/src/pipeline/process_snapshot.rs` — Extend `AGENT_NAME_ALLOWLIST` or replace with adapter-driven discovery
- `src/stores/` — New agentStore.ts, conflictStore.ts
- Phase 2 watcher event stream — Conflict engine taps into the same event flow

</code_context>

<specifics>
## Specific Ideas

- The GenericAdapter with full feature parity means a power user can add support for a new AI coding agent (e.g., Aider, Continue) just by writing a config file — no Rust needed
- Self-registration via HTTP + `AITC_PORT` env var is trivially hookable from Claude Code's hooks system (pre-tool/post-tool hooks can POST to AITC)
- Per-file conflict detection with hunk hints is the sweet spot — Phase 3 stays simple while Phase 5 gets the data it needs for smart merge UI
- Configurable per-state notifications reuse the same settings infrastructure for both agent state changes and conflict alerts — single notification preferences panel

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-agent-management-conflict-detection*
*Context gathered: 2026-04-10*
