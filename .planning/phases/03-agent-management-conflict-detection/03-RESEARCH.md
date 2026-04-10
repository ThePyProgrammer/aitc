# Phase 3: Agent Management + Conflict Detection - Research

**Researched:** 2026-04-10
**Domain:** Rust backend agent registry, adapter trait architecture, process lifecycle management, conflict detection engine, Tauri IPC, native notifications
**Confidence:** HIGH

## Summary

Phase 3 builds the agent management layer and conflict detection engine on top of Phase 2's real-time data pipeline. The core Rust work involves: (1) an `AgentAdapter` async trait with compiled-in implementations for Claude Code, Codex, and OpenCode plus a config-driven `GenericAdapter`, (2) an agent registry that unifies process-scan detection with HTTP self-registration, (3) subprocess launch/terminate lifecycle management with Windows-specific detached process handling, (4) a conflict detection engine that consumes `FileEventBatch` from the pipeline and flags overlapping writes within a configurable time window, and (5) native OS notifications via `tauri-plugin-notification`. The frontend adds two Zustand stores (agentStore, conflictStore) and the Tower Control view with agent manifest table, deploy dialog, conflict alert banners, and system logs panel.

The architecture is well-constrained by CONTEXT.md decisions. The main technical choices remaining are: axum for the self-registration HTTP server (recommended -- it shares the tokio runtime already in use), `async-trait` crate for dyn-compatible async adapter methods, TOML for GenericAdapter config files, and a ring buffer strategy for subprocess stdout/stderr capture.

**Primary recommendation:** Build the `AgentAdapter` trait first as the foundational abstraction, then layer registry, launch, detection, and conflict engine on top. Use `async-trait` 0.1 for dyn dispatch since native async fn in traits is not yet dyn-compatible in stable Rust.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Hybrid trait + config pattern -- Core `AgentAdapter` Rust trait for complex agent-specific logic (Claude Code, Codex, OpenCode), plus a `GenericAdapter` that reads simpler agent definitions from a config file (JSON/TOML)
- **D-02:** Compiled-in modules only for v1 -- all adapters (including GenericAdapter) are compiled into the binary. No dynamic plugin system. Adding a new Rust adapter means a code change + rebuild
- **D-03:** GenericAdapter supports full feature parity -- detect, launch, state, and intent via configurable rules (process name patterns, launch commands, regex patterns for state/intent parsing). Not a second-class citizen
- **D-04:** Launch via detached subprocess -- spawn agent CLI as a detached child process, track PID, monitor stdout/stderr. Agent survives AITC restart
- **D-05:** Hybrid detection: process scanning as baseline (enhances Phase 2's `ProcessSnapshot` + `AGENT_NAME_ALLOWLIST`), plus optional self-registration via local HTTP endpoint for richer metadata
- **D-06:** Self-registration uses a localhost HTTP server run by AITC. Agents POST metadata on start. Port discoverable via `AITC_PORT` environment variable
- **D-07:** Adapter-driven state determination -- each adapter implements `get_state()`. Rich adapters parse agent-specific signals. Generic adapters use configurable rules
- **D-08:** Hybrid intent surfacing -- adapters extract intent automatically when possible. If no intent available, prompt user to manually label the session
- **D-09:** Configurable per-state OS notifications -- user configures which state transitions trigger native OS notifications. In-app indicator updates always happen for all state changes
- **D-10:** Fixed default conflict window (e.g., 5 seconds), user-configurable in settings. Two agents writing the same file within the window = conflict
- **D-11:** Alert via visual badge on Conflicts nav item + conflict row in conflicts list + agent status change to "Conflict" in Tower Control. Plus optional native OS notification. No modal interruption
- **D-12:** Per-file detection granularity with hunk hints -- detect at file level, but capture byte ranges or line counts each agent touched when available. Phase 5 merge UI can use these hints

### Claude's Discretion
- Conflict window default value (5s suggested, Claude can adjust based on research)
- HTTP server framework choice for the self-registration endpoint
- Config file format for GenericAdapter definitions (JSON vs TOML)
- State polling interval for adapter-driven state checks
- Stdout/stderr capture strategy for launched subprocesses

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGNT-01 | Live manifest of all active agents with ID, protocol type, status, and current file/process path | Agent registry + agentStore Zustand store + Tower Control manifest table |
| AGNT-02 | Launch new agent sessions (Claude Code, Codex, OpenCode) from within the app | Adapter `launch()` method + `tokio::process::Command` with detached subprocess + deploy dialog UI |
| AGNT-03 | Detect externally-launched agent processes already running on the codebase | Enhanced `ProcessSnapshot` + self-registration HTTP endpoint (axum) |
| AGNT-04 | Extensible adapter architecture -- new agent types without modifying core logic | `AgentAdapter` trait + `GenericAdapter` config-driven implementation |
| AGNT-05 | Agent intent -- summary of why each agent is touching specific files | Adapter `get_intent()` + Claude Code hooks parsing + manual label fallback |
| AGNT-06 | Stop/terminate a running agent from Tower Control | `kill()` on tracked PID + SIGTERM/TerminateProcess + inline confirmation UI |
| AGNT-07 | Agent state transitions: Running, Idle, Waiting, Conflict, Error | Adapter `get_state()` + state machine + notification system |
| CNFL-01 | Detect when two+ agents write the same file within a configurable conflict window | Conflict detection engine consuming `FileEventBatch` stream with sliding window per file |
| CNFL-02 | Alert user immediately when conflict detected (visual + notification) | Conflict alert banner + nav badge + `tauri-plugin-notification` for OS notifications |
| CNFL-06 | Conflict detection runs in Rust backend for real-time accuracy | Engine is a tokio task that taps the attributed event stream before frontend forwarding |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack**: Tauri v2 + React + TypeScript, Rust backend
- **Tauri commands**: `#[tauri::command] #[specta::specta]` annotated async functions, registered via tauri-specta
- **State management**: Zustand with selectors, one store per domain
- **Styling**: Tailwind CSS v4 with CSS custom properties for Command Horizon design system
- **Icons**: Lucide React with configurable stroke-width
- **Animation**: Motion (Framer Motion) v12 for UI transitions
- **Database**: SQLite via sqlx with compile-time checked queries
- **IPC streaming**: `tauri::ipc::Channel<T>` for high-throughput Rust-to-frontend streaming
- **Async runtime**: tokio, `spawn_blocking` for CPU-intensive ops
- **No shadcn/ui**: All components hand-built to Command Horizon specification
- **Fonts**: Space Grotesk (headlines), JetBrains Mono (data/monospace)

## Standard Stack

### Core (New Dependencies for Phase 3)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| axum | 0.8.8 | Self-registration HTTP endpoint (D-06) | Shares tokio runtime already used by Tauri. Lightweight, modular, tower-compatible. De facto Rust HTTP framework in 2026 | [VERIFIED: cargo search] |
| async-trait | 0.1.89 | Dyn-compatible async trait methods for AgentAdapter | Native async fn in traits not yet dyn-safe in stable Rust. Required for `Box<dyn AgentAdapter>` dispatch | [VERIFIED: cargo search] |
| tauri-plugin-notification | 2.3.3 | Native OS notifications for D-09 | Official Tauri v2 plugin for cross-platform desktop notifications. Supports Windows toast, macOS notification center | [VERIFIED: cargo search] |
| toml | 0.8 | Parse GenericAdapter config files | TOML is idiomatic for Rust ecosystem config (Cargo.toml precedent). Better human readability than JSON for agent definitions | [ASSUMED] |
| regex | 1.x | GenericAdapter configurable rules for state/intent parsing (D-07, D-08) | Standard Rust regex crate, already transitive dep via ignore crate | [ASSUMED] |

### Existing Dependencies (Already in Cargo.toml)

| Library | Version | Phase 3 Usage |
|---------|---------|---------------|
| tokio | 1.x | Async runtime, `process::Command` for subprocess spawning, channels, timers |
| sysinfo | 0.38 | Enhanced process scanning in `ProcessSnapshot` |
| sqlx | 0.8 | Enriched `agent_sessions` and `conflict_events` tables |
| serde / serde_json | 1.x | Serialization for IPC, config parsing, self-registration payloads |
| tauri-specta / specta | 2.0.0-rc.21/22 | Type-safe command bindings for new Phase 3 commands |
| chrono | 0.4 | Timestamps for conflict window calculations, session tracking |
| tracing | 0.1 | Structured logging for agent lifecycle events |

### Frontend (Already in package.json)

| Library | Version | Phase 3 Usage |
|---------|---------|---------------|
| zustand | ^5.0 | agentStore + conflictStore |
| motion | ^12.0 | Phosphor-in animations, status badge transitions, conflict alert slide-in |
| lucide-react | ^1.7 | Agent status icons, alert icons, action buttons |
| @tauri-apps/api | ^2 | invoke() for new Tauri commands |
| @tanstack/react-virtual | ^3.13 | System logs panel virtualization (already in CLAUDE.md stack, needs npm install if not present) |

### New Frontend Dependency

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tauri-apps/plugin-notification | ^2 | JS API for requesting notification permission + sending from frontend | For notification preference UI, permission flow | [ASSUMED] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| axum | warp | Warp is also lightweight but axum has better ecosystem momentum and tower middleware compatibility |
| axum | hyper (raw) | Too low-level for even a simple registration endpoint; axum adds routing/extraction at minimal cost |
| async-trait | trait-variant | trait-variant is newer but less battle-tested; async-trait has 300M+ downloads |
| TOML | JSON | JSON works but lacks comments; TOML is more human-friendly for config files users will edit |

**Installation (Rust):**
```toml
# Add to src-tauri/Cargo.toml [dependencies]
axum = "0.8"
async-trait = "0.1"
tauri-plugin-notification = "2"
toml = "0.8"
regex = "1"

# Add "process" feature to tokio for subprocess management
# tokio = { version = "1", features = [..., "process"] }
```

**Installation (Frontend):**
```bash
npm install @tauri-apps/plugin-notification
```

**Tauri plugin registration** (in `src-tauri/src/lib.rs`):
```rust
.plugin(tauri_plugin_notification::init())
```

**Tauri config** (`src-tauri/capabilities/default.json`):
Add `"notification:default"` to the permissions array.

## Architecture Patterns

### Recommended Project Structure

```
src-tauri/src/
  agents/
    mod.rs              # Module root, AgentAdapter trait definition
    adapter.rs          # AgentAdapter trait + AgentState enum + AgentInfo struct
    registry.rs         # AgentRegistry: HashMap<AgentId, ManagedAgent>
    claude_code.rs      # ClaudeCodeAdapter impl
    codex.rs            # CodexAdapter impl
    opencode.rs         # OpenCodeAdapter impl
    generic.rs          # GenericAdapter impl (TOML config-driven)
    launcher.rs         # Subprocess spawning + PID tracking + stdout capture
    self_register.rs    # axum HTTP server for agent self-registration
    commands.rs         # Tauri commands for agent management
  conflict/
    mod.rs              # Module root
    engine.rs           # ConflictEngine: sliding window detector
    types.rs            # ConflictEvent, ConflictAlert types
    commands.rs         # Tauri commands for conflict queries
  pipeline/             # (existing Phase 2 module -- modified)
    process_snapshot.rs # Enhanced: runtime-configurable allowlist from adapters
  db/
    migrations/
      002_phase3_enrichment.sql  # Enrich agent_sessions + conflict_events tables
src/
  stores/
    agentStore.ts       # Zustand store for agent registry state
    conflictStore.ts    # Zustand store for conflict alerts
  views/
    TowerControl/
      TowerControl.tsx  # Main Tower Control view
      AgentManifest.tsx # Agent manifest table component
      AgentRow.tsx      # Individual agent row with status, intent, actions
      DeployDialog.tsx  # Deploy agent glassmorphism overlay
      ConflictBanner.tsx # Conflict alert banner stack
      QuickCommands.tsx # Quick commands panel
      SystemLogs.tsx    # Virtualized system logs panel
  components/
    StatusBadge.tsx     # Extended with running/idle/waiting/conflict/error variants
    ConflictNavBadge.tsx # Sidebar conflict count badge with ping animation
```

### Pattern 1: AgentAdapter Async Trait

**What:** Core trait that all agent types implement, using `async-trait` for dyn dispatch
**When to use:** Every agent type (built-in + generic) implements this trait
**Example:**
```rust
// Source: Project-specific design based on D-01, D-07, D-08
use async_trait::async_trait;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentState {
    Running,
    Idle,
    Waiting,
    Conflict,
    Error,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub agent_type: String,
    pub protocol: String,
    pub state: AgentState,
    pub pid: Option<u32>,
    pub cwd: Option<PathBuf>,
    pub intent: Option<String>,
}

#[async_trait]
pub trait AgentAdapter: Send + Sync {
    /// Human-readable adapter name (e.g., "claude-code", "codex", "opencode")
    fn adapter_type(&self) -> &str;

    /// Process name patterns this adapter recognizes (fed to ProcessSnapshot)
    fn process_patterns(&self) -> Vec<String>;

    /// Launch a new agent session. Returns PID on success.
    async fn launch(&self, cwd: PathBuf, intent: Option<String>) -> Result<u32, String>;

    /// Determine current state from agent-specific signals
    async fn get_state(&self, pid: u32) -> AgentState;

    /// Extract intent/task description if available
    async fn get_intent(&self, pid: u32) -> Option<String>;

    /// Stop/terminate the agent process
    async fn terminate(&self, pid: u32) -> Result<(), String>;
}
```

### Pattern 2: Agent Registry with Managed State

**What:** Central registry that owns all known agents, combining process-scan discovery with self-registration
**When to use:** Single source of truth for agent lifecycle, consumed by Tauri commands
**Example:**
```rust
// Source: Project-specific design based on D-05
use std::collections::HashMap;
use tokio::sync::RwLock;

pub struct ManagedAgent {
    pub info: AgentInfo,
    pub adapter: Box<dyn AgentAdapter>,
    pub launched_by_aitc: bool,  // true if we spawned it, false if detected/self-registered
    pub stdout_buffer: Option<RingBuffer>,  // captured stdout for AITC-launched agents
}

pub struct AgentRegistry {
    agents: RwLock<HashMap<String, ManagedAgent>>,
    adapters: Vec<Box<dyn AgentAdapter>>,  // registered adapter instances
}
```

### Pattern 3: Conflict Detection Sliding Window

**What:** Per-file sliding window that tracks recent write events and flags conflicts when two different agents write to the same file within the window
**When to use:** Consumes the attributed `FileEventBatch` stream from Phase 2
**Example:**
```rust
// Source: Project-specific design based on D-10, D-12
use std::collections::HashMap;
use std::time::Duration;

struct FileWriteRecord {
    agent_id: String,
    timestamp_ms: i64,
    byte_range: Option<(u64, u64)>,  // hunk hints per D-12
}

pub struct ConflictEngine {
    /// Per-file sliding window of recent writes
    recent_writes: HashMap<PathBuf, Vec<FileWriteRecord>>,
    /// Conflict window duration (default 5s, user-configurable per D-10)
    window: Duration,
}

impl ConflictEngine {
    /// Process a batch of attributed events, return any new conflicts detected
    pub fn process_batch(&mut self, batch: &FileEventBatch) -> Vec<ConflictAlert> {
        // For each write event:
        // 1. Look up recent writes to that file
        // 2. Evict entries older than window
        // 3. If any remaining entry has a DIFFERENT agent_id -> CONFLICT
        // 4. Add current write to the window
        // 5. Return collected conflicts
        todo!()
    }
}
```

### Pattern 4: Detached Subprocess Launch (Windows)

**What:** Spawn agent CLI as a detached process that survives AITC restart
**When to use:** D-04 -- launching agents from the Deploy Agent dialog
**Example:**
```rust
// Source: std::os::windows::process::CommandExt docs + tokio::process::Command
use tokio::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
const DETACHED_PROCESS: u32 = 0x00000008;

pub async fn launch_detached(
    program: &str,
    args: &[&str],
    cwd: &std::path::Path,
) -> Result<u32, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(cwd);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);

    // Capture stdout/stderr via pipes for monitoring
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id().ok_or("no PID from spawned process")?;

    // Store child handle for stdout capture task (don't drop -- that would NOT
    // kill the process on tokio, but we need the pipe handles)
    // ... spawn stdout reader task ...

    Ok(pid)
}
```

### Pattern 5: Self-Registration HTTP Endpoint

**What:** Lightweight axum server on localhost for agents to POST metadata
**When to use:** D-06 -- enriching agent data beyond what process scanning provides
**Example:**
```rust
// Source: axum 0.8 docs pattern
use axum::{routing::post, Json, Router};

#[derive(serde::Deserialize)]
struct RegisterPayload {
    agent_type: String,
    pid: u32,
    cwd: String,
    intent: Option<String>,
    protocol: Option<String>,
}

async fn register_agent(
    Json(payload): Json<RegisterPayload>,
    // ... registry state via axum Extension or State ...
) -> impl axum::response::IntoResponse {
    // Upsert agent in registry with enriched metadata
    axum::http::StatusCode::OK
}

pub async fn start_registration_server(port: u16) -> Result<(), String> {
    let app = Router::new()
        .route("/register", post(register_agent));

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| format!("bind failed: {e}"))?;

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("server error: {e}"))
}
```

### Anti-Patterns to Avoid

- **Polling agent state from the frontend:** State changes must flow from Rust adapters through IPC events, not from frontend polling Tauri commands every second. Use `tauri::ipc::Channel` or Tauri events for push-based updates.
- **Blocking the tokio runtime with process operations:** `sysinfo::refresh` and `Command::spawn` can block. Always use `spawn_blocking` for sysinfo, and `tokio::process::Command` (not `std::process::Command`) for async subprocess management.
- **Storing adapter state in the adapter itself:** Adapters should be stateless trait objects. The `AgentRegistry` owns all mutable state (agent info, stdout buffers, PIDs). Adapters are pure logic for detect/launch/state/intent.
- **Using `async fn` in trait without `async-trait`:** Native async fn in traits is not dyn-compatible in current stable Rust. You cannot `Box<dyn AgentAdapter>` without the `async-trait` crate.
- **Hardcoding agent CLI paths:** Agent binaries should be resolved via `PATH` lookup, not hardcoded paths. Use `which` crate or `Command::new("claude")` which searches PATH.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP server | Custom TCP listener | axum 0.8 | Routing, JSON extraction, error handling, graceful shutdown all handled |
| OS notifications | Win32 API calls | tauri-plugin-notification 2.3 | Cross-platform, official Tauri plugin, permission handling built-in |
| Async trait dispatch | Manual Pin<Box<dyn Future>> | async-trait 0.1 | Eliminates boilerplate, widely battle-tested, trivial to use |
| TOML parsing | Custom parser | toml 0.8 | Serde-based deserialization, error messages, spec-compliant |
| Process name matching | Custom string scanning | regex 1.x | GenericAdapter needs configurable patterns beyond simple substring |
| Ring buffer for stdout | Custom Vec rotation | Use a `VecDeque` with capacity cap | VecDeque is stdlib, push_back + pop_front is O(1), no crate needed |

**Key insight:** Phase 3 has many integration points but few novel algorithms. The conflict detection sliding window is simple HashMap logic. The real complexity is in the plumbing: adapter trait dispatch, subprocess lifecycle, IPC event flow, and state synchronization between Rust and React.

## Common Pitfalls

### Pitfall 1: Zombie Processes on Windows

**What goes wrong:** Spawning a detached process but losing track of its PID. If AITC crashes, the agent process is orphaned with no way to terminate it.
**Why it happens:** `DETACHED_PROCESS` flag means the child has no console and no parent process group. Windows doesn't auto-kill detached children when the parent exits.
**How to avoid:** Persist launched PIDs to SQLite immediately on spawn. On AITC startup, scan for any PIDs from previous sessions and attempt to reconnect. Use `sysinfo` to verify if the PID is still alive and still matches the expected process name (PIDs get recycled on Windows).
**Warning signs:** Agent processes accumulating in Task Manager after AITC restarts.

### Pitfall 2: Port Conflicts for Self-Registration Server

**What goes wrong:** The axum server fails to bind because another process (or a previous AITC instance) is using the port.
**Why it happens:** Fixed port numbers collide. AITC might crash without cleanly shutting down the server.
**How to avoid:** Use port 0 (OS-assigned) as fallback. Try the configured port first, fall back to OS-assigned, then write the actual port to `AITC_PORT` env var. Consider writing the port to a well-known file (e.g., `~/.aitc/port`) so agents can discover it without env vars.
**Warning signs:** "address already in use" errors on startup.

### Pitfall 3: Conflict Window False Positives

**What goes wrong:** File save events from the same agent (e.g., auto-save, format-on-save) trigger self-conflicts.
**Why it happens:** The conflict engine sees two writes to the same file within the window and doesn't check if they're from the same agent.
**How to avoid:** The conflict condition MUST be: same file + DIFFERENT agent IDs + within window. This is a simple check but easy to forget. Also handle `Attribution::Ambiguous` -- if both PIDs resolve to the same agent adapter type, it might be the same logical agent.
**Warning signs:** Conflict count climbing when only one agent is active.

### Pitfall 4: Stdout/Stderr Pipe Deadlock

**What goes wrong:** If the child process writes faster than AITC reads from the pipe, the pipe buffer fills and the child blocks on write.
**Why it happens:** OS pipe buffers are typically 4KB-64KB. AI agents can produce verbose output.
**How to avoid:** Spawn a dedicated tokio task per child that continuously reads from stdout/stderr into a ring buffer (VecDeque). Never let the pipe go unread. If AITC doesn't need the output, redirect to `/dev/null` (or `NUL` on Windows) instead of piping.
**Warning signs:** Agent process appears "hung" -- it's actually blocked on a full pipe buffer.

### Pitfall 5: Race Between Process Scan and Self-Registration

**What goes wrong:** An agent appears twice in the manifest -- once from process scanning, once from self-registration.
**Why it happens:** Process scan discovers the PID before the self-registration POST arrives (or vice versa), creating two registry entries for the same agent.
**How to avoid:** Use PID as the dedup key in the registry. When a self-registration arrives, look up existing entries by PID and merge/enrich rather than creating a new entry. When process scan finds a new PID, check if it matches a self-registered agent.
**Warning signs:** Duplicate agent rows in the manifest with different metadata completeness.

### Pitfall 6: Conflict Engine Memory Growth

**What goes wrong:** The `recent_writes` HashMap grows unboundedly as new files are touched.
**Why it happens:** Files are added to the map but entries are only evicted from per-file vectors, not from the map itself.
**How to avoid:** Periodically sweep the HashMap and remove entries with empty vectors (all writes expired). Run this sweep on a timer (e.g., every 30 seconds) or after every N batches processed.
**Warning signs:** Increasing RSS memory over time proportional to unique files touched.

## Code Examples

### Agent State Machine Transitions

```rust
// Source: Project-specific design based on D-07, D-09
impl AgentState {
    /// Valid transitions. Invalid transitions are logged but not applied.
    pub fn can_transition_to(&self, next: &AgentState) -> bool {
        use AgentState::*;
        matches!(
            (self, next),
            (Running, Idle)
                | (Running, Waiting)
                | (Running, Conflict)
                | (Running, Error)
                | (Idle, Running)
                | (Idle, Error)
                | (Waiting, Running)
                | (Waiting, Error)
                | (Conflict, Running)
                | (Conflict, Error)
                | (Error, Running) // retry/restart
        )
    }
}
```

### Conflict Engine Integration with Pipeline

```rust
// Source: Project-specific design based on existing pipeline_state.rs pattern
// The conflict engine taps the attributed event stream as an observer.
// It does NOT sit inline between attributor and forwarder -- it receives
// a clone of each batch via a broadcast channel or a second mpsc consumer.

use tokio::sync::broadcast;

// In start_watch (commands.rs), after the attributing stream:
let (conflict_tx, conflict_rx) = broadcast::channel::<FileEventBatch>(256);

// The forwarder task also sends to conflict_tx
let forwarder = tokio::spawn(async move {
    while let Some(batch) = attributed_rx.recv().await {
        let _ = conflict_tx.send(batch.clone());  // fan-out to conflict engine
        if channel_clone.send(batch).is_err() {
            break;
        }
    }
});

// Conflict engine task
let conflict_task = tokio::spawn(async move {
    let mut engine = ConflictEngine::new(Duration::from_secs(5));
    let mut rx = conflict_rx;  // broadcast::Receiver
    while let Ok(batch) = rx.recv().await {
        let alerts = engine.process_batch(&batch);
        for alert in alerts {
            // Emit via Tauri event or Channel to frontend
            // Also update agent states to Conflict in registry
        }
    }
});
```

### Database Migration for Phase 3

```sql
-- Source: Project-specific, extending 001_initial_schema.sql
-- 002_phase3_enrichment.sql

-- Enrich agent_sessions with adapter and intent data
ALTER TABLE agent_sessions ADD COLUMN adapter_type TEXT;
ALTER TABLE agent_sessions ADD COLUMN protocol TEXT;
ALTER TABLE agent_sessions ADD COLUMN intent TEXT;
ALTER TABLE agent_sessions ADD COLUMN pid INTEGER;
ALTER TABLE agent_sessions ADD COLUMN cwd TEXT;
ALTER TABLE agent_sessions ADD COLUMN launched_by_aitc INTEGER NOT NULL DEFAULT 0;

-- Enrich conflict_events with window and hunk data
ALTER TABLE conflict_events ADD COLUMN conflict_window_ms INTEGER;
ALTER TABLE conflict_events ADD COLUMN agent_a_id TEXT;
ALTER TABLE conflict_events ADD COLUMN agent_b_id TEXT;
ALTER TABLE conflict_events ADD COLUMN hunk_hints TEXT;  -- JSON blob of byte ranges
```

### Frontend agentStore Pattern

```typescript
// Source: Following existing pipelineStore.ts pattern
import { create } from 'zustand';

interface AgentInfo {
  id: string;
  agentType: string;
  protocol: string;
  state: 'running' | 'idle' | 'waiting' | 'conflict' | 'error';
  pid: number | null;
  cwd: string | null;
  intent: string | null;
}

interface AgentStore {
  agents: Map<string, AgentInfo>;
  upsertAgent: (agent: AgentInfo) => void;
  removeAgent: (id: string) => void;
  updateState: (id: string, state: AgentInfo['state']) => void;
  updateIntent: (id: string, intent: string) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: new Map(),
  upsertAgent: (agent) =>
    set((s) => {
      const next = new Map(s.agents);
      next.set(agent.id, agent);
      return { agents: next };
    }),
  removeAgent: (id) =>
    set((s) => {
      const next = new Map(s.agents);
      next.delete(id);
      return { agents: next };
    }),
  updateState: (id, state) =>
    set((s) => {
      const next = new Map(s.agents);
      const existing = next.get(id);
      if (existing) next.set(id, { ...existing, state });
      return { agents: next };
    }),
  updateIntent: (id, intent) =>
    set((s) => {
      const next = new Map(s.agents);
      const existing = next.get(id);
      if (existing) next.set(id, { ...existing, intent });
      return { agents: next };
    }),
  reset: () => set({ agents: new Map() }),
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `async-trait` crate required | Native async fn in traits (Rust 1.75+) | Dec 2023 | But NOT dyn-compatible yet -- still need `async-trait` for `Box<dyn Trait>` |
| Manual Tauri invoke types | tauri-specta auto-generation | Tauri v2 | Already in use -- Phase 3 commands get free TS bindings |
| Chokidar (Node) for file watching | notify (Rust) native | Phase 2 | Already decided and implemented |
| axum 0.7 | axum 0.8 | Jan 2026 | Minor API changes, same patterns apply |

**Deprecated/outdated:**
- `warp` is effectively in maintenance mode -- axum has captured the Rust HTTP framework mindshare [ASSUMED]
- `async-trait` will eventually be replaced by native dyn-compatible async traits, but that's not in stable Rust yet as of April 2026 [ASSUMED]

## Claude's Discretion Recommendations

### Conflict Window Default: 5 seconds (confirmed)
5 seconds is appropriate. AI coding agents typically write files in bursts (save, format, lint-fix). A 5-second window captures the common case where two agents race on the same file while being short enough to avoid false positives from unrelated sequential edits. [ASSUMED -- no reference implementations found, but 5s is reasonable based on typical agent write patterns]

### HTTP Server Framework: axum 0.8
Axum is the clear choice. It shares the tokio runtime already in Cargo.toml, has first-class JSON extraction via serde, and the self-registration endpoint needs only 1-2 routes. Total added binary size is minimal since axum relies on hyper/tower which are lightweight. [VERIFIED: cargo search confirms axum 0.8.8 available]

### Config File Format: TOML
TOML is idiomatic for Rust projects (Cargo.toml precedent), supports comments (JSON does not), and the `toml` crate provides serde-based deserialization. Users editing GenericAdapter configs will appreciate the comment support. [ASSUMED -- community convention, not verified]

### State Polling Interval: 2 seconds
Adapter `get_state()` should be polled every 2 seconds. This balances responsiveness (state changes visible within 2s) against overhead (sysinfo refresh is 24ms per the Phase 2 benchmark). The process snapshot is already refreshing at 1s -- state polling can piggyback on that data. [ASSUMED]

### Stdout/Stderr Capture: Ring Buffer via VecDeque
Use a fixed-capacity `VecDeque<String>` (1000 lines) per launched agent. A dedicated tokio task reads lines from the child's stdout/stderr pipes and pushes to the deque, dropping oldest entries when full. The system logs panel in the UI reads from this buffer. For agents not launched by AITC (externally detected), no stdout capture is possible -- this is expected. [ASSUMED]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TOML is the best format for GenericAdapter config | Standard Stack, Discretion | Low -- JSON works fine as fallback, minor DX difference |
| A2 | 5-second conflict window is appropriate default | Discretion | Low -- it's user-configurable, just affects the default |
| A3 | 2-second state polling interval is appropriate | Discretion | Low -- easily tunable constant |
| A4 | 1000-line ring buffer is sufficient for stdout capture | Discretion | Low -- easily adjustable, logs are supplementary |
| A5 | regex 1.x is already a transitive dependency via ignore | Standard Stack | Very low -- even if not, adding it is trivial |
| A6 | `@tauri-apps/plugin-notification` JS package version ^2 exists | Standard Stack | Low -- official Tauri plugin, version matches pattern |
| A7 | warp is in maintenance mode | State of the Art | Very low -- doesn't affect our axum choice |
| A8 | Native dyn-compatible async traits not yet in stable Rust | Architecture | Medium -- if stabilized, we could drop async-trait, but code works either way |

## Open Questions

1. **Claude Code hooks integration specifics**
   - What we know: Claude Code has a hooks system with PreToolUse/PostToolUse events. Hooks can output JSON to stdout. Exit code 0 means success. [CITED: https://code.claude.com/docs/en/hooks]
   - What's unclear: Exact JSON schema for hook output that would contain task/intent metadata. Whether hooks can be configured programmatically or only via `.claude/settings.json`.
   - Recommendation: Build the ClaudeCodeAdapter to parse known hook output patterns. Fall back to manual intent labeling if hooks aren't configured. Phase 3 doesn't need to auto-configure hooks -- just consume their output if present.

2. **Codex CLI non-interactive mode for AITC launch**
   - What we know: `codex` starts interactive TUI, `codex --full-auto` runs without approval. `--cd` sets working directory. [CITED: https://developers.openai.com/codex/cli/reference]
   - What's unclear: Whether Codex can run in a mode where AITC acts as the approval gateway (intercepting approval requests). This is likely Phase 4 (COMM) territory.
   - Recommendation: For Phase 3, launch Codex in `--full-auto` or default mode. Approval integration is deferred to Phase 4.

3. **OpenCode process detection patterns**
   - What we know: OpenCode binary is `opencode`. Can launch with `opencode -c /path` or `opencode -p "prompt"`. [CITED: https://opencode.ai/docs/cli/]
   - What's unclear: Whether OpenCode spawns child processes that should also be tracked, or if it's a single process.
   - Recommendation: Start with single-process detection matching "opencode" in the process name. Extend if child processes are observed.

4. **tokio "process" feature**
   - What we know: `tokio::process::Command` requires the "process" feature flag on the tokio dependency.
   - What's unclear: Whether the current Cargo.toml tokio features include "process".
   - Recommendation: Check and add `"process"` to the tokio features list in Cargo.toml. Current features are: `["time", "sync", "rt-multi-thread", "macros"]` -- "process" is NOT included and must be added.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust/Cargo | All backend code | Yes | (in project) | -- |
| Node/npm | Frontend build | Yes | (in project) | -- |
| tokio (process feature) | Subprocess spawning | Needs adding | 1.x | Add "process" to features |
| axum | Self-registration server | Needs adding | 0.8.8 | -- |
| tauri-plugin-notification | OS notifications | Needs adding | 2.3.3 | -- |

**Missing dependencies with no fallback:**
- tokio "process" feature must be added to Cargo.toml
- axum must be added to Cargo.toml
- tauri-plugin-notification must be added to both Cargo.toml and npm

**Missing dependencies with fallback:**
- None -- all new dependencies are required for locked decisions

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Rust) | cargo test (built-in, with tokio::test for async) |
| Framework (Frontend) | vitest 3.x with jsdom |
| Config file (Rust) | None needed -- cargo test is zero-config |
| Config file (Frontend) | `vitest.config.ts` (exists) |
| Quick run command (Rust) | `cd src-tauri && cargo test --lib` |
| Quick run command (Frontend) | `npm run test` |
| Full suite command | `cd src-tauri && cargo test --lib && cd .. && npm run test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01 | Agent manifest state in agentStore | unit | `npm run test -- --run src/__tests__/agentStore.test.ts` | Wave 0 |
| AGNT-02 | launch() spawns detached process, returns PID | unit | `cd src-tauri && cargo test agents::launcher::tests -x` | Wave 0 |
| AGNT-03 | ProcessSnapshot enriched with adapter patterns | unit | `cd src-tauri && cargo test agents::registry::tests -x` | Wave 0 |
| AGNT-04 | GenericAdapter implements AgentAdapter trait | unit | `cd src-tauri && cargo test agents::generic::tests -x` | Wave 0 |
| AGNT-05 | get_intent() returns parsed/manual intent | unit | `cd src-tauri && cargo test agents::adapter::tests -x` | Wave 0 |
| AGNT-06 | terminate() sends kill signal | unit | `cd src-tauri && cargo test agents::launcher::tests::terminate -x` | Wave 0 |
| AGNT-07 | State transitions validated | unit | `cd src-tauri && cargo test agents::adapter::tests::state_transitions -x` | Wave 0 |
| CNFL-01 | Conflict window detects overlapping writes | unit | `cd src-tauri && cargo test conflict::engine::tests -x` | Wave 0 |
| CNFL-02 | Conflict alerts in conflictStore | unit | `npm run test -- --run src/__tests__/conflictStore.test.ts` | Wave 0 |
| CNFL-06 | Conflict engine processes FileEventBatch | unit | `cd src-tauri && cargo test conflict::engine::tests::process_batch -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd src-tauri && cargo test --lib` + `npm run test`
- **Per wave merge:** Full suite
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src-tauri/src/agents/` module -- entire module is new
- [ ] `src-tauri/src/conflict/` module -- entire module is new
- [ ] `src/__tests__/agentStore.test.ts` -- covers AGNT-01
- [ ] `src/__tests__/conflictStore.test.ts` -- covers CNFL-02
- [ ] `src-tauri/src/db/migrations/002_phase3_enrichment.sql` -- schema migration
- [ ] tokio "process" feature added to Cargo.toml
- [ ] axum, async-trait, tauri-plugin-notification, toml, regex added to Cargo.toml
- [ ] @tauri-apps/plugin-notification added to package.json

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Self-registration endpoint is localhost-only, no auth needed |
| V3 Session Management | No | Desktop app, no web sessions |
| V4 Access Control | No | Single-user desktop app |
| V5 Input Validation | Yes | Validate all self-registration POST payloads, sanitize file paths from agents |
| V6 Cryptography | No | No secrets in transit (localhost only) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious self-registration | Spoofing | Bind HTTP server to 127.0.0.1 only (not 0.0.0.0). Validate PID exists and matches claimed agent type |
| Path traversal in file paths | Tampering | Canonicalize all file paths received from agents. Reject paths outside watched repo root |
| PID spoofing in registration | Spoofing | Cross-reference self-registered PID with sysinfo process table. Verify process name matches claimed type |
| Subprocess injection via agent launch | Elevation | Validate agent binary name against a fixed allowlist before spawning. Never pass unsanitized user input to shell |
| Resource exhaustion via many registrations | DoS | Rate-limit self-registration endpoint. Cap maximum concurrent agents in registry |

## Sources

### Primary (HIGH confidence)
- Cargo.toml and existing source code -- current project state and patterns
- [cargo search: axum 0.8.8] -- version verified via cargo search
- [cargo search: async-trait 0.1.89] -- version verified via cargo search
- [cargo search: tauri-plugin-notification 2.3.3] -- version verified via cargo search
- [std::os::windows::process::CommandExt] -- Windows creation_flags API for detached processes
- [tokio::process::Command docs](https://docs.rs/tokio/latest/tokio/process/struct.Command.html) -- async subprocess management

### Secondary (MEDIUM confidence)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) -- hooks lifecycle and stdout/stderr contract
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference) -- command line options
- [OpenCode CLI docs](https://opencode.ai/docs/cli/) -- launch commands and flags
- [Tauri notification plugin](https://v2.tauri.app/plugin/notification/) -- official plugin docs
- [axum docs.rs](https://docs.rs/axum/latest/axum/) -- API reference

### Tertiary (LOW confidence)
- Conflict window default (5s) -- no reference implementations found, based on reasoning about agent write patterns
- State polling interval (2s) -- based on Phase 2 benchmark data extrapolation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all crate versions verified via cargo search, existing patterns well-established
- Architecture: HIGH -- trait + registry + engine pattern is well-constrained by CONTEXT.md decisions, follows established Rust patterns
- Pitfalls: HIGH -- based on concrete Windows process management experience and direct analysis of Phase 2 code
- Agent CLI integration: MEDIUM -- Claude Code hooks documented, Codex/OpenCode CLI docs available but integration specifics need runtime testing

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable domain, 30-day validity)
