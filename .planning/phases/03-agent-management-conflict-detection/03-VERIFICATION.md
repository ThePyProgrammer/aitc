---
phase: 03-agent-management-conflict-detection
verified: 2026-04-10T20:55:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "System detects externally-launched agents already running on the codebase via process scan and self-registration"
    status: partial
    reason: "Self-registration HTTP server is fully wired (agents can POST /register when they know AITC is running). However, the process scan (ProcessSnapshot with AGENT_NAME_ALLOWLIST) only feeds PID-to-file attribution — it does NOT bridge to the AgentRegistry. There is no code that periodically queries ProcessSnapshot.candidates() and upserts matching entries into AgentRegistry. Externally-launched agents that do not proactively self-register will never appear in the live manifest."
    artifacts:
      - path: "src-tauri/src/agents/self_register.rs"
        issue: "Self-registration works but only covers agents that proactively POST /register"
      - path: "src-tauri/src/pipeline/process_snapshot.rs"
        issue: "candidates() method exists but nothing reads it to populate AgentRegistry"
    missing:
      - "A background task (or hook in spawn_snapshot_refresher) that calls registry.upsert_agent() for each CandidateProc not already in the registry"
      - "A Tauri command or periodic check that syncs ProcessSnapshot candidates into AgentRegistry"
human_verification:
  - test: "Visual check of Tower Control view"
    expected: "View renders with TOWER CONTROL .01 header, TOWER_OFFLINE empty state, DEPLOY_AGENT button, QUICK_COMMANDS and SYSTEM_LOGS panels visible. Glassmorphism deploy overlay appears on button click. Command Horizon dark aesthetic matches wireframes."
    why_human: "Visual appearance, layout correctness, and Command Horizon compliance cannot be verified programmatically"
  - test: "Agent lifecycle round-trip"
    expected: "Clicking DEPLOY_AGENT and launching an agent causes it to appear in the manifest table with correct ID, protocol, status badge, and CWD. Clicking the row expands INTENT row. TERMINATE/CONFIRM/CANCEL flow works."
    why_human: "Real subprocess launch requires a running app and installed agent CLI binaries; cannot test without cargo tauri dev"
  - test: "Real-time conflict banner"
    expected: "When two agents write the same file within the conflict window, a CONFLICT_DETECTED banner appears immediately without polling, and the sidebar CONFLICTS nav badge shows a pulsing red dot with count"
    why_human: "Requires two live agent processes writing files concurrently; cannot simulate in automated test"
---

# Phase 3: Agent Management + Conflict Detection Verification Report

**Phase Goal:** User can see, launch, and control agents from a live manifest, and the system detects file conflicts between concurrent agents in real time
**Verified:** 2026-04-10T20:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can view a live manifest of all active agents showing ID, protocol type, status (Running/Idle/Waiting/Conflict/Error), and current file path | VERIFIED | AgentManifest.tsx renders AGENT_ID/PROTOCOL/STATUS/PROCESS_PATH columns; useAgentStore polls list_agents every 2s; StatusBadge has all 5 variants |
| 2 | User can launch new Claude Code, Codex, or OpenCode sessions from within the app and stop/terminate running agents | VERIFIED | DeployDialog.tsx calls launchAgent(); AgentRow.tsx has CONFIRM_TERMINATE flow calling terminateAgent(); all wired through Tauri commands to real launcher.rs subprocess logic |
| 3 | System detects externally-launched agent processes already running on the codebase | PARTIAL | Self-registration HTTP server (POST /register on 127.0.0.1:9417) enables detection when agents actively register. ProcessSnapshot scans running processes but does NOT feed results back to AgentRegistry — no bridge code exists. AGNT-03 is only half-satisfied. |
| 4 | When two agents write to the same file within the conflict window, the system immediately alerts the user with a visual indicator and notification | VERIFIED | ConflictEngine.process_batch() detects overlapping writes; emit_conflict_event() pushes conflict-detected Tauri event; conflictStore.subscribeToEvents() uses listen() for real-time push; ConflictBanner renders with aria-live="assertive"; ConflictNavBadge pings in sidebar |
| 5 | Agent adapter architecture is extensible — new agent types can be added without modifying core logic | VERIFIED | AgentAdapter async trait in adapter.rs; GenericAdapter parses TOML config (process_names, launch_command, state_running_regex, intent_regex) without any core code changes; T-03-01 regex validation at load time |

**Score:** 4/5 truths verified (1 partial = AGNT-03 gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/agents/adapter.rs` | AgentAdapter trait, AgentState enum, AgentInfo struct | VERIFIED | AgentAdapter with 6 async methods, 5-state enum with can_transition_to(), AgentInfo with camelCase serde |
| `src-tauri/src/agents/registry.rs` | AgentRegistry with RwLock HashMap, upsert/remove/get/all ops | VERIFIED | RwLock<HashMap<String, ManagedAgent>>, MAX_AGENTS=100 cap, find_adapter_for_process |
| `src-tauri/src/agents/generic.rs` | GenericAdapter with TOML config parsing | VERIFIED | GenericAgentConfig deserialization, Regex validation at load time, check_state_from_stdout, extract_intent_from_stdout |
| `src-tauri/src/db/migrations/002_phase3_enrichment.sql` | Phase 3 schema enrichment | VERIFIED | ALTER TABLE agent_sessions (adapter_type, protocol, intent, pid, cwd, launched_by_aitc) and conflict_events (conflict_window_ms, agent_a_id, agent_b_id, hunk_hints) |
| `src-tauri/src/agents/launcher.rs` | Detached subprocess spawning with stdout capture | VERIFIED | CREATE_NEW_PROCESS_GROUP\|DETACHED_PROCESS on Windows, Stdio::piped(), spawn_stdout_reader with 1000-line ring buffer, terminate_process via taskkill /T then /F |
| `src-tauri/src/agents/self_register.rs` | Axum HTTP server for self-registration | VERIFIED | POST /register on 127.0.0.1:9417, RegisterPayload, PID validation via sysinfo, rate limiting (10 req/sec), port fallback |
| `src-tauri/src/agents/commands.rs` | Tauri commands for agent CRUD | VERIFIED | list_agents, launch_agent, terminate_agent, update_agent_intent, get_agent_logs — all #[tauri::command] #[specta::specta] |
| `src-tauri/src/agents/notifications.rs` | Notification preferences and dispatch | VERIFIED | NotificationPrefs (on_running=false, on_idle/waiting/conflict/error=true), dispatch_state_notification using NotificationExt |
| `src-tauri/src/conflict/engine.rs` | ConflictEngine with sliding window | VERIFIED | per-file HashMap<PathBuf, Vec<FileWriteRecord>>, process_batch(), evict_expired(), sweep_empty_files() every 100 batches |
| `src-tauri/src/conflict/types.rs` | ConflictAlert, FileWriteRecord, ConflictState | VERIFIED | ConflictAlert with camelCase serde, hunk_hints_a/b, ConflictState with RwLock alerts + AtomicU64 window, 1000-alert cap |
| `src-tauri/src/conflict/commands.rs` | Tauri commands for conflict queries + emit helper | VERIFIED | list_conflicts, dismiss_conflict, get_conflict_settings, update_conflict_window (1000-60000ms validated), emit_conflict_event using app_handle.emit("conflict-detected") |
| `src/stores/agentStore.ts` | Zustand store for agent registry state | VERIFIED | useAgentStore with fetchAgents, launchAgent, terminateAgent, updateIntent, startPolling (2s interval), invoke('list_agents') |
| `src/stores/conflictStore.ts` | Zustand store for conflict alerts with Tauri event listener | VERIFIED | useConflictStore with subscribeToEvents() calling listen('conflict-detected'), event.payload appended to alerts, activeCount() |
| `src/views/TowerControl/TowerControl.tsx` | Tower Control main view | VERIFIED | TOWER CONTROL .01 header, stats bar, ConflictBanner, AgentManifest, sidebar with DEPLOY_AGENT, QuickCommands, SystemLogs; useEffect wires fetchAgents + subscribeToEvents + startPolling with cleanup |
| `src/views/TowerControl/AgentManifest.tsx` | Agent manifest table | VERIFIED | AGENT_ID/PROTOCOL/STATUS/PROCESS_PATH columns, TOWER_OFFLINE empty state, zebra striping |
| `src/components/ui/ConflictNavBadge.tsx` | Sidebar conflict count badge with ping | VERIFIED | radar-ping animation (scale 1-2.5, 2s, infinite), hidden when count=0, aria-live="polite" |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src-tauri/src/agents/claude_code.rs` | `adapter.rs` | `impl AgentAdapter for ClaudeCodeAdapter` | VERIFIED | Pattern confirmed in file |
| `src-tauri/src/agents/registry.rs` | `adapter.rs` | `Arc<dyn AgentAdapter>` in ManagedAgent | VERIFIED | `adapters: Vec<Arc<dyn AgentAdapter>>` |
| `src/stores/agentStore.ts` | Tauri invoke list_agents | `invoke('list_agents')` | VERIFIED | Direct invoke call in fetchAgents |
| `src/stores/conflictStore.ts` | Tauri listen conflict-detected | `listen('conflict-detected')` | VERIFIED | subscribeToEvents uses listen() with event.payload |
| `src/views/TowerControl/AgentManifest.tsx` | `agentStore.ts` | `useAgentStore` selector | VERIFIED | `const agents = useAgentStore((s) => s.agents)` |
| `src-tauri/src/pipeline/commands.rs` | conflict engine | broadcast channel fan-out | VERIFIED | broadcast::channel::<FileEventBatch>(256), conflict_tx feeds ConflictEngine task |
| `src-tauri/src/conflict/commands.rs` | frontend | `app_handle.emit("conflict-detected")` | VERIFIED | emit_conflict_event uses tauri::Emitter trait |
| `src-tauri/src/agents/self_register.rs` | `registry.rs` | `Arc<AgentRegistry>` via Extension | VERIFIED | registry.upsert_agent() called in register_agent handler |
| `ProcessSnapshot.candidates()` | `AgentRegistry` | (MISSING bridge) | NOT_WIRED | No code reads ProcessSnapshot candidates to populate AgentRegistry for AGNT-03 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `AgentManifest.tsx` | `agents` from `useAgentStore` | `invoke('list_agents')` → `registry.all_agents()` → `RwLock<HashMap>` | Yes (when agents in registry) | FLOWING |
| `ConflictBanner.tsx` | `alerts` from `useConflictStore` | `listen('conflict-detected')` → `ConflictEngine.process_batch()` → real FileEventBatch | Yes | FLOWING |
| `ConflictNavBadge.tsx` | `count` from `useConflictStore` | Same source as ConflictBanner | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Rust agent tests pass | `cargo test --lib -- agents:: --test-threads=1` | 44 tests passed | PASS |
| Rust conflict tests pass | `cargo test --lib -- conflict:: --test-threads=1` | 17 tests passed | PASS |
| Frontend store tests pass | `npx vitest run src/stores/__tests__/` | 15 tests passed (2 files) | PASS |
| Cargo build succeeds | `cargo build` in src-tauri | Finished dev profile with warnings only | PASS |
| Visual Tower Control | `cargo tauri dev` | SKIP — requires running app | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AGNT-01 | 03-04 | User can view live agent manifest (ID, protocol, status, file path) | SATISFIED | AgentManifest.tsx renders all 4 columns; useAgentStore polls every 2s |
| AGNT-02 | 03-02 | User can launch new agent sessions | SATISFIED | DeployDialog.tsx + launch_agent Tauri command + launcher.rs |
| AGNT-03 | 03-02 | System detects externally-launched agents | PARTIALLY SATISFIED | Self-registration HTTP server provides opt-in detection; process scan does NOT auto-populate registry |
| AGNT-04 | 03-01 | Extensible adapter architecture | SATISFIED | AgentAdapter trait + GenericAdapter TOML config |
| AGNT-05 | 03-02 | User can see agent intent | SATISFIED | Codex: CLI args extraction; OpenCode: -p flag; Claude Code: hooks infrastructure; manual labeling via update_agent_intent |
| AGNT-06 | 03-02 | User can stop/terminate agents | SATISFIED | terminate_agent command + AgentRow CONFIRM_TERMINATE flow |
| AGNT-07 | 03-01 | System tracks agent state transitions | SATISFIED | AgentState enum with can_transition_to(); update_state() with transition validation warning |
| CNFL-01 | 03-03 | Detect two agents writing same file within conflict window | SATISFIED | ConflictEngine sliding window, 10 TDD tests including same-PID and cross-window cases |
| CNFL-02 | 03-03, 03-04 | Immediately alert user when conflict detected | SATISFIED | emit_conflict_event() via broadcast fan-out; conflictStore listen('conflict-detected'); ConflictBanner aria-live="assertive" |
| CNFL-06 | 03-03 | Conflict detection runs in Rust backend | SATISFIED | ConflictEngine is pure Rust, runs in tokio task spawned from pipeline/commands.rs |

**Orphaned requirements check:** REQUIREMENTS.md maps CNFL-02 to Phase 3. Plan 03-03 covers CNFL-01 and CNFL-06. Plan 03-04 covers CNFL-02. All Phase 3 requirements are claimed by a plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src-tauri/src/lib.rs` | 17 | `// TODO: Load GenericAdapter configs from ~/.aitc/agents/*.toml` | Info | GenericAdapter exists and works but no config loading from disk yet. Not a blocker — only affects users who want custom agents. Expected deferred work. |
| `src-tauri/src/agents/claude_code.rs` | ~90 | Claude Code `get_intent()` always returns None from the adapter | Info | Intent detection infrastructure present (has_hooks_config, extract_intent_from_hooks_output) but stateless adapter returns None. Full flow requires command layer + stdout buffer access. Documented as intentional in SUMMARY. |

No blocker anti-patterns found. No stub returns (empty arrays, "not implemented" responses) in the user-visible flow.

### Human Verification Required

#### 1. Tower Control Visual Appearance

**Test:** Run `cargo tauri dev` from `C:/Users/prann/projects/aitc`, navigate to TOWER CONTROL view via sidebar
**Expected:** View renders with TOWER CONTROL .01 header and subtitle "MONITOR ACTIVE INTELLIGENCE PROTOCOLS", ACTIVE_AGENTS and CONFLICTS stats bar, TOWER_OFFLINE empty state when no agents, DEPLOY_AGENT primary button, QUICK_COMMANDS and SYSTEM_LOGS panels in right sidebar. Command Horizon dark aesthetic — dark surfaces, phosphor green accents (#8eff71), JetBrains Mono data fonts, zero-radius corners.
**Why human:** Visual appearance, layout hierarchy, and Command Horizon compliance cannot be verified programmatically.

#### 2. Deploy Dialog and Agent Launch

**Test:** Click DEPLOY_AGENT, select agent type, enter a valid working directory, click LAUNCH_AGENT
**Expected:** Glassmorphism overlay (backdrop-blur-xl) appears centered at 480px. Agent type selector shows Claude Code/Codex/OpenCode/Generic with primary-colored left border on selection. After launch, overlay closes and agent row appears in manifest with KAGENT-XXXX ID, correct protocol, RUNNING status badge.
**Why human:** Requires installed agent CLI binary (claude/codex/opencode) and running app to test the subprocess launch path.

#### 3. Real-Time Conflict Detection

**Test:** Start two agent sessions writing to the same file within 5 seconds of each other
**Expected:** CONFLICT_DETECTED banner appears immediately in Tower Control (not after next poll), sidebar CONFLICTS nav item shows pulsing red dot with count. Banner shows file path, agent IDs, and dismiss button.
**Why human:** Requires two live agent processes with file writes; cannot simulate in unit tests.

### Gaps Summary

One gap identified for AGNT-03: The "system detects externally-launched agents already running" success criterion is only partially satisfied. The self-registration HTTP server (POST /register on port 9417) provides detection for agents that actively announce themselves to AITC — this covers AITC-launched agents (which receive AITC_PORT env var) and any agent wrapper scripts that call the endpoint. However, the ProcessSnapshot from Phase 2 already scans for running processes matching the agent allowlist (claude, codex, opencode) on a 1-second cadence, but its candidates() output is never fed into AgentRegistry. A background task bridging ProcessSnapshot.candidates() to AgentRegistry.upsert_agent() would complete this requirement and make agent detection fully passive (no agent-side cooperation needed).

This is a functional gap for the stated success criterion. The self-registration path works for cooperative agents; silent detection of pre-existing agent processes does not.

---

*Verified: 2026-04-10T20:55:00Z*
*Verifier: Claude (gsd-verifier)*
