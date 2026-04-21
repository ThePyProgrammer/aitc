---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 18-02 complete; plan 18-03 ready to start
last_updated: "2026-04-21T05:40:32Z"
last_activity: 2026-04-21 -- Phase 18-02 completed (AgentRegistry capacity counter + RegistryStats + snapshot_stats + 2 tests, 6 commits)
progress:
  total_phases: 19
  completed_phases: 12
  total_plans: 59
  completed_plans: 57
  percent: 96
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-07)

**Core value:** A developer can see exactly what every AI agent is doing across their codebase in real time, prevent destructive conflicts between concurrent agents, and approve/deny agent actions from a single command center.
**Current focus:** Phase 11.1 — fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin

## Current Position

Phase: 18 (fix-passive-scan-registry-flooding-agentregistry-hits-its-ma) — EXECUTING
Plan: 2 of 4 complete (18-01 ✓, 18-02 ✓; 18-03, 18-04 pending)
Status: Executing Phase 18 wave 1 complete (18-01 + 18-02 both in)
Last activity: 2026-04-21 -- Phase 18-02 completed (registry capacity counter + RegistryStats + snapshot_stats)

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**

- Total plans completed: 22
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |
| 2 | 4 | - | - |
| 03 | 4 | - | - |
| 05 | 5 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 05 P03 | 13min | 2 tasks | 8 files |
| Phase 05 P04 | 19min | 2 tasks | 10 files |
| Phase 05 P05 | 18min | 2 tasks | 2 files |
| Phase 9 P04 | 383 | 3 tasks | 12 files |
| Phase 09 P03 | 17m | 3 tasks | 8 files |
| Phase 10 P01 | 14 min | 3 tasks | 66 files |
| Phase 10 P02 | 60 min | 3 tasks | 11 files |
| Phase 10 P03 | 10 min | 2 tasks | 9 files |
| Phase 10 P04 | 20m | 3 tasks | 14 files |
| Phase 10 P05 | 13min | 3 tasks | 24 files |
| Phase 10 P06 | 14 min | 3 tasks | 13 files |
| Phase 18 P01 | 8 min | 1 task (7 commits) | 1 file |
| Phase 18 P02 | 8 min | 1 task (6 commits) | 1 file |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

-

- [Phase 05]: Used Map copies for immutable resolution state in conflictStore merge actions
- [Phase 05]: Used Map for contentionScores in radarStore; extended StatusBadge with 8 new variants for history tables
- [Phase 05]: Consolidated immediate + periodic contention score updates into single useEffect; StatusBadge resolved variant reused from Plan 04
- [Phase 9]: Used vi.mock factory internals to avoid hoist-order errors when mocking @tauri-apps/api/core for Channel hooks
- [Phase 9]: ExternalChangeBanner uses single pending union with 3s lapse timer for two-click destructive confirmation pattern
- [Phase 09]: 09-03: Simpler-fallback coordination between pipeline::start_watch and start_claude_resources_watch (each spawns its own Debouncer over disjoint roots) rather than SharedDebouncerRegistry; D-05 spirit preserved, registry deferred.
- [Phase 10]: Enabled specta's serde_json cargo feature so AgentEvent.payload_json can be serde_json::Value (not raw String).
- [Phase 10]: Forward-declared chat_runtime::types::AgentEvent in Task 1 so db::events.rs compiles at commit boundary (Rule 3 blocker auto-fix).
- [Phase 10]: Module-level EMPTY_EVENTS sentinel in ChatTranscript Zustand selector avoids React 19 useSyncExternalStore infinite-loop guard.
- [Phase 10]: Plan 02: adapter_chat_duplex is a local Plan-02 rule (claude-code only); Plan 04 may widen via AgentAdapter capability API
- [Phase 10]: Plan 02: parser uses aggregator-mpsc pattern — reader is pure-logic, downstream aggregator (Plan 04) owns DB writes + Tauri emits
- [Phase 10]: Plan 02: auto_resume validates session_id as hyphenated UUID shape before Command::arg (T-10-11)
- [Phase 10]: UUIDv4 via the uuid crate (v4 feature) rather than hand-rolled getrandom — already a transitive dep via tauri-utils; direct-import gives one-line Uuid::new_v4().to_string() safer than manual RFC 4122 bit fixup
- [Phase 10]: call_get_pending_user_messages v1 returns empty messages list — stdin JSONL writer is the primary user→agent transport per D-08; MCP tool is Claude fallback only. Documented so downstream plans don't rely on it for primary delivery
- [Phase 10]: call_request_user_input is fire-and-forget v1 — inserts system_note transcript row + fires OS notification + returns ack immediately; long-hold is Phase 11+ polish. User replies via ChatInput through normal send_chat_message_to_agent path
- [Phase 10]: GET /mcp returns 405 (SSE upgrade v1-deferred); MCP 2025-03-26 makes SSE optional, Claude Code 2.x polls via POST when it sees non-2xx on GET. Full SSE is Phase 11+ candidate
- [Phase 10]: Plan 04: LaunchOptions.agent_id minted UP FRONT via uuid::Uuid::new_v4().simple()[:4].to_uppercase() so duplex adapters can write per-session MCP config before spawn. Honors explicit agent_id for D-04 relaunch continuity.
- [Phase 10]: Plan 04: AdapterCapabilities flags-struct + trait-method-with-default (chat_duplex: false) widens Plan 02's inline adapter_type match into a typed per-adapter API. ClaudeCodeAdapter overrides to true; Codex/OpenCode/Generic inherit default.
- [Phase 10]: Plan 04: D-21 deletion scope — Phase 4 send_chat_message/list_chat_messages/update_message_delivery_status + ChatMessage type removed from backend. chat_messages DB table kept empty (migration 006) in case rollback needed; Plan 06 catches lingering frontend callers via TS errors.
- [Phase 10]: Plan 06: Task 3 is a blocking human-verify UAT checkpoint — Plan 06 automation is complete but Phase 10 is NOT closed until developer signs off against 10-UI-SPEC.md via 10-06-CHECKPOINT.md
- [Phase 10]: Plan 06: ?tab=chat / ?agent=<id> URL schema finalized; CommsTabBar prop shape (unreadChat + onTabChange) confirmed; setSearchParams uses replace mode to avoid history pollution from tab/selection churn
- [Phase 10]: Plan 06: D-21 Phase 4 frontend chat artifacts DELETED — ChatThread.tsx, MiniChatCard.tsx, Phase-4-era ChatInput.tsx (new Phase 10 version at src/components/chat/ChatInput.tsx); commsStore scrubbed of ChatMessage/messages/sendMessage/fetchMessages; TelemetryPanel AGENT_CHANNELS section gone
- [Phase 18]: Plan 01: D-02 parent-PID filter lives inside bridge_tick after cwd-scope, before reap/upsert — candidate_pids HashSet built from post-cwd in_scope; filter reads ProcessInfo.parent_pid (NOT CandidateProc.parent, which is the seed type). None-branch retention preserves AGNT-03 (shell/PID-1 parents).
- [Phase 18]: Plan 01: cand_with_parent test helper takes parent_pid: u32 positionally and wraps in Some(); existing cand (parent=None default) preserved for 6+ legacy tests. Flood regression test uses all_agents().len()==1 as the authoritative invariant — 51 candidates fit under MAX_AGENTS=1000 so "no capacity hit" is not a meaningful witness.
- [Phase 18]: Plan 02: capacity_hits_since_start counter lives on AgentRegistry (not passive_bridge) — registry-level framing matches the existing 'Registry at capacity' error message and counts ALL upsert failures, not just PASSIVE churn. Relaxed ordering; no happens-before with other memory.
- [Phase 18]: Plan 02: snapshot_stats loads the atomic BEFORE acquiring the read lock (Pitfall 7 / T-18-02) — gives monotonic-lagging semantics, never 'from the future'. No write-lock acquisition, so diagnostic polling does not contend with upsert_agent's write path.
- [Phase 18]: Plan 02: RegistryStats fields are u32/u64 (not usize) per the authoritative PLAN.md signature — specta/TS-cross-boundary-friendly, avoids platform-dependent usize width. 10,000x MAX_AGENTS headroom for u32 count fields.

### Roadmap Evolution

- Phase 7 added: Replace current blocked Codebase Map with a graph based codebase map with better spacing, properly sized nodes and traversal through the graph for agents (with ephemereally highlighted movement between nodes for me to track the agent's trail). The links between code should be stuff like imports/dependencies for now, and the files should have an additional gravitational force based on their proximity in the filesystem.
- Phase 8 added: Real Claude Code hook integration (PreToolUse approvals) -- builds /hook endpoint, ships hooks config, blocks Claude on approval rows; replaces the --accept-edits / --dangerously-skip-permissions chip workaround.
- Phase 9 added: Implement a plugin / skill / tool / hook manager page that scans both ~/.claude/ and cwd/.claude/ via the watcher, this should be for me to track what things claude has access to at any one point and also edit the CLAUDE.md files in cwd/CLAUDE.md and cwd/.claude/CLAUDE.md if need be.
- Phase 10 added: Implement a proper chat user interface for agents I deploy, since I can't do this right now at all. instead, I have to inspect the system logs or some shit which isn't good UI design.
- Phase 11 added: Move d3-force simulation to a WebWorker with Transferable Float32Arrays for non-blocking layout computation
- Phase 12 added: Add IPC bridge nodes and cross-language boundary visualization (tauri-specta bindings → bridge nodes on frontend/backend boundary)
- Phase 13 added: Implement 4-level semantic zoom (workspace → package → file → code)
- Phase 14 added: Multi-layer offscreen canvas rendering (static graph cached, only agent layer redraws at 60fps)
- Phase 15 added: Enhanced ATC agent overlay (6-point trails, data blocks, leader lines, 3-tier TCAS conflict escalation, velocity vectors)
- Phase 16 added: Typed edge system + temporal coupling + Louvain community detection
- Phase 17 added: Conflict-triggered PreToolUse gating — replace tool-category gating with file-conflict gating. Full pitch + 3 design questions in 17-CONTEXT.md. Builds on Phase 08.
- Phase 11.1 inserted after Phase 11 (2026-04-21): Fix zoom-scroll lag in RadarCanvas — wheel-event rAF coalescing + investigate folder-hull caching + audit Zustand viewport writeback cascade. URGENT — surfaced during Phase 11 manual smoke. Not a Phase 11 regression; performance-only scope; no visual change.
- Phase 18 added: Fix passive-scan registry flooding. AgentRegistry hits MAX_AGENTS=100 cap within seconds of boot because passive_bridge matches every claude/codex/opencode-named process on the machine (including unrelated CLI sessions + short-lived subprocess children). Surfaced during Phase 10 UAT — new KAGENT launches fail with "Registry at capacity (100)". Scope passive registration to self-registered PIDs or narrow cwd+cmdline matches; raise MAX_AGENTS as a safety net. Pre-existing bug from Phase 3/Phase 6; Phase 10's long-lived sessions amplified it.
- Phase 19 added: Polish Phase 10 chat transcript rendering. Four UAT-surfaced gaps: (1) repeated assistant_text chunks (aggregator emits one row per content_block_delta flush — merge into one row per turn); (2) richer tool-use card summaries + diff/hunk/exit-code previews matching codey's details-summary aesthetic; (3) markdown rendering via react-markdown + remark-gfm + existing shiki highlighter for code fences / emphasis / lists; (4) filter SessionStart hook noise (4×[HOOK_STARTED] + 4×[HOOK_RESPONSE] per boot) in the parser or collapse to a single system_note. All UI/parser polish on the working Phase 10 pipeline; no schema changes.

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2: Windows ReadDirectoryChangesW buffer overflow under agent burst writes needs empirical testing
- Phase 2: PID-to-file-event correlation on Windows may need ETW investigation
- Phase 3: Conflict window data model has no existing reference implementations
- Phase 5: 3-way merge UI complexity -- study GitKraken, VS Code merge editor for patterns

## Quick Tasks Completed

| ID | Description | Date | Commits |
|----|-------------|------|---------|
| 260414-k8p | Cross-OS CI (Linux/Windows/macOS + Arch container) | 2026-04-14 | e29775b, 0346d38, d8678f9 |
| 260415-gke | Modal Change-Repo dialog (replace inline confirm) | 2026-04-15 | ab94b96, c273caa |
| 260421-igz | Rename top bar title AI_CONTROL_CENTRE → AI_CMD_CENTRE | 2026-04-21 | 236b46e |
| 260421-fast | Rename top bar title AI_CMD_CENTRE → AI_CONTROL_CENTRE | 2026-04-21 | 3cffd8b |

## Session Continuity

Last session: 2026-04-21T05:40:32Z
Stopped at: Phase 18-02 complete; plan 18-03 ready to start
Resume file: .planning/phases/18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma/18-03-PLAN.md
