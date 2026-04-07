# Project Research Summary

**Project:** AI Traffic Controller (AITC)
**Domain:** AI Agent Orchestration / Developer Tool (Desktop)
**Researched:** 2026-04-07
**Confidence:** HIGH

## Executive Summary

AITC is a desktop application that monitors multiple AI coding agents working on a shared codebase, detects file conflicts in real time, and provides a purpose-built resolution UI. The product occupies a unique niche: competitors (Conductor, Mux, cmux) isolate agents into git worktrees to avoid conflicts entirely, while AITC lets agents work on the same tree and resolves conflicts when they occur. This is a harder technical problem but addresses the more natural workflow of a solo developer running 2-3 agents on overlapping code. The recommended approach is a Tauri v2 shell with a Rust backend handling all performance-critical work (file watching, process management, conflict detection) and a React/TypeScript frontend for visualization and interaction, connected via Tauri's IPC event system.

The core technical challenge is the real-time data pipeline: filesystem events must flow from the OS through Rust processing, across the IPC boundary, and into the UI without losing events or introducing perceptible latency. On Windows (the primary target), this is especially dangerous because the OS file watcher can silently drop events when agents write dozens of files in a burst. The architecture must treat the Rust backend as the source of truth for conflict detection and never rely on the frontend receiving every event. A periodic filesystem reconciliation layer is non-negotiable.

The three highest risks are: (1) silent file event loss on Windows causing missed conflicts, (2) IPC serialization bottleneck making the real-time UI lag seconds behind reality, and (3) orphaned agent processes after crashes continuing to modify files unsupervised. All three have known mitigations (reconciliation snapshots, event batching, Win32 Job Objects) but must be addressed in the foundation phases, not retrofitted.

## Key Findings

### Recommended Stack

The stack is a Tauri v2 + React 19 + Rust backend architecture. All system-level operations (file watching, process detection, conflict detection, persistence) run in Rust for performance and reliability. The frontend is a single-window React app with client-side routing across four views (Radar, Tower, Comms, Conflicts). Type safety across the IPC boundary is enforced by tauri-specta, which generates TypeScript bindings from Rust command signatures at build time.

**Core technologies:**
- **Tauri v2 (^2.10):** Desktop shell with Rust backend -- 5MB binary vs Electron's 150MB, native OS APIs for tray/notifications
- **React 19 + TypeScript + Vite 8:** Frontend framework -- concurrent features for responsive UI under high-frequency updates, Vite 8's Rolldown for fast builds
- **Zustand (^5.0):** State management -- 3KB, selector-based subscriptions prevent re-render cascades, one store per domain (agents, radar, conflicts, comms, sessions, settings)
- **notify + notify-debouncer-full (Rust):** File watching -- native OS APIs per platform, debouncing for burst writes, used by rust-analyzer and cargo-watch
- **SQLite via sqlx (^0.8):** Persistence -- compile-time checked SQL queries, ACID transactions, single-file database for desktop app
- **Canvas 2D API + visx math:** Radar visualization -- custom spatial rendering at 60fps, no charting library supports ATC-style spatial visualization
- **Tailwind CSS v4:** Styling -- build-time CSS generation (no runtime cost), CSS-first config maps to Command Horizon design tokens
- **Motion v12:** Animation -- hardware-accelerated transitions for phosphor effects, presence animations for mount/unmount

### Expected Features

**Must have (table stakes):**
- Agent process listing with real-time status (Running/Idle/Waiting/Conflict/Error)
- File activity monitoring via Rust notify crate (foundation for everything)
- Conflict detection when 2+ agents touch the same file
- Approval request workflow (human-in-the-loop for agent write access)
- Agent launch/spawn with extensible adapter architecture (Claude Code, Codex, OpenCode)
- Session persistence in SQLite (agent sessions, conflicts, approvals)
- System tray + native notifications (agents run long, must pull user back)
- Multi-agent protocol support via adapter pattern
- Workspace isolation awareness (worktree vs shared directory)

**Should have (differentiators):**
- Spatial codebase radar -- the killer feature, no competitor has this
- Real-time conflict resolution UI (3-way merge with agent intent context)
- Agent intent display (why an agent is touching a file)
- Cross-agent file heat map (early warning for contention)
- Command Horizon dark-room ATC aesthetic (not just skin-deep, shapes mental model)

**Defer (v1.x and v2+):**
- Agent observation / attach to externally-launched agents (complex process detection)
- Conflict timeline/replay (enhances resolution, not required for it)
- Approval request intelligence with approve-with-edit
- Remote agent support
- Additional agent adapters beyond initial 3

**Anti-features (explicitly do NOT build):**
- Agent-to-agent direct communication (controller, not mesh network)
- Task decomposition/planning (traffic controller, not project manager)
- Built-in code editor (show diffs, link to user's editor)
- AI-powered auto-merge (present conflicts clearly, human decides)

### Architecture Approach

Single-window Tauri v2 application with strict separation: Rust backend owns all system operations and is the source of truth; React frontend is a visualization/interaction layer hydrated by events. Communication uses Tauri commands (frontend-initiated request/response) for initial data hydration and Tauri events (backend-initiated push) for real-time updates. The Rust backend is organized into services (watcher, process monitor, conflict engine, approval system, codebase mapper), adapters (per-agent-type implementations of a trait), and a persistence layer (SQLite via sqlx).

**Major components:**
1. **Filesystem Watcher Service** -- monitors file reads/writes via notify crate, debounces, attributes events to agents by PID correlation
2. **Process Monitor** -- detects running agent processes via sysinfo crate, tracks PIDs and lifecycle, handles launch/termination
3. **Agent Registry + Adapter System** -- canonical agent list, trait-based adapters per agent type (spawn, status, approve/deny), plugin architecture
4. **Conflict Detection Engine** -- receives file-event stream, maintains per-file ownership map with time windows, generates conflict records with diff context
5. **Approval/Comms System** -- queues human-approval requests from agents, relays decisions back via adapters
6. **Codebase Mapper** -- builds spatial representation of file tree for radar visualization
7. **SQLite Persistence** -- session history, conflict logs, approval audit trail; source of truth for all historical data
8. **Frontend (4 views)** -- Radar (spatial canvas), Tower (agent manifest table), Comms (approval queue), Conflicts (3-way merge UI)

### Critical Pitfalls

1. **Windows file watcher buffer overflow** -- ReadDirectoryChangesW silently drops ALL events when its 64KB buffer fills during agent bulk writes. Mitigate with dedicated drain thread, max buffer size, and periodic filesystem snapshots (every 5-10s) for reconciliation.
2. **IPC serialization bottleneck** -- JSON serialization of hundreds of events/second causes 3-10s UI lag. Mitigate by batching events into 100ms windows in Rust before crossing IPC, using Tauri v2 channels for streaming, and running conflict detection in Rust (not frontend).
3. **Orphaned agent processes** -- App crash leaves spawned agents running unsupervised. Mitigate with Win32 Job Objects (auto-kill on parent close), PID file tracking, and startup orphan detection.
4. **Conflict detection race conditions** -- By the time a conflict is detected, both agents may have built further changes on top. Mitigate with conflict windows (2-5s monitoring after any file touch), content snapshots at each write, and file dependency graph tracking.
5. **Radar DOM thrashing** -- Naive React/SVG rendering of 10K+ file nodes at 60fps will freeze the UI. Mitigate by using Canvas 2D with a manual requestAnimationFrame render loop reading from Zustand getState() (bypassing React reconciliation entirely).

## Implications for Roadmap

Based on combined research, the architecture has clear dependency layers that dictate phase ordering. The critical path is: Tauri scaffold -> File Watcher -> Conflict Engine -> Conflict Resolution UI.

### Phase 1: Foundation + Shell
**Rationale:** Every component depends on the Tauri IPC bridge, SQLite database, React shell, and design system tokens existing. This phase also locks in critical early decisions (Canvas vs DOM for radar, WAL mode for SQLite, Tauri permissions).
**Delivers:** Working Tauri v2 app shell with React routing across 4 empty views, SQLite database with schema and migrations, Command Horizon design system tokens and base components, tauri-specta IPC skeleton with type generation.
**Addresses:** Project scaffold, design system foundation, database layer.
**Avoids:** Pitfall 9 (Tauri permissions -- configure from start), Pitfall 7 (SQLite locking -- WAL mode from day one), Pitfall 10 (contrast/accessibility -- validate design tokens early).

### Phase 2: Real-Time Data Pipeline
**Rationale:** File watching and process monitoring are independent services that both feed into the intelligence layer. They are the foundation the entire product depends on. The Windows event loss pitfall must be addressed here.
**Delivers:** Filesystem watcher service with debouncing and reconciliation, process monitor with agent detection, event batching and IPC streaming to frontend, Zustand stores hydrated by Tauri events.
**Addresses:** File activity monitoring (table stakes), real-time agent status (table stakes).
**Avoids:** Pitfall 1 (Windows buffer overflow -- reconciliation layer), Pitfall 2 (IPC bottleneck -- event batching), Pitfall 6 (memory explosion -- Rust-native watching, not JS).

### Phase 3: Agent Management + Conflict Detection
**Rationale:** Agent Registry depends on Process Monitor (Phase 2). Conflict Engine depends on File Watcher (Phase 2). These can be built in parallel once Phase 2 is complete. The adapter trait design is an early architectural commitment that shapes all future agent support.
**Delivers:** Agent Registry with trait-based adapter system, Claude Code adapter (richest hooks API, build first), Conflict Detection Engine with file ownership tracking and conflict windows, agent launch/spawn capability.
**Addresses:** Agent process listing (table stakes), agent launch/spawn (table stakes), conflict detection (table stakes), multi-agent protocol support (table stakes).
**Avoids:** Pitfall 3 (orphaned processes -- Job Objects from day one), Pitfall 4 (detection races -- conflict windows, Rust-side detection), Pitfall 8 (leaky abstraction -- design from controller's needs, test with hypothetical 4th agent), Pitfall 11 (parsing agent output -- rely on filesystem as universal truth).

### Phase 4: Core UI Views
**Rationale:** All backend services exist. Now build the four frontend views that consume them. Tower and Comms are data-driven tables (simpler); Radar and Conflicts are complex visualizations (harder). Start with Tower and Comms, then Radar.
**Delivers:** Tower Control view (agent manifest, quick commands), Communications Hub (approval queue with approve/deny), Airspace Radar (spatial codebase visualization with agents as dots), system tray and native notifications.
**Addresses:** Approval request workflow (table stakes), spatial codebase radar (differentiator), system tray/notifications (table stakes), agent intent display (differentiator).
**Avoids:** Pitfall 5 (DOM thrashing -- Canvas 2D with manual render loop for radar).

### Phase 5: Conflict Resolution + Polish
**Rationale:** The 3-way merge UI is the most complex frontend component and depends on conflict detection (Phase 3) and the design system being proven (Phase 4). Session history requires all prior phases to be generating data worth reviewing.
**Delivers:** Conflict Resolution view (3-way merge with per-hunk accept/reject), session persistence and history browsing, cross-agent file heat map overlay on radar, Codex and OpenCode adapters.
**Addresses:** Conflict resolution UI (differentiator), session persistence (table stakes), workspace isolation awareness (table stakes), cross-agent heat map (differentiator).

### Phase Ordering Rationale

- **Bottom-up by dependency:** Each phase produces outputs consumed by the next. File watching (Phase 2) feeds conflict detection (Phase 3) feeds conflict resolution UI (Phase 5). Skipping ahead is not possible.
- **Risk-first:** The highest-risk components (file watching on Windows, IPC performance, process management) are in Phases 2-3. If these fail, the product cannot work. Better to discover this early.
- **Value delivery:** Phase 3 delivers the core value proposition (conflict detection). Phase 4 delivers the killer differentiator (spatial radar). Phase 5 delivers the complete loop (conflict resolution). Each phase is independently demoable.
- **Pitfall alignment:** Critical pitfalls (1-4) are all addressed in Phases 2-3, before the frontend views are built on top of them.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Data Pipeline):** Windows ReadDirectoryChangesW behavior under load needs empirical testing. The reconciliation layer design (snapshot interval, comparison strategy) has no established pattern to follow.
- **Phase 3 (Conflict Detection):** The conflict window concept and file ownership tracking over time need careful data model design. No existing tool does detect-and-resolve on shared trees, so there are no reference implementations.
- **Phase 5 (Conflict Resolution UI):** 3-way merge UI is complex. Study GitKraken, VS Code merge editor, and Meld for interaction patterns. The addition of agent intent context alongside code diffs is novel.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Tauri v2 + React scaffolding, SQLite setup, Tailwind theming -- all well-documented with official guides and templates.
- **Phase 4 (Core UI Views):** Table views (Tower, Comms) are standard React patterns. Canvas rendering for Radar follows established game-loop patterns. System tray is a Tauri plugin.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are mature, well-documented, and version-pinned. Tauri v2, React 19, Zustand 5, notify-rs 8 are all stable releases with production track records. |
| Features | HIGH | Competitive analysis covered 6+ tools. Table stakes are clear from the market. Differentiators are well-defined and validated against competitor gaps. |
| Architecture | HIGH | Tauri IPC model (commands + events) is well-documented. The service-oriented Rust backend with trait-based adapters follows idiomatic patterns. Build order is dependency-driven. |
| Pitfalls | HIGH | Critical pitfalls are backed by OS documentation, GitHub issues, and real-world bug reports from similar tools. Windows-specific issues are especially well-sourced. |

**Overall confidence:** HIGH

### Gaps to Address

- **Codebase-to-spatial-map algorithm:** No research covered how to convert a file tree into a meaningful 2D spatial layout for the radar. Treemap, force-directed graph, and Hilbert curve approaches each have tradeoffs. Needs experimentation in Phase 4.
- **Agent PID-to-file-event correlation on Windows:** Determining which process wrote a specific file is non-trivial. notify-rs does not provide PID information. May need ETW (Event Tracing for Windows) or process handle enumeration. Needs investigation in Phase 2.
- **Claude Code hooks API stability:** The hooks system is the richest integration point but is relatively new. API stability and backward compatibility guarantees are unclear. Build the adapter to degrade gracefully.
- **Conflict resolution data model:** How to store and represent a 3-way conflict (base, agent A version, agent B version) with per-hunk granularity needs careful schema design. No existing reference for real-time (not git-merge-time) conflict records.
- **React-Konva + Canvas 2D coexistence:** The stack recommends Canvas 2D for the radar sweep and React-Konva for interactive overlays. Whether these can share a canvas or need layered canvases needs prototyping.

## Sources

### Primary (HIGH confidence)
- [Tauri v2 Official Docs](https://v2.tauri.app/) -- IPC, architecture, plugins, security
- [notify-rs GitHub](https://github.com/notify-rs/notify) -- v8.2.0, cross-platform file watching
- [SQLite WAL Documentation](https://www.sqlite.org/wal.html) -- concurrency model
- [Microsoft ReadDirectoryChangesW](https://learn.microsoft.com/en-us/answers/questions/1428660/) -- buffer overflow behavior
- [React 19 Docs](https://react.dev/versions) -- concurrent features
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) -- CSS-first configuration

### Secondary (MEDIUM confidence)
- [Tresorit Engineering Blog](https://medium.com/tresorit-engineering/how-to-get-notifications-about-file-system-changes-on-windows-519dd8c4fb01) -- Windows file watcher edge cases
- [Tauri IPC Discussion #7146](https://github.com/tauri-apps/tauri/discussions/7146) -- high-frequency event performance
- [Auto-Claude #1252](https://github.com/AndyMik90/Auto-Claude/issues/1252) -- orphaned process behavior
- [OpenCode #11959](https://github.com/anomalyco/opencode/issues/11959) -- orphaned process behavior
- [Conductor](https://www.conductor.build/), [Coder Mux](https://github.com/coder/mux), [cmux](https://cmux.com/) -- competitive analysis

### Tertiary (LOW confidence)
- React-Konva + Canvas 2D layering -- needs prototyping validation
- Codebase spatial mapping algorithms -- needs experimentation
- Windows ETW for PID-to-file correlation -- needs feasibility investigation

---
*Research completed: 2026-04-07*
*Ready for roadmap: yes*
