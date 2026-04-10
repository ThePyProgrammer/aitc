---
phase: 03-agent-management-conflict-detection
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 29
files_reviewed_list:
  - src-tauri/src/agents/adapter.rs
  - src-tauri/src/agents/claude_code.rs
  - src-tauri/src/agents/codex.rs
  - src-tauri/src/agents/commands.rs
  - src-tauri/src/agents/generic.rs
  - src-tauri/src/agents/launcher.rs
  - src-tauri/src/agents/mod.rs
  - src-tauri/src/agents/notifications.rs
  - src-tauri/src/agents/opencode.rs
  - src-tauri/src/agents/registry.rs
  - src-tauri/src/agents/self_register.rs
  - src-tauri/src/conflict/commands.rs
  - src-tauri/src/conflict/engine.rs
  - src-tauri/src/conflict/mod.rs
  - src-tauri/src/conflict/types.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/pipeline/commands.rs
  - src-tauri/src/pipeline/pipeline_state.rs
  - src-tauri/Cargo.toml
  - src-tauri/capabilities/default.json
  - src/stores/agentStore.ts
  - src/stores/conflictStore.ts
  - src/views/TowerControl/TowerControl.tsx
  - src/views/TowerControl/AgentManifest.tsx
  - src/views/TowerControl/AgentRow.tsx
  - src/views/TowerControl/DeployDialog.tsx
  - src/views/TowerControl/ConflictBanner.tsx
  - src/components/ui/ConflictNavBadge.tsx
  - src/components/ui/StatusBadge.tsx
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-04-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 29
**Status:** issues_found

## Summary

Phase 03 implements agent lifecycle management (launch, terminate, registry), a sliding-window conflict detection engine, a self-registration HTTP server, and the Tower Control UI. The overall architecture is sound: the adapter trait pattern is clean, state machines are enforced, and security mitigations (T-03-04 through T-03-10) are present.

Three critical issues were found: a path traversal vulnerability in the `cwd` input to `launch_agent`, a race condition in the rate limiter that allows burst-injection beyond 10 RPS, and a child process handle being silently dropped in three adapters (causing immediate process orphaning on launch). Six warnings cover logic correctness issues including a stale timestamp in the conflict engine's eviction logic, missing error propagation in the frontend store's `launchAgent` and `terminateAgent`, and the stop-button hover requiring a missing `group` class. Four info items address code quality.

---

## Critical Issues

### CR-01: Path Traversal in `launch_agent` — `cwd` Not Canonicalized

**File:** `src-tauri/src/agents/commands.rs:39-45`
**Issue:** The `cwd` argument is validated for existence and directory-ness, but is never canonicalized. A caller can pass a path containing `..` components (e.g., `../../etc`) that resolve to a valid directory outside any intended sandbox. The backend calls `adapter.launch(cwd_path.clone(), ...)` directly, which passes the raw path to `tokio::process::Command::current_dir`. This is consistent with the T-03-05 mitigation comment referencing "validate cwd", but canonicalization is the actual mitigation — existence checks alone do not prevent traversal.

**Fix:**
```rust
let cwd_path = PathBuf::from(&cwd)
    .canonicalize()
    .map_err(|e| format!("cwd is invalid or inaccessible: {e}"))?;
if !cwd_path.is_dir() {
    return Err(format!("cwd is not a directory: {}", cwd_path.display()));
}
```
Replace the current `PathBuf::from` + `exists()` + `is_dir()` chain with a single `canonicalize()` call, which resolves symlinks and `..` components. The T-03-05 comment should then be updated to note that canonicalization is the implemented mitigation.

---

### CR-02: Race Condition in `RateLimiter::check` Allows Bursts Beyond 10 RPS

**File:** `src-tauri/src/agents/self_register.rs:61-76`
**Issue:** The rate limiter uses two separate `AtomicU64` values (`count` and `window_start`) with `Ordering::Relaxed` reads/stores. There is a TOCTOU window between reading `window_start`, reading `count`, and then storing a new value. Under concurrent requests (possible since axum handlers run on a multi-threaded tokio runtime), multiple threads can observe `now != window` simultaneously, each resetting both atomics independently. This resets the counter multiple times per second, effectively disabling the rate limit for burst traffic. The use of `Relaxed` ordering also means stores may not be visible across threads in a timely fashion.

**Fix:** Replace the two-atomic approach with a single `Mutex<(u64, u64)>` or use `AtomicU64` correctly with `AcqRel`/`SeqCst` ordering and a compare-exchange for the window reset:
```rust
fn check(&self) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Try to atomically compare-and-swap the window start; only one winner resets
    let window = self.window_start.load(Ordering::Acquire);
    if now != window {
        // Attempt to claim the new window; if another thread won, fall through to count check
        if self.window_start.compare_exchange(window, now, Ordering::AcqRel, Ordering::Acquire).is_ok() {
            self.count.store(1, Ordering::Release);
            return true;
        }
    }
    let prev = self.count.fetch_add(1, Ordering::AcqRel);
    prev < 10
}
```
Alternatively, use a `tokio::sync::Mutex<(u64, u64)>` for simplicity given that this runs in async context anyway.

---

### CR-03: Spawned Child Process Handle Dropped Immediately in Three Adapters

**File:** `src-tauri/src/agents/claude_code.rs:57-64`, `src-tauri/src/agents/codex.rs:57-65`, `src-tauri/src/agents/opencode.rs:49-57`
**Issue:** All three built-in adapter `launch` methods call `launcher::launch_detached(...)` which returns `(pid, child)`. The `_child` binding immediately drops the `tokio::process::Child` at the end of the async block. Dropping a `tokio::process::Child` without calling `.wait()` or `.into_std()` on it causes the child to be abandoned — tokio will wait for it internally in some configurations, but since `DETACHED_PROCESS` is used on Windows, the handle drop means the stdout pipe is immediately closed. This defeats the `spawn_stdout_reader` functionality because `commands.rs` calls `launcher::spawn_stdout_reader` only when it has the child — but here the child is dropped before `spawn_stdout_reader` is ever called. The commands layer calls `adapter.launch()` and gets back only a `u32` pid, with no path to pass the child handle to `spawn_stdout_reader`. Result: stdout buffers are always empty for agent logs, and `get_agent_logs` always returns `[]`.

**Fix:** The `AgentAdapter::launch` trait signature needs to return the child handle (or the adapters need to call `spawn_stdout_reader` themselves). The most targeted fix given existing structure:

Change the trait return type:
```rust
// In adapter.rs
async fn launch(&self, cwd: PathBuf, intent: Option<String>)
    -> Result<(u32, tokio::process::Child), String>;
```

Then in `commands.rs`, after calling `adapter.launch()`, extract the child and spawn the reader:
```rust
let (pid, child) = adapter.launch(cwd_path.clone(), intent.clone()).await?;
// ... build info, upsert_agent ...
launcher::spawn_stdout_reader(child, agent_id.clone(), registry.inner().clone());
```

Alternatively, if the trait signature cannot be changed, have each adapter call `spawn_stdout_reader` internally (but this requires passing the registry to the adapter, which breaks the stateless design).

---

## Warnings

### WR-01: Conflict Engine Eviction Uses Event Timestamp Instead of Wall Clock

**File:** `src-tauri/src/conflict/engine.rs:79`
**Issue:** The eviction predicate `event.timestamp_ms - r.timestamp_ms <= window_ms` compares two event timestamps. This is correct for detecting conflicts between events in the same batch. However, for the `evict_expired` call in the `ConflictEngine`, the `now_ms` parameter is expected to be a wall-clock millisecond timestamp. At line 79 inside `process_batch`, the in-batch eviction uses `event.timestamp_ms` as the reference point — but if events arrive with stale timestamps (e.g., a delayed batch from the debouncer), writes from other agents within the real window could be prematurely evicted. More critically, the `evict_expired` public method is never called from the conflict task in `pipeline/commands.rs` (lines 128-149). Only `process_batch` is called; the periodic eviction of old entries from files not recently touched never fires unless a new batch arrives for that file. The `sweep_empty_files` call inside `process_batch` (every 100 batches) only removes empty keys, not keys with stale but non-empty records.

**Fix:** Call `evict_expired` with the current wall-clock time at the start of each `process_batch` call, or in the conflict task loop:
```rust
// In process_batch, before processing events:
let now_ms = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as i64;
self.evict_expired(now_ms);
```
This ensures stale records are cleaned up even when no new events arrive for a file.

---

### WR-02: `launch_agent` Resolves Adapter by `agent_type` Using Substring Match

**File:** `src-tauri/src/agents/commands.rs:48-52`, `src-tauri/src/agents/registry.rs:148-158`
**Issue:** `find_adapter_for_process` uses a **lowercased substring** match: `lower.contains(&p.to_lowercase())`. When called from `launch_agent` with `agent_type = "claude-code"`, this matches the ClaudeCodeAdapter (whose patterns include `"claude-code"`). However, a caller passing `agent_type = "claude"` would also match, and an `agent_type = "code"` would match too (since `"claude-code"` contains `"code"`). This is intended for process-name detection, but `launch_agent` uses it as an explicit type selector. The wrong adapter could be selected. For instance, `agent_type = "code"` would launch a ClaudeCodeAdapter process.

**Fix:** Add an exact-match lookup for the `launch_agent` path:
```rust
// In registry.rs
pub fn find_adapter_by_type(&self, agent_type: &str) -> Option<Arc<dyn AgentAdapter>> {
    self.adapters
        .iter()
        .find(|a| a.adapter_type() == agent_type)
        .cloned()
}
```
Use `find_adapter_by_type` in `launch_agent` for the explicit launch path, and keep `find_adapter_for_process` for the process-scan detection path.

---

### WR-03: Self-Registration Fallback Uses Hard-Coded `"claude"` String

**File:** `src-tauri/src/agents/self_register.rs:113-125`
**Issue:** When no adapter matches the registering agent's `agent_type`, the fallback calls `registry.find_adapter_for_process("claude")` with a hard-coded string, prefaced with a `expect("built-in adapters must be registered")`. This will panic at runtime if the claude-code adapter was not registered (e.g., in a future configuration where built-ins are optional, or in tests where the registry is empty). The `expect` message does not surface in a user-recoverable way — it would crash the axum handler task.

**Fix:** Return `400 Bad Request` for unknown agent types instead of silently using a fallback adapter, since the agent is self-identifying:
```rust
let adapter = registry
    .find_adapter_for_process(&payload.agent_type)
    .ok_or_else(|| {
        tracing::warn!(agent_type = %payload.agent_type, "Unknown agent type in self-registration");
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "unknown agent_type"})))
    });

match adapter {
    Err(resp) => return resp,
    Ok(a) => a,
}
```
If intentional fallback is desired, replace `expect` with a graceful error return.

---

### WR-04: `launchAgent` and `terminateAgent` in Frontend Store Have No Error State

**File:** `src/stores/agentStore.ts:48-57`
**Issue:** `launchAgent` and `terminateAgent` do not set the store's `error` field on failure — only `fetchAgents` does. If `invoke('launch_agent', ...)` throws (e.g., the backend returns `Err("cwd does not exist")`), the error propagates up to the caller (`DeployDialog`), which does handle it locally. However, `terminateAgent` at line 54 has no `try/catch` at all. If `invoke('terminate_agent', ...)` throws, the unhandled rejection will silently fail: the agent is NOT removed from the local state (`s.agents.filter` never runs), but the UI shows no error. The user believes the agent is still running, which it may or may not be.

**Fix:**
```typescript
terminateAgent: async (agentId) => {
  try {
    await invoke('terminate_agent', { agentId });
    set((s) => ({ agents: s.agents.filter((a) => a.id !== agentId) }));
  } catch (e) {
    set({ error: String(e) });
    throw e; // re-throw so AgentRow can show feedback
  }
},
```

---

### WR-05: `ConflictBanner` Timestamp Interprets `detectedAtMs` as Unix Epoch Milliseconds

**File:** `src/views/TowerControl/ConflictBanner.tsx:33`
**Issue:** `new Date(alert.detectedAtMs).toLocaleTimeString()` assumes `detectedAtMs` is a Unix epoch millisecond timestamp. However, `ConflictAlert.detected_at_ms` in the Rust backend is populated from `event.timestamp_ms`, which in the `FileEvent` type is described as "milliseconds" but the conflict engine tests use values like `1000`, `3000`, `7000` — clearly relative timestamps from the debouncer's monotonic clock, not wall-clock epoch milliseconds. `new Date(3000)` renders as `"1:00:03 AM"` on Jan 1, 1970, not the actual time of the conflict.

**Fix:** Either:
1. Ensure `FileEvent.timestamp_ms` is always a wall-clock epoch millisecond (e.g., use `chrono::Utc::now().timestamp_millis()` in the watcher when creating events), or
2. Display a relative time in the UI: `${Math.round((Date.now() - alert.detectedAtMs) / 1000)}s ago` with a fallback to `toLocaleTimeString` when the value is clearly an epoch ms (> some threshold).

The root fix is option 1 — ensure the pipeline produces wall-clock timestamps consistently.

---

### WR-06: Stop Button in `AgentRow` Is Always Invisible (Missing `group` Class)

**File:** `src/views/TowerControl/AgentRow.tsx:43-46`, `75-83`
**Issue:** The stop button uses `opacity-0 group-hover:opacity-100` to appear on row hover (line 80). However, the parent `div` at line 43 does not have the `group` class applied. Without `group` on the ancestor, `group-hover:opacity-100` never triggers — the button remains invisible and the `hover:opacity-100` on the button itself only fires when the user hovers over the invisible button element, which is practically inaccessible.

**Fix:** Add `group` to the row container div:
```tsx
<div
  className={`group flex h-12 items-center px-4 transition-colors duration-150 hover:bg-surface-container-high cursor-pointer ${bgClass} ${
    isConflict ? 'border-l-2 border-error' : 'border-l-2 border-transparent'
  }`}
  onClick={() => setExpanded(!expanded)}
  role="row"
  aria-expanded={expanded}
>
```

---

## Info

### IN-01: `GenericAdapter` Does Not Validate `launch_command` for Path Traversal

**File:** `src-tauri/src/agents/generic.rs:128-137`
**Issue:** The `launch_command` from TOML config is passed directly to `Command::new()` without validation. A TOML config with `launch_command = "../../malicious"` or an absolute path like `/bin/sh` would execute arbitrary binaries. This is a lower-severity concern since the TOML is user-provided (not remote-supplied), but for defense-in-depth, the command should be validated to be a bare filename (no path separators).

**Fix:** Add a validation in `GenericAdapter::from_toml`:
```rust
if config.launch_command.contains('/') || config.launch_command.contains('\\') {
    return Err("launch_command must be a bare binary name, not a path".to_string());
}
```

---

### IN-02: Duplicate `MAX_STDOUT_LINES` Constant

**File:** `src-tauri/src/agents/launcher.rs:24`, `src-tauri/src/agents/registry.rs:17`
**Issue:** `MAX_STDOUT_LINES = 1000` is defined independently in both `launcher.rs` and `registry.rs`. These must stay in sync; if one is changed, the other silently diverges, leading to inconsistent ring buffer behavior.

**Fix:** Define once in `registry.rs` (or a shared `constants` module) and import in `launcher.rs`:
```rust
// In registry.rs
pub const MAX_STDOUT_LINES: usize = 1000;

// In launcher.rs
use crate::agents::registry::MAX_STDOUT_LINES;
```

---

### IN-03: `AgentStore.startPolling` Starts Polling Even When a Previous Poll Is In-Flight

**File:** `src/stores/agentStore.ts:66-70`
**Issue:** `startPolling` fires `fetchAgents()` every 2 seconds unconditionally. `fetchAgents` sets `isLoading: true` at the start and `false` at the end, but the interval does not check `isLoading` before issuing another fetch. If a fetch takes >2 seconds (e.g., the backend is slow), a second poll will start, causing redundant concurrent Tauri invokes. This is minor for a 2-second interval but worth guarding.

**Fix:**
```typescript
startPolling: () => {
  const interval = setInterval(() => {
    if (!get().isLoading) {
      get().fetchAgents();
    }
  }, 2000);
  return () => clearInterval(interval);
},
```

---

### IN-04: `StatusBadge` `animate` Prop Applies Color String Directly Without Effect

**File:** `src/components/ui/StatusBadge.tsx:31-34`
**Issue:** The `motion.span` has `animate={{ color: variantStyles[variant] }}`, where `variantStyles[variant]` is a Tailwind utility class string like `"bg-[#8eff71]/10 text-[#8eff71] border border-[#8eff71]/20"`. Framer Motion's `animate.color` expects a valid CSS color value (e.g., `"#8eff71"`), not a Tailwind class string. This animation call has no visible effect — the color transition is a no-op. The `className` already handles colors statically via Tailwind.

**Fix:** Either remove the `animate` prop (the `className` handles colors correctly), or if an animated transition is desired, pass a valid CSS color:
```tsx
// Remove ineffective animate prop:
<motion.span
  className={`inline-flex items-center px-2 py-0.5 text-[8px] font-mono font-bold uppercase relative ${variantStyles[variant]}`}
  transition={{ duration: 0.3 }}
  aria-label={`${variant} status`}
>
```

---

_Reviewed: 2026-04-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
