---
phase: 03-agent-management-conflict-detection
fixed_at: 2026-04-10T00:00:00Z
review_path: .planning/phases/03-agent-management-conflict-detection/03-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 8
skipped: 1
status: partial
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-04-10T00:00:00Z
**Source review:** .planning/phases/03-agent-management-conflict-detection/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (3 critical, 6 warning)
- Fixed: 8
- Skipped: 1

## Fixed Issues

### CR-01: Path Traversal in `launch_agent` -- `cwd` Not Canonicalized

**Files modified:** `src-tauri/src/agents/commands.rs`
**Commit:** ae2ee3c
**Applied fix:** Replaced `PathBuf::from` + `exists()` + `is_dir()` chain with `canonicalize()` which resolves symlinks and `..` components, preventing path traversal. The `is_dir()` check is retained after canonicalization as a secondary guard.

### CR-02: Race Condition in `RateLimiter::check` Allows Bursts Beyond 10 RPS

**Files modified:** `src-tauri/src/agents/self_register.rs`
**Commit:** 812fbc6
**Applied fix:** Replaced `Ordering::Relaxed` load/store with `Ordering::Acquire`/`Release`/`AcqRel` and added `compare_exchange` on `window_start` so only one thread can win the window reset. Prevents concurrent threads from each resetting the counter independently.

### CR-03: Spawned Child Process Handle Dropped Immediately in Three Adapters

**Files modified:** `src-tauri/src/agents/adapter.rs`, `src-tauri/src/agents/claude_code.rs`, `src-tauri/src/agents/codex.rs`, `src-tauri/src/agents/opencode.rs`, `src-tauri/src/agents/generic.rs`, `src-tauri/src/agents/registry.rs`, `src-tauri/src/agents/commands.rs`
**Commit:** 2554671
**Applied fix:** Changed `AgentAdapter::launch` trait return type from `Result<u32, String>` to `Result<(u32, tokio::process::Child), String>`. All four adapter implementations (claude_code, codex, opencode, generic) now return the child handle. The `launch_agent` command in `commands.rs` extracts the child and passes it to `launcher::spawn_stdout_reader` so stdout logs are actually captured. Test adapter in `registry.rs` updated to match new signature.

### WR-01: Conflict Engine Eviction Uses Event Timestamp Instead of Wall Clock

**Files modified:** `src-tauri/src/conflict/engine.rs`
**Commit:** ec769ba
**Applied fix:** Added a wall-clock `evict_expired(now_ms)` call at the start of `process_batch`, before processing any events. This ensures stale records from files not recently touched are cleaned up using real time, not event-relative timestamps.

### WR-02: `launch_agent` Resolves Adapter by `agent_type` Using Substring Match

**Files modified:** `src-tauri/src/agents/registry.rs`, `src-tauri/src/agents/commands.rs`
**Commit:** d55f223
**Applied fix:** Added `find_adapter_by_type()` method to `AgentRegistry` that performs exact `adapter_type()` match. Updated `launch_agent` in `commands.rs` to use the new exact-match method. The existing `find_adapter_for_process()` is preserved for process-scan detection where substring matching is correct.

### WR-03: Self-Registration Fallback Uses Hard-Coded `"claude"` String

**Files modified:** `src-tauri/src/agents/self_register.rs`
**Commit:** 912aca0
**Applied fix:** Replaced the `unwrap_or_else` + `expect("built-in adapters must be registered")` fallback with a `match` that returns `400 Bad Request` with a descriptive error JSON payload for unknown agent types. Eliminates the potential panic.

### WR-04: `terminateAgent` in Frontend Store Has No Error State

**Files modified:** `src/stores/agentStore.ts`
**Commit:** 0b0e580
**Applied fix:** Wrapped `terminateAgent` body in try/catch. On failure, sets `error` in the store (so the UI can display it) and re-throws so the calling component (`AgentRow`) can provide local feedback. The `set()` for removing the agent from local state now only runs on success.

### WR-06: Stop Button in `AgentRow` Is Always Invisible (Missing `group` Class)

**Files modified:** `src/views/TowerControl/AgentRow.tsx`
**Commit:** d716517
**Applied fix:** Added `group` to the row container div's className. This enables `group-hover:opacity-100` on the stop button to trigger when hovering anywhere on the row, making the button accessible.

## Skipped Issues

### WR-05: `ConflictBanner` Timestamp Interprets `detectedAtMs` as Unix Epoch Milliseconds

**File:** `src/views/TowerControl/ConflictBanner.tsx:33`
**Reason:** Code is correct for production use. The `FileEvent.timestamp_ms` field is populated with `Utc::now().timestamp_millis()` in the pipeline (`src-tauri/src/pipeline/events.rs:60`), which produces wall-clock epoch milliseconds. The reviewer was misled by conflict engine test fixtures using small relative values (1000, 3000, 7000) which are test-only. In production, `new Date(alert.detectedAtMs).toLocaleTimeString()` will render correctly.
**Original issue:** `new Date(alert.detectedAtMs).toLocaleTimeString()` assumes wall-clock epoch ms, but reviewer noted test values suggest relative timestamps.

---

_Fixed: 2026-04-10T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
