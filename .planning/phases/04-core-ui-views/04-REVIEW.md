---
phase: 04-core-ui-views
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src-tauri/src/comms/commands.rs
  - src-tauri/src/comms/types.rs
  - src-tauri/src/comms/protected_path_trigger.rs
  - src-tauri/src/system_load.rs
  - src-tauri/src/agents/notifications.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/pipeline/commands.rs
  - src/stores/commsStore.ts
  - src/stores/radarStore.ts
  - src/views/CommsView.tsx
  - src/views/CommsHub/InlineDiff.tsx
  - src/views/CommsHub/ApprovalActions.tsx
  - src/views/CommsHub/ChatThread.tsx
  - src/views/CommsHub/ChatInput.tsx
  - src/views/CommsHub/SystemLoad.tsx
  - src/views/CommsHub/MiniChatCard.tsx
  - src/views/Radar/RadarCanvas.tsx
  - src/views/RadarView.tsx
  - src/views/Radar/RadarManifest.tsx
  - src/hooks/useTreemapLayout.ts
  - src/hooks/useCanvasZoomPan.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 04 introduces the Communications Hub (approval workflow, chat, protected paths), system load telemetry, and the Radar canvas view (treemap, zoom/pan, agent dots, lead lines). Overall the code is well-structured and follows the Tauri + Zustand + Canvas 2D architecture. Two critical issues were found: a race condition that allows the backend to receive Tauri commands that require the SQLite pool before the pool is registered as managed state, and a cross-site-scripting-class issue (XSS-via-contentEditable) in the inline diff editor. Six warnings cover logic errors in the render loop, incorrect palette color indexing, missing error propagation, and two edge-case bugs. Four informational items flag dead code and minor quality concerns.

---

## Critical Issues

### CR-01: Race condition — Tauri commands that need the DB pool are callable before the pool is registered

**File:** `src-tauri/src/lib.rs:86-127`

The `Pool<Sqlite>` is registered with `app_handle.manage(pool)` inside an async task spawned at setup time (line 114). However, the invoke handler is active the moment `tauri::Builder::run()` is called. Any IPC call from the frontend that arrives before the async task completes — including all 11 comms commands and `start_watch` — will trigger a Tauri state lookup of `Pool<Sqlite>` that panics with *"State<Pool<Sqlite>> has not been managed"*.

On a slow machine the splash screen 2-second sleep (line 117) makes this window large. The main window is hidden by default, but a user who resizes or the window system that sends events early can trigger this.

**Fix:** Register a placeholder pool (or the real pool) synchronously before calling `.run()`. The canonical Tauri v2 pattern is to initialize the DB in `setup` using `tauri::async_runtime::block_on` or pre-build the pool outside the builder:

```rust
// In run(), before tauri::Builder::default()
let pool = tauri::async_runtime::block_on(db::init_db_with_handle(/* data_dir */))
    .expect("Failed to initialize database");

tauri::Builder::default()
    // ...
    .manage(pool)           // registered before .run(), never panics
    .setup(move |app| {
        // splash/main window logic only
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

If `init_db` requires `AppHandle` for the data directory, use `app.path().app_data_dir()` synchronously inside `setup` with `block_on`.

---

### CR-02: XSS via unsanitized `innerText` from contentEditable written back into state and sent to backend

**File:** `src/views/CommsHub/InlineDiff.tsx:140-146`

`contentEditable` lines read back their content with `e.target.innerText` (line 143). `innerText` returns the visible text of the element, which is generally safe — but the `displayContent` is rendered as children of a `contentEditable` span (line 149). If the backend ever supplies diff content that itself contains HTML (e.g., `<img onerror=...>`), React does **not** escape children set via JSX when the node is `contentEditable`, because the browser's content-editable algorithm controls the DOM. An attacker who can produce a crafted `diff_content` value in the DB (e.g., via a malicious agent) could inject active HTML into the editable spans.

Additionally, the edited text returned via `handleContentEdit` → `onEditsChange` → `ApprovalActions.editedContent` is sent verbatim to `approve_with_edits` without any backend sanitization beyond storing it in the DB column `edited_content`. While SQLite binding prevents SQL injection, the value is later presumably applied to actual files. An injected shell-metacharacter sequence is not sanitized.

**Fix:** Render diff line content as plain text only. Replace the `contentEditable` span approach with a controlled `<textarea>` or an `<input>` per editable line, or at minimum sanitize `innerText` output by stripping any HTML tags before storing:

```tsx
// Replace contentEditable span with controlled input for editable lines
{isEditable ? (
  <input
    type="text"
    className={`flex-1 font-mono text-xs leading-5 px-2 bg-transparent border-none outline-none ${textColor}`}
    defaultValue={line.content}
    onBlur={(e) => {
      const newText = e.target.value;
      if (newText !== line.content) {
        handleContentEdit(index, newText);
      }
    }}
  />
) : (
  <span className={`flex-1 font-mono text-xs leading-5 px-2 ${textColor} ${additionalStyles}`}>
    {displayContent}
  </span>
)}
```

---

## Warnings

### WR-01: `get_system_load` allocates a new `sysinfo::System` and sleeps 200ms on every call — called every 2 seconds

**File:** `src-tauri/src/system_load.rs:23-44`

Every invocation creates a fresh `System`, refreshes CPU, sleeps 200ms (blocking a tokio worker thread), then refreshes again. At a 2-second poll interval this means 10% of the async thread is permanently sleeping. More critically, `tokio::time::sleep` inside an async command suspends the tokio task but `System` is not `Send` in some sysinfo versions; even if it is, re-creating the struct every call discards the kernel state that sysinfo uses to compute delta-based CPU usage. The result can be `0%` CPU on every even call and a spike on odd calls.

**Fix:** Hold the `System` in a `Mutex<System>` in Tauri managed state, refresh it once per command call, and let the 2-second polling cadence (not an internal sleep) provide the delta:

```rust
// In lib.rs setup:
.manage(Arc::new(tokio::sync::Mutex::new(sysinfo::System::new())))

// In get_system_load:
pub async fn get_system_load(
    sys: tauri::State<'_, Arc<tokio::sync::Mutex<sysinfo::System>>>,
) -> Result<SystemLoadInfo, String> {
    let mut system = sys.lock().await;
    system.refresh_cpu_all();
    system.refresh_memory();
    let cpu_percent = system.global_cpu_usage() as f64;
    // ...
}
```

---

### WR-02: Broadcast channel initial receiver dropped immediately — protected path watcher may miss batches

**File:** `src-tauri/src/pipeline/commands.rs:109`

```rust
let (conflict_tx, _) = broadcast::channel::<FileEventBatch>(256);
```

The initial `_` receiver is dropped, which is intentional (only the later `.subscribe()` calls matter). However, the forwarder task (line 118) calls `conflict_tx_clone.send(batch.clone())`. A `broadcast::Sender::send` returns `Err(SendError)` when there are **zero active receivers** at the moment of the call. If the conflict engine or protected path watcher tasks have not yet been polled by the tokio scheduler between pipeline start and the first event arrival, the send silently drops the batch. Given the comment "drop if no receivers", this is known — but the result is that the very first file events after watch start are never checked against protected paths or conflict detection, which is a correctness issue for fast-writing agents.

**Fix:** Subscribe both receivers before spawning the forwarder, or use `mpsc` channels instead of broadcast for exactly-two-receiver fan-out:

```rust
let mut conflict_rx = conflict_tx.subscribe();  // subscribe BEFORE forwarder spawns
let protected_rx = conflict_tx.subscribe();      // subscribe BEFORE forwarder spawns

let forwarder = tokio::spawn(async move { ... });
let conflict_task = tokio::spawn(async move { while let Ok(batch) = conflict_rx.recv() ... });
let protected_task = spawn_protected_path_watcher(protected_rx, ...);
```

---

### WR-03: `create_approval_request` Tauri command is callable from the frontend — security control comment contradicts the exposed surface

**File:** `src-tauri/src/comms/commands.rs:137-158`

The doc comment at line 133 states: *"T-04-03 mitigation: Only called from Rust backend ... Frontend can approve/deny/ask but not fabricate requests through this command in normal workflow."* Yet the command is decorated `#[tauri::command]` and registered in `lib.rs:39`, making it directly callable from the frontend with arbitrary `agent_id`, `request_type`, and `urgency` values. A malicious or compromised webview (e.g., via a plugin loading external content) could fabricate approval requests for any agent and any file.

**Fix:** Remove `create_approval_request` from the Tauri command surface entirely. Backend-only callers (protected path trigger, adapter hooks) already use `create_approval_request_internal` directly. Delete the `#[tauri::command]` wrapper and remove it from the `collect_commands!` macro in `lib.rs`.

---

### WR-04: `subscribeToApprovals` only listens to `approval-request-created` — approve/deny/info events are not reflected in real time

**File:** `src/stores/commsStore.ts:163-185`

The store subscribes only to `"approval-request-created"`. Backend commands `approve_request`, `deny_request`, and `ask_more_info` each emit `"approval-resolved"` and `"approval-updated"` respectively (commands.rs lines 176, 194, 244). The frontend never listens to these events. After another user session (or a backend-triggered resolution), the approval list only updates on next `fetchRequests()` call. The optimistic local update in `approveRequest`/`denyRequest` works for the current session, but state diverges if events arrive from the backend independently.

**Fix:** Add listeners for `approval-resolved` and `approval-updated` in `subscribeToApprovals`, and return a combined unlisten function:

```typescript
subscribeToApprovals: async () => {
  const [unCreated, unResolved, unUpdated] = await Promise.all([
    listen<ApprovalRequest>('approval-request-created', (event) => { /* existing logic */ }),
    listen<number>('approval-resolved', (event) => {
      get().fetchRequests(); // or targeted update
    }),
    listen<number>('approval-updated', (event) => {
      get().fetchRequests();
    }),
  ]);
  return () => { unCreated(); unResolved(); unUpdated(); };
},
```

---

### WR-05: `RadarCanvas` render loop runs unconditionally on every animation frame when agents have dots

**File:** `src/views/Radar/RadarCanvas.tsx:178-218`

The render loop `useEffect` has no dependency array (line 218, bare `}`). This means it re-registers `requestAnimationFrame` on every React re-render of `RadarCanvas`, potentially stacking multiple concurrent rAF loops. Each re-render (from any store selector changing) cancels the previous frame via `cancelAnimationFrame(animFrameRef.current)`, but only cancels the *last stored frame ID* — if a frame fires between the cancel and the new registration, a double-render occurs. More importantly, without a dependency array, the closure captures stale `viewport`, `agents`, etc., mitigated by refs but inconsistently so.

**Fix:** Add an empty dependency array `[]` to the render loop `useEffect` and access all changing values through refs:

```typescript
const viewportRef = useRef(viewport);
useEffect(() => { viewportRef.current = viewport; }, [viewport]);

// render loop useEffect — runs once, reads from refs
useEffect(() => {
  function render() {
    if (dirtyRef.current || hasAnimatingDots) {
      // use viewportRef.current instead of viewport
    }
    animFrameRef.current = requestAnimationFrame(render);
  }
  animFrameRef.current = requestAnimationFrame(render);
  return () => cancelAnimationFrame(animFrameRef.current);
}, []); // empty deps: one loop for the lifetime of the component
```

---

### WR-06: `buildFileTree` silently produces incorrect tree for Windows-style backslash paths

**File:** `src/hooks/useTreemapLayout.ts:50`

```typescript
const segments = entry.path.split('/');
```

The backend (`pipeline/commands.rs:231`) converts paths via `path.to_string_lossy().to_string()` on Windows, which produces backslash separators (`src-tauri\src\lib.rs`). The frontend splits only on `/`, yielding a single-segment path with no directory structure — all files land as direct children of root with the full path as their name, making the treemap flat and all directory grouping lost.

`findRect` in `RadarCanvas.tsx:170` does normalize with `replace(/\\/g, '/')`, but the tree is already built incorrectly by the time `findRect` is called.

**Fix:** Normalize path separators before splitting in `buildFileTree`:

```typescript
const normalized = entry.path.replace(/\\/g, '/');
const segments = normalized.split('/');
```

---

## Info

### IN-01: Agent ID derived from PID modulo — not stable across process restarts

**File:** `src-tauri/src/comms/protected_path_trigger.rs:91`

```rust
let agent_id = format!("KAGENT-{:04}", pid % 10000);
```

The PID-to-agent-ID mapping is ad-hoc and not consistent with how agents are identified elsewhere in the system (where `AgentInfo.id` is set by the adapter or self-registration). If the same process restarts with a different PID, or if two processes produce the same `pid % 10000`, approval requests are associated with the wrong or phantom agent. This makes the approval queue unreliable for long-running sessions.

**Fix:** Look up the running agent by PID from the `AgentRegistry` or `AgentInfo` list and use its canonical `id`. Fall back to the PID string only if no registered agent matches.

---

### IN-02: `isUnifiedDiff` detection is fragile — any line starting with `@@` triggers unified-diff parsing

**File:** `src/views/CommsHub/InlineDiff.tsx:22-23`

```typescript
let isUnifiedDiff = diffParts.some((line) => line.startsWith('@@'));
```

A file that legitimately contains `@@` (e.g., decorator syntax in TypeScript, email headers) will be incorrectly parsed as a unified diff, silently dropping the `---`/`+++` header lines and misclassifying all content lines. The variable `isUnifiedDiff` is also declared with `let` but never reassigned.

**Fix:** Use a stricter heuristic (presence of both `--- ` and `+++ ` header lines *and* `@@`) or declare it `const`.

---

### IN-03: `getAgentColor` can return palette colors with alpha suffix appended via string concatenation

**File:** `src/views/Radar/RadarCanvas.tsx:427`

```typescript
ctx.fillStyle = color.slice(0, 7) + Math.round(pulseAlpha1 * 255).toString(16).padStart(2, '0');
```

`getAgentColor` returns 7-character hex strings (`#rrggbb`) from `AGENT_DOT_PALETTE`. The `.slice(0, 7)` is correct, but when `pulseAlpha * 255` rounds to a value like `0` the hex is `'00'` and the result is `'#rrggbb00'` — which is valid. However if `AGENT_DOT_PALETTE` ever has an 8-character entry (e.g., `#rrggbbaa`), `.slice(0, 7)` would produce `'#rrggbb'` dropping the last character of `bb`. This is a latent bug. Use a type-safe approach:

**Fix:** Use `rgba()` format consistently instead of string-concatenating hex alpha:

```typescript
const rgb = hexToRgb(color); // already available via hexToRgb
ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${pulseAlpha1})`;
```

---

### IN-04: Keyboard shortcut handler fires approve/deny on non-pending requests

**File:** `src/views/CommsView.tsx:34-84`

The `pendingRequests` filter at line 34 is used only for ArrowUp/ArrowDown navigation. The `'a'` and `'d'` shortcuts at lines 58-75 call `approveRequest(selectedRequestId)` and `denyRequest(selectedRequestId)` for any `selectedRequestId !== null`, regardless of whether the selected request is already approved, denied, or in `info_requested` state. The backend `UPDATE` will silently overwrite a resolved request's status. While not a security issue, it is unexpected behavior.

**Fix:** Guard the action shortcuts with a status check:

```typescript
case 'a': {
  const req = get().selectedRequest();
  if (req?.status === 'pending' && !e.ctrlKey && !e.metaKey) {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && !target.isContentEditable) {
      useCommsStore.getState().approveRequest(selectedRequestId!);
    }
  }
  break;
}
```

---

_Reviewed: 2026-04-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
