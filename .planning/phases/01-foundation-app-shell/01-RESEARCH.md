# Phase 1: Foundation + App Shell - Research

**Researched:** 2026-04-07
**Domain:** Tauri v2 desktop application scaffolding, React SPA shell, Command Horizon design system
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield scaffolding phase: create a Tauri v2 + React 19 + TypeScript desktop app with four navigable views, a custom title bar, system tray integration, splash screen, command palette, and the Command Horizon dark-room design system applied throughout. The SQLite database needs schema and auto-migration on first launch.

The developer environment has all required tooling (Rust 1.87, Node 24, npm 11). All npm packages and Rust crates referenced in CLAUDE.md are available at current versions. The primary technical risks are: (1) custom frameless window behavior on Windows requiring careful testing, (2) correctly wiring Tauri v2's permission system for window controls, tray, and SQL, and (3) translating the Command Horizon design tokens into a Tailwind v4 CSS-first theme.

**Primary recommendation:** Scaffold with `create-tauri-app` (React + TypeScript + Vite template), then layer in Tailwind v4, Zustand, React Router v7 (memory router for SPA), custom titlebar, system tray, and splash screen in sequential waves.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Sidebar starts collapsed (icon-only, 80px) on every launch -- no persisted state
- **D-02:** Sidebar expands/collapses via a click toggle button (hamburger/chevron) at the top -- no hover-to-expand, no keyboard shortcut
- **D-03:** Active view highlighting style is Claude's discretion
- **D-04:** Command palette opens with Ctrl+Shift+P keyboard shortcut
- **D-05:** Phase 1 palette offers view navigation plus recent actions (last-visited views)
- **D-06:** Search uses fuzzy matching (typing "rad" matches "Radar View")
- **D-07:** Command palette uses glassmorphism floating style -- surface-variant (#262626) at 60% opacity with backdrop-filter: blur(20px), centered modal overlay
- **D-08:** Empty views show animated ambient states
- **D-09:** Radar empty state uses a minimal pulse animation (central pulsing dot with concentric rings) -- NOT a full rotating sweep line
- **D-10:** Each empty view includes a disabled CTA button with tooltip: "Agent management available in a future update"
- **D-11:** Custom title bar (Tauri decorations:false, frameless window) with custom-built window controls
- **D-12:** Clicking close (X) minimizes to system tray instead of quitting -- double-click tray to restore
- **D-13:** System tray shows a single static AITC icon in Phase 1. Right-click menu: "Show" and "Quit"
- **D-14:** Branded splash screen (2-3 seconds) on launch with AITC logo and "COMMAND HORIZON" tagline, then opens to Radar view

### Claude's Discretion
- Active view sidebar highlight treatment (D-03)
- Splash screen visual design details -- animation style, fade-in/out timing
- Ambient animation specifics for Tower, Comms, and Conflicts empty states
- System tray icon design

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHELL-01 | App runs as Tauri v2 desktop application with native system tray integration | Tauri v2.10 scaffolding + TrayIconBuilder API documented below |
| SHELL-02 | App uses sidebar navigation between four core views: Radar, Tower, Comms, Conflicts | React Router v7 memory router + Zustand sidebar store |
| SHELL-03 | App provides a global search/command palette for quick navigation | Custom React component with Zustand store, fuzzy matching via simple filter |
| SHELL-04 | System tray icon indicates overall system status | TrayIconBuilder with static icon (Phase 1 = always green) |
| DSGN-01 | Command Horizon design system -- dark room, phosphor greens, zero-radius, radar indicators | Tailwind v4 @theme with full CSS custom property set from UI-SPEC |
| DSGN-02 | Typography uses Space Grotesk for headlines and monospace for data/agent IDs | Self-hosted fonts (Space Grotesk + JetBrains Mono) |
| DSGN-03 | Status indicators use radar pulse animations | CSS @keyframes ping-scale animation from wireframe code |
| DSGN-04 | UI achieves glanceability -- system health visible from a glance | Color-coded status system (primary/tertiary/error) with ambient glow |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tauri | 2.10.3 (crate) / @tauri-apps/cli 2.10.1 (npm) | Desktop shell, IPC, window management | Locked in CLAUDE.md. Latest stable. [VERIFIED: cargo search + npm view] |
| React | 19.2.4 | UI framework | Locked in CLAUDE.md. [VERIFIED: npm view] |
| TypeScript | ^5.7 | Type safety | Locked in CLAUDE.md. [ASSUMED: bundled with Vite template] |
| Vite | 8.0.6 | Build tool / dev server | Locked in CLAUDE.md. Vite 8 with Rolldown. [VERIFIED: npm view] |
| React Router | 7.14.0 | Client-side SPA routing | Memory router for Tauri (no server-side navigation). [VERIFIED: npm view] |
| Zustand | 5.0.12 | State management | Locked in CLAUDE.md. Sidebar state, palette state. [VERIFIED: npm view] |
| Tailwind CSS | 4.2.2 | Utility-first CSS with @theme for design tokens | Locked in CLAUDE.md. CSS-first config (no tailwind.config.js). [VERIFIED: npm view] |
| @tailwindcss/vite | ^4.2 | Vite plugin for Tailwind v4 | Replaces PostCSS setup. [VERIFIED: npm registry] |
| Lucide React | 1.7.0 | Icons (stroke-width 1.5px) | Locked in CLAUDE.md. [VERIFIED: npm view] |
| Motion | 12.38.0 | Phosphor transitions, splash screen animations | Locked in CLAUDE.md. [VERIFIED: npm view] |

### Supporting (Frontend)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tauri-apps/api | 2.10.1 | JS bridge to Tauri backend (window, tray, invoke) | Every Tauri command call from React [VERIFIED: npm view] |
| @tauri-apps/plugin-sql | 2.4.0 | Frontend SQLite read access | Read-only dashboard queries in later phases [VERIFIED: npm view] |

### Supporting (Rust Backend)

| Crate | Version | Purpose | When to Use |
|-------|---------|---------|-------------|
| sqlx | 0.8.x (stable) | SQLite with compile-time checked queries | DB schema, migrations. Use stable 0.8, not 0.9-alpha. [VERIFIED: crates.io shows 0.9.0-alpha.1 latest, 0.8.x is last stable] |
| tauri-plugin-sql | 2.3+ | SQL plugin Rust side | Pairs with @tauri-apps/plugin-sql on frontend [VERIFIED: crates.io] |
| serde + serde_json | ^1.0 | Serialization for IPC | Every Rust command that sends/receives data [ASSUMED: standard] |
| tokio | ^1.0 | Async runtime | Built into Tauri v2. Used for splash screen setup, DB init. [ASSUMED: Tauri dependency] |
| tauri-specta | 2.0.0-rc.24 | Type-safe IPC bridge | Generate TS types from Rust commands. Still RC but actively maintained for Tauri v2. [VERIFIED: crates.io] |
| specta | 2.0.0-rc.24 | Type export engine for tauri-specta | Dependency of tauri-specta [VERIFIED: crates.io] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Router (memory) | TanStack Router | React Router is simpler for 4-view SPA; TanStack adds unnecessary complexity |
| Hand-built command palette | cmdk library | cmdk imposes its own styling; Command Horizon needs full custom styling |
| Self-hosted fonts | Google Fonts CDN | Desktop app should not depend on internet; self-host in assets/ |

**Installation (frontend):**
```bash
npm create tauri-app@latest aitc -- --template react-ts
cd aitc
npm install react-router react-router-dom zustand motion lucide-react @tauri-apps/plugin-sql
npm install -D tailwindcss @tailwindcss/vite
```

**Installation (Rust - Cargo.toml):**
```toml
[dependencies]
tauri = { version = "2.10", features = ["tray-icon"] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite"] }
tokio = { version = "1", features = ["time"] }
tauri-specta = { version = "=2.0.0-rc.24", features = ["derive", "typescript"] }
specta = { version = "=2.0.0-rc.24", features = ["derive", "typescript"] }
```

## Architecture Patterns

### Recommended Project Structure
```
src-tauri/
  src/
    lib.rs              # Tauri builder, plugin registration, setup()
    commands/
      mod.rs            # Command modules
    db/
      mod.rs            # SQLite connection pool, migration runner
      migrations/       # SQL migration files
    tray.rs             # System tray builder and event handlers
  capabilities/
    default.json        # Permissions for window, tray, SQL
  icons/                # App icon + tray icon (.ico for Windows)
  tauri.conf.json       # Window config, plugins, security
  Cargo.toml
src/
  main.tsx              # React entry point
  App.tsx               # Router + layout shell
  assets/
    fonts/              # Space Grotesk + JetBrains Mono (self-hosted woff2)
  components/
    layout/
      AppShell.tsx       # TopBar + Sidebar + MainContent
      TopBar.tsx         # Custom titlebar with window controls
      Sidebar.tsx        # Collapsible nav (80px / 256px)
    ui/
      CommandPalette.tsx # Glassmorphism overlay, fuzzy search
      RadarPulse.tsx     # Reusable pulse indicator component
      StatusBadge.tsx    # Inline status badge
      Button.tsx         # Primary + Ghost variants
  views/
    RadarView.tsx        # Empty state with pulse animation
    TowerView.tsx        # Empty state placeholder
    CommsView.tsx        # Empty state placeholder
    ConflictsView.tsx    # Empty state placeholder
    SplashScreen.tsx     # Branded splash (separate Tauri window)
  stores/
    sidebarStore.ts      # Zustand: expanded/collapsed, active view
    paletteStore.ts      # Zustand: open/closed, search query, recent actions
  hooks/
    useWindowControls.ts # Minimize, maximize, close via @tauri-apps/api
  styles/
    theme.css            # Tailwind v4 @theme with all Command Horizon tokens
    animations.css       # @keyframes for ping, scanline, phosphor transitions
    fonts.css            # @font-face declarations
  splashscreen.html      # Static HTML for splash window (loaded by Tauri)
```

### Pattern 1: Tauri v2 Custom Titlebar
**What:** Frameless window with custom HTML titlebar and data-tauri-drag-region
**When to use:** D-11 requires custom window chrome matching Command Horizon
**Implementation:**
```typescript
// Source: https://v2.tauri.app/learn/window-customization/
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

// TopBar.tsx - custom titlebar with drag region
function TopBar() {
  return (
    <header data-tauri-drag-region className="fixed top-0 w-full h-14 bg-surface-container-low flex justify-between items-center px-6 z-50 select-none">
      {/* App title and nav - NOT draggable (interactive) */}
      <div className="flex items-center gap-8">
        <h1 className="text-xl font-bold tracking-tighter text-primary font-headline">
          AERO_CODE_CMD
        </h1>
      </div>
      {/* Window controls - NOT draggable */}
      <div className="flex">
        <button onClick={() => appWindow.minimize()}>
          {/* minimize icon */}
        </button>
        <button onClick={() => appWindow.toggleMaximize()}>
          {/* maximize icon */}
        </button>
        <button onClick={() => appWindow.hide()}>
          {/* close icon - hides to tray per D-12 */}
        </button>
      </div>
    </header>
  );
}
```
[VERIFIED: https://v2.tauri.app/learn/window-customization/]

### Pattern 2: Close-to-Tray (D-12)
**What:** Intercept window close event, hide instead of quit, restore from tray
**When to use:** Required by D-12 and D-13
**Implementation (Rust):**
```rust
// Source: https://v2.tauri.app/learn/system-tray/
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem};
use tauri::Manager;

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}
```
[VERIFIED: https://v2.tauri.app/learn/system-tray/]

### Pattern 3: Splash Screen with Two Windows
**What:** Tauri creates two windows: visible splash + hidden main. After setup, close splash and show main.
**When to use:** D-14 requires branded splash screen
**Configuration (tauri.conf.json):**
```json
{
  "windows": [
    {
      "label": "main",
      "visible": false,
      "decorations": false,
      "width": 1280,
      "height": 800,
      "minWidth": 1280,
      "minHeight": 800
    },
    {
      "label": "splashscreen",
      "url": "/splashscreen.html",
      "width": 600,
      "height": 400,
      "decorations": false,
      "resizable": false,
      "center": true
    }
  ]
}
```
[VERIFIED: https://v2.tauri.app/learn/splashscreen/]

### Pattern 4: Tailwind v4 CSS-First Theme
**What:** Define all Command Horizon tokens via @theme in CSS, no JS config
**When to use:** DSGN-01 through DSGN-04
**Implementation (theme.css):**
```css
/* Source: Tailwind v4 docs + UI-SPEC.md token set */
@import "tailwindcss";

@theme {
  --color-surface: #0e0e0e;
  --color-surface-container-lowest: #000000;
  --color-surface-container-low: #131313;
  --color-surface-container: #1a1919;
  --color-surface-container-high: #201f1f;
  --color-surface-container-highest: #262626;
  --color-surface-variant: #262626;
  --color-primary: #8eff71;
  --color-primary-container: #2ff801;
  --color-on-primary: #0d6100;
  --color-secondary: #00cffc;
  --color-tertiary: #ffd16f;
  --color-error: #ff7351;
  --color-error-container: #b92902;
  --color-on-surface: #ffffff;
  --color-on-surface-variant: #adaaaa;
  --color-outline: #777575;
  --color-outline-variant: #494847;
  --color-on-error: #450900;

  --font-headline: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```
[CITED: https://tailwindcss.com/blog/tailwindcss-v4 + 01-UI-SPEC.md]

### Pattern 5: React Router v7 Memory Router for Tauri SPA
**What:** Use createMemoryRouter (not browser router) since Tauri has no URL bar
**When to use:** SHELL-02 view navigation
```typescript
// Source: https://reactrouter.com/api/data-routers/createMemoryRouter
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const router = createMemoryRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <RadarView /> },
      { path: 'radar', element: <RadarView /> },
      { path: 'tower', element: <TowerView /> },
      { path: 'comms', element: <CommsView /> },
      { path: 'conflicts', element: <ConflictsView /> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}
```
[VERIFIED: https://reactrouter.com/api/data-routers/createMemoryRouter]

### Pattern 6: Zustand Store-Per-Domain
**What:** Separate Zustand stores for each UI concern
**When to use:** All state management in Phase 1
```typescript
// Source: CLAUDE.md recommends store-per-domain pattern
import { create } from 'zustand';

interface SidebarStore {
  expanded: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  expanded: false, // D-01: starts collapsed on every launch
  toggle: () => set((s) => ({ expanded: !s.expanded })),
}));
```
[ASSUMED: standard Zustand pattern]

### Anti-Patterns to Avoid
- **Using createBrowserRouter in Tauri:** Tauri WebView has no URL navigation; use createMemoryRouter. BrowserRouter will break on reload and produce blank screens.
- **Using tailwind.config.js with Tailwind v4:** v4 uses CSS-first @theme. A JS config file is legacy and will not pick up the Vite plugin correctly.
- **Fetching fonts from Google CDN:** Desktop app must work offline. Self-host woff2 files in src/assets/fonts/.
- **Using Material Symbols from the wireframe HTML:** Wireframes use Material Symbols for prototyping; CLAUDE.md specifies Lucide React with 1.5px stroke-width. Map wireframe icons to Lucide equivalents.
- **Borders for sectioning:** DESIGN.md "No-Line Rule" prohibits borders for panel separation. Use tonal shifts (surface tier changes) and negative space instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Window minimize/maximize/close | Custom IPC commands | `@tauri-apps/api/window` getCurrentWindow() methods | Battle-tested, handles platform quirks |
| System tray | Custom native code | Tauri's built-in TrayIconBuilder | Cross-platform, handles Windows/macOS/Linux differences |
| SQLite connection management | Raw rusqlite | sqlx with connection pool | Compile-time SQL checking, async, migration support |
| CSS design token system | Manual CSS variables + utility classes | Tailwind v4 @theme directive | Automatically generates utility classes from CSS custom properties |
| Splash screen orchestration | setTimeout + manual window management | Tauri's two-window splash pattern | Handles edge cases (race conditions, window focus) |
| Fuzzy matching for command palette | Custom string matching | Simple includes() or lightweight fuse.js-style filter | For 4 items + recent actions, a sophisticated algorithm is overkill; Array.filter with toLowerCase is sufficient in Phase 1 |

**Key insight:** Phase 1 is foundational scaffolding. Every hand-rolled solution here becomes tech debt in Phases 2-5. Use platform APIs (Tauri) and established libraries (React Router, Zustand) for everything infrastructure-related; reserve custom code for Command Horizon visual components only.

## Common Pitfalls

### Pitfall 1: Tauri v2 Permission System
**What goes wrong:** Commands and plugins silently fail because capabilities are not declared in `src-tauri/capabilities/default.json`.
**Why it happens:** Tauri v2 introduced a granular permission system. Every API call needs explicit permission.
**How to avoid:** Add ALL required permissions upfront. For Phase 1:
```json
{
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-start-dragging",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:window:allow-unminimize",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "sql:allow-close"
  ]
}
```
**Warning signs:** JavaScript console errors with "Not allowed" or "Permission denied" messages.
[VERIFIED: https://v2.tauri.app/learn/window-customization/ + https://v2.tauri.app/plugin/sql/]

### Pitfall 2: Frameless Window Resize on Windows
**What goes wrong:** Setting `decorations: false` historically broke window resizing.
**Why it happens:** Native window resizing relies on the window frame hit-test areas that disappear with decorations off.
**How to avoid:** The bug was fixed in Tauri v2 beta (commit 9a4d46e). Current stable v2.10 should work. But test early -- if resize breaks, the `data-tauri-drag-region` attribute plus explicit `resizable: true` in tauri.conf.json is the configuration.
**Warning signs:** Window cannot be resized by dragging edges/corners.
[VERIFIED: https://github.com/tauri-apps/tauri/issues/8519 -- fixed in 2024]

### Pitfall 3: Splash Screen Race Condition
**What goes wrong:** Main window shows before React hydration completes, causing a white flash.
**Why it happens:** Tauri's `show()` call completes before React's first render.
**How to avoid:** Use the two-window pattern (splash + hidden main). Only call `splashscreen.close()` + `main.show()` AFTER both backend setup AND frontend DOMContentLoaded are confirmed. Use Tauri's Mutex-based state tracking pattern from official docs.
**Warning signs:** Brief white screen flash between splash and main window.
[VERIFIED: https://v2.tauri.app/learn/splashscreen/]

### Pitfall 4: Tailwind v4 Font Family Token Naming
**What goes wrong:** Custom font-family tokens don't generate expected utility classes.
**Why it happens:** Tailwind v4 @theme expects `--font-*` namespace for font families. Using wrong prefix means `font-headline` class won't work.
**How to avoid:** Use `--font-headline` and `--font-mono` in @theme block. Then use `font-headline` and `font-mono` as utility classes.
**Warning signs:** Font utility classes don't apply; elements fall back to system fonts.
[CITED: https://tailwindcss.com/blog/tailwindcss-v4]

### Pitfall 5: Command Palette Keyboard Shortcut Conflict
**What goes wrong:** Ctrl+Shift+P conflicts with VS Code's command palette if dev tools are open.
**Why it happens:** Browser-like shortcuts in WebView can conflict with dev tools.
**How to avoid:** Register the shortcut in React with a global keydown listener. The CONTEXT.md specifies Ctrl+Shift+P (D-04). Note: UI-SPEC.md says Ctrl+K -- the CONTEXT.md decision (Ctrl+Shift+P) takes precedence as it was explicitly discussed and decided.
**Warning signs:** Shortcut doesn't fire, or fires something unexpected.

### Pitfall 6: SQLite File Location
**What goes wrong:** Database created in wrong directory, or path doesn't exist on first launch.
**Why it happens:** Desktop apps need to use the platform-specific app data directory.
**How to avoid:** Use Tauri's `app.path().app_data_dir()` to get the correct platform path (e.g., `%APPDATA%/com.aitc.app/` on Windows). Create directory if it doesn't exist before opening SQLite connection.
**Warning signs:** "No such file or directory" errors on first launch.
[ASSUMED: standard Tauri pattern for app data]

## Code Examples

### Self-Hosted Font Loading
```css
/* src/styles/fonts.css */
@font-face {
  font-family: 'Space Grotesk';
  src: url('/fonts/SpaceGrotesk-Variable.woff2') format('woff2');
  font-weight: 300 700;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Variable.woff2') format('woff2');
  font-weight: 400 700;
  font-display: swap;
}
```
[ASSUMED: standard @font-face pattern]

### Radar Pulse Animation (DSGN-03)
```css
/* From wireframe code.html -- verified pattern */
@keyframes ping-scale {
  75%, 100% {
    transform: scale(2.5);
    opacity: 0;
  }
}

.ping {
  animation: ping-scale 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
```
[VERIFIED: wireframes/airspace_radar/code.html line 114-118]

### Scanline Sweep Ambient Effect
```css
/* From wireframe code.html */
.scanline-wipe::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: rgba(142, 255, 113, 0.2);
  opacity: 0.5;
  animation: scan 4s linear infinite;
}

@keyframes scan {
  0% { top: 0; }
  100% { top: 100%; }
}
```
[VERIFIED: wireframes/airspace_radar/code.html line 88-107]

### SQLite Migration Runner (Rust)
```rust
// Source: https://tauritutorials.com/blog/building-a-todo-app-in-tauri-with-sqlite-and-sqlx
use sqlx::sqlite::SqlitePoolOptions;
use tauri::Manager;

pub async fn init_db(app: &tauri::AppHandle) -> Result<sqlx::SqlitePool, sqlx::Error> {
    let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

    let db_path = app_dir.join("aitc.db");
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}
```
[CITED: Tauri tutorials + sqlx docs]

### Initial SQLite Schema (Phase 1 Foundation)
```sql
-- migrations/001_initial_schema.sql
-- Session records (HIST-01, used in Phase 5 but schema created now)
CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conflict log (HIST-02)
CREATE TABLE IF NOT EXISTS conflict_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_a_id INTEGER REFERENCES agent_sessions(id),
    session_b_id INTEGER REFERENCES agent_sessions(id),
    file_path TEXT NOT NULL,
    resolution TEXT,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- Approval log (HIST-03)
CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES agent_sessions(id),
    request_type TEXT NOT NULL,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- App settings (Phase 1: minimal)
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```
[ASSUMED: schema design based on REQUIREMENTS.md HIST-01 through HIST-03]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js | @theme in CSS (Tailwind v4) | Jan 2025 | No JS config file; CSS custom properties consumed natively |
| Tauri v1 system tray | Tauri v2 TrayIconBuilder | 2024 | Different API; v1 examples won't work |
| react-router v6 createBrowserRouter | react-router v7 (same API, non-breaking) | 2025 | v7 is drop-in upgrade from v6 |
| Framer Motion | Motion v12 | 2024 | Renamed package; import from "motion/react" not "framer-motion" |
| notify 6.x | notify 8.x stable (9.0 in RC) | 2024 | Use 8.x stable for Phase 1; 9.0 is RC only |
| sqlx 0.7 | sqlx 0.8.x stable (0.9 in alpha) | 2024 | Use 0.8.x stable; 0.9 is alpha |

**Deprecated/outdated:**
- `framer-motion` package name: Use `motion` (import from `motion/react`)
- Tailwind v3 `tailwind.config.js`: v4 uses CSS @theme; JS config is legacy compatibility mode
- Tauri v1 `SystemTray::new()`: v2 uses `TrayIconBuilder` in setup()

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TypeScript ^5.7 bundled with Vite template | Standard Stack | LOW -- Vite template always includes TS |
| A2 | Zustand store-per-domain is the right pattern for sidebar + palette state | Architecture | LOW -- trivially refactorable |
| A3 | Simple includes()/toLowerCase() is sufficient for Phase 1 fuzzy matching (D-06) | Don't Hand-Roll | LOW -- can swap to fuse.js later if needed |
| A4 | SQLite schema can be created in Phase 1 even though HIST records aren't populated until Phase 5 | Code Examples | MEDIUM -- might create unused tables early, but ensures migration path |
| A5 | Self-hosted woff2 variable fonts for Space Grotesk and JetBrains Mono are available | Code Examples | LOW -- both are open source fonts available as woff2 |
| A6 | `app.path().app_data_dir()` is the correct Tauri v2 API for platform-specific data directory | Common Pitfalls | MEDIUM -- API name may differ; verify against Tauri v2 docs |
| A7 | tauri-specta RC versions are stable enough for production use | Standard Stack | MEDIUM -- RC status means potential breaking changes |

## Open Questions

1. **Command palette shortcut: Ctrl+Shift+P (CONTEXT.md D-04) vs Ctrl+K (UI-SPEC.md)**
   - What we know: CONTEXT.md explicitly discusses and decides Ctrl+Shift+P. UI-SPEC.md lists Ctrl+K.
   - What's unclear: Which takes precedence? They were produced by different processes.
   - Recommendation: Use Ctrl+Shift+P per CONTEXT.md (user-decided). It also avoids conflicts with browser Ctrl+K behavior.

2. **tauri-specta RC stability for Phase 1**
   - What we know: tauri-specta is at 2.0.0-rc.24. CLAUDE.md recommends it.
   - What's unclear: Whether RC.24 is stable enough, or if manual invoke() typing is safer for Phase 1.
   - Recommendation: Use tauri-specta -- Phase 1 has very few Rust commands (splash close, DB init), so even if specta has issues, the blast radius is small. Can fall back to manual typing.

3. **System tray icon format**
   - What we know: Windows needs .ico, macOS needs .png. Tauri handles this via icon configuration.
   - What's unclear: Whether a single SVG source can be auto-converted, or if we need separate icon files.
   - Recommendation: Create a simple AITC icon in .ico format for Windows (Phase 1 target). Use Tauri's default icon as placeholder during development.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | Tauri backend | Yes | 1.87.0 | -- |
| Cargo | Rust builds | Yes | 1.87.0 | -- |
| Node.js | Frontend build | Yes | 24.1.0 | -- |
| npm | Package management | Yes | 11.3.0 | -- |
| SQLite | Database | Yes (via sqlx, compiled in) | -- | -- |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:** None

All required tooling is present and at current versions.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (frontend), cargo test (Rust backend) |
| Config file | None -- Wave 0 creates vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run && cd src-tauri && cargo test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHELL-01 | Tauri app builds and creates window | smoke | `cd src-tauri && cargo build` | N/A (build test) |
| SHELL-02 | Sidebar nav switches between 4 views | unit | `npx vitest run src/__tests__/navigation.test.tsx` | Wave 0 |
| SHELL-03 | Command palette opens, searches, navigates | unit | `npx vitest run src/__tests__/command-palette.test.tsx` | Wave 0 |
| SHELL-04 | System tray icon exists with menu | manual-only | Manual: right-click tray icon, verify "Show" and "Quit" | -- |
| DSGN-01 | Design tokens produce correct CSS values | unit | `npx vitest run src/__tests__/theme.test.ts` | Wave 0 |
| DSGN-02 | Fonts load and apply correctly | manual-only | Manual: visual inspection of typography | -- |
| DSGN-03 | Radar pulse animation renders | unit | `npx vitest run src/__tests__/radar-pulse.test.tsx` | Wave 0 |
| DSGN-04 | Status colors visible (glanceability) | manual-only | Manual: visual inspection | -- |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- test framework config
- [ ] `src/__tests__/navigation.test.tsx` -- covers SHELL-02
- [ ] `src/__tests__/command-palette.test.tsx` -- covers SHELL-03
- [ ] `src/__tests__/theme.test.ts` -- covers DSGN-01
- [ ] `src/__tests__/radar-pulse.test.tsx` -- covers DSGN-03
- [ ] Framework install: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- local desktop app, no auth |
| V3 Session Management | No | N/A -- no user sessions |
| V4 Access Control | No | N/A -- single user |
| V5 Input Validation | Yes (minimal) | Command palette input sanitized before use; no user input reaches SQL in Phase 1 |
| V6 Cryptography | No | N/A -- no secrets in Phase 1 |

### Known Threat Patterns for Tauri + React

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IPC command injection | Tampering | Tauri v2 capability permissions restrict which commands frontend can call |
| Malicious webview content | Elevation | CSP headers in tauri.conf.json; no external script loading |
| SQL injection via frontend | Tampering | All writes through Rust commands with parameterized sqlx queries; frontend gets read-only access via plugin |

## Sources

### Primary (HIGH confidence)
- [Tauri v2 Window Customization](https://v2.tauri.app/learn/window-customization/) -- custom titlebar, decorations:false, drag regions, permissions
- [Tauri v2 System Tray](https://v2.tauri.app/learn/system-tray/) -- TrayIconBuilder, menu events, tray icon events
- [Tauri v2 Splashscreen](https://v2.tauri.app/learn/splashscreen/) -- two-window pattern, setup state tracking
- [Tauri v2 SQL Plugin](https://v2.tauri.app/plugin/sql/) -- plugin setup, permissions, migration API
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) -- @theme directive, CSS-first configuration
- [React Router createMemoryRouter](https://reactrouter.com/api/data-routers/createMemoryRouter) -- memory router API
- npm registry -- all package versions verified via `npm view`
- crates.io -- Rust crate versions verified via `cargo search`

### Secondary (MEDIUM confidence)
- [Tauri Tutorials - SQLite + sqlx](https://tauritutorials.com/blog/building-a-todo-app-in-tauri-with-sqlite-and-sqlx) -- sqlx integration pattern
- [GitHub Issue #8519](https://github.com/tauri-apps/tauri/issues/8519) -- frameless window resize fix confirmed

### Tertiary (LOW confidence)
- None

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** Tauri v2 + React 19 + TypeScript + Vite 8 + Zustand 5 + Tailwind v4 + Lucide React + Motion v12
- **No shadcn/ui:** Command Horizon is too custom; all components hand-built
- **No borders for sectioning:** "No-Line Rule" from DESIGN.md
- **Zero border-radius:** All components use 0px radius
- **Icons:** Lucide React with configurable stroke-width (1.5px global) -- NOT Material Symbols from wireframes
- **Fonts:** Space Grotesk (headlines) + JetBrains Mono (data/code) -- self-hosted, NOT Inter for body
- **DB approach:** sqlx with compile-time SQL checking for writes; tauri-plugin-sql for frontend reads
- **State management:** Zustand with store-per-domain pattern
- **tauri-specta:** For type-safe Rust-to-TypeScript IPC bridge

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages verified against registries, versions confirmed current
- Architecture: HIGH -- patterns drawn from official Tauri v2 documentation
- Pitfalls: HIGH -- verified against official docs and GitHub issues
- Design system: HIGH -- complete token set provided in UI-SPEC.md with wireframe code reference

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (30 days -- stable ecosystem, no major releases expected)
