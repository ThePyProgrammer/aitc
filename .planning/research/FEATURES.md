# Feature Landscape

**Domain:** AI Agent Orchestration / Developer Tool (Desktop)
**Researched:** 2026-04-07
**Competitive context:** Conductor, Coder Mux, cmux, amux, Composio Agent Orchestrator, Overstory

## Table Stakes

Features users expect from an AI agent orchestration tool. Missing any of these and the product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Agent process listing** | Every competitor (Conductor, Mux, cmux) shows running agents with status. Users need to know what is alive. | Low | Tower Control manifest -- agent ID, protocol, status, PID/path. Already in wireframe. |
| **Agent launch/spawn** | Conductor, Mux, and amux all let you start agents from the UI. Mandatory for a "control center." | Medium | Must support Claude Code, Codex, OpenCode at minimum. Adapter pattern needed. |
| **Real-time agent status** | cmux shows notification rings; Conductor shows activity indicators. Users expect live feedback. | Medium | Running / Idle / Waiting for approval / Conflict / Error states. Websocket or Tauri event bridge from Rust watchers. |
| **File activity monitoring** | Core premise of the app. Without real-time file read/write tracking, there is no "traffic control." | High | chokidar-style watcher in Rust (notify crate). Must handle 10k+ files. Debounce and batch events. |
| **Approval request workflow** | Claude Code hooks emit approval requests. This is the primary human-in-the-loop interaction. | Medium | Queue of pending requests with approve/deny/ask-for-more-info. Already designed in Communications Hub wireframe. |
| **Conflict detection** | The fundamental value proposition. Competitors either use worktree isolation (avoidance) or warn about conflicts without solving them. | High | Detect when 2+ agents touch the same file. Timestamp-based or content-hash diffing. Must be real-time, not post-merge. |
| **Session persistence** | Every tool tracks history. Users need to review what happened while they were away. | Medium | SQLite local DB. Agent sessions, file events, approval decisions, conflict resolutions. |
| **System tray / notifications** | cmux has macOS notifications; amux has mobile push. Agents run long -- users switch away. Must pull them back for approvals/conflicts. | Low | Tauri system tray + native OS notifications. Critical for "unattended but supervised" workflow. |
| **Multi-agent protocol support** | Conductor supports Claude Code + Codex. Mux supports 5+ models. Monoprotocol = niche dead end. | High | Extensible adapter architecture from day 1. Each agent type has different lifecycle (hooks for Claude Code, CLI for Codex, process for OpenCode). |
| **Workspace isolation awareness** | Conductor and Mux auto-create git worktrees. The app must at minimum understand whether agents share a workspace or are isolated. | Medium | Detect worktree vs shared-directory mode. Conflict detection strategy differs by mode. |

## Differentiators

Features that set AITC apart from competitors. Not expected, but create competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Spatial codebase radar** | No competitor has this. Conductor shows a list; Mux shows a dashboard; cmux is a terminal. AITC maps agents to a 2D spatial representation of the file tree -- genuinely novel. | High | The "killer feature." File tree as spatial layout (directories = regions, files = coordinates). Agents as moving dots. Must be performant with large codebases -- canvas/WebGL, not DOM. |
| **Real-time conflict resolution UI** | Competitors punt on conflicts (use worktrees to avoid them, or fail to merge). AITC shows a 3-way merge UI with agent context (intent). Closest analogue is GitKraken, but with agent awareness. | Very High | Three-panel view: Agent A changes, Central (base), Agent B changes. Per-hunk accept/reject. Show agent intent alongside code. Already wireframed. |
| **Agent intent display** | No competitor surfaces WHY an agent is touching a file. AITC can parse agent task descriptions and show "Agent A's intent: optimizing memory allocation" alongside its file edits. | Medium | Parse from agent hooks / task metadata. Display in radar tooltips, tower manifest, and conflict resolution panels. |
| **Dark-room ATC aesthetic** | Command Horizon design system is architecturally distinct. Conductor/Mux look like standard dev tools. cmux looks like a terminal. AITC looks like a mission control center. | Medium | Phosphor greens, radar indicators, pulse animations, zero-radius. Not just skin-deep -- the UI metaphors (radar, tower, comms) shape how users think about the problem. |
| **Detect-and-resolve over preventive locking** | Competitors either isolate agents into worktrees (no conflicts possible, but also no shared-workspace support) or lock files preventively (friction). AITC lets agents work freely on the same tree and resolves conflicts when they occur. | High | This is a philosophical differentiator. Supports the "multiple agents, one checkout" workflow that worktree-based tools cannot. Riskier but more natural for solo dev with 2-3 agents on overlapping areas. |
| **Cross-agent file heat map** | Show which files are "hot" (touched by multiple agents). No competitor visualizes file contention spatially. | Medium | Overlay on radar view. Color intensity = number of agents touching that file region. Early warning system before conflicts. |
| **Agent observation (attach to external)** | Most tools only manage agents they launch. AITC can detect and attach to externally-launched agents (e.g., Claude Code started from terminal). | High | Process detection + hook injection. Claude Code hooks make this feasible. Codex/OpenCode need process monitoring. |
| **Approval request intelligence** | Show the code diff alongside the approval request so the developer has full context without switching windows. Add one-click "approve with edit" for minor tweaks. | Medium | Communications Hub already wireframed with code preview. "Approve with edit" would be additive. |
| **Conflict timeline / replay** | Show temporal sequence of how a conflict developed (Agent A wrote at T1, Agent B wrote at T2). Helps developer understand causation, not just final state. | Medium | Requires storing event history per file. Render as timeline in conflict resolution view. |

## Anti-Features

Features to explicitly NOT build. These are traps that would bloat scope, violate the product philosophy, or serve a different audience.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Agent-to-agent direct communication** | Adds massive complexity. Overstory and amux do this and it leads to compounding errors and debugging nightmares. AITC is a controller, not a mesh network. | All coordination flows through the human via the controller. Agents are independent; the human is the orchestrator. |
| **Task decomposition / planning** | Composio Agent Orchestrator and Overstory handle breaking issues into subtasks. This is a different product (project manager, not traffic controller). | Accept tasks as given. The developer assigns tasks to agents. AITC monitors execution, not planning. |
| **CI/CD integration** | Composio auto-fixes CI failures. This pulls the product into DevOps territory and away from the core real-time monitoring value. | Stay focused on the coding phase. Post-commit is out of scope. |
| **Cloud/remote agent hosting** | Mux supports SSH remotes; Codex runs in cloud sandboxes. AITC is a desktop app for local agents. | Monitor local processes only. Remote agent support is a v2+ concern. |
| **Multi-user / team collaboration** | Explicitly out of scope per PROJECT.md. Solo developer only. | Design data models to be single-user. Do not add auth, permissions, or sharing. |
| **AI-powered auto-merge** | Tempting but dangerous. No tool has reliable auto-merge for semantic conflicts. GitHub Copilot just added merge conflict resolution (March 2026) and it is PR-level, not real-time. | Present conflicts clearly to the human. The human decides. AI can suggest, but must not auto-apply. |
| **Built-in code editor** | VS Code, Cursor, etc. already exist. Embedding an editor adds enormous complexity for marginal value. | Show diffs and previews. Link/open files in the user's preferred editor. |
| **Agent marketplace / plugin store** | Premature. The adapter architecture should be extensible via code, not via a discovery/install marketplace. | Ship adapter API docs. Community can build adapters. No store UI needed for v1. |
| **Mobile companion app** | amux has a PWA. But AITC is desktop-first and the interaction model (3-way merge, spatial radar) does not translate to mobile. | Native OS notifications suffice for "away from desk" awareness. |
| **Token/cost tracking** | Some tools (Codegen, Mux) track API costs. Useful but tangential to traffic control. | Out of scope for v1. Agents manage their own billing. |

## Feature Dependencies

```
File Activity Monitoring
  |-> Conflict Detection (requires knowing which agents touch which files)
  |-> Spatial Codebase Radar (requires file-to-agent mapping)
  |-> Cross-Agent File Heat Map (requires aggregated file touch data)

Agent Process Listing
  |-> Agent Launch/Spawn (listing must exist before launch UI)
  |-> Agent Observation (external detection feeds the same listing)
  |-> Real-time Agent Status (status is a property of listed agents)

Conflict Detection
  |-> Conflict Resolution UI (detection triggers resolution flow)
  |-> Conflict Timeline (requires stored conflict event history)

Agent Launch/Spawn
  |-> Multi-Agent Protocol Support (adapters power the launch mechanism)

Session Persistence (SQLite)
  |-> Approval Request Workflow (persist decisions)
  |-> Session History (query past sessions)
  |-> Conflict Timeline (query past events)

Approval Request Workflow
  |-> Approval Request Intelligence (enhanced version with diffs)
```

## MVP Recommendation

**Prioritize (Phase 1 -- Core Loop):**
1. File activity monitoring (Rust notify crate) -- the foundation everything depends on
2. Agent process listing with real-time status -- the Tower Control manifest
3. Conflict detection -- the core value proposition
4. System tray + notifications -- agents run long, user must be pulled back

**Prioritize (Phase 2 -- Interaction):**
5. Approval request workflow -- the primary human-in-the-loop interaction
6. Spatial codebase radar -- the killer differentiator, but requires file monitoring to be solid first
7. Agent launch/spawn with adapter architecture -- start with Claude Code adapter (richest hooks API)

**Prioritize (Phase 3 -- Resolution):**
8. Conflict resolution UI (3-way merge) -- complex but essential for the full value loop
9. Session persistence and history -- needed before this for storing conflict data
10. Agent intent display -- enhances conflict resolution and radar

**Defer to v1.x:**
- Agent observation (attach to external agents) -- complex process detection, Claude Code hooks help but Codex/OpenCode are harder
- Cross-agent file heat map -- nice visualization, not critical path
- Conflict timeline/replay -- enhances resolution but not required for it
- Approval request intelligence (approve-with-edit) -- polish feature

**Defer to v2+:**
- Remote agent support
- Additional agent adapters beyond the initial 3

## Competitive Positioning

| Capability | Conductor | Mux | cmux | amux | Composio | AITC |
|------------|-----------|-----|------|------|----------|------|
| Agent monitoring | List view | Dashboard | Terminal tabs | Web dashboard | CLI | Spatial radar + manifest |
| Conflict strategy | Worktree isolation | Worktree + divergence alerts | None | Task isolation | Worktree | Detect-and-resolve on shared tree |
| Conflict resolution | Git merge (manual) | Git merge (manual) | N/A | N/A | Auto-retry CI | 3-way merge UI with agent context |
| Approval workflow | No | No | Notification escape codes | No | No | Full approve/deny/chat hub |
| Agent launch | Yes | Yes | Terminal spawn | Yes | Yes | Yes (adapter pattern) |
| External agent detection | No | No | No | No | No | Yes (planned) |
| Desktop native | Mac only | Electron/Tauri | Mac only | Web/PWA | CLI | Tauri (Windows primary) |
| Aesthetic | Standard dev tool | Standard dev tool | Terminal | Web dashboard | CLI | ATC command center |

AITC's unique position: the only tool that (a) monitors agents on a shared working tree instead of isolating them into worktrees, (b) provides spatial visualization of agent activity, and (c) offers a purpose-built conflict resolution UI. This targets the "2-3 agents on overlapping code" use case that worktree isolation tools do not address.

## Sources

- [Composio Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) -- parallel agent fleet management with worktrees
- [Conductor](https://www.conductor.build/) -- Mac app for parallel coding agents (YC-backed)
- [Coder Mux](https://github.com/coder/mux) -- desktop app for isolated parallel agentic development
- [cmux](https://cmux.com/) -- native macOS terminal for AI coding agents
- [amux](https://github.com/mixpeek/amux) -- agent multiplexer with web dashboard and mobile PWA
- [Overstory](https://github.com/jayminwest/overstory) -- multi-agent orchestration with SQLite mail and tiered conflict resolution
- [Addy Osmani - Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/) -- patterns for multi-agent coding
- [Claude Code Hooks Multi-Agent Observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) -- hook-based monitoring
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide) -- official hooks documentation
- [Parallel Coding Agents Comparison (2026)](https://www.morphllm.com/parallel-coding-agents) -- 8 tools compared
- [GitHub Copilot Merge Conflict Resolution](https://github.blog/changelog/2026-03-26-ask-copilot-to-resolve-merge-conflicts-on-pull-requests/) -- PR-level conflict resolution
- [Agentmaxxing](https://vibecoding.app/blog/agentmaxxing) -- running multiple AI agents in parallel
