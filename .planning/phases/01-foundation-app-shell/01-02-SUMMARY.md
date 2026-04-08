---
phase: 01-foundation-app-shell
plan: 02
subsystem: tauri-backend-and-app-shell
tags: [tray, sqlite, splash-screen, sidebar, router, layout]
dependency_graph:
  requires: [01-01]
  provides: [system-tray, sqlite-db, app-shell-layout, client-routing]
  affects: [01-03]
tech_stack:
  added: [sqlx, tauri-plugin-sql, react-router-dom, zustand]
  patterns: [close-to-tray, two-window-splash, memory-router, zustand-store-per-domain]
key_files:
  created:
    - src-tauri/src/tray.rs
    - src-tauri/src/db/mod.rs
    - src-tauri/src/db/migrations/001_initial_schema.sql
    - src/splashscreen.html
    - src/components/layout/AppShell.tsx
    - src/components/layout/TopBar.tsx
    - src/components/layout/Sidebar.tsx
    - src/stores/sidebarStore.ts
    - src/hooks/useWindowControls.ts
    - src/views/RadarView.tsx
    - src/views/TowerView.tsx
    - src/views/CommsView.tsx
    - src/views/ConflictsView.tsx
  modified:
    - src-tauri/src/lib.rs
    - src-tauri/tauri.conf.json
    - src-tauri/capabilities/default.json
    - src/App.tsx
decisions:
  - "Close-to-tray uses window.hide() in both Rust (on_window_event) and React (useWindowControls hook)"
  - "Active nav indicator uses phosphor green 2px left border (D-03 discretion choice matching runway edge lights)"
  - "SQLite Result type uses Send+Sync bound to satisfy tokio spawn requirements"
  - "Splash screen waits 2s after DB init before closing, ensuring branded display time"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-08T02:56:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 13
  files_modified: 4
requirements:
  - SHELL-01
  - SHELL-02
  - SHELL-04
  - DSGN-01
  - DSGN-04
---

# Phase 01 Plan 02: Tauri Backend Infrastructure & App Shell Layout Summary

Tauri backend with system tray (Show/Quit + double-click restore), SQLite database (4-table schema with auto-migration), branded 2s splash screen, close-to-tray behavior, and React app shell with custom frameless titlebar, collapsible sidebar (80px/256px), and memory router for 4 views.

## Task Completion

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Rust backend -- system tray, SQLite, splash screen, permissions | d6db6fc | Done |
| 2 | App shell layout -- custom titlebar, collapsible sidebar, React Router navigation | 68f8bea | Done |

## What Was Built

### Task 1: Rust Backend Infrastructure

- **System Tray** (`src-tauri/src/tray.rs`): TrayIconBuilder with Show/Quit right-click menu and DoubleClick restore. Uses `show_menu_on_left_click(false)` to prevent menu on single left click.
- **SQLite Database** (`src-tauri/src/db/mod.rs`): Connection pool via SqlitePoolOptions with embedded migrations. Database created at platform app_data_dir as `aitc.db`.
- **Schema** (`src-tauri/src/db/migrations/001_initial_schema.sql`): 4 tables -- agent_sessions, conflict_events, approval_requests, app_settings.
- **Splash Screen** (`src/splashscreen.html`): Static HTML with AT logo, "AI TRAFFIC CONTROLLER" title, "COMMAND HORIZON" tagline, pulsing dot animation. All styles inlined.
- **Configuration**: Two-window splash pattern in tauri.conf.json (main hidden + splashscreen visible). Capabilities include window control and SQL permissions.
- **lib.rs**: Wires tray setup, async DB init with splash timing, and close-to-tray interceptor.

### Task 2: App Shell Layout

- **TopBar** (`src/components/layout/TopBar.tsx`): Custom frameless titlebar with data-tauri-drag-region, "AERO_CODE_CMD" title, and window control buttons (minimize, maximize, close-to-tray) using Lucide icons.
- **Sidebar** (`src/components/layout/Sidebar.tsx`): Collapsible (80px collapsed, 256px expanded) with chevron toggle, 4 nav items (RADAR, TOWER, COMMS, CONFLICTS) using NavLink active state, phosphor green left border indicator, DEPLOY_AGENT disabled button, TERMINAL/LOGS footer links.
- **AppShell** (`src/components/layout/AppShell.tsx`): Layout shell with TopBar + Sidebar + Outlet, sidebar-responsive main content margin.
- **Zustand Store** (`src/stores/sidebarStore.ts`): Sidebar expanded/collapsed state, starts collapsed per D-01.
- **Window Controls Hook** (`src/hooks/useWindowControls.ts`): Wraps getCurrentWindow() for minimize, toggleMaximize, hide (close-to-tray).
- **Router** (`src/App.tsx`): createMemoryRouter with AppShell parent route and 5 child routes (index + 4 views).
- **Placeholder Views**: RadarView, TowerView, CommsView, ConflictsView with section headers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed non-Send error type in async DB init**
- **Found during:** Task 1 cargo check
- **Issue:** `Box<dyn std::error::Error>` is not Send, but `tauri::async_runtime::spawn` requires Send futures. The Result lived across an await point.
- **Fix:** Changed return type to `Box<dyn std::error::Error + Send + Sync>` and restructured the async block to extract the bool result before the sleep await.
- **Files modified:** src-tauri/src/db/mod.rs, src-tauri/src/lib.rs
- **Commit:** d6db6fc

**2. [Rule 1 - Bug] Fixed deprecated tray API and unused import**
- **Found during:** Task 1 cargo check warnings
- **Issue:** `menu_on_left_click` deprecated in favor of `show_menu_on_left_click`; unused `MouseButtonState` import.
- **Fix:** Updated method name and removed unused import.
- **Files modified:** src-tauri/src/tray.rs
- **Commit:** d6db6fc

## Verification Results

- `cargo check` in src-tauri/: PASSED (0 errors, 0 warnings)
- `npx vite build`: PASSED (built in 18.48s)
- `npx vitest run`: PASSED (5 passed, 12 todo from Plan 01 placeholders)

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| Placeholder views (RADAR/TOWER/COMMS/CONFLICTS) | src/views/*.tsx | Intentional -- Plan 03 adds full animated empty states |
| DEPLOY_AGENT button disabled | src/components/layout/Sidebar.tsx | Intentional -- agent management is Phase 2+ |
| TERMINAL/LOGS footer links non-functional | src/components/layout/Sidebar.tsx | Intentional -- future phase feature |

## Self-Check: PASSED

- All 13 created files exist on disk
- Both commits (d6db6fc, 68f8bea) found in git log
- cargo check: 0 errors, 0 warnings
- vite build: successful
- vitest run: 5 passed, 0 failed
