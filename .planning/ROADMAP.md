# Roadmap: AI Traffic Controller

## Overview

AITC is built bottom-up following its dependency chain: a Tauri + React shell with design system tokens (Phase 1), then the Rust-powered real-time data pipeline for file watching and process monitoring (Phase 2), then agent management and conflict detection services (Phase 3), then the four core UI views that consume those services (Phase 4), and finally the complex conflict resolution UI, session history, and heat map polish (Phase 5). Each phase delivers a coherent, independently verifiable capability. The critical path runs through file watcher -> conflict engine -> conflict resolution UI.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation + App Shell** - Tauri v2 scaffold, React routing across 4 views, SQLite persistence layer, Command Horizon design system
- [x] **Phase 2: Real-Time Data Pipeline** - Rust file watcher with debouncing/reconciliation, process monitoring, event batching over IPC (completed 2026-04-10)
- [ ] **Phase 3: Agent Management + Conflict Detection** - Agent registry with adapter architecture, launch/observe agents, conflict detection engine
- [ ] **Phase 4: Core UI Views** - Tower Control manifest, Communications Hub, Airspace Radar visualization, system tray notifications
- [ ] **Phase 5: Conflict Resolution + History** - 3-way merge UI, session/conflict/approval history, file heat map, final polish
- [ ] **Phase 6: Pipeline Activation + Integration Wiring** - Wire usePipelineChannel into UI, bridge ProcessSnapshot→AgentRegistry, activate session file tracking (gap closure)

## Phase Details

### Phase 1: Foundation + App Shell
**Goal**: Developer can launch AITC and navigate between four styled views in a native desktop window with system tray presence
**Depends on**: Nothing (first phase)
**Requirements**: SHELL-01, SHELL-02, SHELL-03, SHELL-04, DSGN-01, DSGN-02, DSGN-03, DSGN-04
**Success Criteria** (what must be TRUE):
  1. App launches as a native Tauri v2 desktop window with system tray icon
  2. User can navigate between four views (Radar, Tower, Comms, Conflicts) via sidebar
  3. All views render with Command Horizon design system -- dark room aesthetic, phosphor greens, zero-radius corners, Space Grotesk + monospace typography, radar pulse animations for status indicators
  4. User can open a command palette for quick navigation
  5. SQLite database exists with schema and migrations applied on first launch
**Plans:** 4 plans
Plans:
- [x] 01-01-PLAN.md -- Scaffold Tauri v2 project, Command Horizon design tokens, test infrastructure
- [x] 01-02-PLAN.md -- Rust backend (tray, SQLite, splash screen) and app shell layout (titlebar, sidebar, routing)
- [x] 01-03-PLAN.md -- Animated view empty states, reusable UI components, command palette
- [x] 01-04-PLAN.md -- Component tests and visual verification checkpoint
**UI hint**: yes

### Phase 2: Real-Time Data Pipeline
**Goal**: System can watch a repository directory tree in real time, attribute file events to processes, and stream batched events to the frontend without data loss
**Depends on**: Phase 1
**Requirements**: FMON-01, FMON-02, FMON-03, FMON-04
**Success Criteria** (what must be TRUE):
  1. File read/write events across a repository are captured in real time by the Rust backend using filesystem watchers
  2. File events are attributed to specific agent processes via PID correlation
  3. System handles 10k+ file codebases without excessive CPU/memory (debouncing and event batching active)
  4. System detects whether agents share a working tree or use isolated git worktrees
**Plans:** 4/4 plans complete
Plans:
- [x] 02-01-PLAN.md -- Wave 0: Rust deps (notify 8, notify-debouncer-full 0.7, sysinfo 0.38, ignore 0.4), pipeline module scaffold, FileEvent types, Channel lifetime + sysinfo cost smoke tests
- [x] 02-02-PLAN.md -- File watcher actor (150ms debouncer, writes-only filter, hardcoded excludes), tree index walker (gitignore-aware, 10k files <500ms), notify→tokio sync bridge
- [x] 02-03-PLAN.md -- Process snapshot (sysinfo allowlist filter, best-effort PID attribution via cwd prefix match), attributing stream that rewrites FileEventBatch in-flight
- [x] 02-04-PLAN.md -- Worktree porcelain parser, Tauri commands (start_watch/stop_watch/list_worktrees) wiring watcher+snapshot+Channel<FileEventBatch>, Zustand pipelineStore + usePipelineChannel hook

### Phase 3: Agent Management + Conflict Detection
**Goal**: User can see, launch, and control agents from a live manifest, and the system detects file conflicts between concurrent agents in real time
**Depends on**: Phase 2
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, AGNT-06, AGNT-07, CNFL-01, CNFL-02, CNFL-06
**Success Criteria** (what must be TRUE):
  1. User can view a live manifest of all active agents showing ID, protocol type, status (Running/Idle/Waiting/Conflict/Error), and current file path
  2. User can launch new Claude Code, Codex, or OpenCode sessions from within the app and stop/terminate running agents
  3. System detects externally-launched agent processes already running on the codebase
  4. When two agents write to the same file within the conflict window, the system immediately alerts the user with a visual indicator and notification
  5. Agent adapter architecture is extensible -- new agent types can be added without modifying core logic
**Plans:** 4 plans
Plans:
- [x] 03-01-PLAN.md -- AgentAdapter trait, AgentState/AgentInfo types, AgentRegistry, built-in + GenericAdapter implementations, DB migration
- [x] 03-02-PLAN.md -- Detached subprocess launcher, self-registration HTTP server, terminate, Tauri agent commands, lib.rs wiring
- [x] 03-03-PLAN.md -- Conflict detection engine (sliding window per-file), ConflictState, conflict Tauri commands
- [x] 03-04-PLAN.md -- Frontend stores (agentStore, conflictStore), Tower Control UI view, StatusBadge extensions, ConflictNavBadge, pipeline conflict wiring

### Phase 4: Core UI Views
**Goal**: User can approve/deny agent requests from a communications hub, view agents spatially on a codebase radar, and receive native OS notifications for urgent events
**Depends on**: Phase 3
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, COMM-05, COMM-06, VIZN-01, VIZN-02, VIZN-04, VIZN-05
**Success Criteria** (what must be TRUE):
  1. User sees a queue of pending approval requests with file paths and code diff previews, and can approve, deny, ask for more info, or approve-with-edit
  2. User can send freeform text messages to an agent via the Communications Hub chat interface
  3. User can view a 2D spatial radar plotting agents as dots on a file-tree-based codebase map with trajectory lead lines
  4. Radar renders performantly via Canvas 2D for codebases with 10k+ files
  5. Native OS notifications and system tray alerts fire when an agent requires user action
**Plans:** 5 plans
Plans:
- [x] 04-01-PLAN.md -- Backend foundation: DB migration 002, comms Tauri commands (approval workflow + chat + protected paths), get_tree_index pipeline command
- [x] 04-02-PLAN.md -- Communications Hub approval core: commsStore, 3-panel layout, RequestQueue, InlineDiff with editable lines, ApprovalActions, PendingCountBadge
- [x] 04-03-PLAN.md -- Airspace Radar core: radarStore, squarified treemap layout, Canvas 2D rendering with zoom/pan, agent dots with pulse animation
- [x] 04-04-PLAN.md -- Comms Hub chat + telemetry: ChatThread with delivery status, TelemetryPanel, SystemLoad, MiniChatCard, OS notification wiring
- [x] 04-05-PLAN.md -- Radar interaction: lead lines with fade, RadarManifest, AgentTooltip, RadarMinimap, visual verification checkpoint
**UI hint**: yes

### Phase 5: Conflict Resolution + History
**Goal**: User can resolve file conflicts via a 3-way merge UI with agent intent context, browse past sessions and conflicts, and see cross-agent file contention at a glance
**Depends on**: Phase 4
**Requirements**: CNFL-03, CNFL-04, CNFL-05, FMON-05, VIZN-03, HIST-01, HIST-02, HIST-03, HIST-04
**Success Criteria** (what must be TRUE):
  1. User can view a 3-way merge UI showing Agent A changes, base file, and Agent B changes side by side, with agent intent displayed alongside code diffs
  2. User can accept changes per-hunk from either agent or manually edit the resolution
  3. File heat map overlay on the radar shows contention intensity across the codebase
  4. User can browse past agent sessions, resolved conflicts, and approval decision history from the app
**Plans:** 5 plans
Plans:
- [x] 05-01-PLAN.md -- Rust backend: SQLite migration (conflict_resolutions, session_files tables), BackupManager, resolution Tauri commands, session/history queries
- [x] 05-02-PLAN.md -- Frontend libraries: node-diff3 + shiki install, merge.ts (3-way merge computation), contention.ts (heat map scoring), useSyntaxHighlight hook, historyStore
- [x] 05-03-PLAN.md -- Merge UI: conflictStore resolution state, MergeView layout, UnifiedDiff with syntax highlighting, HunkNavigator, HunkResolutionControls, IntentPanel, ResolutionToolbar
- [x] 05-04-PLAN.md -- Heat map overlay on radar (HeatMapOverlay Canvas function, radarStore extension, toggle button) + History view (HistoryView with 3 tabbed virtualized tables, sidebar/router update)
- [x] 05-05-PLAN.md -- Integration wiring (contention score updates, StatusBadge/Button extensions, type fixes) + visual verification checkpoint
**UI hint**: yes

### Phase 6: Pipeline Activation + Integration Wiring
**Goal**: All cross-phase integration points are connected — pipeline activates from UI, passive agent detection works, and session file tracking populates data
**Depends on**: Phase 5
**Requirements**: FMON-01, FMON-02, FMON-03, FMON-04, AGNT-03, HIST-01
**Success Criteria** (what must be TRUE):
  1. File watcher starts automatically when a repository is opened via the UI (usePipelineChannel wired into TowerControl or App mount)
  2. ProcessSnapshot candidates are periodically bridged to AgentRegistry for passive agent detection
  3. Session file write counts are populated via record_session_file during pipeline events
  4. Radar treemap populates with live file tree data when a watch is active
**Plans:** 5 plans
Plans:
- [x] 06-01-PLAN.md -- Wave 0: install tauri-plugin-dialog (Rust + TS), scaffold test files + module stubs
- [x] 06-02-PLAN.md -- Wave 1: repo_session.rs commands + repoStore + RepoSessionProvider mount (FMON-01, FMON-04)
- [x] 06-03-PLAN.md -- Wave 2: db/session.rs lifecycle + AgentRegistry::find_agent_by_pid/reap_passive_agents + self_register PASSIVE/KAGENT reconciliation (HIST-01, AGNT-03, FMON-02)
- [x] 06-04-PLAN.md -- Wave 3: pipeline/passive_bridge.rs + forwarder session-file persistence (AGNT-03, FMON-02, HIST-01)
- [x] 06-05-PLAN.md -- Wave 4: radar↔pipeline bridge + TopBar RepoStatusChip/PauseToggle/ChangeRepo + e2e smoke + human-verify checkpoint (FMON-01, FMON-03, FMON-04)
**Gap Closure**: Closes gaps from v1.0 milestone audit

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + App Shell | 0/4 | Planning complete | - |
| 2. Real-Time Data Pipeline | 4/4 | Complete    | 2026-04-10 |
| 3. Agent Management + Conflict Detection | 0/4 | Planning complete | - |
| 4. Core UI Views | 0/5 | Planning complete | - |
| 5. Conflict Resolution + History | 0/5 | Planning complete | - |
| 6. Pipeline Activation + Integration Wiring | 0/5 | Planning complete | - |
