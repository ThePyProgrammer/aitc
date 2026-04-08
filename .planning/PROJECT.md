# AI Traffic Controller

## What This Is

A desktop application (Tauri + React) that manages multiple coding AI agents working on a codebase — like an air traffic controller manages aircraft in an airspace. It monitors agent file activity via filesystem watchers, visualizes agent positions on a spatial codebase map, detects conflicts when agents touch the same files, and provides a communications hub for approving or denying agent requests. Built for a solo developer running concurrent agents (Claude Code, Codex, OpenCode, and any extensible adapter).

## Core Value

A developer can see exactly what every AI agent is doing across their codebase in real time, prevent destructive conflicts between concurrent agents, and approve/deny agent actions from a single command center.

## Requirements

### Validated

- [x] "Command Horizon" dark ATC aesthetic (phosphor greens, zero-radius, radar indicators) — Validated in Phase 1: Foundation + App Shell

### Active

- [ ] Spatial radar view plotting agents as dots on a file-tree-based codebase map
- [ ] Tower control manifest listing all active agents with status, protocol, and process path
- [ ] Communications hub for agent approval requests with approve/deny/chat workflow
- [ ] Conflict detection when multiple agents touch the same file, with side-by-side merge UI
- [ ] File system watchers to track agent reads/writes across the repository
- [ ] Codebase structure mapping (file tree as spatial layout for the radar)
- [ ] Agent launcher — spawn Claude Code, Codex, OpenCode sessions from within the app
- [ ] Agent observation — detect and monitor externally-launched agents
- [ ] Extensible agent adapter architecture (plugin system for any coding agent)
- [ ] Native OS notifications and system tray alerts for urgent agent requests
- [ ] Session history — past agent sessions, resolved conflicts, approval logs
- [x] "Command Horizon" dark ATC aesthetic (phosphor greens, zero-radius, radar indicators) — Validated in Phase 1

### Out of Scope

- Team/multi-user collaboration — solo developer only for v1
- Cloud deployment or web hosting — desktop app only
- Mobile companion app — desktop-first
- Agent-to-agent direct communication — all coordination goes through the controller
- Custom AI model hosting — agents use their own existing infrastructure

## Context

- **Wireframes exist** at `./wireframes/` with four key screens: Airspace Radar, Tower Control (agent_control_tower), Communications Hub, and Conflict Resolution Center
- **Design system** defined in `./wireframes/vector_terminal/DESIGN.md` — "The Command Horizon" with dark room philosophy, phosphor transitions, radar indicators, zero-radius corners, Space Grotesk + monospace typography
- **Target agents**: Claude Code (hooks system), OpenAI Codex (CLI), OpenCode — each has different APIs and lifecycle patterns
- **Conflict strategy**: Detect-and-resolve (not preventive locking) — agents work freely, system detects overlapping file edits and presents merge UI
- **Agent tracking**: Filesystem watchers (chokidar or similar) monitoring read/write events in the repo directory
- **Agent launch**: App can both launch new agent sessions and observe already-running external ones
- **Persistence**: SQLite or similar local DB for session history, conflict resolutions, approval logs

## Constraints

- **Tech stack**: Tauri v2 + React + TypeScript — lightweight native shell with web frontend
- **Platform**: Desktop (Windows primary, macOS/Linux stretch goals)
- **Design**: Must follow Command Horizon design system from wireframes
- **Agent integration**: Must be extensible — adapter pattern, not hardcoded per-agent
- **Performance**: File watchers must handle large codebases (10k+ files) without excessive CPU/memory

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri over Electron | Lighter binary, lower resource usage, Rust backend for file watching performance | — Pending |
| File watchers over git-based tracking | Real-time visibility into what agents are reading/writing, not just commits | — Pending |
| Detect+resolve over preventive locking | Less friction for agents, more natural workflow — agents work freely | — Pending |
| File tree for spatial layout (not dependency graph) | Simpler to implement, intuitive mapping of directories to regions | — Pending |
| Extensible adapter architecture from day 1 | Avoids rewrites when adding new agents beyond the initial three | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-08 after Phase 1 completion*
