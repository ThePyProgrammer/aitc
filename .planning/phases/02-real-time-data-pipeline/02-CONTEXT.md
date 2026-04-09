# Phase 2: Real-Time Data Pipeline - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a Rust-powered real-time file watching system that monitors a repository directory tree, attributes file events to agent processes via PID correlation, detects git worktree topology, and streams batched events to the React frontend over Tauri IPC. This is the sensing layer that all downstream features (conflict detection, radar visualization, tower control) depend on.

</domain>

<decisions>
## Implementation Decisions

### Event Delivery to Frontend
- **D-01:** Use `tauri::ipc::Channel<T>` for streaming batched file events to the frontend — Tauri-native IPC, `Clone + Send + Sync`, designed for low-latency high-throughput streaming. **REVISED from app.emit()** after research: Tauri docs explicitly label events as "not designed for low latency or high throughput" and issue #8177 documents emit() crashes under high-frequency bursts. Channel is the documented streaming primitive and avoids data loss (Phase 2 success criterion)
- **D-02:** Frontend subscribes via a Zustand store that updates on incoming events through the Channel's `onmessage` callback (follows store pattern established with `sidebarStore`, `paletteStore`)

### Claude's Discretion: Throttling
- **D-03:** Claude decides the throttling strategy for incoming events (Rust-side batching vs dual Rust+frontend throttling) based on performance testing and typical event volumes

### Claude's Discretion: Event Persistence
- **D-04:** Claude decides whether file events are persisted to SQLite in real time or kept in-memory during the session (tradeoff: write overhead vs audit trail)

### PID Correlation Strategy
- **D-05:** Hybrid approach — process polling as baseline, with hooks for agent self-reporting (Phase 3 adapters will supplement with higher accuracy)
- **D-06:** Best-effort attribution in Phase 2 — attribute when confident, mark as "unattributed" otherwise. Phase 3 agent adapters will improve accuracy
- **D-07:** Claude decides the initial process discovery approach (scan by process name, watch directory only, or other heuristic) before Phase 3 adapters exist

### Worktree Detection
- **D-08:** Use `git worktree list` and .git file/dir inspection to detect shared vs isolated worktrees — automated, no user config needed
- **D-09:** Detection runs once on watch start, re-detects on user-triggered refresh or new agent discovery

### Watch Scope & Filtering
- **D-10:** Respect the repo's `.gitignore` plus hardcoded excludes (`.git/`, `node_modules/`, `target/`, `build/`) — no user-configurable ignore patterns in Phase 2
- **D-11:** Track writes only (create, modify, delete, rename) — no read events. Reads are too noisy and not actionable for conflict detection
- **D-12:** Build an in-memory file tree index on watch start by walking the directory — provides baseline state and powers the Phase 4 Radar codebase map

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Technology Stack
- `CLAUDE.md` — Technology stack decisions including `notify` ^8.2 for filesystem watching, `notify-debouncer-full` ^0.4 for event batching, `sqlx` ^0.8 for SQLite, `tokio` ^1.0 for async runtime, `tauri-specta` ^2.0 for type-safe IPC

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (relevant for any UI elements that surface file events)

### Existing Backend Code
- `src-tauri/src/lib.rs` — App setup, plugin initialization, window management patterns
- `src-tauri/src/db/mod.rs` — SQLite pool initialization pattern via sqlx
- `src-tauri/src/db/migrations/001_initial_schema.sql` — Existing DB schema (agent_sessions, conflict_events, approval_requests tables)
- `src-tauri/Cargo.toml` — Current dependencies (already has sqlx, tokio, tauri-specta, specta)

### Phase 1 Context
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` — Prior decisions on app shell, IPC patterns, Zustand store conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src-tauri/src/db/mod.rs` — SQLite pool management pattern (init, migrations, app state). New migration needed for file event tables if persistence is chosen
- `src-tauri/src/lib.rs` — Tauri plugin registration pattern, `app.manage()` for state injection
- `src/stores/sidebarStore.ts` and `src/stores/paletteStore.ts` — Zustand store patterns for new file event store
- `src/hooks/useWindowControls.ts` — Custom hook pattern for new `useFileEvents` or similar hooks

### Established Patterns
- **State management:** Zustand stores with selectors (one store per domain)
- **IPC:** tauri-specta for type-safe Rust→TS bridge (already configured in Cargo.toml)
- **DB:** sqlx with embedded migrations, async pool via tokio
- **Async:** tokio runtime for all backend async work

### Integration Points
- `src-tauri/src/lib.rs` — New file watcher module registered here, managed state injected via `app.manage()`
- `src-tauri/Cargo.toml` — Add `notify` and `notify-debouncer-full` crates
- `src-tauri/src/db/migrations/` — New migration if event persistence is chosen
- `src/stores/` — New Zustand store for file events
- Tauri event system — `app.emit()` from Rust, `listen()` from frontend

</code_context>

<specifics>
## Specific Ideas

- Writes-only tracking keeps the event volume manageable — reads would generate 10-100x more events with little actionable value
- File tree index built on startup doubles as the foundation for the Phase 4 Radar codebase map — no redundant scan needed later
- Best-effort PID attribution is the right Phase 2 boundary — accuracy improves incrementally as Phase 3 agent adapters come online
- Hybrid PID strategy (polling + self-report hooks) means the pipeline is ready for Phase 3 without rework

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-real-time-data-pipeline*
*Context gathered: 2026-04-09*
