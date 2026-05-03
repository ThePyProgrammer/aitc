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

### Phase 7: Replace current blocked Codebase Map with a graph based codebase map with better spacing, properly sized nodes and traversal through the graph for agents (with ephemereally highlighted movement between nodes for me to track the agent's trail). The links between code should be stuff like imports/dependencies for now, and the files should have an additional gravitational force based on their proximity in the filesystem.

**Goal:** Replace the squarified-treemap radar with a force-directed graph: nodes are source files, edges are import/dependency relationships extracted via tree-sitter, filesystem proximity acts as gravity (folder islands), and agents leave 10s fading comet trails travelling along edges in their assigned palette colour. Heat map, minimap, agent manifest, and conflict pulse are preserved on the new graph layout. Treemap is fully removed.
**Requirements**: VIZN-01 (rewrite), VIZN-02 (rewrite), VIZN-04 (rewrite), VIZN-05 (rewrite), FMON-05 (preserve), EMON-01 (pulled forward from v2)
**Depends on:** Phase 6
**Plans:** 6 plans

Plans:
- [ ] 07-01-PLAN.md -- Wave 0: install Rust + JS deps, scaffold deps/ module + fixtures, get_dependency_graph stub command, regenerate bindings, extend radarStore shape, create 7 Wave 0 test files (EMON-01)
- [ ] 07-02-PLAN.md -- Rust dep extraction: tree-sitter parsers per language, per-language resolution (TS/JS/Rust/Python), rayon parallel orchestrator with edge caps, T-07-A/B/C mitigations, 10k-file <2s benchmark (EMON-01, VIZN-04)
- [ ] 07-03-PLAN.md -- forceCluster custom d3 force + useGraphLayout settle-then-freeze hook + radarStore refactor (fetchGraph, pin/unpin, commitSettledPositions; treeData removed) (VIZN-01, VIZN-05)
- [ ] 07-04-PLAN.md -- GraphRenderer pure functions (hulls, edges, arrows, nodes with heat tint) + RadarCanvas rewrite + delete useTreemapLayout + uninstall squarify + performance banners (VIZN-01, VIZN-04, VIZN-05)
- [ ] 07-05-PLAN.md -- CometTrail lifecycle (interpolate/sample/cull) + agent dot pulse + drag-to-pin + pipeline event subscription wiring (VIZN-02)
- [ ] 07-06-PLAN.md -- HeatMapOverlay refactor to node tint + RadarMinimap rewrite for graph extents (preserves e62272d shift) + conflict pulse on graph nodes + visual verification checkpoint (FMON-05, VIZN-04)

### Phase 8: Real Claude Code hook integration (PreToolUse approvals)

**Goal:** Every Claude Code permission prompt surfaces in the AITC Requests page and the agent blocks on the user's approve/deny until resolved. Replaces the current `--accept-edits` / `--dangerously-skip-permissions` chip workaround so users can run Claude Code safely without pre-authorising every tool.

**Scope:**
- New `/hook` endpoint on the self-register HTTP server that accepts PreToolUse events.
- Protocol: agent posts tool call context (tool name, inputs, file path, diff preview), AITC responds with `{decision: approve|deny, reason?}` after the user resolves the approval row.
- Ship a Claude Code hook config (e.g. `.claude/hooks/aitc-pretooluse.sh` or JSON settings) that launched agents install into their cwd and that posts PreToolUse events to AITC's `/hook`.
- Block Claude's tool call by holding the HTTP response until the user clicks approve/deny in the Requests page.
- DB migration: extend `approval_requests` with `tool_name`, `tool_input_json`, and a new `request_type = "pretool_use"`. Existing `write_access` rows stay unchanged.
- Frontend: per-tool context on ApprovalRequestCard (tool name badge, collapsible tool input preview). Deep-link the OS notification to the specific request.
- Timeout + failure handling: if AITC is unreachable or the user doesn't respond within N seconds, the hook falls back to a deny (fail safe).

**Out of scope:** PostToolUse hooks, Codex/OpenCode adapters (no hook surface yet), multi-user auth on the `/hook` endpoint.

**Requirements:** Carries forward the Phase 4 comms hub request flow; no new milestone requirements.
**Depends on:** Phase 7. (Also builds on the existing Phase 3 self-register server and Phase 4 approval UI.)
**Plans:** 6/6 plans complete

Plans:
- [x] 08-01-PLAN.md -- Wave 0: workspace + sidecar crate scaffold, DB migration 005, hook_waiters/hook_install/port_file module stubs, bundle+capability config, frontend ToolPreview registry stub, test fixtures (foundation)
- [x] 08-02-PLAN.md -- Wave 1 backend: /hook axum route with long-held response + AbandonGuard, WaiterRegistry impl, port_file writer, Tauri approve/deny/approve_with_edits signal waiters + terminate force-deny, e2e smokes (COMM-01/02/06, AGNT-03)
- [x] 08-03-PLAN.md -- Wave 1 sidecar: aitc-hook binary parses Claude PreToolUse stdin, POSTs /hook, emits modern hookSpecificOutput envelope, fail-safe deny on every error path (COMM-02, COMM-06)
- [x] 08-04-PLAN.md -- Wave 2 install: settings.local.json merge-safe writer, claude_code::launch chip-bypass wiring, passive consent event+commands, startup auto-heal, tauri-plugin-shell registration (AGNT-03, COMM-05)
- [x] 08-05-PLAN.md -- Wave 2 frontend: ToolBadge, per-tool ToolPreview renderers (Edit/Write/Bash/Notebook/ProtectedPath/Unknown), DontAskAgainCheckbox, PassiveHookConsentDialog, deepLinkNotification, RequestQueue abandoned-row treatment (COMM-01/02/03/05/06)
- [x] 08-06-PLAN.md -- Wave 3 e2e: cross-crate integration test driving real aitc-hook binary against real /hook endpoint (allow/allow_with_edits/deny/abandon); manual UAT + visual verification checkpoint against 08-UI-SPEC

### Phase 9: Implement a plugin / skill / tool / hook manager page that scans both ~/.claude/ and cwd/.claude/ via the watcher, this should be for me to track what things claude has access to at any one point and also edit the CLAUDE.md files in cwd/CLAUDE.md and cwd/.claude/CLAUDE.md if need be

**Goal:** Ship the ARSENAL page — a master/detail view under /arsenal that surfaces Skills, Agents, Plugins, and Configuration (Hooks+Commands+Settings+MCP) from both ~/.claude/ (global) and <cwd>/.claude/ (project) via a multi-root extension of the pipeline watcher, and provides an inline textarea editor for <cwd>/CLAUDE.md and <cwd>/.claude/CLAUDE.md with atomic writes + 10-second undo toast + non-blocking external-change banner. Backend parses all formats in Rust (gray_matter + serde_json), frontend mirrors the Phase 2 Channel<T>+Zustand trio. Establishes MasterDetailShell as a reusable layout primitive.
**Requirements**: (none — phase added mid-milestone; behavioral spec lives in D-01..D-15 of 09-CONTEXT.md)
**Depends on:** Phase 8
**Plans:** 5/5 plans executed (UAT skipped at user request)

Plans:
- [x] 09-01-PLAN.md -- Wave 0: backend deps (gray_matter, runtime tempfile, dirs), claude_resources module skeleton, ResourceEvent/Resource/Category/Scope types registered via tauri-specta, fixture tree, frontend Arsenal placeholders
- [x] 09-02-PLAN.md -- Wave 1: parse.rs (all resource categories + MCP secret masking), scan.rs (allowlist + exclude cache/session-env/projects/backups/downloads), routing.rs (classify + category_for_path), write_fence.rs (TTL suppression)
- [x] 09-03-PLAN.md -- Wave 2: claude_md.rs (atomic_write + editable whitelist), watcher_routing.rs (two-Debouncer architecture — persistent global + ephemeral project), commands.rs (start/stop/readClaudeMd/writeClaudeMd with D-13 write gate), state management, bindings regen
- [x] 09-04-PLAN.md -- Wave 2: frontend foundations — claudeResourcesStore (with D-03 shadow suppression in selectCombined), useClaudeResourcesChannel hook, MasterDetailShell primitive, ScopeChip/UndoToast/ExternalChangeBanner components
- [x] 09-05-PLAN.md -- Wave 3: ArsenalView assembly — Sidebar ARSENAL entry (Lucide Package, after TOWER), /arsenal route, ScopeTabs/CategoryRail/ResourceList/ResourceRow/DetailPanel/FrontmatterTable/ContentPreview/ClaudeMdEditor, save+undo+external-change wiring (human-verify checkpoint skipped per user)

### Phase 10: Implement a proper chat user interface for agents I deploy, since I can't do this right now at all. instead, I have to inspect the system logs or some shit which isn't good UI design.

**Goal:** Ship a first-class CHAT tab inside Communications Hub driven by a long-lived `claude --input-format stream-json` subprocess per chattable agent, a new `agent_events` transcript table, an MCP server hosted on the existing self-register axum port (get_pending_user_messages + request_user_input tools), FIFO stdin outbound with delivery-status lifecycle, auto-resume fallback via `claude --resume --print`, read-only stdout/stderr capture for Codex/OpenCode/Generic, and full deletion of the Phase 4 embedded chat surface (ChatThread, ChatInput, MiniChatCard). Tab state URL-synced; unread badges on Sidebar + CHAT tab + per-agent rows; OS notifications only on @user / awaiting-user signals.
**Requirements**: No new REQ-IDs; scope driven by CONTEXT.md decisions D-01..D-24. COMM-04 (freeform text messages to agents) carries forward from Phase 4 and is addressed implicitly by the new surface.
**Depends on:** Phase 9
**Plans:** 6/6 plans complete

Plans:
- [x] 10-01-PLAN.md — Wave 0: DB migration 006 (agent_events + one-shot chat_messages migration), backend scaffolds (chat_runtime/, mcp/, db/events.rs), 7 stream-json fixtures, DeliveryStatus `consumed` variant, MasterDetailShell width props, frontend component + store stubs
- [x] 10-02-PLAN.md — Wave 1 chat_runtime core: session_registry, db/events CRUD, stream-json parser (with @250ms idle flush), FIFO outbound writer, launcher live-session, supervisor, auto_resume, Tauri commands (send/list/clear/markRead/relaunch)
- [x] 10-03-PLAN.md — Wave 1 MCP server: Streamable HTTP POST/GET/DELETE /mcp on self_register host, two-tool surface (get_pending_user_messages + request_user_input), per-session .claude/aitc-mcp-{id}.json atomic writer
- [x] 10-04-PLAN.md — Wave 2 integration: AgentAdapter::capabilities trait + ClaudeCodeAdapter long-lived rewrite (MCP config + stream-json), dispatch_chat_notification body + @user regex in parser, codex/opencode raw_stdout capture, Phase 4 send_chat_message/list_chat_messages/update_message_delivery_status DELETED
- [x] 10-05-PLAN.md — Wave 3 frontend: chatStore (9-listener subscription), useChatChannel, all 9 event cards + dispatcher, ChatInput bound to store, TanStack Virtual AgentChannelList (active/archived), ChatTranscript reverse-scroll with loadOlder + new-messages pill, UnreadBadge, CommsTabBar
- [x] 10-06-PLAN.md — Wave 4 integration + UAT: CommsView tab routing (URL-synced), ChatView full detail pane with 2-click CLEAR_THREAD, App-root useChatChannel, Sidebar COMMS unread dot, D-21 frontend deletions (ChatThread/ChatInput/MiniChatCard + RequestDetail + TelemetryPanel + commsStore cleanup), human-verify checkpoint against 10-UI-SPEC
**UI hint**: yes


### Phase 11: Move d3-force simulation to a WebWorker with Transferable Float32Arrays for non-blocking layout computation

**Goal:** Relocate the d3-force simulation from the React main thread into a dedicated WebWorker; positions flow back as Transferable Float32Array; zero visual change; success = no main-thread long tasks >50ms during a 5k-node settle. (Completed 2026-04-21.)
**Requirements**: VIZN-04 (performance — in spirit, no new REQ-IDs)
**Depends on:** Phase 10
**Plans:** 4/4 plans complete

Plans:
- [x] 11-01-PLAN.md -- Wave 0: scaffold src/workers/ module stubs + test files + graphSimConfig extraction
- [x] 11-02-PLAN.md -- Wave 1: pure graphSimCore + BufferPool (3-cap) + 12 core tests + 5 pool tests green
- [x] 11-03-PLAN.md -- Wave 2: graphSim.worker.ts postMessage shim (53 LOC) + useGraphLayout Worker-client rewrite + 13 mocked-Worker tests green
- [x] 11-04-PLAN.md -- Wave 3: RadarCanvas hot path reads Float32Array + benchmark harness (D-31..D-34) + VERIFICATION.md

**Verification status:** Passed (2026-04-21). User-confirmed manual smoke: worker loads cleanly in Tauri prod build, visual invariance preserved, force-config sliders "damn responsive" (live D-31 proxy witness — sim is off main thread). Zoom-scroll lag surfaced during manual smoke; not a Phase 11 regression (hot-path gate short-circuits when sim is settled); carried to Phase 11.1.

### Phase 11.1: Fix zoom-scroll lag in RadarCanvas (INSERTED)

**Goal:** Make wheel-driven zoom in/out on the Radar feel smooth on a settled graph. Surfaced during Phase 11 manual smoke: scrolling the wheel to zoom causes significant UI lag. Not a Phase 11 regression — the hot-path gate short-circuits when `isSimulatingRef.current === false`, so the render loop is byte-identical to Phase 7. Fix is scoped as performance-only; no visual change; no new capability.

**Likely causes (to investigate during plan phase):**
- (a) Wheel events fire at 120–240Hz on modern trackpads, driving React re-renders faster than rAF can consume → coalesce wheel events through rAF.
- (b) `drawFolderHulls` recomputes convex hulls per frame even when positions are static → cache hulls keyed on `settledAt` / a positions-generation counter.
- (c) `storeSetViewport(viewport)` round-trip triggers Zustand subscribers (minimap, force-config panel?) to re-render on every wheel event → audit subscriber list and move to a ref-based publication pattern if the cost shows up.

**Requirements**: No new REQ-IDs (perf refactor of VIZN-04 delivery).
**Depends on:** Phase 11
**Plans:** 1/1 plans complete

Plans:
- [x] 11.1-01-PLAN.md — Wave 1: wheel rAF coalescer + useRafCoalesced hook + defensive viewport writeback throttle + settledAt-keyed hullCache + drawFolderHulls rewrite + radarPerfDebug rolling-p95 diagnostic (D-01..D-19; VIZN-04 perf delivery)

**Verification status:** Code-complete 2026-04-21 (commits `16c663a` / `969db53` / `b367489` / `cb218e2`). Verifier confirmed 19/19 D-XX witnesses pass; 0 new test regressions; workers untouched (`git diff HEAD~5 -- src/workers/` empty). Pending manual wheel-zoom smoke in the Tauri prod build (`localStorage.radarPerfDebug = '1'` to capture numeric evidence).

### Phase 12: Add IPC bridge nodes and cross-language boundary visualization — parse tauri-specta bindings.ts for the command surface, cross-reference invoke() callers with #[tauri::command] handlers, render bridge nodes on a visible frontend/backend boundary line

**Goal:** Extend the Phase 7 graph radar with a first-class IPC-bridge layer: each #[tauri::command] becomes a diamond-shaped bridge node pinned on a horizontal y=0 boundary line; TS/TSX files cluster above via a new forceBoundary force, Rust files cluster below; hover + click surface bridge metadata (command, handler, signature, callers); BOUNDARY slider in ForceConfigPanel tunes the bifurcation strength.
**Requirements**: V-12-01..V-12-24 (phase-local witnesses — no new REQ-IDs; extends VIZN-01 / VIZN-05 / EMON-01 in spirit)
**Depends on:** Phase 11
**Plans:** 5 plans

Plans:
- [x] 12-01-PLAN.md — Wave 0 foundation + test scaffolding (Rust module skeleton, fixtures, panic-stubs, forceBoundary skeleton, 5 frontend test scaffolds) — completed 2026-04-21, commits `a6e6a46` / `8038742`
- [x] 12-02-PLAN.md — Wave 1 Rust scanners (bindings_parser regex, rust_handler_scanner rayon, frontend_callsite_scanner tree-sitter, build_ipc_bridges merge; V-12-01..V-12-12) — completed 2026-04-21, commits `f7192e0` / `4cc570b` / `4ee804b`
- [x] 12-03-PLAN.md — Wave 2 Tauri command wiring (get_ipc_bridges + EdgeKind::{Invokes,Handles} + lib.rs registration + bindings regen; V-12-13..V-12-14) — completed 2026-04-21, commits `b5ccbab` / `3a1bf30`
- [x] 12-04-PLAN.md — Wave 3 store + worker (radarStore widen, forceBoundary physics, worker protocol + graphSimCore registration, useGraphLayout payload; V-12-15..V-12-20) — completed 2026-04-21, commits `4bc9b35` / `62cf031`
- [x] 12-05-PLAN.md — Wave 4 canvas + UI + human-verify (BridgeRenderer, BridgeTooltip, BridgeDetailPanel, RadarManifest wiring, RadarCanvas z-order + hit-test, BOUNDARY slider, prod smoke checkpoint; V-12-21..V-12-24) — code complete 2026-04-21, commits `9604920` / `b86c0f8` / `b48b46f`; 36/36 automated witnesses green

**Verification status:** Passed (2026-04-22). D-34 human-verify UAT approved — user smoke confirmed bridge diamonds on the boundary line, no layout shift on detail-panel selection, anchor labels scale correctly with zoom. Four visual-polish items surfaced (aura circle from `drawNodes` not filtering bridges; folder hulls enveloping bridges via unfiltered `hullCache`; FRONTEND/BACKEND labels blend into theme; dangling-vs-populated bridge distinction too subtle) — none invalidate the Phase 12 deliverable; all tracked as Phase 22 polish. Post-ship quick-task `260422-dqu` (commits `6b9f1bb` / `e7fe5b8`) shipped the runtime no-bridges guard so the boundary layer cleanly hides on non-Tauri repos; structural polyglot generalization tracked as Phase 21.

### Phase 13: Implement 4-level semantic zoom — workspace (package blobs only), package (sub-packages + file dots), file (names + edges + agent indicators), code (content preview + function signatures). Replace current 3-tier shouldRenderHullAtZoom with a full semantic zoom system that changes representation, not just visibility

**Goal:** User can smoothly zoom the Radar across four semantic representations — WORKSPACE package blobs, PACKAGE sub-package blobs plus file dots, FILE names/edges/agent indicators, and CODE signature cards — while bridge, agent, conflict, pan/zoom, minimap, and 10k-file performance constraints remain intact.
**Requirements**: VIZN-01, VIZN-04, VIZN-05, DSGN-01, DSGN-04
**Depends on:** Phase 12
**Plans:** 6 plans

Plans:

**Wave 0**
- [ ] 13-01-PLAN.md — Wave 0 Nyquist test scaffold for semantic zoom, package blobs, code preview, and renderer regressions

**Wave 1 *(blocked on Wave 0 completion)***
- [ ] 13-02-PLAN.md — Pure semantic zoom helpers, package blob derivation/rendering, FILE-level labels, and semantic edge filtering

**Wave 2 *(blocked on Wave 1 completion)***
- [ ] 13-03-PLAN.md — RadarCanvas workspace/package/file representation orchestration, semantic HUD, and dominant hit-testing
- [ ] 13-04-PLAN.md — Guarded best-effort source signature extraction, Tauri binding, and GraphNode metadata merge

**Wave 3 *(blocked on Wave 2 completion)***
- [ ] 13-05-PLAN.md — CODE-level capped signature cards with fallback copy and RadarCanvas overlay integration

**Wave 4 *(blocked on Wave 3 completion)***
- [ ] 13-06-PLAN.md — Final automated validation and blocking semantic zoom human UAT checkpoint

### Phase 14: Multi-layer offscreen canvas rendering — separate static graph (hulls, edges, nodes) from animated agent layer (trails, dots, pulses). Cache layers 1-5 to offscreen canvases, composite per frame. Only the agent layer (6) and DOM overlay (7) redraw at 60fps

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 13
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 14 to break down)

### Phase 15: Enhanced agent overlay — ATC radar display patterns with 6-point history trails (exponential opacity decay), data blocks on leader lines showing agent callsign + current file + activity rate + intent, 3-tier conflict escalation adapted from TCAS (advisory/warning/critical), and velocity vectors for predicted agent movement direction

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 14
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 15 to break down)

### Phase 16: Typed edge system + temporal coupling — add typed edges (import/ipc-call/type-share/temporal-coupling) with distinct visual styles (thin solid, thick dashed, dotted, faint). Integrate git-based temporal coupling analysis (files that change together) as faint weighted edges. Add Louvain community detection for automatic file clustering that reveals actual code communities beyond directory structure

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 15
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 16 to break down)

### Phase 17: Conflict-triggered PreToolUse gating — replace tool-category gating (Edit/Write/Bash always prompt) with file-conflict gating (prompt only when another active agent is touching the same file). See 17-CONTEXT.md for the full pitch and open design questions.

**Goal:** Swap PreToolUse gate predicate from tool-category (Edit/Write/Bash always prompt) to file-conflict (prompt only when another live agent is actively touching the same canonical file within the conflict window). Preserve protected_paths OR-branch, always-allow cache, long-held HTTP transport, and bypass chips from Phase 8. 23 locked D-XX decisions plus 2 research-surfaced amendments (D-14b window_ms param per RESEARCH §1, D-15b update_pid_mapping wire-up per RESEARCH §Pitfall 5).
**Requirements**: CNFL-01, CNFL-02, CNFL-06, COMM-01, COMM-02, COMM-06 (inherited — no new REQ-IDs)
**Depends on:** Phase 8
**Plans:** 6 plans

Plans:
- [x] 17-01-PLAN.md — Wave 1: `agents/bash_paths.rs` module — safelist + verb dispatch (cp/mv/rm/touch/mkdir/patch/sed -i/awk inplace/dd of=/install/tee + stdout redirects) + operator-split + 25 unit tests. D-09..D-13. Mitigates T-17-01.
- [x] 17-02-PLAN.md — Wave 1: `ConflictEngine::could_conflict_with` with amended D-14b signature (window_ms as 4th param) + `GateReason` enum (snake_case serde, specta::Type) + `canonicalize_for_conflict` shared helper + 11 unit tests. D-01/D-02/D-03/D-05/D-14/D-14b/D-20. Mitigates T-17-05.
- [x] 17-03-PLAN.md — Wave 1: Scaffolding — Cargo.toml direct deps (`shlex = "1.3"`, `path-clean = "1.0"`), `pub mod bash_paths` registration, migration 007 (ALTER TABLE approval_requests ADD conflict_with_agent_id TEXT, gate_reason TEXT + UPDATE app_settings SET pretool_gated_tools='[]'). D-18/D-19/D-20. Mitigates T-17-06.
- [x] 17-04-PLAN.md — Wave 2: Engine sharing — construct `Arc<tokio::sync::Mutex<ConflictEngine>>` once in lib.rs setup + register as Tauri State + axum Extension + refactor pipeline conflict_task to pull from managed state + extend `hook_handler` signature + `build_router` + `start_registration_server` + `spawn_hook_server` test fixture + `make_hook_pool` test schema (adds the two new columns). D-15/D-16. Mitigates T-17-04. No behavior change — mechanical wiring only.
- [x] 17-05-PLAN.md — Wave 3: Rewrite `hook_handler` gate predicate — conflict query + Bash dispatch + protected_paths OR-branch + always-allow-first + liveness gate via `registry.get_agent(&id).is_some()` (D-04 clarified per RESEARCH §5) + wire `update_pid_mapping` in resolve_or_create_agent (D-15b) + extend `create_approval_request_internal` signature + SQL + `ApprovalRequest` struct + 6 new integration tests in `phase17` submodule + pivot 3 existing hook tests + tracing keys (`hook_gate`, `hook_allow`, `hook_lock_wait`, `conflict_query`). D-01..D-18, D-21, D-23. Mitigates T-17-02/T-17-03/T-17-07.
- [x] 17-06-PLAN.md — Wave 4: Frontend + UAT — regenerate `src/bindings.ts` via canonical command + extend `commsStore` ApprovalRequest interface + `ApprovalRequestCard` conditional render (⚠ CONFLICT with {id} in text-error amber, 🔒 PROTECTED path in #ffd16f warning) + 5 vitest cases + blocking human-verify UAT checkpoint (6 scenarios: two-agent conflict, solo-agent silence, protected-path, Bash safelist, Bash-verb conflict, OS notification deep-link). D-22/D-23. **Phase code-complete 2026-04-22 — awaiting UAT sign-off at `17-06-CHECKPOINT.md`.**

### Phase 18: Fix passive-scan registry flooding. AgentRegistry hits its MAX_AGENTS=100 cap within seconds of startup because passive_bridge.bridge_tick registers a PASSIVE-{pid} for every claude/codex/opencode-named process on the machine — including unrelated interactive CLI sessions in other terminals, plus short-lived subprocesses that Phase 10 long-lived stream-json runtime spawns (MCP request handlers, aitc-hook fires, node helpers). Once capped, new KAGENT launches fail with 'Registry at capacity (100)'. Need to scope passive registration to only processes that actually matter: PIDs that self-registered via /register, or PIDs whose cwd is inside the active watched repo AND command-line matches a narrow AITC-compatible shape, or a hybrid where noisy subprocess children do not get their own registry entry (only the parent claude/codex does). Also raise MAX_AGENTS ceiling as a safety net. Pre-existing bug from Phase 3 (T-03-03 throttle) / Phase 6 (passive_bridge). Phase 10 amplified it with 4 long-lived sessions.

**Goal:** Scope `passive_bridge::bridge_tick` to drop subprocess children whose parent is itself an in-scope allowlisted candidate (D-01/D-02 hybrid filter: cwd-in-repo + parent-PID-in-candidate-set), formalize `MAX_AGENTS = 1000` as an intentional emergency ceiling with an explanatory doc comment (D-03), and expose a read-only `get_registry_stats` Tauri command backed by a new `capacity_hits_since_start: AtomicU64` on `AgentRegistry` for post-hoc debugging (D-04). Preserve AGNT-03 (externally-launched agents with non-candidate shell parents still register).
**Requirements**: AGNT-03 (preservation-class — filter must not break external agent detection)
**Depends on:** Phase 17
**Plans:** 4 plans

Plans:
- [x] 18-01-PLAN.md — Wave 1: parent-PID in-candidate-set filter inside `bridge_tick` + `cand_with_parent` helper + 5 new unit/regression tests (parent-drops-children, orphaned-child-registers, child-of-cwd-filtered-parent-promoted, 1+50 flood regression, AGNT-03 preservation). Core fix. (D-01, D-02, D-05, AGNT-03) — completed 2026-04-21, 8min, 7 commits (7355a3f..525a3fe), 12/12 passive_bridge tests pass
- [x] 18-02-PLAN.md — Wave 1: `capacity_hits_since_start: AtomicU64` field on `AgentRegistry` + increment on `upsert_agent`'s at-capacity branch + `RegistryStats` struct with specta derives + `snapshot_stats()` method + 2 unit tests. (D-03, D-04, D-05) — completed 2026-04-21, 8min, 6 commits (0d9b526..e173800), 11/11 registry tests pass
- [x] 18-03-PLAN.md — Wave 2: `get_registry_stats` Tauri command in `agents/commands.rs` + registration in `lib.rs` `collect_commands!` + `RegistryStats` type registration + verified `src/bindings.ts` regen. Depends on 18-02. (D-04) — completed 2026-04-21, 7min, 2 commits (05ce27e..a5c3d70), 7/7 agents::commands + 11/11 agents::registry tests pass, getRegistryStats() + RegistryStats TS type live in bindings
- [x] 18-04-PLAN.md — Wave 2: rewrite `MAX_AGENTS` doc comment with D-03 rationale (why 1000, why not 100, why not configurable) + forward-pointer to 18-02's `capacity_hits_since_start` and 18-03's `get_registry_stats` Tauri command. Depends on 18-02 (same file, different region). (D-03) — completed 2026-04-21, 3min, 1 commit (8571af0), 11/11 registry tests pass, cargo build --lib clean, rustdoc parses clean

### Phase 19: Polish Phase 10 chat transcript rendering. Four related gaps surfaced during UAT: (1) Repeated assistant_text chunks — the parser/aggregator emits many small rows per turn (one per content_block_delta flush) instead of merging contiguous text into a single row. Even with the isContinuation label fix from 9c2f4e8, adjacent chunks still feel visually duplicated. Fix: aggregator-side turn-boundary merging or a store-side selector that collapses adjacent assistant_text events. (2) Tool-use cards don't represent what Claude did well — TOOL · EDIT path shows a raw truncation, no hunk count / diff preview for MultiEdit or Write, BashPreview shows command but not exit code / output. Need richer summary derivation + tighter visual treatment matching codey's collapsed details-summary aesthetic. (3) Markdown fences show as literal text — assistant_text body uses whitespace-pre-wrap so triple-backticks and * emphasis and - lists don't render. Need react-markdown + remark-gfm integration (codey's prose prose-sm prose-neutral dark:prose-invert pattern) with code-block syntax highlighting via the existing shiki / useSyntaxHighlight Phase 5 dep. (4) SessionStart hook line noise — 4x [HOOK_STARTED] SessionStart:startup + 4x [HOOK_RESPONSE] SessionStart:startup appear at every session boot because the parser emits raw stdout lines for each hook event --verbose surfaces. A parser filter should suppress pure hook-announcement lines (or fold them into a single system_note summarizing N hooks fired on SessionStart). All four are UI/parser polish; no schema changes.

**Goal:** Ship Phase 10 chat transcript polish in four surgical changes: (D-01) coalesce assistant_text chunks at the aggregator so one DB row is written per assistant turn (progressive reveal preserved via existing agent-assistant-delta emit path); (D-02) enrich tool-use collapsed rows with per-tool summary dispatcher returning `{primary, secondary?}` (Edit/MultiEdit hunks, Write lines, WebFetch host+path) plus a green/red/grey status dot sourced from the paired tool_result via a new `selectToolUseWithResult` store selector; (D-03) render assistant markdown via react-markdown + remark-gfm + rehype-sanitize with code-fence highlighting through the existing Phase 5 useSyntaxHighlight shiki singleton; (D-04) silently drop SessionStart:* hook envelopes at `parser::dispatch_system`. No schema changes, no new Tauri commands, no new StreamEvent variants; Phase 8 ToolPreview registry untouched. 21 Nyquist assertions V-19-01..V-19-21 gate the work.
**Requirements**: No new REQ-IDs (polish-only phase). Scope driven by CONTEXT.md decisions D-01..D-04 (21 sub-decisions) and VALIDATION.md V-19-01..V-19-21.
**Depends on:** Phase 18
**Plans:** 4 plans

Plans:
- [x] 19-01-PLAN.md — Wave 0: install react-markdown@^10 + remark-gfm@^4 + rehype-sanitize@^6 + @tailwindcss/typography@^0.5; wire `@plugin "@tailwindcss/typography"` into theme.css; create 3 stream-json fixtures (coalesced_turn, interrupted_turn, hook_pretool_use); scaffold MarkdownBody.test.tsx (7 .todo entries keyed to V-19-13..V-19-19) + chatStore.test.ts selectToolUseWithResult describe block + mkToolUse/mkToolResult factories. (dependency foundation for Waves 1 + 2) — completed 2026-04-21, 9min, 3 commits (1c9ac0e..a1a0c0a), vitest 21 passed + 10 todo, `npm run build` 6.42s clean, RESEARCH.md Open Q#3 resolved (@plugin on line 2 first-try)
- [x] 19-02-PLAN.md — Wave 1 Rust: D-04 dispatch_system SessionStart silent drop (4-line parser edit) + 2 tests (V-19-20, V-19-21); D-01 run_event_aggregator TurnBuffer coalescing (AssistantText arm no longer writes; TurnComplete flushes one row; StdoutClosed flushes interrupted turn + synthesizes agent-turn-complete with terminalReason:"interrupted"; @user notification preserved pre-buffer per Pitfall 1) + 4 tests (V-19-01..V-19-04). Single file: src-tauri/src/chat_runtime/parser.rs. (D-01, D-04) — completed 2026-04-21, 11min, 3 commits (e7de43e..2948369), `cargo test --lib chat_runtime::parser::tests` 17 passed / 0 failed; reader EOF-flush added as Rule 3 blocker fix (required for V-19-02 end-to-end); StreamEvent schema + insert_agent_event signature + agents/commands.rs call site untouched (verified empty `git diff --stat`)
- [x] 19-03-PLAN.md — Wave 2 frontend markdown: new `src/components/chat/MarkdownBody.tsx` with react-markdown + remarkGfm + rehypeSanitize + CodeBlock (shiki via highlightLines + dangerouslySetInnerHTML OUTSIDE the sanitizer tree per Pattern 4); migrate @user tokenizer from AssistantTextCard into MarkdownBody; AssistantTextCard delegates body render via `<MarkdownBody content={content} streaming={streaming}/>`; replace 7 .todo stubs with V-19-13..V-19-19 assertions. (D-03) — completed 2026-04-21, 10min, 3 commits (d6697b7..a3c5975), MarkdownBody 165 lines, AssistantTextCard 105→68 lines, MarkdownBody.test.tsx 7/7 green + AssistantTextCard.test.tsx 6/6 green, `npm run build` 15.74s clean, V-19-17 input tweaked for react-markdown HTML-block semantics (Rule 1 test-fixture fix); 4 pre-existing failures in full-suite (D-02 + new D-04 useGraphLayout flake) left per "only fix own bugs"
- [x] 19-04-PLAN.md — Wave 2 frontend tool-use: export `selectToolUseWithResult(events, toolUseId)` from chatStore.ts (pure linear scan, returns {toolUse, toolResult}); flip 3 chatStore .todo tests to V-19-08 assertions; ToolUseCard.tsx per-tool dispatcher ({primary, secondary?}) + 8px status dot before TOOL label (green/red/grey from paired tool_result.is_error) + py-1.5 + bg-surface-container/10 visual polish; add 7 new tests (V-19-05..V-19-07, V-19-09..V-19-12). Phase 8 ToolPreview registry untouched (Pitfall 6 scope guard). (D-02) — completed 2026-04-21, 15min, 3 commits (368958c..090b57e), chatStore.test.ts 24/24 green (3 new V-19-08) + ToolUseCard.test.tsx 11/11 green (7 new V-19-05..V-19-12) + EventCard.test.tsx 9/9 green; `bg-primary`/`bg-error` used instead of RESEARCH sketch's non-existent `bg-status-*` tokens (matches theme.css Command Horizon vocabulary); useMemo + module-level EMPTY_EVENTS sentinel on useChatStore selector prevents infinite-render loop under useSyncExternalStore (Rule 1 bug auto-fixed in source commit); `git diff --stat src/views/CommsHub/ToolPreview/` empty (Phase 8 contract preserved); `git diff --stat src-tauri/` empty (D-02.3 backend untouched); `npm run build` exits 0; Phase 19 complete (pending combined manual UAT with Plan 19-03 markdown body)

### Phase 20: Diff-aware agent polling — replace the wholesale `set({ agents })` in agentStore's 2s poll loop with a diff-emit mechanism so only changed agents trigger re-renders

**Goal:** [To be planned] — Replace the wholesale `set({ agents, isLoading: false })` in `src/stores/agentStore.ts:89–93` `fetchAgents()` with a diff-aware update: compare the incoming agent list to the current store array, apply per-agent patches (upsert changed, remove missing, keep untouched by reference) so Zustand's reference-equality selectors let unchanged subscribers (AgentChannelList, Tower, etc.) skip re-render. In sessions with 20+ agents the current 2s poll produces ~30 full-list re-renders per minute for a single state delta. Perf-only scope; no behavioral change; no schema change. Source: surfaced by the 2026-04-21 codebase inefficiency survey as the highest-ROI frontend perf fix.
**Requirements**: TBD (no new REQ-IDs expected — perf-only delivery of existing agent-manifest surface)
**Depends on:** Phase 19
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 20 to break down)

### Phase 21: Polyglot IPC bridge extractor — pluggable per-language parsers (FastAPI/Flask/Django, tRPC, OpenAPI, gRPC, Express/Fastify, Python↔TS) + auto-detected boundary labels (generalize Phase 12 beyond Tauri)

**Goal:** [To be planned] — Generalize the Phase 12 IPC bridge extractor beyond the Tauri-specific binary (tauri-specta `src/bindings.ts` + `#[tauri::command]`) to any cross-language API surface. Ship pluggable per-language extractors in a new `pipeline/ipc_bridges/extractors/` submodule covering FastAPI/Flask/Django route decorators, tRPC router definitions, OpenAPI/Swagger specs, gRPC `.proto` files, Express/Fastify route registrations, and Python↔TS message-passing contracts (JSON-RPC, WebSocket envelopes). Replace the hardcoded "FRONTEND · TypeScript" / "BACKEND · Rust" boundary labels with per-repo auto-detected language groupings — e.g. "TYPESCRIPT" above and "PYTHON" below for a TS+Python repo, or three lanes for monorepos with TS + Python + Go. Detect the primary frontend/backend axis from file-type distribution + inferred dependency flow (imports crossing the language boundary). Reuse Phase 12's IpcBridgeDto shape, `get_ipc_bridges` Tauri command surface, `forceBoundary` mechanic, and bridge diamond rendering — changes are additive (new extractor trait, dynamic boundary-label selection in `BridgeRenderer.drawBoundaryAnchorLabels`) not breaking. Surfaced during Phase 12 UAT on a "2 TS frontends + Python backend" repo where the hardcoded Tauri binary split was misleading. Quick-task 260422-dqu shipped a runtime no-bridges guard as the short-term fix (so non-Tauri repos cleanly hide the boundary layer today); this phase is the structural generalization that makes the layer meaningful on polyglot repos.
**Requirements**: TBD (extends VIZN-01 / VIZN-05 / EMON-01 in spirit; no new REQ-IDs expected)
**Depends on:** Phase 12
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 21 to break down)

### Phase 22: Phase 12 bridge layer visual polish — kill the aura circle, exclude bridges from folder hulls, boost FE/BE label contrast, change dangling signal from dashed-stroke to grey-fill

**Goal:** [To be planned] — Four concrete visual fixes surfaced during Phase 12's D-34 UAT smoke. None invalidate the Phase 12 deliverable (all 24 witnesses V-12-15..V-12-24 remain green); all are layering/rendering defects on top of working code. (1) **Aura bug** — `RadarCanvas:726` passes `liveNodes` unfiltered to `drawNodes`, so every bridge GraphNode gets drawn as a 5px file-node circle underneath the diamond from `drawBridgeNodes`. The two passes use different zoom-scaling math (`drawNodes` fixed world-space radius vs `drawBridgeNodes` BRIDGE_HALF_DIAG/zoom), producing a visible halo that inverts across zoom (aura > diamond at low zoom, aura < diamond at high zoom). Fix: filter `liveNodes.filter(n => n.kind !== 'bridge')` before passing to `drawNodes` + `drawFileLabels`. (2) **Convex hull around bridges** — `hullCache.ts:86` groups nodes by `dirKey` without a `kind` filter; bridges carrying their handler file's `dirKey` get included in folder-hull computation and pull the hull centroid toward y=0. Fix: skip `n.kind === 'bridge'` in the group-by-dirKey loop so bridges stand alone on the boundary line. (3) **FRONTEND/BACKEND anchor labels blend into theme** — currently drawn with `theme.onSurfaceVariant` (same token as folder labels) so they read as chrome, not axis markers. Fix: swap to `theme.onSurface` at full opacity + add a `theme.surface/80` padded backdrop rect behind each label so they pop against busy graph regions. (4) **Dangling-vs-populated bridge distinction too subtle** — D-09/D-17 locked "dashed stroke for dangling, solid for populated" but at BRIDGE_HALF_DIAG=8 world-space, a 1px `[4, 3]` dash pattern on an 8-unit shape is genuinely hard to see. Change dangling from "cyan fill + dashed stroke" to "transparent/grey fill + solid stroke" (color as primary signal, stroke pattern secondary); populated bridges keep cyan fill; channel-bearing double-stroke continues to work on both states. Fifth deferred item from the UAT report: BOUNDARY slider "relatively responsive, could have been better" — logged to deferred-items.md if alpha-restart value + force decay rate don't feel right during Phase 22 smoke; not a blocker. All fixes are additive to Phase 12 — zero schema changes, no worker protocol changes, no new dependencies. Planner should scope to ~2-3 plans grouped by file overlap.
**Requirements**: TBD (polish-only — V-12-15..V-12-24 remain the acceptance gate; new tests cover the specific fixes)
**Depends on:** Phase 12
**Plans:** 2 plans

Plans:
- [x] 22-01-PLAN.md — Render-layer composition fixes (Fix 1 aura removal in RadarCanvas + Fix 2 bridge exclusion in hullCache) — W-22-01..W-22-03
- [x] 22-02-PLAN.md — BridgeRenderer visual tokens (Fix 3 FE/BE anchor label contrast + Fix 4 dangling bridge color signal) — W-22-04..W-22-07
