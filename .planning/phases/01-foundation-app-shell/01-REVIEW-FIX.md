---
phase: 01-foundation-app-shell
fixed_at: 2026-04-08T03:40:51Z
review_path: .planning/phases/01-foundation-app-shell/01-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-04-08T03:40:51Z
**Source review:** .planning/phases/01-foundation-app-shell/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: Content Security Policy Disabled

**Files modified:** `src-tauri/tauri.conf.json`
**Commit:** fa5e11d
**Applied fix:** Replaced `"csp": null` with a restrictive CSP that allows only self-origin scripts/styles, inline styles (required for Tailwind), data URIs for images, and IPC connections. This restores Tauri's XSS protections.

### CR-02: Panic via `expect()` in DB Initialization (Non-Recoverable Crash)

**Files modified:** `src-tauri/src/db/mod.rs`
**Commit:** 490fe01
**Applied fix:** Replaced both `expect()` calls with `.map_err()?` error propagation, returning descriptive errors through the existing `Result` return type instead of panicking the async task. Also replaced `format!`-based SQLite URL construction with `SqliteConnectOptions::new().filename()` (addresses WR-03 simultaneously).

### WR-01: Stale Closure in Command Palette Keyboard Handler

**Files modified:** `src/components/ui/CommandPalette.tsx`
**Commit:** d014f5f
**Applied fix:** Changed the Ctrl+Shift+P handler from `setOpen(!open)` (stale closure) to `setOpen(true)` (always open). Removed `open` from the dependency array since the handler no longer reads it. The palette shortcut now always opens; Escape key handles closing.

### WR-02: `unwrap()` Panic on Main Window in `lib.rs`

**Files modified:** `src-tauri/src/lib.rs`
**Commit:** ec1dcd5
**Applied fix:** Replaced `app.get_webview_window("main").unwrap()` with a `let Some(window) ... else` pattern that logs an error message and returns `Err` from setup, preventing a panic if the window label is missing.

### WR-03: DB URL Can Break on Windows Paths with Spaces

**Files modified:** `src-tauri/src/db/mod.rs`
**Commit:** 490fe01
**Applied fix:** Replaced `format!("sqlite:{}?mode=rwc", db_path.display())` with `SqliteConnectOptions::new().filename(&db_path).create_if_missing(true)`, which passes the path as a native `PathBuf` and avoids URL-encoding issues with spaces in Windows paths. Fixed in same commit as CR-02.

### WR-04: Navigation Test Shares Mutable Store State Without Reset

**Files modified:** `src/__tests__/navigation.test.tsx`
**Commit:** 84fd887
**Applied fix:** Added `beforeEach` hook that resets `useSidebarStore` to `{ expanded: false }` before each test, preventing state leakage between test cases. Added `beforeEach` to vitest imports.

### WR-05: Splash Screen Shown Even When DB Init Fails

**Files modified:** `src-tauri/src/lib.rs`
**Commit:** 53a40ad
**Applied fix:** On DB init failure, the app now closes the splash screen and calls `app_handle.exit(1)` instead of proceeding to show the main window. Removed the `db_ok` boolean flag and simplified the match to extract the pool directly, with early return on error.

---

_Fixed: 2026-04-08T03:40:51Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
