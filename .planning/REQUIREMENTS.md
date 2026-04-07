# Requirements: AI Traffic Controller

**Defined:** 2026-04-07
**Core Value:** A developer can see exactly what every AI agent is doing across their codebase in real time, prevent destructive conflicts between concurrent agents, and approve/deny agent actions from a single command center.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### File Monitoring

- [ ] **FMON-01**: System monitors all file read/write events across a repository directory tree in real time via Rust filesystem watchers
- [ ] **FMON-02**: System attributes file events to specific agent processes (PID-based correlation)
- [ ] **FMON-03**: System handles large codebases (10k+ files) without excessive CPU/memory via debouncing and event batching
- [ ] **FMON-04**: System detects whether agents operate on a shared working tree or isolated git worktrees
- [ ] **FMON-05**: System generates a file heat map showing which files/regions are touched by multiple agents

### Agent Management

- [ ] **AGNT-01**: User can view a live manifest of all active agents with ID, protocol type, status, and current file/process path (Tower Control)
- [ ] **AGNT-02**: User can launch new agent sessions (Claude Code, Codex, OpenCode) from within the app
- [ ] **AGNT-03**: System detects and attaches to externally-launched agent processes already running on the codebase
- [ ] **AGNT-04**: System supports an extensible adapter architecture so new agent types can be added without modifying core logic
- [ ] **AGNT-05**: User can see agent intent — a summary of why each agent is touching specific files, parsed from agent task metadata/hooks
- [ ] **AGNT-06**: User can stop/terminate a running agent from the Tower Control view
- [ ] **AGNT-07**: System tracks agent state transitions: Running, Idle, Waiting for Approval, Conflict, Error

### Conflict Handling

- [ ] **CNFL-01**: System detects when two or more agents write to the same file within a configurable conflict window
- [ ] **CNFL-02**: System alerts the user immediately when a conflict is detected (visual indicator + notification)
- [ ] **CNFL-03**: User can view a 3-way merge UI showing Agent A changes, base file, and Agent B changes side by side
- [ ] **CNFL-04**: User can accept changes from either agent per-hunk, or manually edit the resolution
- [ ] **CNFL-05**: System shows agent intent alongside code changes in the conflict resolution view
- [ ] **CNFL-06**: Conflict detection runs in the Rust backend for real-time accuracy (not deferred to frontend)

### Communications

- [ ] **COMM-01**: User sees a queue of pending approval requests from agents in the Communications Hub
- [ ] **COMM-02**: User can approve, deny, or ask for more info on each agent request
- [ ] **COMM-03**: Approval requests show the target file path and a preview of the proposed changes (code diff)
- [ ] **COMM-04**: User can send freeform text messages to an agent via the Communications Hub chat interface
- [ ] **COMM-05**: System shows native OS notifications and system tray alerts when an agent requires user action
- [ ] **COMM-06**: User can approve a request with inline edits ("approve with edit" for minor tweaks)

### Visualization

- [ ] **VIZN-01**: User can view a 2D spatial radar plotting agents as dots on a file-tree-based codebase map
- [ ] **VIZN-02**: Radar shows agent trajectories (lead lines indicating which files an agent is approaching/recently touched)
- [ ] **VIZN-03**: File heat map overlay on radar shows contention intensity (color = number of agents touching a region)
- [ ] **VIZN-04**: Radar renders performantly via Canvas 2D for codebases with 10k+ files
- [ ] **VIZN-05**: Codebase map uses file tree structure (directories = regions, files = points) as spatial layout

### Design System

- [ ] **DSGN-01**: App follows the Command Horizon design system — dark room aesthetic, phosphor greens, zero-radius corners, radar indicators
- [ ] **DSGN-02**: Typography uses Space Grotesk for headlines and monospace for data/agent IDs
- [ ] **DSGN-03**: Status indicators use radar pulse animations (not simple circles)
- [ ] **DSGN-04**: UI achieves "glanceability" — system health (green/amber/red) visible from a glance

### Persistence & History

- [ ] **HIST-01**: System stores agent session records (start time, end time, files touched, outcome) in local SQLite database
- [ ] **HIST-02**: System stores conflict resolution records (which agents, which files, how resolved, timestamp)
- [ ] **HIST-03**: System stores approval decision audit log (request, response, timestamp)
- [ ] **HIST-04**: User can browse past sessions and their event history

### Application Shell

- [ ] **SHELL-01**: App runs as a Tauri v2 desktop application with native system tray integration
- [ ] **SHELL-02**: App uses sidebar navigation between four core views: Radar, Tower, Comms, Conflicts
- [ ] **SHELL-03**: App provides a global search/command palette for quick navigation
- [ ] **SHELL-04**: System tray icon indicates overall system status (healthy/warning/conflict)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Conflict Handling

- **CNFL-07**: Conflict timeline showing temporal sequence of how a conflict developed
- **CNFL-08**: AI-suggested merge resolutions (suggestions only, never auto-applied)

### Team Features

- **TEAM-01**: Multiple users can view the same agent dashboard
- **TEAM-02**: Role-based approval permissions

### Extended Monitoring

- **EMON-01**: Dependency-graph-based codebase map (in addition to file tree)
- **EMON-02**: Token/cost tracking per agent session
- **EMON-03**: Agent performance metrics (files/minute, conflict rate)

### Platform

- **PLAT-01**: macOS native support
- **PLAT-02**: Linux native support

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Agent-to-agent direct communication | Adds massive complexity; all coordination flows through the human controller |
| Task decomposition / planning | AITC is a traffic controller, not a project manager — agents receive tasks externally |
| CI/CD integration | Pulls product into DevOps territory, away from core real-time monitoring value |
| Cloud/remote agent hosting | Desktop app for local agents only |
| Multi-user / team collaboration | Solo developer for v1 |
| AI-powered auto-merge | Dangerous without human oversight; present conflicts clearly, human decides |
| Built-in code editor | VS Code/Cursor exist; show diffs and previews, link to external editor |
| Agent marketplace / plugin store | Premature; adapter API docs suffice for v1 |
| Mobile companion app | Interaction model (3-way merge, spatial radar) doesn't translate to mobile |
| Token/cost tracking | Tangential to traffic control; agents manage own billing |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FMON-01 | — | Pending |
| FMON-02 | — | Pending |
| FMON-03 | — | Pending |
| FMON-04 | — | Pending |
| FMON-05 | — | Pending |
| AGNT-01 | — | Pending |
| AGNT-02 | — | Pending |
| AGNT-03 | — | Pending |
| AGNT-04 | — | Pending |
| AGNT-05 | — | Pending |
| AGNT-06 | — | Pending |
| AGNT-07 | — | Pending |
| CNFL-01 | — | Pending |
| CNFL-02 | — | Pending |
| CNFL-03 | — | Pending |
| CNFL-04 | — | Pending |
| CNFL-05 | — | Pending |
| CNFL-06 | — | Pending |
| COMM-01 | — | Pending |
| COMM-02 | — | Pending |
| COMM-03 | — | Pending |
| COMM-04 | — | Pending |
| COMM-05 | — | Pending |
| COMM-06 | — | Pending |
| VIZN-01 | — | Pending |
| VIZN-02 | — | Pending |
| VIZN-03 | — | Pending |
| VIZN-04 | — | Pending |
| VIZN-05 | — | Pending |
| DSGN-01 | — | Pending |
| DSGN-02 | — | Pending |
| DSGN-03 | — | Pending |
| DSGN-04 | — | Pending |
| HIST-01 | — | Pending |
| HIST-02 | — | Pending |
| HIST-03 | — | Pending |
| HIST-04 | — | Pending |
| SHELL-01 | — | Pending |
| SHELL-02 | — | Pending |
| SHELL-03 | — | Pending |
| SHELL-04 | — | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 0
- Unmapped: 40

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after initial definition*
