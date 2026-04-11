---
phase: 04-core-ui-views
fixed_at: 2026-04-10T00:00:00Z
review_path: .planning/phases/04-core-ui-views/04-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-04-10T00:00:00Z
**Source review:** .planning/phases/04-core-ui-views/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: Race condition -- Tauri commands callable before DB pool is registered

**Files modified:** `src-tauri/src/lib.rs`
**Commit:** a13f2af
**Applied fix:** Replaced the async-spawned DB initialization with a synchronous `tauri::async_runtime::block_on(db::init_db(...))` call inside `setup`, registering the pool via `app.manage(pool)` before `.run()` returns. The splash screen transition was moved to its own async task. This eliminates the race window where commands requiring `Pool<Sqlite>` could panic.

### CR-02: XSS via unsanitized innerText from contentEditable

**Files modified:** `src/views/CommsHub/InlineDiff.tsx`
**Commit:** 12f5663
**Applied fix:** Replaced the `contentEditable` span with a controlled `<input type="text">` element for editable (added) lines. Non-editable lines remain as plain `<span>` elements. The input uses `defaultValue` and `onBlur` to capture edits safely via `e.target.value` instead of `innerText`, preventing HTML injection.

### WR-01: get_system_load allocates new System and sleeps 200ms on every call

**Files modified:** `src-tauri/src/system_load.rs`, `src-tauri/src/lib.rs`
**Commit:** bdee778
**Applied fix:** Created a `SystemLoadState` struct wrapping `Arc<Mutex<sysinfo::System>>` as persistent managed state. Registered it in `lib.rs` via `.manage(SystemLoadState::new())`. The `get_system_load` command now locks the shared System instance, refreshes CPU and memory without sleeping, and returns metrics. The 2-second frontend polling interval provides the delta needed for accurate CPU readings.

### WR-02: Broadcast channel receivers may miss first events due to late subscription

**Files modified:** `src-tauri/src/pipeline/commands.rs`
**Commit:** e3c8c3c
**Applied fix:** Moved both `conflict_tx.subscribe()` calls (for conflict engine and protected path watcher) to occur immediately after creating the broadcast channel, before spawning the forwarder task. This ensures receivers are active when the first `send()` occurs, preventing silent event drops.

### WR-03: create_approval_request Tauri command exposes fabrication surface to frontend

**Files modified:** `src-tauri/src/comms/commands.rs`, `src-tauri/src/lib.rs`
**Commit:** 340c73c
**Applied fix:** Removed the `create_approval_request` function (which was a `#[tauri::command]` wrapper around `create_approval_request_internal`) and removed its registration from the `collect_commands!` macro in `lib.rs`. Backend-only callers (protected path trigger, adapter hooks) already use `create_approval_request_internal` directly. Added a comment documenting the removal rationale.

### WR-04: subscribeToApprovals only listens to approval-request-created

**Files modified:** `src/stores/commsStore.ts`
**Commit:** 0f5c590
**Applied fix:** Added `Promise.all` listeners for `approval-resolved` and `approval-updated` events alongside the existing `approval-request-created` listener. Both new listeners call `fetchRequests()` to refresh the full list from the backend. The returned unlisten function now cleans up all three subscriptions.

### WR-05: RadarCanvas render loop runs on every re-render due to missing dependency array

**Files modified:** `src/views/Radar/RadarCanvas.tsx`
**Commit:** 0403b4f
**Applied fix:** Added a `viewportRef` that syncs from the `viewport` state via a separate `useEffect([viewport])`. The main render loop `useEffect` now has an empty dependency array `[]`, ensuring a single `requestAnimationFrame` loop runs for the component's lifetime. The render function reads `viewportRef.current` instead of the closure-captured `viewport`. The existing `dirtyRef` pattern ensures redraws occur when state changes.

### WR-06: buildFileTree silently produces flat tree for Windows backslash paths

**Files modified:** `src/hooks/useTreemapLayout.ts`
**Commit:** 3f5e52a
**Applied fix:** Added `entry.path.replace(/\\/g, '/')` normalization before splitting on `/` in `buildFileTree`. Also updated the file node's stored `path` to use the normalized value, ensuring consistent forward-slash paths throughout the treemap data structure for correct `findRect` matching.

---

_Fixed: 2026-04-10T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
