# Phase 6: Pipeline Activation + Integration Wiring - Research

**Researched:** 2026-04-11
**Domain:** Tauri v2 desktop integration wiring — React hook mount, Rust<->JS IPC activation, persisted config, cross-store event reactivity
**Confidence:** HIGH

## Summary

This is a pure integration phase: every backend and frontend primitive needed already exists. The work is wiring them together in six specific places:

1. Mount `usePipelineChannel` at an App-shell level so the Channel outlives route navigation, and trigger `register(repoRoot)` once a repo is known (FMON-01..04).
2. Resolve the initial `repoRoot` via CWD + git-root detection with a folder-picker fallback (D-01), persisted across launches (D-02).
3. Add a pause/resume control and a "Change repo" action (D-03, D-04).
4. Bridge `ProcessSnapshot.candidates()` to `AgentRegistry` on a periodic tick, keyed as `PASSIVE-{pid}`, with merge semantics so a later self-registration replaces it (AGNT-03, D-06, D-07).
5. Call `record_session_file` from the Rust pipeline forwarder so session files populate automatically (HIST-01, D-09) — but note: `agent_sessions` rows are currently never inserted by anyone, so this phase must also insert a session row per detected agent or the FK will reject writes.
6. Wire `pipelineStore` -> `radarStore` so treemap data follows live tree-index/event updates instead of a static on-mount fetch (D-08).

**Primary recommendation:** Create a dedicated `RepoSessionProvider` component inside `AppShell` (above `<Outlet/>`) that owns the pipeline channel lifecycle, the active repo state, and the PID->registry bridge. Route views stay pure consumers of stores. This gives one canonical location for the pipeline lifecycle and avoids re-mount churn when the user navigates between Radar / Tower / Comms / Conflicts / History.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Auto-detect git repo root from CWD on startup. If CWD is not a git repo, show a native folder picker dialog as fallback.
- **D-02:** Persist last-opened repo path across app launches (SQLite or local config). On next launch, auto-open the persisted repo unless CWD points to a different git repo.
- **D-03:** Provide a "Change repo" option (sidebar or title bar) to switch repos without restarting the app. Stops current watch, opens picker, starts new watch.
- **D-04:** Auto-start file watcher when a repo is opened, with a pause/resume toggle. User can pause monitoring (useful during large git operations) and resume without losing pipeline state.
- **D-06:** Passively-detected PIDs from ProcessSnapshot appear as "unidentified" agents on the radar and tower manifest — NOT auto-registered with derived names. They show as unnamed dots until the agent self-registers via HTTP.
- **D-07:** When a self-registered agent's PID matches a previously passive-detected PID, merge the entries into one. No duplicate agents in the tower manifest.
- **D-08:** Radar treemap updates are event-driven from the pipeline. When `pipelineStore` ingests file events, `radarStore` reacts to update affected tree nodes. No polling — changes appear immediately via Zustand subscribe() or lightweight effect.
- **D-09:** Session file tracking is backend-driven. The Rust pipeline calls `record_session_file` internally when processing file events — no frontend IPC calls needed. DB stays accurate even if frontend disconnects.

### Claude's Discretion
- **D-05:** Mount point for `usePipelineChannel`. Claude decides where to wire the hook (App-level root vs. dedicated provider) during planning.
- Implementation details for pause/resume toggle UI placement.
- Exact mechanism for CWD detection (Tauri API vs. env var).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FMON-01 | Real-time file read/write monitoring via Rust watchers | Phase 2 pipeline exists; phase must invoke `usePipelineChannel.register(repoRoot)` from a UI mount point. Backend `start_watch` is complete and spawns the full watcher -> attributor -> forwarder chain. |
| FMON-02 | PID-based event attribution | Backend attributing_stream already rewrites `Attribution` per batch. Activates automatically when FMON-01 is wired. |
| FMON-03 | Handle 10k+ files without excessive CPU/memory | Pipeline debouncing + tree index capped already; activation does not change perf profile. Verify via smoke test on a large repo after wiring. |
| FMON-04 | Shared-tree vs. worktree detection | `start_watch` returns `Worktree[]` and `usePipelineChannel` stores them. Pure activation. |
| AGNT-03 | Detect and attach to externally-launched agent processes | Requires new bridge: periodic task reading `ProcessSnapshot.candidates()` and `upsert_agent` into `AgentRegistry` with key `PASSIVE-{pid}`. `registry.upsert_agent()` already supports merge-on-same-id (registry.rs:62-68). Self-registration uses key `KAGENT-{pid mod 10000}` which does NOT collide — reconciliation logic must match by PID, not by ID. |
| HIST-01 | Store agent session records and file writes | `record_session_file` command exists; `session_files` table exists with FK to `agent_sessions`. Gap: `agent_sessions` rows are never inserted anywhere in the codebase. This phase must insert a session row per detected agent (first file event OR on upsert_agent) or the FK constraint will reject writes. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tauri v2** desktop shell, Rust backend, React frontend
- **React 19.2** + **TypeScript 5.7/5.8** + **Vite 8**
- **Zustand 5** — one store per domain (already established: `agentStore`, `pipelineStore`, `radarStore`, `conflictStore`, `sidebarStore`)
- **tauri-specta 2.0** — all Tauri commands MUST use `#[specta::specta]` and be registered in `lib.rs` `collect_commands!` so TS bindings stay generated
- **Channel<T>** IPC pattern (not `app.emit`) for high-throughput streaming (Phase 2 decision, confirmed in `usePipelineChannel`)
- **Canvas 2D** for radar rendering (already implemented in RadarCanvas)
- **sqlx 0.8** raw SQL with embedded migrations (`src-tauri/src/db/migrations/*.sql`)
- **Platform:** Windows primary — detached process creation flags already handled in `agents/launcher.rs`
- **GSD workflow:** No direct repo edits outside a GSD command entry point

## Standard Stack

### Core (already installed — no new frontend deps required)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tauri-apps/api | ^2 | invoke, Channel | [VERIFIED: package.json] Existing — all current IPC uses it |
| zustand | ^5.0 | Store reactivity | [VERIFIED: package.json] Existing — existing stores already expose the `subscribe()` selector needed for D-08 cross-store reactivity |
| react-router-dom | ^7.0 | Memory router (already used) | [VERIFIED: package.json] `createMemoryRouter` already in `App.tsx`; AppShell owns the `<Outlet/>` so a lifecycle provider can sit above it |

### New Tauri Plugins Required (Rust + TS sides)
| Plugin | Version | Purpose | Why Needed |
|--------|---------|---------|------------|
| tauri-plugin-dialog | 2 | Native folder picker for D-01/D-03 | [CITED: v2.tauri.app/plugin/dialog/] Standard way to open a folder chooser; no cross-platform code to roll. Not currently installed (`grep -rn tauri-plugin-dialog` returned none in Cargo.toml or package.json). |
| @tauri-apps/plugin-dialog | ^2 | JS binding for dialog plugin | Provides `open({ directory: true })` from TS |

**Do NOT install tauri-plugin-store.** We already have SQLite managed state (`Pool<Sqlite>`) and an `app_settings (key, value)` table (migration 001). Persisting the last-opened repo path (D-02) should write a single row with key `last_repo_root` — one Rust command, zero new plugins, zero new dependencies.

### Supporting (already in-repo, verified)
| Library | Purpose | Where |
|---------|---------|-------|
| sqlx 0.8 + SqlitePool | Session + config persistence | `db/mod.rs` |
| chrono 0.4 | Timestamps for session rows | Already used across Rust side |
| sysinfo 0.38 | PID validation on bridge tick | Already used in `process_snapshot` and `self_register` |
| tracing 0.1 | Structured logging | Used throughout; use the same for new bridge/session-insert paths |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite `app_settings` table for D-02 | tauri-plugin-store (JSON file) | Adds a plugin + a second persistence mechanism. SQLite is already set up. |
| Poll-based PID-to-Registry bridge | Push-based (hook into attributor) | Push requires threading `Arc<AgentRegistry>` into the pipeline module; poll is a one-task, single-module addition. |
| Lifting pipeline logic into `App.tsx` | Dedicated `RepoSessionProvider` inside AppShell | App.tsx uses `createMemoryRouter` which doesn't re-render children on route change, but a dedicated provider keeps concerns separated and testable. |

**Installation (additions to existing manifests):**
```toml
# src-tauri/Cargo.toml — add:
tauri-plugin-dialog = "2"
```
```json
// package.json — add:
"@tauri-apps/plugin-dialog": "^2"
```

**Version verification note:** `tauri-plugin-dialog` is part of the official Tauri v2 plugin set; the major version tracks Tauri core (currently `tauri = "2"`). `[ASSUMED]` that the latest 2.x minor aligns with the installed Tauri 2.10 — the planner or executor should run `cargo add tauri-plugin-dialog` and let Cargo resolve to a compatible minor.

## Architecture Patterns

### Recommended Mount Structure
```
src/
├── App.tsx                        # Router only (unchanged)
├── components/layout/
│   └── AppShell.tsx                # Wraps children in <RepoSessionProvider>
├── components/RepoSessionProvider.tsx   # NEW — owns pipeline channel + active repo
├── hooks/
│   ├── usePipelineChannel.ts      # Existing — unchanged
│   ├── useActiveRepo.ts            # NEW — reads from a new repoStore
│   └── usePassiveAgentBridge.ts    # NEW (optional; or in provider) — polls registry bridge via periodic invoke
├── stores/
│   ├── repoStore.ts                # NEW — active repoRoot, isWatching, isPaused
│   └── (existing stores unchanged)
└── views/
    └── (consume stores; no direct pipeline calls)
```

### Pattern 1: App-Lifetime Pipeline Provider (D-05 decision)
**What:** A provider component mounted once in `AppShell` above `<Outlet/>`. Owns the `usePipelineChannel` hook, orchestrates repo resolution on mount, and drives register/unregister.
**When to use:** When an IPC resource must outlive route navigation. React Router's `<Outlet/>` re-renders children on navigation; mounting above the Outlet ensures the Channel is constructed exactly once per app session.
**Example:**
```typescript
// src/components/RepoSessionProvider.tsx
// Source: pattern combines existing usePipelineChannel.ts with a Zustand repoStore.
import { useEffect } from 'react';
import { useRepoStore } from '../stores/repoStore';
import { usePipelineChannel } from '../hooks/usePipelineChannel';

export function RepoSessionProvider({ children }: { children: React.ReactNode }) {
  const { register, unregister } = usePipelineChannel();
  const activeRepo = useRepoStore((s) => s.activeRepo);
  const isPaused = useRepoStore((s) => s.isPaused);

  // Resolve repo on mount: CWD -> git root -> persisted -> picker
  useEffect(() => { useRepoStore.getState().resolveInitialRepo(); }, []);

  // Register when activeRepo changes and not paused
  useEffect(() => {
    if (!activeRepo || isPaused) return;
    register(activeRepo).catch((err) => {
      console.error('register failed', err);
      useRepoStore.getState().setError(String(err));
    });
    return () => { unregister().catch(() => {}); };
  }, [activeRepo, isPaused, register, unregister]);

  return <>{children}</>;
}
```

### Pattern 2: Zustand Cross-Store Subscription (D-08 treemap reactivity)
**What:** Use `useStore.subscribe(selector, callback)` to make `radarStore` react to `pipelineStore.events` without coupling the components.
**When to use:** When a derived store needs push updates from a source store outside React render cycles.
**Example:**
```typescript
// src/stores/radarStore.ts — add a subscription installer
// Source: Zustand 5 subscribe + selector API (docs.pmnd.rs/zustand)
import { usePipelineStore } from './pipelineStore';

export function installRadarPipelineBridge() {
  return usePipelineStore.subscribe(
    (s) => s.events,
    (events, prev) => {
      if (events === prev) return;
      // Fast path: re-fetch tree index OR apply incremental path-level updates.
      // For Phase 6 MVP, re-invoke get_tree_index on a debounced tick (500ms).
      useRadarStore.getState().fetchTreeIndex();
    },
  );
}
```
Call `installRadarPipelineBridge()` once inside `RepoSessionProvider` and keep the returned unsubscribe in a ref.

### Pattern 3: Rust Periodic Bridge Task (PID -> Registry)
**What:** A tokio task spawned inside `start_watch` that reads `snapshot.candidates()` on a tick and upserts to `AgentRegistry` with key `PASSIVE-{pid}`.
**When to use:** AGNT-03 passive detection.
**Example:**
```rust
// src-tauri/src/pipeline/commands.rs — inside start_watch, after snapshot refresher
// Source: existing pattern from spawn_snapshot_refresher + AgentRegistry::upsert_agent.
let bridge_registry = app_handle.state::<Arc<AgentRegistry>>().inner().clone();
let bridge_snapshot = snapshot.clone();
let bridge_task = tokio::spawn(async move {
    let mut tick = tokio::time::interval(Duration::from_millis(2000));
    loop {
        tick.tick().await;
        let candidates = {
            let snap = bridge_snapshot.read().await;
            snap.candidates()
        };
        for c in candidates {
            let id = format!("PASSIVE-{}", c.pid);
            // Skip if a self-registered agent already owns this PID.
            // Self-registered agents use key KAGENT-{pid%10000}; we key passives
            // by PASSIVE-{pid} and reconcile in find_by_pid helper.
            if bridge_registry.find_agent_by_pid(c.pid).await.is_some() {
                continue;
            }
            let info = AgentInfo {
                id: id.clone(),
                agent_type: "unknown".into(),            // D-06: unidentified
                protocol: "passive-scan".into(),
                state: AgentState::Running,
                pid: Some(c.pid),
                cwd: c.cwd,
                intent: None,
            };
            // Need an adapter — use GenericAdapter or a new "passive" sentinel adapter.
            let adapter = bridge_registry.find_adapter_for_process(&c.name)
                .unwrap_or_else(|| passive_sentinel_adapter());
            let _ = bridge_registry.upsert_agent(id, info, adapter, false).await;
        }
        // Reap: remove PASSIVE-* entries whose PID is no longer in snapshot
        bridge_registry.reap_passive_agents(&current_pids).await;
    }
});
```

**Required helper additions to `AgentRegistry`:**
- `find_agent_by_pid(pid: u32) -> Option<AgentInfo>` — needed for D-07 merge. Self-registered agents have key `KAGENT-{pid%10000}`; passive have `PASSIVE-{pid}`. Reconcile by PID field, not by ID.
- `reap_passive_agents(live_pids: &HashSet<u32>)` — removes stale `PASSIVE-*` entries whose PID is no longer running.
- On successful self-registration, the `register_agent` HTTP handler should also call `remove_agent("PASSIVE-{pid}")` to satisfy D-07 "no duplicates."

### Pattern 4: Backend-Driven Session File Recording (D-09)
**What:** Modify the pipeline forwarder to call the internal session-recording logic for every attributed file event. Skip events with `Attribution::Unattributed` or `Ambiguous`.
**When to use:** HIST-01 population without frontend coordination.

**Prerequisite — session lifecycle.** `record_session_file(session_id, file_path)` (resolution.rs:364) requires a valid `agent_sessions.id` (FK). No code path currently INSERTs into `agent_sessions`. This phase must add:
- `ensure_session(agent_id, agent_type, pool) -> Result<i64, ...>` — upserts an open session for the agent and returns its id. Open = `ended_at IS NULL`.
- Called from two places: (a) the passive-scan bridge when a new PASSIVE agent is seen, (b) the self-registration HTTP handler (`agents/self_register.rs`) when a KAGENT is created.
- Session end: on `reap_passive_agents` or on explicit `terminate_agent`.

**Example:**
```rust
// src-tauri/src/pipeline/commands.rs — inside forwarder loop, per batch
// Source: existing forwarder pattern + resolution.rs record_session_file SQL.
for ev in &batch.events {
    if let Attribution::Pid(pid) = ev.attribution {
        // 1. Resolve pid -> agent_id via AgentRegistry.find_agent_by_pid
        // 2. Resolve agent_id -> open session_id via ensure_session
        // 3. Call the internal upsert (factor record_session_file SQL into a
        //    private fn that accepts a SqlitePool reference, so it can run
        //    off the Tauri command path too).
        if let Some(agent) = registry.find_agent_by_pid(pid).await {
            let session_id = ensure_session(&agent.id, &agent.agent_type, &pool).await?;
            let _ = record_session_file_internal(session_id, ev.path.to_string_lossy().into(), &pool).await;
        }
    }
}
```

### Anti-Patterns to Avoid
- **Don't mount `usePipelineChannel` inside `RadarView` or `TowerControl`:** Route views unmount on navigation. The Channel would be reconstructed on every route change, `start_watch` would re-fire, and the watcher lifecycle would churn.
- **Don't poll the radar treemap from the frontend:** D-08 is explicit — event-driven. Installing a `setInterval` that invokes `get_tree_index` every 500ms defeats the point.
- **Don't auto-register passive agents with adapter-guessed names (D-06):** Use `agent_type: "unknown"` and a sentinel adapter. Users identify them only when the agent self-registers.
- **Don't write session rows from the frontend:** D-09 is backend-only. The frontend never calls `record_session_file`; remove the Tauri command from TS invoke sites if any exist (none found in grep).
- **Don't rely on `std::env::current_dir()` inside a Tauri command:** On a Tauri-packaged build, CWD may be the install dir, not the user's shell. Resolve CWD from the process the user launched AITC from — typically obtained via `std::env::args()` + `std::env::current_dir()` at `lib.rs::run()` entry (before Tauri builder), and passed through a `#[tauri::command] get_launch_cwd()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Folder picker dialog | Custom Electron-style modal | `tauri-plugin-dialog` `open({ directory: true })` | Cross-platform native picker; handles permissions |
| Git repo-root detection | Scan for `.git/` walking up | Shell out to `git rev-parse --show-toplevel` | Correctly handles worktrees, submodules, bare repos, `GIT_DIR` env. `Command::new("git")` already used in `conflict/resolution.rs:151`. |
| Cross-store reactivity | Custom event emitter | `zustand.subscribe(selector, cb)` | Built-in, de-duplicated, supports selector equality |
| Last-opened-repo persistence | JSON file in userdata | SQLite `app_settings` table (already in schema) | Table exists; no new dep |
| PID existence check | Parse `/proc` / `tasklist` | `sysinfo::System::process(Pid::from_u32(...))` | Already used by `self_register.rs:103-113` |
| Ring-buffer of pipeline events | Manual array trimming | Existing `pipelineStore.ingest` | Already implemented with `MAX_EVENTS = 5000` |

**Key insight:** This phase is 90% composition of existing primitives. The single largest new chunk of code is the agent_sessions lifecycle (ensure_session / end_session), because no prior phase built it — the audit missed this because `record_session_file` exists but has no caller.

## Runtime State Inventory

This is a net-new wiring phase, not a rename. However, "wiring" does have runtime state implications once it turns on.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `app_settings` table will gain a `last_repo_root` row once D-02 ships. On migration/reinstall this row is preserved inside `%APPDATA%/aitc/aitc.db`. | None — standard SQLite upgrade path. |
| Stored data | `agent_sessions` and `session_files` tables are currently empty across all dev installs. First-run after this phase will start populating them. | Confirm existing sessions UI in HistoryView handles empty + populated states both. Verified in Phase 5 (`list_sessions` returns empty Vec gracefully). |
| Live service config | None — no external services configured at runtime. | None. |
| OS-registered state | Tauri system tray icon (already registered in Phase 1). This phase does not modify tray state. | None. |
| Secrets/env vars | `AITC_PORT` env var injected into launched agents (launcher.rs:51). Unchanged by this phase. | None. |
| Build artifacts | `src/bindings.ts` is regenerated on every dev build via `tauri-specta` export. New Rust commands (`get_launch_cwd`, `persist_last_repo`, `get_last_repo`) will appear there automatically. | Verify bindings regenerate; plan must include a build step after new Rust commands land. |

## Common Pitfalls

### Pitfall 1: Double-starting the watcher on navigation
**What goes wrong:** If `usePipelineChannel` is mounted inside a route view, every navigation tears down the Channel and the Rust side hits `channel.send()` error, exits the forwarder, then the next view re-invokes `start_watch`. The active watch is torn down and rebuilt repeatedly, losing batched events and flashing empty state in the radar.
**Why it happens:** React Router unmounts route elements; route-scoped hooks unmount with them.
**How to avoid:** Mount above `<Outlet/>` (in `AppShell` or a provider). `start_watch` is idempotent (commands.rs:69-72 stops any existing watch first) but churn is still observable.
**Warning signs:** Log line "channel send failed -- frontend channel dead" appears on every route change in dev console.

### Pitfall 2: FK violation on first file event
**What goes wrong:** Pipeline calls `record_session_file(session_id=?, ...)` but `agent_sessions` has no matching row → SQLite rejects with FOREIGN KEY constraint failed, forwarder logs and continues, session_files stays empty.
**Why it happens:** No code path INSERTs into `agent_sessions` today. `record_session_file` has been dead code since Phase 5.
**How to avoid:** Add `ensure_session` before any `record_session_file` call. Wire it into both the passive-scan bridge (creates a session when a new PASSIVE agent appears) and the self-registration handler (creates a session when a KAGENT registers). End the session on reap/terminate.
**Warning signs:** Tracing log `Failed to record session file: error returned from database: FOREIGN KEY constraint failed`.

### Pitfall 3: CWD is not the user's CWD in a packaged build
**What goes wrong:** On a bundled Tauri build (.msi install), `std::env::current_dir()` returns the install directory, not the directory the user invoked AITC from. Auto-detect always falls back to the picker, defeating D-01.
**Why it happens:** Windows shortcut launches and Start-menu launches do not pass a shell cwd.
**How to avoid:** Capture launch-time CWD at the very top of `lib.rs::run()` via `std::env::current_dir().ok()`, stash in a `OnceLock<Option<PathBuf>>` or as managed state, and expose via a Tauri command. Additionally, inspect `std::env::args()` for a trailing path arg (user-dragged folder). Fall back to the persisted `last_repo_root` (D-02) before prompting.

### Pitfall 4: Passive agent becomes a duplicate of self-registered agent
**What goes wrong:** Claude Code launches externally → ProcessSnapshot picks it up at t=2s, bridge upserts `PASSIVE-12345`. At t=5s the agent's wrapper script self-registers → HTTP handler creates `KAGENT-2345`. Tower manifest now shows two rows for the same process.
**Why it happens:** Different key schemes (`PASSIVE-{pid}` vs `KAGENT-{pid%10000}`) mean `upsert_agent` treats them as distinct.
**How to avoid:** In `register_agent` (self_register.rs) add a `registry.remove_agent(&format!("PASSIVE-{}", payload.pid))` before the `upsert_agent` call for the KAGENT id. Equivalently, reconcile by PID field during upsert.
**Warning signs:** Two rows in AgentManifest with identical PID column values.

### Pitfall 5: Paused state races with stop_watch
**What goes wrong:** User clicks Pause while a large batch is in the attributor queue. Pause calls `unregister()` → `stop_watch()`. The batch is mid-send and the channel send fails; events are dropped but `pipelineStore` still shows them as pending.
**Why it happens:** `stop_watch` (commands.rs:198-206) aborts all tasks via `Drop` on ActiveWatch — any in-flight batch is discarded.
**How to avoid:** Pause = stop the forwarder only, not the watcher. But the current `ActiveWatch` has no such API. Two options for the plan:
  1. Simpler: Pause = full unregister; Resume = re-register from last `repoRoot`. Brief gap in coverage during pause (acceptable per D-04 "useful during large git operations").
  2. Richer: Add an atomic flag inside `ActiveWatch` that the forwarder checks — when paused, forwarder drains `attributed_rx` into `/dev/null` rather than sending to the Channel. Keeps watcher alive.
**Recommendation:** Go with option 1 for Phase 6. Option 2 can be a follow-up if users complain about event gaps.

### Pitfall 6: `installRadarPipelineBridge` leaks on hot-reload
**What goes wrong:** Dev HMR re-executes `RepoSessionProvider`; each reload installs a new Zustand subscription, old ones stay active, DevTools shows N stacked subscriptions and redundant `fetchTreeIndex` calls.
**How to avoid:** Store the unsubscribe function in a `useRef`, invoke on unmount effect cleanup. Install exactly once with `useEffect(() => { const un = installRadarPipelineBridge(); return un; }, [])`.

## Code Examples

### Example 1: Repo resolution flow (D-01 / D-02)
```typescript
// src/stores/repoStore.ts (NEW)
// Source: composition of tauri-plugin-dialog API + existing invoke pattern.
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface RepoStore {
  activeRepo: string | null;
  isPaused: boolean;
  error: string | null;
  resolveInitialRepo: () => Promise<void>;
  changeRepo: () => Promise<void>;
  togglePause: () => void;
  setError: (e: string | null) => void;
}

export const useRepoStore = create<RepoStore>((set) => ({
  activeRepo: null,
  isPaused: false,
  error: null,

  resolveInitialRepo: async () => {
    // 1. Try launch-time CWD via new Rust command
    const cwd = await invoke<string | null>('get_launch_cwd');
    if (cwd) {
      const root = await invoke<string | null>('detect_git_root', { path: cwd });
      if (root) { set({ activeRepo: root }); await invoke('persist_last_repo', { path: root }); return; }
    }
    // 2. Try persisted
    const persisted = await invoke<string | null>('get_last_repo');
    if (persisted) { set({ activeRepo: persisted }); return; }
    // 3. Prompt
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      set({ activeRepo: picked });
      await invoke('persist_last_repo', { path: picked });
    }
  },

  changeRepo: async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      set({ activeRepo: picked, isPaused: false });
      await invoke('persist_last_repo', { path: picked });
    }
  },

  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  setError: (error) => set({ error }),
}));
```

### Example 2: Rust commands for CWD / git-root / persistence
```rust
// src-tauri/src/repo_session.rs (NEW module)
// Source: std::env + existing sqlx pattern.
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::process::Command;

static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn capture_launch_cwd() {
    let _ = LAUNCH_CWD.set(std::env::current_dir().ok());
}

#[tauri::command]
#[specta::specta]
pub async fn get_launch_cwd() -> Result<Option<String>, String> {
    Ok(LAUNCH_CWD.get()
        .and_then(|o| o.as_ref())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn detect_git_root(path: String) -> Result<Option<String>, String> {
    let out = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() { return Ok(None); }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn persist_last_repo(
    path: String,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<(), String> {
    sqlx::query("INSERT INTO app_settings (key, value) VALUES ('last_repo_root', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(&path)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("persist: {e}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_last_repo(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM app_settings WHERE key = 'last_repo_root'")
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("load: {e}"))?;
    Ok(row.map(|r| r.0))
}
```

Register in `lib.rs` `collect_commands!` block + call `repo_session::capture_launch_cwd()` at the very top of `run()` (before Tauri builder).

### Example 3: Session ensure / end helpers
```rust
// src-tauri/src/db/session.rs (NEW)
// Source: existing sqlx pattern in conflict/resolution.rs; schema from 001_initial_schema.sql.
use sqlx::SqlitePool;

pub async fn ensure_open_session(
    agent_id: &str,
    agent_type: &str,
    pool: &SqlitePool,
) -> Result<i64, String> {
    // Check for an open session (ended_at IS NULL) for this agent.
    if let Ok(Some((id,))) = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM agent_sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    ).bind(agent_id).fetch_optional(pool).await {
        return Ok(id);
    }
    // Insert new.
    let result = sqlx::query(
        "INSERT INTO agent_sessions (agent_id, agent_type, status, started_at)
         VALUES (?, ?, 'running', datetime('now'))"
    ).bind(agent_id).bind(agent_type).execute(pool).await
     .map_err(|e| format!("insert session: {e}"))?;
    Ok(result.last_insert_rowid())
}

pub async fn close_session(agent_id: &str, pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("UPDATE agent_sessions SET ended_at = datetime('now'), status = 'completed'
                 WHERE agent_id = ? AND ended_at IS NULL")
        .bind(agent_id).execute(pool).await
        .map_err(|e| format!("close session: {e}"))?;
    Ok(())
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `app.emit` broadcasts for high-frequency events | `tauri::ipc::Channel<T>` per subscriber | Tauri 2.0 stable (2024) | Already applied in this codebase; this phase activates it. |
| Manual TS type sync with Rust | `tauri-specta` codegen | Specta 2 RC series | Already applied; new commands auto-export via `specta::specta` attr. |
| Cross-store glue via Context | `zustand.subscribe(selector, cb)` | Zustand 5 | Use for D-08 radar reactivity. |

**Deprecated/outdated:**
- Any `@tauri-apps/api/event` listener pattern for file batches — we use Channel. Don't mix.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tauri-plugin-dialog` 2.x is compatible with installed `tauri 2.10` | Standard Stack | Low — plugins in the official monorepo track the core major. Executor runs `cargo add` and lets resolver confirm. |
| A2 | Capturing CWD at `lib.rs::run()` entry reflects the user's shell directory on Windows packaged builds | Pitfall 3 | Medium — if launched from a Start-menu shortcut, CWD may be `%USERPROFILE%` or install dir. Fallback chain (persisted → picker) keeps UX intact. |
| A3 | `git rev-parse --show-toplevel` is available on all target dev machines | Code Examples / Don't Hand-Roll | Low — AITC is for developers; git is a baseline tool. If missing, `detect_git_root` returns None and we fall through to picker. |
| A4 | Keying passive agents as `PASSIVE-{pid}` will not collide with any current or future `KAGENT-*` or adapter-assigned id scheme | AGNT-03 bridge | Low — prefix is distinct. Verified against `self_register.rs:117` (`KAGENT-{pid%10000}`) and `agents/commands.rs` (assumed to use adapter-specific ids). |
| A5 | Session lifecycle is a one-open-session-per-agent model (no concurrent sessions for same agent_id) | Session ensure / end | Medium — if a user terminates + relaunches the same agent rapidly, the first close_session may race with the second ensure_open_session. Unique lookup by `ended_at IS NULL` handles this but should be wrapped in a transaction. |
| A6 | Frontend `@tauri-apps/plugin-dialog` `open()` returns a string (or null/array) matching v2 signature | Code Example 1 | Low — documented v2 behavior, same as existing `@tauri-apps/plugin-sql` pattern. |

**None of these change the phase scope.** A2 is the one to watch — visually confirm during verification that auto-detect works from a terminal-launched dev build.

## Open Questions

1. **How should the passive sentinel adapter behave on `terminate(pid)`?**
   - What we know: `AgentAdapter::terminate` is called from `terminate_agent` command. For PASSIVE agents, users may want a "detach / forget" vs. a real kill.
   - What's unclear: Does D-06 imply passive agents are view-only (can't be terminated) or can users kill them via the Tower UI?
   - Recommendation: For Phase 6, disable the terminate button in AgentRow for agents with `agent_type === 'unknown'` (protocol `passive-scan`). Flag for Phase 7 if real termination is desired.

2. **Should `ensure_open_session` also insert on self-registration even if no file event arrives?**
   - What we know: HIST-01 wants session records; a self-registered agent that never writes a file today would have no DB row.
   - Recommendation: Yes — call `ensure_open_session` inside the self-registration HTTP handler success path, independent of any file event. Keeps History view showing all launches.

3. **Does the pause toggle clear `pipelineStore.events` or preserve them?**
   - What we know: Current `reset()` clears events and resets `droppedBatches`. Pause-via-unregister would call reset.
   - Recommendation: Modify pause path to skip `reset()`, so the user sees the last events up to the pause. Only `changeRepo` should reset — that's a true session boundary.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git (CLI) | `detect_git_root` | ✓ (dev baseline) | Any modern | Return None → user picker prompt |
| sysinfo 0.38 | PID bridge reconcile | ✓ (Cargo.toml:32) | 0.38 | — |
| SQLite via sqlx 0.8 | Session + settings persistence | ✓ (Cargo.toml:21) | 0.8 | — |
| tauri-plugin-dialog | Folder picker | ✗ | — | Must be added to Cargo.toml + package.json |
| @tauri-apps/plugin-dialog | TS binding for dialog | ✗ | — | Must be added to package.json |
| tauri-plugin-notification | Already in use, unchanged | ✓ | 2 | — |

**Missing dependencies with no fallback:** None — plugin-dialog install is a one-line Cargo + npm addition, not a blocker.

**Missing dependencies with fallback:** `tauri-plugin-dialog`. A prompt-less fallback (prompt via a custom modal inside the app) is possible but undesirable — folder selection on Windows without the native picker is poor UX.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (frontend) | Vitest 3 + @testing-library/react 16 + jsdom 26 |
| Framework (backend) | `cargo test` (built-in) — existing `#[cfg(test)]` modules + `src-tauri/src/pipeline/smoke_tests.rs` |
| Config file | `vite.config.ts` / `vitest.config` inferred; `src/test-setup.ts` existing |
| Quick run command (frontend) | `npm run test -- --run <pattern>` |
| Quick run command (backend) | `cargo test -p aitc_lib --lib <mod_path>` |
| Full suite command | `npm run test && cargo test --manifest-path src-tauri/Cargo.toml` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FMON-01 | `register(repoRoot)` fires once on mount and causes `isWatching=true` | unit | `npm run test -- --run src/__tests__/repoSessionProvider.test.tsx` | Wave 0 |
| FMON-01 | Pause stops watch; resume restarts with same repoRoot | unit | `npm run test -- --run src/__tests__/repoStore.test.ts` | Wave 0 |
| FMON-02 | (cascade) Events with `Attribution::Pid` route to the right session_id | integration | `cargo test -p aitc_lib --lib pipeline::commands::tests::pid_event_records_session_file` | Wave 0 |
| FMON-03 | 10k-file repo activates watch in under the Phase 2 benchmark window | smoke | existing `cargo test --test smoke_tests start_watch_large_repo` extension | Wave 0 extend |
| FMON-04 | Worktrees from `start_watch` land in `pipelineStore.worktrees` | unit | `npm run test -- --run src/stores/__tests__/pipelineStore.test.ts` (extend existing) | extend |
| AGNT-03 | PID bridge upserts `PASSIVE-{pid}`; dedupe with KAGENT on self-register | integration | `cargo test -p aitc_lib --lib agents::registry::tests::passive_merges_with_self_registered` | Wave 0 |
| AGNT-03 | Reap removes stale PASSIVE entries when PID dies | unit | `cargo test -p aitc_lib --lib agents::registry::tests::reap_drops_dead_passives` | Wave 0 |
| HIST-01 | `ensure_open_session` returns existing id for open session, inserts otherwise | unit | `cargo test -p aitc_lib --lib db::session::tests::ensure_session_is_idempotent` | Wave 0 |
| HIST-01 | `record_session_file_internal` increments `file_count` on `agent_sessions` | integration | `cargo test -p aitc_lib --lib conflict::resolution::tests::record_session_file_updates_aggregate` (may exist) | verify existing |
| D-02 | `persist_last_repo` writes row; `get_last_repo` returns it | unit | `cargo test -p aitc_lib --lib repo_session::tests::persist_and_get_roundtrip` | Wave 0 |
| D-01 | `detect_git_root` returns toplevel for a git dir, None otherwise | unit | `cargo test -p aitc_lib --lib repo_session::tests::detect_git_root_for_self_repo` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -- --run <changed file>` + `cargo test -p aitc_lib --lib <changed module>`
- **Per wave merge:** `npm run test && cargo test --manifest-path src-tauri/Cargo.toml`
- **Phase gate:** Full suite green + manual verification of live repo open on Windows dev machine

### Wave 0 Gaps
- [ ] `src/__tests__/repoSessionProvider.test.tsx` — mounts provider, mocks `invoke`, asserts `register` is called with resolved repoRoot
- [ ] `src/__tests__/repoStore.test.ts` — resolve chain, pause/toggle behavior
- [ ] `src-tauri/src/repo_session.rs` — new module with `#[cfg(test)]` submodule for roundtrip tests
- [ ] `src-tauri/src/db/session.rs` — new module with tests for ensure / close idempotency
- [ ] Extend `src-tauri/src/agents/registry.rs` tests to cover `find_agent_by_pid`, `reap_passive_agents`, and PASSIVE<->KAGENT merge
- [ ] Extend `src-tauri/src/pipeline/smoke_tests.rs` with a test that asserts bridge task populates registry and session_files increments

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Desktop app, local-only, single user |
| V3 Session Management | no | No user sessions |
| V4 Access Control | partial | Tauri IPC boundary — all commands are local; no network listener except existing self-registration on 127.0.0.1 |
| V5 Input Validation | yes | `repo_root` path, `file_path` in `record_session_file`, folder picker output |
| V6 Cryptography | no | No encryption required |
| V12 File Handling | yes | Folder picker + git-root detection touches FS |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in `detect_git_root(path)` | Tampering / Information disclosure | `git rev-parse` is invoked with `current_dir(path)` — git itself validates and the output is absolute. Still reject inputs containing `..` segments before shell-out. Existing `start_watch` uses `canonicalize()` (commands.rs:65); mirror that. |
| Malicious path persisted in `app_settings` | Tampering | `persist_last_repo` should validate that path exists AND is a directory before writing. Mirror existing start_watch validation (commands.rs:58-62). |
| Untrusted folder picked by user pointing outside home | Elevation of privilege | Tauri-plugin-dialog returns an OS-blessed path; user consented via native dialog. Acceptable. |
| `AgentInfo.cwd` from `ProcessSnapshot` could be an attacker-controlled path if a malicious non-agent binary spoofs a name in the allowlist | Spoofing | Allowlist is substring-match on lowercased name (already documented Phase 2 risk). Phase 6 inherits this — no change. Log a note in the plan that the passive bridge does not increase this surface. |
| FK injection via `agent_id` in `ensure_open_session` | Tampering | Use parameterized sqlx queries (all examples above use `.bind()`). No string interpolation. |

No new network surface is introduced by this phase. The existing 127.0.0.1 self-register endpoint is unchanged except for the `remove_agent("PASSIVE-{pid}")` reconciliation call.

## Sources

### Primary (HIST confidence)
- `C:/Users/prann/projects/aitc/src-tauri/src/pipeline/commands.rs` — active watch lifecycle and fan-out pattern (lines 45-206)
- `C:/Users/prann/projects/aitc/src-tauri/src/pipeline/process_snapshot.rs` — candidate model (lines 42-178) and refresher pattern
- `C:/Users/prann/projects/aitc/src-tauri/src/agents/registry.rs` — upsert merge semantics (lines 54-85), adapter lookup (lines 148-168)
- `C:/Users/prann/projects/aitc/src-tauri/src/agents/self_register.rs` — KAGENT id scheme (line 117), PID validation (lines 102-114)
- `C:/Users/prann/projects/aitc/src-tauri/src/conflict/resolution.rs` — `record_session_file` SQL (lines 364-397)
- `C:/Users/prann/projects/aitc/src-tauri/src/db/migrations/001_initial_schema.sql` + `004_phase5_resolution.sql` — `agent_sessions`, `session_files`, `app_settings` schemas
- `C:/Users/prann/projects/aitc/src-tauri/src/lib.rs` — command registration pattern (lines 22-79), setup flow
- `C:/Users/prann/projects/aitc/src/hooks/usePipelineChannel.ts` — existing hook (fully implemented, never invoked)
- `C:/Users/prann/projects/aitc/src/stores/radarStore.ts`, `pipelineStore.ts`, `agentStore.ts` — existing Zustand pattern
- `C:/Users/prann/projects/aitc/src/components/layout/AppShell.tsx` — mount point candidate
- `C:/Users/prann/projects/aitc/.planning/v1.0-MILESTONE-AUDIT.md` — gap list driving this phase

### Secondary (MEDIUM)
- [CITED: v2.tauri.app/plugin/dialog/] tauri-plugin-dialog v2 API — `open({ directory: true })`
- [CITED: docs.pmnd.rs/zustand] Zustand 5 `subscribe(selector, cb)` pattern

### Tertiary (LOW)
- None — this phase's research is codebase-driven; no unverified WebSearch claims.

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all existing deps verified in manifests; one new plugin with a clear install path
- Architecture: HIGH — existing code patterns are explicit and followed by all prior phases
- Pitfalls: HIGH — derived from reading the actual code paths (FK violation, channel churn, key collision all verified by source)
- Session lifecycle: MEDIUM — `agent_sessions` INSERT is genuinely missing from the codebase; this research flags it as a prerequisite the plan must address

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (30 days — stable Tauri 2.10 branch)
