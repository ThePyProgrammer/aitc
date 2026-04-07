# Architecture Patterns

**Domain:** AI Agent Traffic Controller Desktop App
**Researched:** 2026-04-07

## Recommended Architecture

Single-window Tauri v2 application with a Rust backend handling all system-level operations (file watching, process management, conflict detection, persistence) and a React/TypeScript frontend handling visualization and user interaction. Communication flows through Tauri's IPC layer: commands (frontend-initiated request/response) and events (backend-initiated push streams).

### High-Level Diagram

```
+---------------------------------------------------------------+
|                     TAURI SHELL (Native OS)                    |
|  System Tray  |  Native Notifications  |  Window Management   |
+---------------------------------------------------------------+
|                                                                |
|  +---------------------------+  IPC   +---------------------+  |
|  |     RUST BACKEND          | <====> |   REACT FRONTEND    |  |
|  |     (src-tauri/)          | Cmds   |   (src/)            |  |
|  |                           | Events |                     |  |
|  |  +---------------------+  |        |  +--------------+   |  |
|  |  | Filesystem Watcher  |  |------->|  | Zustand      |   |  |
|  |  | Service             |  | events |  | State Store  |   |  |
|  |  +---------------------+  |        |  +--------------+   |  |
|  |  +---------------------+  |        |       |             |  |
|  |  | Process Monitor     |  |------->|  +--------------+   |  |
|  |  | (Agent Detection)   |  | events |  | React Router |   |  |
|  |  +---------------------+  |        |  | (4 views)    |   |  |
|  |  +---------------------+  |        |  +--------------+   |  |
|  |  | Conflict Engine     |  |------->|  | Radar        |   |  |
|  |  +---------------------+  | events |  | Tower        |   |  |
|  |  +---------------------+  |        |  | Comms        |   |  |
|  |  | Agent Registry      |  |        |  | Conflicts    |   |  |
|  |  | + Adapter System    |  |        |  +--------------+   |  |
|  |  +---------------------+  |        |                     |  |
|  |  +---------------------+  |        |                     |  |
|  |  | SQLite (via sqlx)   |  |        |                     |  |
|  |  | Persistence Layer   |  |        |                     |  |
|  |  +---------------------+  |        |                     |  |
|  +---------------------------+        +---------------------+  |
+---------------------------------------------------------------+
```

### Component Boundaries

| Component | Responsibility | Lives In | Communicates With |
|-----------|---------------|----------|-------------------|
| **Filesystem Watcher Service** | Monitors file reads/writes across the watched codebase using `notify` crate. Debounces events, attributes them to agents, emits structured file-event stream. | Rust backend | Process Monitor (to attribute events to agents), Conflict Engine (raw events), Frontend (via events) |
| **Process Monitor** | Detects running agent processes (Claude Code, Codex, OpenCode) via `sysinfo` crate. Tracks PIDs, working directories, lifecycle. Can also launch new agent processes. | Rust backend | Agent Registry (process-to-agent mapping), Filesystem Watcher (PID correlation), Frontend (via events) |
| **Agent Registry + Adapters** | Maintains canonical list of known agents. Each adapter implements a trait that knows how to detect, launch, communicate with, and interpret a specific agent type. Plugin architecture via Rust traits. | Rust backend | Process Monitor (registration), Comms System (agent-specific protocol), Frontend (agent metadata via commands) |
| **Conflict Detection Engine** | Receives file-event stream, maintains per-file ownership map, detects when two agents touch the same file within a time window. Generates conflict records with diff context. | Rust backend | Filesystem Watcher (input events), SQLite (persist conflicts), Frontend (conflict alerts via events) |
| **Approval/Comms System** | Handles agent requests that need human approval (write access, destructive ops). Queues requests, presents to frontend, relays decisions back to agents via their adapter. | Rust backend | Agent Registry (adapter-specific communication), Frontend (approval UI via commands + events), SQLite (audit log) |
| **Codebase Mapper** | Builds and maintains a spatial representation of the file tree. Maps directories to regions, computes positions for the radar visualization. Rebuilds on significant file tree changes. | Rust backend | Filesystem Watcher (tree change events), Frontend (spatial map via commands) |
| **SQLite Persistence** | Stores session history, conflict resolutions, approval logs, agent session records. Uses `sqlx` directly (not the Tauri SQL plugin) for full Rust-side control. | Rust backend | All backend components (write), Frontend (historical queries via commands) |
| **Frontend State (Zustand)** | Holds all real-time UI state: active agents, file events, conflicts, approval queue. Hydrated by Tauri events, queried via Tauri commands on mount. | React frontend | All views consume; Tauri event listeners populate |
| **Radar View** | Spatial visualization of agents on the codebase map. Canvas or SVG-based. Shows agent positions, trajectories, conflict zones. | React frontend | Zustand (reads agent positions, file tree map) |
| **Tower Control View** | Agent manifest table: all agents with status, protocol, process path. Quick commands (flush, halt, restart). Resource allocation overview. | React frontend | Zustand (reads agent list), Tauri commands (agent actions) |
| **Communications Hub View** | Pending approval queue. Shows agent requests with context, approve/deny/chat. History of past communications. | React frontend | Zustand (reads approval queue), Tauri commands (approve/deny actions) |
| **Conflict Resolution View** | Three-pane merge UI (Agent A / Central / Agent B). Shows conflicting changes side-by-side with accept/reject per hunk. | React frontend | Zustand (reads active conflicts), Tauri commands (resolve conflict) |

### Data Flow

#### 1. File Event Flow (primary real-time loop)

```
OS filesystem event
  -> notify crate (Rust, debounced)
    -> FileWatcherService.on_event()
      -> Correlate with running agent PIDs (which process has this file open?)
      -> Emit structured AgentFileEvent { agent_id, file_path, op: Read|Write|Delete, timestamp }
        -> ConflictEngine.ingest(event)  [check for overlapping writes]
        -> Tauri event "agent:file-event" -> Frontend Zustand store
        -> SQLite insert (async, batched)
```

#### 2. Agent Lifecycle Flow

```
Process Monitor polls sysinfo every 2-3 seconds
  -> Detects new process matching known agent signatures
    -> AgentRegistry.register(process_info)
      -> Adapter resolves agent type (Claude Code, Codex, OpenCode)
      -> Tauri event "agent:connected" -> Frontend
  -> Detects process exit
    -> AgentRegistry.deregister(agent_id)
      -> Tauri event "agent:disconnected" -> Frontend

OR: User clicks "Deploy Agent" in UI
  -> Tauri command "launch_agent" { agent_type, working_dir, config }
    -> AgentRegistry.launch(adapter, config)
      -> Adapter spawns process, returns PID
      -> Same registration flow as above
```

#### 3. Conflict Detection Flow

```
ConflictEngine maintains:
  - file_owners: HashMap<PathBuf, Vec<(AgentId, Timestamp)>>
  - conflict_window: Duration (e.g., 30 seconds)

On each AgentFileEvent(Write):
  -> Check file_owners for other agents with recent writes
  -> If collision detected:
    -> Generate ConflictRecord { file, agent_a, agent_b, timestamp, diff_context }
    -> Persist to SQLite
    -> Tauri event "conflict:detected" -> Frontend (triggers alert)
    -> Frontend navigates to Conflict Resolution view or shows notification
```

#### 4. Approval Flow

```
Agent adapter detects approval request (agent-specific mechanism):
  - Claude Code: hooks system "defer" event
  - Codex: AGENTS.md permission boundaries or CLI prompts
  - OpenCode: similar lifecycle hooks

  -> ApprovalSystem.queue(request)
    -> Persist to SQLite
    -> Tauri event "approval:requested" -> Frontend
      -> Communications Hub shows request with context
      -> User clicks Approve/Deny
        -> Tauri command "resolve_approval" { request_id, decision }
          -> ApprovalSystem.resolve(request_id, decision)
            -> Adapter relays decision to agent
            -> Persist resolution to SQLite
```

#### 5. Frontend Data Hydration

```
On app launch / view mount:
  -> Tauri commands (request/response):
    - "get_agents" -> current agent list
    - "get_codebase_map" -> spatial file tree
    - "get_pending_approvals" -> approval queue
    - "get_active_conflicts" -> unresolved conflicts
    - "get_session_history" -> past sessions (paginated)

After hydration, all updates via events (push):
  -> "agent:file-event", "agent:connected", "agent:disconnected"
  -> "conflict:detected", "conflict:resolved"
  -> "approval:requested", "approval:resolved"
```

## Patterns to Follow

### Pattern 1: Trait-Based Agent Adapters (Rust)

Each agent type is a struct implementing the `AgentAdapter` trait. New agents are added by implementing the trait -- no changes to core logic.

```rust
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    /// Unique identifier for this agent type (e.g., "claude-code", "codex")
    fn agent_type(&self) -> &str;

    /// Check if a running process matches this agent type
    fn matches_process(&self, process: &ProcessInfo) -> bool;

    /// Launch a new instance of this agent
    async fn launch(&self, config: &LaunchConfig) -> Result<ProcessHandle>;

    /// Send an approval decision back to the agent
    async fn relay_approval(&self, agent_id: &AgentId, decision: ApprovalDecision) -> Result<()>;

    /// Extract pending approval requests from agent state
    async fn poll_approvals(&self, agent_id: &AgentId) -> Result<Vec<ApprovalRequest>>;

    /// Get agent-specific metadata for display
    fn display_info(&self, process: &ProcessInfo) -> AgentDisplayInfo;
}
```

**Why:** The project explicitly requires extensibility. Hardcoding agent logic means rewrites when new agents appear. The trait approach is idiomatic Rust and maps cleanly to the adapter pattern.

### Pattern 2: Event-Driven Frontend State

Use Zustand stores that subscribe to Tauri events. Each domain gets its own store slice. Events push updates; commands handle initial hydration and user actions.

```typescript
// Example: Agent store
interface AgentStore {
  agents: Map<string, Agent>;
  // Hydration
  fetchAgents: () => Promise<void>;
  // Event handlers (called from Tauri event listeners)
  onAgentConnected: (agent: Agent) => void;
  onAgentDisconnected: (agentId: string) => void;
  onFileEvent: (event: AgentFileEvent) => void;
}

// In app initialization:
listen('agent:connected', (event) => useAgentStore.getState().onAgentConnected(event.payload));
listen('agent:disconnected', (event) => useAgentStore.getState().onAgentDisconnected(event.payload));
listen('agent:file-event', (event) => useAgentStore.getState().onFileEvent(event.payload));
```

**Why:** Tauri's event system is inherently push-based. Polling the backend from the frontend would waste IPC bandwidth and add latency. Zustand is lightweight and does not re-render components that do not subscribe to changed state.

### Pattern 3: Command/Query Separation in Rust Backend

Organize Tauri commands into two categories: queries (read state, return data) and mutations (change state, return confirmation). Queries can be cached frontend-side; mutations always invalidate relevant caches.

```rust
// Queries - safe to cache
#[tauri::command]
async fn get_agents(state: State<'_, AppState>) -> Result<Vec<AgentInfo>, String> { ... }

#[tauri::command]
async fn get_codebase_map(state: State<'_, AppState>) -> Result<CodebaseMap, String> { ... }

// Mutations - invalidate frontend cache after
#[tauri::command]
async fn resolve_approval(state: State<'_, AppState>, request_id: String, decision: String) -> Result<(), String> { ... }

#[tauri::command]
async fn launch_agent(state: State<'_, AppState>, agent_type: String, config: LaunchConfig) -> Result<AgentInfo, String> { ... }
```

### Pattern 4: Debounced File Event Batching

File watchers can produce hundreds of events per second during agent operations. Batch and debounce before sending to frontend.

```rust
// In the watcher service, accumulate events and flush every 100ms
// This prevents flooding the IPC channel and overwhelming React renders
struct EventBatcher {
    pending: Vec<AgentFileEvent>,
    flush_interval: Duration, // 100ms
    last_flush: Instant,
}
```

**Why:** `notify` fires at OS-level granularity. A single file save can produce multiple events (create temp, write, rename). Batching at 100ms intervals reduces IPC traffic by 10-50x while keeping the UI feeling real-time.

### Pattern 5: Single Window with Client-Side Routing

Use one Tauri window with React Router for the four views (Radar, Tower, Comms, Conflicts). This avoids the complexity of multi-window state synchronization and matches the wireframe design which shows a persistent left sidebar navigation.

```
/ -> Redirect to /radar
/radar -> Airspace Radar view
/tower -> Tower Control view
/comms -> Communications Hub view
/conflicts -> Conflict Resolution view
```

**Why:** The wireframes show a single application shell with sidebar navigation. Multi-window adds state sync complexity with no UX benefit for this use case.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Frontend File Watching

**What:** Using chokidar or the Tauri FS watch JS plugin to watch files from the frontend.
**Why bad:** File watching at scale (10k+ files) requires native performance. The frontend should only receive pre-processed, attributed, debounced events -- never raw OS events. Putting this in JS means the webview process handles thousands of events per second, causing UI jank.
**Instead:** All file watching in Rust via `notify`. Frontend receives batched, attributed `AgentFileEvent` structs via Tauri events.

### Anti-Pattern 2: Polling-Based Agent Detection

**What:** Having the frontend poll a "get_agents" command on a timer to discover new agents.
**Why bad:** Wastes IPC bandwidth, adds latency to agent discovery, makes the app feel sluggish.
**Instead:** Rust backend polls `sysinfo` internally (2-3s interval), emits `agent:connected` / `agent:disconnected` events. Frontend state is always current without explicit polling.

### Anti-Pattern 3: Storing State Only in Frontend

**What:** Using Zustand as the source of truth with no backend persistence.
**Why bad:** App restart loses all session data. Conflicts resolved in one session cannot be referenced later. No audit trail.
**Instead:** SQLite is the source of truth. Zustand is a read cache that is hydrated on launch and kept current via events. Every mutation writes to SQLite first, then emits an event.

### Anti-Pattern 4: Monolithic Rust Module

**What:** Putting all backend logic in a single `lib.rs` or `main.rs` file.
**Why bad:** Tauri backends grow fast. File watching, process management, conflict detection, and persistence are independent concerns that will each be hundreds of lines.
**Instead:** Modular structure:
```
src-tauri/
  src/
    main.rs              # Tauri setup, plugin registration
    lib.rs               # Re-exports
    commands/             # Tauri command handlers (thin layer)
      mod.rs
      agents.rs
      conflicts.rs
      approvals.rs
      codebase.rs
    services/             # Core business logic
      mod.rs
      watcher.rs          # Filesystem watcher service
      process_monitor.rs  # Agent process detection
      conflict_engine.rs  # Conflict detection logic
      approval_system.rs  # Approval queue management
      codebase_mapper.rs  # File tree -> spatial map
    adapters/             # Agent-specific adapters
      mod.rs
      trait.rs            # AgentAdapter trait definition
      claude_code.rs
      codex.rs
      opencode.rs
    models/               # Shared data types
      mod.rs
      agent.rs
      conflict.rs
      approval.rs
      file_event.rs
    db/                   # Database layer
      mod.rs
      migrations/
      queries.rs
    state.rs              # AppState definition
```

### Anti-Pattern 5: Synchronous Tauri Commands for Long Operations

**What:** Using synchronous Tauri commands for operations like launching agents or querying large file trees.
**Why bad:** Blocks the Tauri core thread, freezing IPC for all other operations.
**Instead:** All commands that touch I/O, processes, or the database must be `async`. Tauri v2 runs async commands on a thread pool automatically.

## Scalability Considerations

| Concern | At 1-3 agents | At 5-10 agents | At 20+ agents |
|---------|---------------|----------------|---------------|
| File events/sec | ~10-50, no batching needed | ~100-500, batching critical | ~1000+, may need sampling |
| Conflict detection | Simple hashmap lookup | Still fast, O(1) per event | Consider time-window pruning |
| Radar visualization | Direct SVG rendering | Canvas rendering preferred | WebGL or virtualized rendering |
| SQLite writes | Inline inserts fine | Batched inserts (WAL mode) | Write-ahead batching, async flush |
| Process polling | sysinfo refresh is cheap | Still fine at 2-3s interval | Consider targeted PID checks only |
| Memory (Rust side) | < 20MB | < 50MB | Profile; may need event eviction |
| IPC bandwidth | Negligible | ~1MB/s event stream | Throttle events per view visibility |

## Technology Choices Embedded in Architecture

| Component | Technology | Version | Confidence | Why |
|-----------|-----------|---------|------------|-----|
| File watching | `notify` crate | 7.x | HIGH | Used by rust-analyzer, cargo-watch. Native per-platform backends (ReadDirectoryChangesW on Windows, FSEvents on macOS, inotify on Linux). Known issue with dropped events at 1500+ individual file watches -- mitigate by watching directories, not files. |
| Process detection | `sysinfo` crate | latest | HIGH | De facto standard for cross-platform process enumeration in Rust. Provides PID, process name, command line, working directory. |
| Database | `sqlx` + SQLite | latest | HIGH | Compile-time query checking, async support, migration system. More control than the Tauri SQL plugin (which is designed for frontend-initiated queries). |
| Frontend state | Zustand | 5.x | HIGH | Minimal boilerplate, excellent TypeScript support, selector-based re-renders. Pairs well with Tauri's event-driven architecture. |
| Routing | React Router | 7.x | HIGH | Standard for single-window multi-view React apps. |
| Radar rendering | Canvas 2D API | N/A | MEDIUM | SVG is simpler for small agent counts but will struggle with many moving elements + animations (phosphor transitions, pulse rings). Canvas gives pixel-level control needed for the Command Horizon aesthetic. Evaluate at implementation time. |

## Build Order (Dependency Chain)

The architecture has clear dependency layers. Build bottom-up:

```
Phase 1: Foundation
  [Tauri shell + React scaffold + SQLite schema + IPC skeleton]
      |
Phase 2: Core Services
  [File Watcher] + [Process Monitor] + [Codebase Mapper]
      |              |
      v              v
Phase 3: Intelligence Layer
  [Agent Registry + Adapters] + [Conflict Engine]
      |                              |
      v                              v
Phase 4: Interaction Layer
  [Approval System] + [All 4 Frontend Views]
      |
Phase 5: Polish
  [Session History] + [System Tray] + [Notifications] + [Agent Launcher]
```

**Rationale:**
1. **Foundation first** because every other component depends on the Tauri IPC bridge, the database, and the React shell existing.
2. **File Watcher + Process Monitor** are independent of each other but both feed into the Agent Registry and Conflict Engine. Build them in parallel.
3. **Agent Registry** depends on Process Monitor (to know what processes exist) and defines the adapter trait that all agent-specific code implements. Conflict Engine depends on File Watcher (its input stream).
4. **Approval System** depends on Agent Registry (to relay decisions via adapters). Frontend views depend on all services existing to populate their data.
5. **Polish features** (session history, system tray, notifications) are additive and have no downstream dependents.

**Critical path:** Tauri scaffold -> File Watcher -> Conflict Engine -> Conflict Resolution UI. This is the highest-risk, highest-value chain and should be prioritized.

## Sources

- [Tauri v2 IPC Concepts](https://v2.tauri.app/concept/inter-process-communication/) - Commands and events architecture
- [Tauri v2 Architecture](https://v2.tauri.app/concept/architecture/) - Core architecture overview
- [Tauri v2 Plugin Development](https://v2.tauri.app/develop/plugins/) - Plugin system for extensibility
- [Tauri v2 State Management](https://v2.tauri.app/develop/state-management/) - Rust-side managed state
- [Tauri SQL Plugin](https://v2.tauri.app/plugin/sql/) - SQLite integration patterns
- [notify-rs](https://github.com/notify-rs/notify) - Cross-platform filesystem notification library
- [notify-rs Issue #412](https://github.com/notify-rs/notify/issues/412) - Large-scale watching event drops
- [sysinfo crate](https://crates.io/crates/sysinfo) - Cross-platform process detection
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) - Claude Code lifecycle integration
- [Codex CLI Features](https://developers.openai.com/codex/cli/features) - Codex agent integration
- [Zustand State Sync in Tauri](https://www.gethopp.app/blog/tauri-window-state-sync) - Zustand + Tauri patterns
- [Tauri v2 + React 19 Template](https://github.com/dannysmith/tauri-template) - Production-ready Tauri/React patterns
