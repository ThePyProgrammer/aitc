---
phase: 06-pipeline-activation-integration-wiring
reviewed: 2026-04-11T00:00:00Z
depth: standard
files_reviewed: 29
files_reviewed_list:
  - package.json
  - src/components/layout/AppShell.tsx
  - src/components/layout/TopBar.tsx
  - src/components/repo/ChangeRepoButton.tsx
  - src/components/repo/PauseMonitoringToggle.tsx
  - src/components/repo/RepoStatusChip.tsx
  - src/providers/__tests__/RepoSessionProvider.integration.test.tsx
  - src/providers/__tests__/RepoSessionProvider.test.tsx
  - src/providers/RepoSessionProvider.tsx
  - src/stores/__tests__/radarStore.test.ts
  - src/stores/__tests__/repoStore.test.ts
  - src/stores/radarStore.ts
  - src/stores/repoStore.ts
  - src-tauri/Cargo.toml
  - src-tauri/src/agents/generic.rs
  - src-tauri/src/agents/registry.rs
  - src-tauri/src/agents/self_register.rs
  - src-tauri/src/db/mod.rs
  - src-tauri/src/db/session.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/pipeline/commands.rs
  - src-tauri/src/pipeline/mod.rs
  - src-tauri/src/pipeline/passive_bridge.rs
  - src-tauri/src/pipeline/pipeline_state.rs
  - src-tauri/src/pipeline/process_snapshot.rs
  - src-tauri/src/pipeline/smoke_tests.rs
  - src-tauri/src/repo_session.rs
  - src-tauri/tests/common/mod.rs
  - src-tauri/tests/end_to_end_smoke.rs
findings:
  critical: 2
  warning: 6
  info: 5
  total: 13
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-04-11
**Depth:** standard
**Files Reviewed:** 29
**Status:** issues_found

## Summary

Phase 6 wires the backend pipeline (watcher, passive bridge, self-registration, forwarder persistence) to the frontend via Zustand stores, a `RepoSessionProvider`, and top-bar controls. The architecture is sound: `ActiveWatch` owns every background task and aborts them on `Drop`, the passive-bridge reconciliation between `PASSIVE-{pid}` and `KAGENT-{pid}` entries is well-tested, and the forwarder correctly skips `Unattributed`/`Ambiguous` events before touching SQLite.

Two findings rise to critical severity:

- **CR-01** — `KAGENT-{pid % 10000}` collapses any two PIDs whose low four digits collide into the same registry key, causing one agent to silently overwrite another and mis-attribute file writes to the wrong session.
- **CR-02** — `detect_git_root` shells out to `git rev-parse` in a user-picked directory. Running `git` inside an attacker-controlled tree is a known RCE vector (malicious `core.fsmonitor`, `core.hooksPath`, aliases) unless the config scope is locked down. The only defense currently is a `..`-substring check, which is orthogonal to the real risk.

Warnings cluster around SQLite FK enforcement (not enabled globally), tree-index `is_dir` always set to `false`, Windows `canonicalize()` producing `\\?\` UNC paths that will not equal the frontend `activeRepo`, the `resolvedOnce` ref permanently latching on a failed initial resolve, and a non-atomic two-statement update in `record_session_file_internal`.

## Critical Issues

### CR-01: PID collision via modulo-10000 in `KAGENT` id generation

**File:** `src-tauri/src/agents/self_register.rs:118`
**Issue:** The self-registration handler derives the registry key as `format!("KAGENT-{:04}", payload.pid % 10000)`. On any modern OS the PID space extends well past 10,000 (Windows: 32-bit PIDs; Linux `pid_max` commonly 4,194,304). Two concurrent agents with PIDs `1234` and `11234` both produce `KAGENT-1234`. `upsert_agent` then merges them: the second registration silently overwrites the first's `info.agent_type`, `cwd`, and `intent`, and every subsequent forwarder lookup via `find_agent_by_pid` will only find whichever PID the registry still holds, while the other process's writes are recorded under the wrong session (or dropped).

This also breaks the passive-bridge reconciliation in `start_watch` and `self_register::register_agent`: the handler calls `registry.remove_agent(&format!("PASSIVE-{}", payload.pid))` using the **full** PID, but stores the KAGENT under the **truncated** PID. If two PASSIVEs exist with colliding low-4-digit PIDs, only the exact-PID PASSIVE is removed, leaving the other as a ghost entry.

**Fix:**
```rust
// Use the full PID -- it is already unique within a host OS.
let agent_id = format!("KAGENT-{}", payload.pid);
```

Audit callers that format `PASSIVE-{pid}` / `KAGENT-{pid}` to ensure they use the same scheme (they currently do — see `passive_bridge::bridge_tick` line 72 using the full PID). Consider adding a shared helper `fn kagent_id(pid: u32) -> String` and `fn passive_id(pid: u32) -> String` in `agents/registry.rs` to prevent drift.

### CR-02: `detect_git_root` executes `git` inside an attacker-controlled directory

**File:** `src-tauri/src/repo_session.rs:26-48`
**Issue:** `detect_git_root` is invoked with a path the user selects via the native folder picker *and* with any value persisted in `app_settings.last_repo_root`. It then runs `git rev-parse --show-toplevel` with `current_dir(&p)`. Running `git` inside a directory containing a malicious `.git/config` or a malicious parent-directory `.git/config` is a known RCE vector:

- `core.fsmonitor` — git invokes the configured binary on every plumbing command.
- `core.hooksPath` + `core.ignoreCase` tricks — git may execute hooks from attacker paths on some subcommands.
- `alias.rev-parse = !sh -c 'pwn'` — shell aliases are expanded before the real subcommand runs.
- CVE-2022-41953, CVE-2024-32002-style multi-submodule/symlink attacks.

The `path.contains("..")` guard does not address this — the attack comes from the *contents* of the selected directory, not its path string. Cloning a repo from an untrusted source and then pointing AITC at it would be sufficient to trigger code execution during `resolveInitialRepo`/`changeRepo`.

**Fix:** Harden the `git` invocation so configs and aliases from the target directory cannot influence execution, or stop shelling out:

```rust
let out = Command::new("git")
    // Drop system/global/repo-local config hooks that can run arbitrary code.
    .env("GIT_CONFIG_SYSTEM", "/dev/null")
    .env("GIT_CONFIG_GLOBAL", "/dev/null")
    // Refuse to honor hook-based / fsmonitor-based code execution.
    .args([
        "-c", "core.fsmonitor=",
        "-c", "core.hooksPath=/dev/null",
        "-c", "protocol.file.allow=never",
        "rev-parse", "--show-toplevel",
    ])
    .current_dir(&p)
    .output()
    .await
    .map_err(|e| format!("git: {e}"))?;
```

A stronger long-term fix is to detect the git root by walking parents looking for a `.git` directory/file in Rust (no subprocess). That also removes the hard dependency on `git` being on PATH (already an implicit Windows CI failure mode — see `end_to_end_smoke.rs:2` which bails if `git` is missing).

## Warnings

### WR-01: `get_tree_index` always sets `is_dir: false`

**File:** `src-tauri/src/pipeline/commands.rs:259-264`
**Issue:** The TreeIndexEntry mapping hardcodes `is_dir: false` for every entry pulled from `active.tree_index`. The frontend radar tree-builder (see `src/stores/__tests__/radarStore.test.ts:77-96`) relies on `isDir` to split directory vs. file rendering. With `is_dir: false` universal, directory nodes with `size: 0` fall into the "file" branch of `buildFileTree`, and the treemap layout mis-renders folder aggregates.

**Fix:** Either expose `is_dir` on `FileNode` and read it through, or derive directory-ness from the index key shape:
```rust
let is_dir = active.tree_index.keys()
    .any(|other| other != path && other.starts_with(path));
```
Prefer the first approach (single source of truth in the watcher) to keep this an O(n) pass instead of O(n²).

### WR-02: Windows `canonicalize()` produces UNC paths that mismatch the frontend `activeRepo`

**File:** `src-tauri/src/pipeline/commands.rs:64-66`
**Issue:** `repo_root_path.canonicalize()` on Windows returns a `\\?\C:\...` extended-length path. The frontend stores `activeRepo` as the raw string returned by `detect_git_root` (from `git rev-parse --show-toplevel`, which yields a forward-slash POSIX-style path like `C:/repos/aitc`). Downstream code that compares paths — e.g., path display in `RepoStatusChip`, future "is this path inside the active repo" checks — will treat the same directory as two different strings. The `tree_index` keys are built from the canonical root, while frontend-emitted paths from the watcher-forwarded `FileEvent.path` go through `to_string_lossy`, so any string-equality join between them is fragile.

**Fix:** Strip the `\\?\` prefix before storing / returning, or canonicalize both sides consistently:
```rust
#[cfg(windows)]
fn strip_unc(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").map(PathBuf::from).unwrap_or(p)
}
```
Apply the same normalization in `detect_git_root` so frontend and backend agree on one canonical form.

### WR-03: SQLite foreign keys are not enabled at connection time

**File:** `src-tauri/src/db/mod.rs:18-25`
**Issue:** `session_files.session_id REFERENCES agent_sessions(id)` is declared in the schema but SQLite does **not** enforce foreign keys unless `PRAGMA foreign_keys = ON` is set per connection. The current `SqliteConnectOptions::new().filename(...).create_if_missing(true)` omits this pragma, so `record_session_file_internal` can insert a row with an arbitrary `session_id` without error, silently corrupting referential integrity. This matters because the very next statement (`UPDATE agent_sessions SET file_count = (SELECT COUNT(*)...`) will silently set the count to zero when the session_id does not exist, hiding the corruption.

**Fix:**
```rust
let options = sqlx::sqlite::SqliteConnectOptions::new()
    .filename(&db_path)
    .create_if_missing(true)
    .foreign_keys(true)
    .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
```
Also add a regression test that asserts `PRAGMA foreign_keys` returns `1` on a connection pulled from `init_db`'s pool.

### WR-04: `record_session_file_internal` is not atomic

**File:** `src-tauri/src/db/session.rs:65-93`
**Issue:** Two separate `execute()` calls (insert/upsert into `session_files`, then update `agent_sessions.file_count`). If the second fails (disk full, FK violation once WR-03 is fixed, or a transient pool error), the session_file row is persisted but `file_count` drifts. A concurrent writer can also observe `file_count` being temporarily behind.

**Fix:** Wrap both statements in a single transaction via `pool.begin()` / `tx.commit()`, or use a trigger:
```sql
CREATE TRIGGER trg_session_files_bump_count
AFTER INSERT ON session_files
BEGIN
  UPDATE agent_sessions SET file_count = file_count + 1 WHERE id = NEW.session_id;
END;
```
The trigger approach also eliminates the `SELECT COUNT(*)` rescan on every write.

### WR-05: `resolvedOnce` ref permanently latches on a failed initial resolve

**File:** `src/providers/RepoSessionProvider.tsx:16-22`
**Issue:** `resolvedOnce.current = true` is set *before* `resolveInitialRepo()` runs. Any exception from the promise chain (e.g., transient Tauri IPC failure during app startup) lands in the `.catch` that calls `setError`, but the ref never resets. The user is stuck with the error banner and no way to retry initial resolve short of quitting and restarting AITC. `changeRepo` is still available, but the invariant "we have resolved once" is now a lie.

**Fix:** Only latch the ref on success, or expose a retry on the store:
```tsx
useEffect(() => {
  if (resolvedOnce.current) return;
  const run = async () => {
    try {
      await useRepoStore.getState().resolveInitialRepo();
      resolvedOnce.current = true;
    } catch (err) {
      useRepoStore.getState().setError(String(err));
      // leave resolvedOnce false so the next mount can retry
    }
  };
  run();
}, []);
```
Note: StrictMode double-invoke will still call `resolveInitialRepo` twice on a failure. If that is undesirable, move idempotence into the store itself (e.g., a `resolving: boolean` guard inside `resolveInitialRepo`).

### WR-06: Rate limiter in `self_register` double-counts across window boundaries

**File:** `src-tauri/src/agents/self_register.rs:64-84`
**Issue:** Between the `load(window)` on line 69 and the `compare_exchange` on line 74, another thread can win the CAS and reset `count` to 1. The loser then falls through to the shared `fetch_add` on line 82, which increments the *new* window's counter (now at 2, not 1). Under heavy contention at a second boundary, legitimate requests can be rate-limited or, worse, an attacker who synchronizes bursts with the wall-clock can smuggle extra registrations through (because the window reset branch unconditionally returns `true` without checking the current count).

This is not exploitable at the T-03-07 threat level (10 rps) but the logic is harder to reason about than necessary.

**Fix:** Use a single atomic `u64` encoding `(window << 16) | count` and CAS the whole thing, or switch to a `tokio::sync::Mutex<(u64, u64)>` — lock contention at 10 rps is negligible and the code becomes obviously correct:
```rust
struct RateLimiter {
    inner: tokio::sync::Mutex<(u64, u64)>, // (window_secs, count)
}
impl RateLimiter {
    async fn check(&self) -> bool {
        let now = /* ... */;
        let mut g = self.inner.lock().await;
        if g.0 != now { *g = (now, 0); }
        g.1 += 1;
        g.1 <= 10
    }
}
```

## Info

### IN-01: `repoStore.resolveInitialRepo` allows exceptions to propagate without `setError`

**File:** `src/stores/repoStore.ts:23-56`
**Issue:** Internal `invoke`/`openDialog` rejections propagate out of `resolveInitialRepo` as uncaught promise rejections. The provider's `.catch` converts them to an error string, but the store's own `error` field is only set in the "picked non-git folder" branch. A Tauri IPC failure on `get_launch_cwd` throws through the provider rather than surfacing as a store error users can see via the existing UI. Minor consistency issue.
**Fix:** Wrap the body in `try { ... } catch (e) { set({ error: String(e) }); }` and drop the provider-level fallback; keeps error semantics in one place.

### IN-02: `find_adapter_for_process` uses substring matching for explicit-type registration

**File:** `src-tauri/src/agents/self_register.rs:123` (call site) and `src-tauri/src/agents/registry.rs:195-205`
**Issue:** Self-register uses `find_adapter_for_process(payload.agent_type)` — the substring matcher designed for process-name sniffing, not for explicit type lookup. An agent_type of `"claude"` will match the `claude-code` adapter and be registered as such; `"code"` would match `claude-code`, `opencode`, potentially others. The registry already has `find_adapter_by_type` for exact matches.
**Fix:** Use `find_adapter_by_type(&payload.agent_type)` in the HTTP handler. Keep `find_adapter_for_process` for process-scan paths where sniffing is the intent.

### IN-03: `lib.rs` calls `app_handle.exit(1)` then `panic!`

**File:** `src-tauri/src/lib.rs:117-122`
**Issue:** `app_handle.exit(1)` schedules shutdown but is not guaranteed to terminate synchronously; the subsequent `panic!` then unwinds the setup closure, which Tauri reports as a setup error. Users see a panic backtrace instead of a clean "Database failed to initialize" message. Functional but noisy.
**Fix:** Return `Err(...)` from the setup closure and let Tauri surface it cleanly:
```rust
let pool = tauri::async_runtime::block_on(db::init_db(&app_handle))
    .map_err(|e| format!("Database init failed: {e}"))?;
```

### IN-04: `radarStore.fetchTreeIndex` swallows all errors silently

**File:** `src/stores/radarStore.ts:65-72`
**Issue:** `catch { /* Backend may not have this command yet; silently ignore */ }` discards real failures too. Now that `get_tree_index` is wired up in `lib.rs`, the "backend doesn't implement this yet" justification no longer holds. A real IPC failure (e.g., serde deserialization mismatch between `TreeIndexEntry` and the Rust-exported type) will silently leave the radar empty with no diagnostic.
**Fix:** At minimum log via `console.warn`. Better: set an error field on the store so the UI can surface a small chip instead of showing an empty radar.

### IN-05: `ChangeRepoButton` swallows `changeRepo` rejections

**File:** `src/components/repo/ChangeRepoButton.tsx:18-21`
**Issue:** `await changeRepo();` inside the click handler is not wrapped in try/catch. If `changeRepo` throws (e.g., `invoke('persist_last_repo', …)` rejects because the DB pool state is gone during window close), React logs an unhandled promise rejection. The confirming UI is already dismissed by then, so the user has no signal that the switch failed.
**Fix:** Call through a store-level wrapper that captures the error (mirrors `repoStore.setError`), or wrap in try/catch and call `setError` locally.

---

_Reviewed: 2026-04-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
