---
phase: 01-foundation-app-shell
reviewed: 2026-04-08T03:25:36Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - package.json
  - src/__tests__/command-palette.test.tsx
  - src/__tests__/navigation.test.tsx
  - src/__tests__/radar-pulse.test.tsx
  - src/__tests__/theme.test.ts
  - src/App.tsx
  - src/components/layout/AppShell.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/TopBar.tsx
  - src/components/ui/Button.tsx
  - src/components/ui/CommandPalette.tsx
  - src/components/ui/RadarPulse.tsx
  - src/components/ui/StatusBadge.tsx
  - src/hooks/useWindowControls.ts
  - src/main.tsx
  - src/splashscreen.html
  - src/stores/paletteStore.ts
  - src/stores/sidebarStore.ts
  - src/styles/animations.css
  - src/styles/fonts.css
  - src/styles/theme.css
  - src/views/CommsView.tsx
  - src/views/ConflictsView.tsx
  - src/views/RadarView.tsx
  - src/views/TowerView.tsx
  - src-tauri/capabilities/default.json
  - src-tauri/Cargo.toml
  - src-tauri/src/db/migrations/001_initial_schema.sql
  - src-tauri/src/db/mod.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/main.rs
  - src-tauri/src/tray.rs
  - src-tauri/tauri.conf.json
  - vite.config.ts
  - vitest.config.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-08T03:25:36Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

This phase delivers the foundational app shell: Tauri window management, React routing, the sidebar/topbar layout, a command palette, the design token system, SQLite initialization, and the system tray. The implementation is well-structured with clean separation between stores, components, and views. The design system tokens are consistently applied.

Two critical issues were found. First, `tauri.conf.json` sets `csp: null`, which completely disables the Content Security Policy — a significant security regression for a Tauri app that processes filesystem paths and agent data. Second, `src-tauri/src/db/mod.rs` uses `expect()` panics for directory creation errors instead of returning them through the `Result`, which can crash the app silently before the splash window even appears.

Five warnings cover a stale-closure bug in the command palette keyboard handler, an `unwrap()` panic path in `lib.rs` that will crash if the main window label is wrong, unsafe path construction in `db/mod.rs` that can break on Windows paths with spaces, missing `aria-role` on the command palette overlay, and the navigation test mutating shared Zustand store state between tests without cleanup.

---

## Critical Issues

### CR-01: Content Security Policy Disabled

**File:** `src-tauri/tauri.conf.json:36`
**Issue:** `"csp": null` completely disables Tauri's built-in Content Security Policy. Tauri's default CSP restricts what scripts, styles, and connections the webview can make. Setting it to `null` removes all protections. Once agent integrations start passing filesystem paths and external data through the frontend, this creates a realistic XSS attack surface — a malicious agent could inject script content that runs without restriction.
**Fix:** Restore a restrictive CSP. For the current phase (no external network calls), a tight policy is feasible:
```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost"
}
```
`'unsafe-inline'` for styles is required for Tailwind's runtime class injection. Tighten further before agent data flows through the UI.

---

### CR-02: Panic via `expect()` in DB Initialization (Non-Recoverable Crash)

**File:** `src-tauri/src/db/mod.rs:9-11`
**Issue:** Two `expect()` calls inside an async task will panic the spawned tokio task if the app data directory cannot be resolved or created. Because this runs inside `tauri::async_runtime::spawn`, the panic kills only the spawned task — not the whole process — but the splash window will never close and the main window will never show. The user sees a frozen splash screen with no error message and no way to recover.
```rust
let app_dir = app
    .path()
    .app_data_dir()
    .expect("failed to get app data dir");      // <-- panics in async task
std::fs::create_dir_all(&app_dir).expect("failed to create app data dir"); // <-- same
```
**Fix:** Propagate errors through the `Result` return type so the caller in `lib.rs` can handle them gracefully (show an error dialog, then exit):
```rust
pub async fn init_db(
    app: &tauri::AppHandle,
) -> Result<sqlx::SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("failed to create app data dir: {e}"))?;
    // ... rest unchanged
}
```

---

## Warnings

### WR-01: Stale Closure in Command Palette Keyboard Handler

**File:** `src/components/ui/CommandPalette.tsx:55-64`
**Issue:** The `keydown` handler for `Ctrl+Shift+P` captures `open` from the render closure but has `[open, setOpen]` as its dependency array. This means every time `open` changes, the old listener is removed and a new one is added — which is correct. However, if `setOpen` is called from the handler while `open` is in transition (e.g., React batching), the toggle logic `setOpen(!open)` can mis-evaluate the current state, toggling to the wrong value.
```tsx
// Current: reads closed-over `open` value
setOpen(!open);
```
**Fix:** Use the functional updater form that reads live state, which is consistent with how `toggle` is written in `sidebarStore.ts`:
```tsx
const handler = (e: KeyboardEvent) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    e.preventDefault();
    setOpen(true); // palette shortcut should always open, never toggle
  }
};
// Remove `open` from the dependency array — handler no longer reads it
window.addEventListener('keydown', handler);
return () => window.removeEventListener('keydown', handler);
```
Alternatively, if toggle behavior is intentional, drive it through the store action: `usePaletteStore.getState().setOpen(!usePaletteStore.getState().open)` inside the handler with an empty dependency array.

---

### WR-02: `unwrap()` Panic on Main Window in `lib.rs`

**File:** `src-tauri/src/lib.rs:46`
**Issue:** `app.get_webview_window("main").unwrap()` will panic if the window label does not match. If `tauri.conf.json` is ever edited and the label changes from `"main"`, or in a test build, this crashes the entire process at startup — before any error dialog can appear.
```rust
let window = app.get_webview_window("main").unwrap();
```
**Fix:** Handle the `None` case explicitly:
```rust
let Some(window) = app.get_webview_window("main") else {
    eprintln!("main window not found — check tauri.conf.json window labels");
    return Err("main window not found".into());
};
```

---

### WR-03: DB URL Can Break on Windows Paths with Spaces

**File:** `src-tauri/src/db/mod.rs:14`
**Issue:** The SQLite connection URL is built with `format!("sqlite:{}?mode=rwc", db_path.display())`. On Windows, `app_data_dir()` returns paths like `C:\Users\User Name\AppData\Roaming\aitc\aitc.db`. The space in `User Name` is not percent-encoded, which sqlx may reject or misparse when constructing the URL.
```rust
let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
```
**Fix:** Use the `sqlite://` path-based connection approach that bypasses URL parsing, or use `SqliteConnectOptions` directly:
```rust
use sqlx::sqlite::SqliteConnectOptions;
use std::str::FromStr;

let options = SqliteConnectOptions::new()
    .filename(&db_path)
    .create_if_missing(true);

let pool = SqlitePoolOptions::new()
    .max_connections(5)
    .connect_with(options)
    .await?;
```

---

### WR-04: Navigation Test Shares Mutable Store State Without Reset

**File:** `src/__tests__/navigation.test.tsx:10-18`
**Issue:** The `navigation.test.tsx` file calls `useSidebarStore.getState().toggle()` in one test and then calls `toggle()` again in the same test to reset it. This is fragile — test order-dependency via the shared Zustand store. If the `toggle()` calls are ever separated across `it` blocks (e.g., when the `.todo` tests are implemented), state leaks between tests. The `command-palette.test.tsx` correctly uses `beforeEach` to reset store state; this file does not.
**Fix:** Add a `beforeEach` to reset the sidebar store to its initial state:
```tsx
import { beforeEach } from 'vitest';

beforeEach(() => {
  useSidebarStore.setState({ expanded: false });
});
```

---

### WR-05: Splash Screen Shown Even When DB Init Fails

**File:** `src-tauri/src/lib.rs:30-43`
**Issue:** When `db::init_db` fails, `db_ok` is `false` and the 2-second splash delay is skipped — but the splash is still closed and the main window is shown. The user is presented with a functional-looking app backed by a broken database, which will silently fail on any future DB operations.
```rust
if db_ok {
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
}
// splash always closed regardless of db_ok
if let Some(splash) = app_handle.get_webview_window("splashscreen") {
    let _ = splash.close();
}
```
**Fix:** On DB failure, show an error dialog and exit rather than proceeding:
```rust
Err(e) => {
    eprintln!("Failed to initialize database: {}", e);
    // Show a native dialog before exit
    app_handle.exit(1);
    return;
}
```
At minimum, emit an event to the frontend so the UI can display a startup error state rather than silently operating without storage.

---

## Info

### IN-01: `borderRadius: '50% !important'` in Inline Styles Fights Global CSS Reset

**File:** `src/components/ui/RadarPulse.tsx:41`, `src/views/RadarView.tsx:33-41`
**Issue:** The global `theme.css` rule `* { border-radius: 0 !important; }` uses `!important` to enforce zero border radius everywhere. The inline `style={{ borderRadius: '50% !important' }}` attempts to override it with another `!important`. Inline styles cannot actually override a stylesheet `!important` — the behavior is browser-dependent and may silently fail to produce circular elements.
**Fix:** Use a CSS class with `!important` defined in a stylesheet, which correctly wins the specificity battle:
```css
/* In animations.css or theme.css */
.radius-full { border-radius: 50% !important; }
```
Then use `className="radius-full"` on the ring elements. Alternatively, scope the global reset more tightly using `:not(.radius-full)` to avoid the conflict entirely.

---

### IN-02: `getCurrentWindow()` Called at Module Level in Hook

**File:** `src/hooks/useWindowControls.ts:4`
**Issue:** `getCurrentWindow()` is called directly in the hook body (not inside a `useEffect` or `useMemo`), so it runs on every render. While `getCurrentWindow()` is cheap, it also means the hook cannot be safely used or tested outside a Tauri webview context — any test that imports a component using `useWindowControls` will throw unless `@tauri-apps/api` is mocked.
**Fix:** Memoize the window reference:
```ts
import { useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useWindowControls() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  // ...
}
```

---

### IN-03: `main.tsx` Casts `getElementById` Result Without Null Check

**File:** `src/main.tsx:6`
**Issue:** `document.getElementById("root") as HTMLElement` silently casts away the `HTMLElement | null` type. If the `root` element is missing (e.g., a future template change), `ReactDOM.createRoot(null)` throws an unhelpful runtime error.
**Fix:**
```tsx
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found in DOM");
ReactDOM.createRoot(rootEl).render(/* ... */);
```

---

### IN-04: `animations.css` Not Imported in `main.tsx` or Vite Entry

**File:** `src/main.tsx`
**Issue:** `src/styles/animations.css` is imported via `@import "./animations.css"` inside `theme.css`, which is itself imported in `main.tsx`. This chained import works but is non-obvious — if `theme.css` is ever refactored or replaced, animation keyframes silently disappear. The keyframes are load-bearing for `RadarPulse`, `RadarView`, and the phosphor-in transition used across all views.

This is a low-risk documentation/maintainability note; the current setup is functionally correct.
**Fix:** Either keep the comment in `theme.css` explaining the dependency, or import `animations.css` directly in `main.tsx` alongside `theme.css` to make the dependency explicit.

---

_Reviewed: 2026-04-08T03:25:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
