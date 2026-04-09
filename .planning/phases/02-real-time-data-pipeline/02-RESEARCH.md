# Phase 02: Real-Time Data Pipeline - Research

**Researched:** 2026-04-08
**Domain:** Rust filesystem watching, process correlation, Tauri v2 IPC streaming, git worktree topology
**Confidence:** HIGH (stack, patterns), MEDIUM (Windows PID-attribution accuracy), MEDIUM (Tauri event throughput headroom)

## Summary

Phase 02 builds the sensing layer of AITC: a Rust backend that watches a repository directory tree in real time via the `notify` + `notify-debouncer-full` crates, correlates file events to agent processes via PID enumeration (`sysinfo`), detects git worktree topology, and streams batched events into a Zustand store on the React frontend.

Three findings shape the architecture:

1. **Tauri events are the wrong transport for high-frequency streaming.** `app.emit()` has a documented crash under load (issue #8177, still open as of 2026) and the Tauri team explicitly recommends `tauri::ipc::Channel` for fast, ordered streaming data. The plan MUST use `Channel<FileEventBatch>` — not events — for the hot path. User decision D-01 said "Tauri event emission," but the project-level constraint "Tauri IPC system" is what actually matters; Channels are the Tauri IPC system's streaming primitive in v2. The planner should surface this to the user in plan-check. [VERIFIED: Tauri docs + issue #8177]
2. **notify-rs on Windows will drop events under bursts.** `ReadDirectoryChangesW` uses a single fixed kernel buffer per directory handle. The notify crate does not expose buffer size via `Config`, and maintainers label overflow as `B-upstream/B-wontfix` (issue #412). The ONLY safe strategy is: debounce aggressively, watch the repo root (not thousands of leaf paths), and include a known-gap acknowledgement in the pipeline. A drop counter should be surfaced so Phase 3 conflict detection can reconcile missed writes via a reconciliation pass. [VERIFIED: notify GitHub issues + Windows API docs]
3. **PID-to-file attribution on Windows has no cheap, correct primitive.** There is no equivalent of Linux `fanotify` that reports `(path, pid)` tuples. `sysinfo` 0.38 now reads other processes' PEB (so `cwd`, `cmd`, `exe`, `parent` are retrievable for non-self processes), which enables a *heuristic* — "if a write happens inside a worktree and exactly one watched process has cwd inside that worktree, attribute the write to it." This is best-effort and matches D-06. Exact attribution would require ETW kernel-mode tracing (ferrisetw crate) which is out of scope for Phase 2. [VERIFIED: sysinfo source code]

**Primary recommendation:** Build a single background tokio task that owns a `Debouncer<RecommendedWatcher, RecommendedCache>` and a long-lived `tauri::ipc::Channel<FileEventBatch>` (stored in Tauri managed state and set once via a `start_watch` command). Correlate PIDs by polling `sysinfo` every 1s into a process snapshot (`cwd`, `exe`, `cmd`, `pid`, `parent`), and attribute events by matching the event path prefix against each watched process's cwd. Walk the repo with the `ignore` crate (gitignore-respecting) at watch start to build the initial tree index. Detect worktrees by running `git worktree list --porcelain` once at startup.

## Project Constraints (from CLAUDE.md)

- **Tech stack lock:** Tauri v2 + React + TypeScript — no alternatives
- **File watching crate:** `notify` ^8.2 + `notify-debouncer-full` ^0.4 already listed in CLAUDE.md as decided
- **DB:** `sqlx` ^0.8 with embedded migrations pattern — must use existing `src-tauri/src/db/mod.rs` pool
- **IPC:** `tauri-specta` ^2.0 for type-safe Rust↔TS bindings (already configured)
- **Async runtime:** `tokio` ^1.0 — Tauri v2 uses tokio internally; use `tauri::async_runtime::spawn`
- **State management:** Zustand `^5.0` — one store per domain (pattern: `sidebarStore.ts`, `paletteStore.ts`)
- **Performance requirement:** File watchers must handle 10k+ files without excessive CPU/memory
- **Design system:** Command Horizon (Space Grotesk, phosphor greens, zero-radius) — relevant only if this phase adds visible UI
- **GSD Workflow enforcement:** all edits go through a GSD command; no direct file edits outside of a GSD flow
- **Platform priority:** Windows primary (macOS/Linux stretch) — Windows-specific pitfalls are first-class concerns

## User Constraints (from 02-CONTEXT.md)

### Locked Decisions

**Event Delivery to Frontend**
- **D-01:** Use Tauri event emission (`app.emit()` / `listen()`) for streaming batched file events to the frontend — built-in, fire-and-forget, natural fit for real-time data
- **D-02:** Frontend subscribes via a Zustand store that updates on incoming events (follows pattern established with `sidebarStore`, `paletteStore`)

**PID Correlation Strategy**
- **D-05:** Hybrid approach — process polling as baseline, with hooks for agent self-reporting (Phase 3 adapters will supplement with higher accuracy)
- **D-06:** Best-effort attribution in Phase 2 — attribute when confident, mark as "unattributed" otherwise. Phase 3 agent adapters will improve accuracy

**Worktree Detection**
- **D-08:** Use `git worktree list` and `.git` file/dir inspection to detect shared vs isolated worktrees — automated, no user config needed
- **D-09:** Detection runs once on watch start, re-detects on user-triggered refresh or new agent discovery

**Watch Scope & Filtering**
- **D-10:** Respect the repo's `.gitignore` plus hardcoded excludes (`.git/`, `node_modules/`, `target/`, `build/`) — no user-configurable ignore patterns in Phase 2
- **D-11:** Track writes only (create, modify, delete, rename) — no read events. Reads are too noisy and not actionable for conflict detection
- **D-12:** Build an in-memory file tree index on watch start by walking the directory — provides baseline state and powers the Phase 4 Radar codebase map

### Claude's Discretion

- **D-03:** Throttling strategy (Rust-side batching vs dual Rust+frontend throttling) — Claude decides based on performance testing and typical event volumes
- **D-04:** Whether file events are persisted to SQLite in real time or kept in-memory during the session (tradeoff: write overhead vs audit trail)
- **D-07:** Initial process discovery approach (scan by process name, watch directory only, or other heuristic) before Phase 3 adapters exist

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

### Claude's Recommendations for Discretionary Items

These are recommendations the planner should surface for user confirmation in plan-check — they are NOT locked:

- **D-03 recommendation:** Rust-side batching as the primary throttle, frontend throttle as a safety net. The debouncer's `Duration::from_millis(150)` tick window is the first line of defense; a secondary 60Hz (16ms) rAF-gated flush in the Zustand store prevents React re-render storms if a batch exceeds a few hundred events. **Rationale:** Single-layer debouncing would push burst spikes straight into React reconciliation; dual throttling matches the pattern used by download progress streaming in Tauri itself.
- **D-04 recommendation:** Keep file events in-memory (ring buffer, ~5,000 events) for Phase 2, and emit into SQLite only for Phase 3 when `conflict_events` correlation needs persistence. **Rationale:** Write amplification from persisting every event would blow through sqlite's ~1000 writes/sec soft ceiling under burst activity. Audit trail can be reconstructed later from a conflict-triggered event dump.
- **D-07 recommendation:** Discover by process name (`claude`, `claude-code`, `codex`, `opencode`) plus cwd prefix match against the watched repository. **Rationale:** Watched-directory-only requires OS-level file handle inspection, which is expensive on Windows. Name + cwd is cheap, observable via `sysinfo`, and cleanly extensible (Phase 3 adapters add themselves to the allowlist).
- **D-01 clarification (CRITICAL to surface):** User said "Tauri event emission (`app.emit()` / `listen()`)" but the Tauri documentation explicitly labels the event system as not suitable for high-throughput streaming and recommends `tauri::ipc::Channel` instead. The underlying intent (built-in Tauri IPC, no Websocket/HTTP) is preserved by using Channels. The planner should make this substitution explicit in plan-check so the user can confirm before execution.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FMON-01 | Monitor all file read/write events across a repository directory tree in real time via Rust filesystem watchers | `notify` v8.2/v9.0-rc + `notify-debouncer-full` v0.7 provide cross-platform `RecommendedWatcher` using ReadDirectoryChangesW on Windows, FSEvents on macOS, inotify on Linux. D-11 narrows this to writes only. |
| FMON-02 | Attribute file events to specific agent processes (PID-based correlation) | `sysinfo` 0.38 provides `refresh_processes_specifics`, per-process `cwd()`/`cmd()`/`exe()`/`parent()`/`pid()`. On Windows, sysinfo reads PEB of other processes via `ReadProcessMemory`. D-05, D-06, D-07 scope this as best-effort in Phase 2. |
| FMON-03 | Handle large codebases (10k+ files) without excessive CPU/memory via debouncing and event batching | notify-debouncer-full's tick-window batching + `ignore::WalkBuilder` parallel walker + tokio mpsc batching. D-03, D-10, D-12. |
| FMON-04 | Detect whether agents operate on a shared working tree or isolated git worktrees | `git worktree list --porcelain` shells out once on watch start (D-08, D-09). Porcelain format is NUL-safe and stable. |

## Standard Stack

### Core (Rust backend — new additions for Phase 2)

| Crate | Version | Purpose | Why Standard | Confidence |
|-------|---------|---------|--------------|------------|
| `notify` | `^8.2` (8.2.0 is latest stable, 2025-08-03; 9.0-rc.2 exists but is not yet final) | Cross-platform filesystem watching (ReadDirectoryChangesW / FSEvents / inotify) | De facto Rust watcher used by rust-analyzer, deno, cargo-watch. Specified in CLAUDE.md. [VERIFIED: notify CHANGELOG] | HIGH |
| `notify-debouncer-full` | `^0.7` (0.7.0 released 2026-01-23) | Event batching, deduplication, rename reconstruction via FileIdCache | Required companion to notify to batch rapid bursts; CLAUDE.md specified `^0.4` but v0.5 (2025-01-10) updated to notify 8.0. Plan should use `^0.7` to pair with current notify 8.2+. [VERIFIED: notify-debouncer-full CHANGELOG] | HIGH |
| `sysinfo` | `^0.38` (0.38.4 is latest) | Process enumeration, per-process cwd/cmd/exe/parent PID | Most-used cross-platform process crate on crates.io. 0.38 reads other processes' PEB on Windows (critical — earlier rumors that cwd is empty on Windows are outdated). [VERIFIED: sysinfo source + docs.rs] | HIGH |
| `ignore` | `^0.4` (0.4.25 is latest) | Gitignore-respecting parallel recursive directory walker | Used by ripgrep. Handles `.gitignore` + `.ignore` + `.git/info/exclude` + hidden files natively. Directly satisfies D-10, D-12. [VERIFIED: crates.io] | HIGH |

**Already in Cargo.toml (reuse):** `tokio` (^1), `serde`/`serde_json` (^1), `tauri` (^2 with `tray-icon`), `sqlx` (^0.8), `tauri-specta` (`=2.0.0-rc.21`), `specta` (`=2.0.0-rc.22`).

### Supporting (may not be strictly necessary)

| Crate | Version | Purpose | When to Use |
|-------|---------|---------|-------------|
| `dashmap` | `^6.1` | Concurrent hash map for PID↔cwd cache shared across debouncer callback and PID polling task | Only if the naive `Arc<RwLock<HashMap>>` shows contention in testing. Start without it. |
| `smallvec` | `^1.13` | Reduce allocations when collecting small event batches | Only if hot-path allocations become a measured bottleneck. Skip for MVP. |

### Intentionally NOT used in Phase 2

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| `sysinfo` | `ferrisetw` (ETW kernel tracing) | Correct PID-to-file attribution on Windows requires ETW, but ferrisetw is complex, needs elevation or the `SeSystemProfilePrivilege`, and is deferred — D-06 says best-effort is acceptable in Phase 2 |
| `git worktree list` (shell-out) | `git2` crate (libgit2 bindings) | Shelling out is ~1 call at watch start, zero maintenance. `git2` is 10MB+ compile overhead. D-08 says "use git worktree list." |
| Raw `walkdir` | `ignore::WalkBuilder` | walkdir doesn't know about `.gitignore`. Would need to re-implement ignore logic. `ignore::WalkBuilder` IS walkdir with gitignore glued on. |
| Polling file watcher | `notify::PollWatcher` | Polling misses burst writes entirely; use `RecommendedWatcher` which picks the correct native API per OS. Fall back to PollWatcher only if notify fails at startup (rare). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tauri::ipc::Channel<FileEventBatch>` | `app.emit("file-events", payload)` | Events are documented as unsuitable for streaming (Tauri v2 docs). Issue #8177 confirms high-frequency emit can crash the app on Windows. Channel is the recommended replacement. **This is the single most important architectural call in Phase 2.** |
| `ignore::WalkBuilder::build_parallel()` | `ignore::WalkBuilder::build()` (single-threaded) | Parallel walker is only faster for 10k+ files with cold cache. For 1k files the overhead exceeds the win. Recommend single-threaded for simplicity; escalate to parallel if startup walk exceeds 500ms in testing. |
| Tokio mpsc batching of debounced events | Direct callback from debouncer into Channel | notify-debouncer-full callbacks run on the watcher's own thread. Using an mpsc to shuttle into a tokio task lets you batch, PID-correlate asynchronously, and isolate the watcher thread from IPC stalls. |

**Installation:**
```toml
# src-tauri/Cargo.toml additions
notify = "8"
notify-debouncer-full = "0.7"
sysinfo = "0.38"
ignore = "0.4"
```

**Version verification command the planner should run before finalizing Cargo.toml:**
```bash
cargo search notify notify-debouncer-full sysinfo ignore --limit 1
```

## Architecture Patterns

### Recommended Module Structure

```
src-tauri/src/
├── lib.rs                      # existing — register new watcher module + manage channel state
├── tray.rs                     # existing
├── db/                         # existing
│   ├── mod.rs
│   └── migrations/
│       └── 001_initial_schema.sql
└── pipeline/                   # NEW — Phase 2 module
    ├── mod.rs                  # public API: start_watch, stop_watch, worktree_layout
    ├── watcher.rs              # notify-debouncer-full setup, event loop
    ├── events.rs               # FileEvent, FileEventBatch types (with specta::Type)
    ├── process_snapshot.rs     # sysinfo polling, PID cache, attribution heuristic
    ├── worktree.rs             # git worktree list --porcelain parser
    ├── ignore_filter.rs        # ignore crate wrapping + hardcoded excludes
    └── tree_index.rs           # in-memory file tree (HashMap<PathBuf, FileNode>)

src/
├── stores/
│   └── pipelineStore.ts        # NEW — Zustand store for file events, process table, worktree state
└── hooks/
    └── usePipelineChannel.ts   # NEW — sets up Tauri Channel on mount, pumps into Zustand
```

### Pattern 1: The Watcher Actor

**What:** A single owned background task that holds the `Debouncer`, the `sysinfo::System`, the process cache, and the `Channel<FileEventBatch>`. Runs as an actor — it receives start/stop/refresh commands via a tokio mpsc and sends outputs via the Channel.

**When to use:** Always for this phase. One actor = one owner of the filesystem watcher = no cross-thread sharing of the Debouncer.

**Example:**
```rust
// Source: https://rfdonnelly.github.io/posts/tauri-async-rust-process/
//         https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/

use notify_debouncer_full::{new_debouncer, notify::*, DebounceEventResult};
use std::time::Duration;
use tokio::sync::mpsc;

pub enum WatcherCmd {
    Start { repo_root: PathBuf },
    Stop,
    RefreshWorktrees,
}

pub async fn run_watcher_actor(
    mut cmd_rx: mpsc::Receiver<WatcherCmd>,
    out_channel: tauri::ipc::Channel<FileEventBatch>,
) {
    let (fs_tx, mut fs_rx) = mpsc::channel::<DebounceEventResult>(1024);
    let mut debouncer: Option<notify_debouncer_full::Debouncer<_, _>> = None;
    let mut snapshot = ProcessSnapshot::new();

    // PID polling tick
    let mut pid_tick = tokio::time::interval(Duration::from_millis(1000));

    loop {
        tokio::select! {
            Some(cmd) = cmd_rx.recv() => match cmd {
                WatcherCmd::Start { repo_root } => {
                    // Build debouncer; hand-off fs_tx clone via std::sync bridge
                    let bridge_tx = fs_tx.clone();
                    let mut d = new_debouncer(
                        Duration::from_millis(150),
                        None,
                        move |res: DebounceEventResult| {
                            // Runs on watcher thread — shuttle to tokio channel
                            let _ = bridge_tx.blocking_send(res);
                        }
                    ).expect("debouncer init");
                    d.watch(&repo_root, RecursiveMode::Recursive).unwrap();
                    debouncer = Some(d);
                }
                WatcherCmd::Stop => { debouncer = None; }
                WatcherCmd::RefreshWorktrees => { /* ... */ }
            },

            Some(res) = fs_rx.recv() => {
                let batch = process_debounced(res, &snapshot);
                if !batch.events.is_empty() {
                    let _ = out_channel.send(batch);
                }
            },

            _ = pid_tick.tick() => {
                snapshot.refresh();
            },
        }
    }
}
```

**Critical detail:** The debouncer's callback runs on the notify watcher thread, which is NOT a tokio task. You MUST shuttle through a sync->async bridge (`std::sync::mpsc::channel` + `blocking_send` or `tokio::sync::mpsc::Sender::blocking_send`). Calling `.send().await` directly from the callback will panic.

### Pattern 2: Long-Lived Channel via Command Registration

**What:** The `tauri::ipc::Channel<T>` must be created in a Tauri command (frontend creates it, passes as parameter). Once created, Rust clones it into app state, and the watcher actor sends to the clone. `Channel` implements `Clone + Send + Sync`, so this is safe.

**When to use:** Every time you need Rust→frontend streaming that outlives a single command invocation.

**Example:**
```rust
// Source: https://docs.rs/tauri/2.10.2/tauri/ipc/struct.Channel.html
//         https://v2.tauri.app/develop/calling-frontend/

// Frontend creates channel once on mount:
// const pipelineChannel = new Channel<FileEventBatch>();
// pipelineChannel.onmessage = (batch) => usePipelineStore.getState().ingest(batch);
// await invoke('register_pipeline_channel', { channel: pipelineChannel });

#[tauri::command]
#[specta::specta]
pub async fn register_pipeline_channel(
    channel: tauri::ipc::Channel<FileEventBatch>,
    state: tauri::State<'_, WatcherHandle>,
) -> Result<(), String> {
    state.cmd_tx.send(WatcherCmd::RegisterChannel(channel))
        .await
        .map_err(|e| e.to_string())
}
```

### Pattern 3: PID Attribution Heuristic

**What:** On each debounced batch, iterate events. For each event, find processes where `process.cwd().starts_with(repo_root)` AND the event path is under one of the process's cwd's. If exactly one matches, attribute. Otherwise mark as `unattributed`.

**When to use:** Phase 2's best-effort attribution (D-06). Phase 3 agent adapters will send explicit `(pid, path)` claims via self-reporting.

**Example:**
```rust
// Source: https://docs.rs/sysinfo/latest/sysinfo/struct.Process.html
use sysinfo::{System, Pid, ProcessRefreshKind, ProcessesToUpdate};

pub struct ProcessSnapshot {
    sys: System,
    // Narrowed view: only agent-like processes, keyed by pid
    candidates: HashMap<Pid, CandidateProc>,
    agent_name_allowlist: Vec<&'static str>, // ["claude", "claude-code", "codex", "opencode"]
}

impl ProcessSnapshot {
    pub fn refresh(&mut self) {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::OnlyIfNotSet)
                .with_cwd(sysinfo::UpdateKind::Always)
                .with_exe(sysinfo::UpdateKind::OnlyIfNotSet),
        );
        self.candidates.clear();
        for (pid, proc) in self.sys.processes() {
            let name = proc.name().to_string_lossy().to_lowercase();
            if !self.agent_name_allowlist.iter().any(|a| name.contains(a)) { continue; }
            let Some(cwd) = proc.cwd() else { continue; };
            self.candidates.insert(*pid, CandidateProc {
                pid: *pid,
                name: name.to_string(),
                cwd: cwd.to_path_buf(),
                exe: proc.exe().map(|p| p.to_path_buf()),
                parent: proc.parent(),
            });
        }
    }

    pub fn attribute(&self, event_path: &Path) -> Attribution {
        let matches: Vec<_> = self.candidates.values()
            .filter(|c| event_path.starts_with(&c.cwd))
            .collect();
        match matches.as_slice() {
            [only] => Attribution::Pid(only.pid),
            [] => Attribution::Unattributed,
            _ => Attribution::Ambiguous(matches.iter().map(|c| c.pid).collect()),
        }
    }
}
```

**Tuning note:** Start the PID poll tick at 1000ms. Agents rarely change cwd mid-session, so this is generous. Don't poll faster than 500ms — the PEB-read cost per process on Windows is non-trivial.

### Pattern 4: The In-Memory File Tree Index

**What:** Walk the repo once with `ignore::WalkBuilder`, build a `HashMap<PathBuf, FileNode>` where `FileNode` carries path, parent, modified_at, size. This becomes both the baseline state (for reconciliation after dropped events) and the data source for Phase 4's Radar spatial map.

**When to use:** Every time `start_watch` is called. Results cached in watcher actor state until `stop_watch`.

**Example:**
```rust
// Source: https://docs.rs/ignore/latest/ignore/struct.WalkBuilder.html
use ignore::WalkBuilder;

pub fn build_tree_index(repo_root: &Path) -> HashMap<PathBuf, FileNode> {
    let mut idx = HashMap::with_capacity(16_384);
    let walker = WalkBuilder::new(repo_root)
        .standard_filters(true) // .gitignore + .ignore + .git/info/exclude + hidden
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .add_custom_ignore_filename(".agentignore") // future-proof
        .build();
    for entry in walker.flatten() {
        if let Some(ft) = entry.file_type() {
            if ft.is_file() {
                let meta = entry.metadata().ok();
                idx.insert(entry.into_path(), FileNode {
                    modified_at: meta.as_ref().and_then(|m| m.modified().ok()),
                    size: meta.map(|m| m.len()).unwrap_or(0),
                });
            }
        }
    }
    idx
}
```

**Memory footprint (back-of-envelope):** For 10k files, `PathBuf` averages ~96 bytes (short path) to ~200 bytes (deep monorepo). Plus `FileNode` at ~32 bytes. Plus HashMap overhead ~48 bytes per entry. Total: **~3-4 MB for 10k files, ~30-40 MB for 100k files.** Well within acceptable for desktop.

**Excluded paths (hardcoded on top of gitignore — D-10):** `.git/`, `node_modules/`, `target/`, `build/`, `.next/`, `dist/`, `out/`. Apply via `WalkBuilder::add_ignore` or a custom `Override`.

### Pattern 5: Worktree Topology Detection

**What:** On watch start, run `git worktree list --porcelain -z` in the repo root. Parse the NUL-terminated porcelain output into a list of `Worktree { path, head, branch, is_main }`. Flag the repo as `shared` if all watched agents' cwd's fall inside the same worktree entry, or `isolated` if they fall inside different worktree entries.

**When to use:** D-08: on watch start, and on user-triggered refresh or new agent discovery (D-09).

**Example:**
```rust
// Source: https://git-scm.com/docs/git-worktree
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct Worktree {
    pub path: PathBuf,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub is_main: bool,
    pub is_bare: bool,
    pub detached: bool,
}

pub fn list_worktrees(repo_root: &Path) -> Result<Vec<Worktree>, String> {
    let output = Command::new("git")
        .arg("-C").arg(repo_root)
        .args(["worktree", "list", "--porcelain", "-z"])
        .output()
        .map_err(|e| format!("git worktree list failed: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let body = String::from_utf8_lossy(&output.stdout);
    // Records separated by NUL-NUL (empty line in porcelain); lines separated by single NUL
    // Replace with \n to reuse simple line parser
    let body = body.replace('\0', "\n");
    parse_porcelain(&body)
}

fn parse_porcelain(s: &str) -> Result<Vec<Worktree>, String> {
    let mut out = Vec::new();
    let mut cur: Option<Worktree> = None;
    let mut first = true;
    for line in s.lines() {
        if line.is_empty() {
            if let Some(wt) = cur.take() { out.push(wt); }
            continue;
        }
        let (label, value) = line.split_once(' ').unwrap_or((line, ""));
        match label {
            "worktree" => {
                if let Some(wt) = cur.take() { out.push(wt); }
                let is_main = first;
                first = false;
                cur = Some(Worktree {
                    path: PathBuf::from(value),
                    head: None, branch: None,
                    is_main, is_bare: false, detached: false,
                });
            }
            "HEAD" => { if let Some(c) = cur.as_mut() { c.head = Some(value.to_string()); } }
            "branch" => { if let Some(c) = cur.as_mut() { c.branch = Some(value.to_string()); } }
            "bare" => { if let Some(c) = cur.as_mut() { c.is_bare = true; } }
            "detached" => { if let Some(c) = cur.as_mut() { c.detached = true; } }
            _ => {}
        }
    }
    if let Some(wt) = cur.take() { out.push(wt); }
    Ok(out)
}
```

**Verified on this repo:** `git worktree list --porcelain` on `C:/Users/prann/projects/aitc` returns:
```
worktree C:/Users/prann/projects/aitc
HEAD 3e74406a5e51786a38fc2bb897b7c20279faaef7
branch refs/heads/main
```
Single worktree (main). Parser must handle this single-record case.

### Pattern 6: Typed Zustand Event Store

**What:** A Zustand store that holds a ring buffer of recent file events, a process table, and worktree layout. Updates come from a `Channel<FileEventBatch>.onmessage` pump wired up in a custom hook.

**Example:**
```typescript
// Source: established in Phase 1 — src/stores/sidebarStore.ts, src/stores/paletteStore.ts
import { create } from 'zustand';
import type { FileEventBatch, FileEvent, Worktree, ProcessInfo } from '../bindings';

const MAX_EVENTS = 5_000; // ring buffer

interface PipelineStore {
  events: FileEvent[];           // most recent first
  eventCount: number;             // total seen (including trimmed)
  processes: ProcessInfo[];
  worktrees: Worktree[];
  isWatching: boolean;
  droppedBatches: number;
  ingest: (batch: FileEventBatch) => void;
  setWorktrees: (wts: Worktree[]) => void;
  setProcesses: (ps: ProcessInfo[]) => void;
  setWatching: (on: boolean) => void;
  reset: () => void;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  events: [],
  eventCount: 0,
  processes: [],
  worktrees: [],
  isWatching: false,
  droppedBatches: 0,
  ingest: (batch) => set((s) => {
    const merged = [...batch.events, ...s.events].slice(0, MAX_EVENTS);
    return { events: merged, eventCount: s.eventCount + batch.events.length };
  }),
  setWorktrees: (wts) => set({ worktrees: wts }),
  setProcesses: (ps) => set({ processes: ps }),
  setWatching: (on) => set({ isWatching: on }),
  reset: () => set({ events: [], eventCount: 0, droppedBatches: 0 }),
}));
```

**Hook:**
```typescript
// src/hooks/usePipelineChannel.ts
import { useEffect } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { usePipelineStore } from '../stores/pipelineStore';

export function usePipelineChannel() {
  useEffect(() => {
    const channel = new Channel<FileEventBatch>();
    channel.onmessage = (batch) => usePipelineStore.getState().ingest(batch);
    invoke('register_pipeline_channel', { channel }).catch(console.error);
    // Cleanup: Channel doesn't need explicit teardown; dropping reference is enough
  }, []);
}
```

### Anti-Patterns to Avoid

- **Blocking the notify watcher thread:** Any slow work (DB writes, PID enumeration, path canonicalisation against a huge map) inside the debouncer callback stalls the watcher and triggers ReadDirectoryChangesW buffer overflow on Windows. The callback MUST do one thing: shuttle the result to a tokio mpsc channel.
- **Calling `app.emit()` in a hot loop:** Tauri issue #8177 demonstrates crashes. Even with throttling, emit is not the streaming primitive. Channel is.
- **Watching individual files instead of the repo root:** notify maintainers (issue #412) confirm that watching 1500+ individual paths drops events. Watch the root recursively; filter in the event callback.
- **Refreshing sysinfo on every event:** `sys.refresh_processes()` traverses all processes and reads PEB on Windows — this is NOT cheap. Poll on a tick, not per-event.
- **Holding a single `RwLock<HashMap>` for the process snapshot AND the event batcher:** Put each in a separate lock, or pass the snapshot through the mpsc as a versioned clone.
- **Storing file events in SQLite for "audit":** The `conflict_events` table stores *conflicts*, not raw events. A 10k-file codebase under burst editing can generate 500+ events/second; sqlite WAL can handle it, but the amplification is wasted I/O. Phase 2 keeps events in-memory per D-04.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform file watching | Native FSEvents/inotify/ReadDirectoryChangesW wrappers | `notify` crate | Years of edge-case bugs already fixed: rename detection, symlinks, case-insensitive filesystems, network drives |
| Event debouncing and rename reconstruction | Custom timer wheel + rename tracker | `notify-debouncer-full` | FileIdCache handles the notoriously hard problem of reconstructing renames when FSEvents/RDCW deliver them as separate Remove+Create events |
| Gitignore parsing | Read `.gitignore` + glob match | `ignore` crate `WalkBuilder` | Gitignore has subtle precedence rules (negations, multiple files, global config, git/info/exclude) that are easy to get wrong |
| Process enumeration across OSes | `psapi.h` on Windows, `/proc` on Linux, `libproc` on macOS | `sysinfo` crate | 50+ OS version edge cases already handled; includes PEB reading for other processes on Windows |
| Git worktree topology | Parse `.git` file manually, walk `.git/worktrees/` | Shell out to `git worktree list --porcelain -z` | git's output format is stable and documented; re-implementing it drifts as git evolves |
| High-frequency Rust→frontend streaming | Batched `emit()` with manual backpressure | `tauri::ipc::Channel<T>` | Tauri's built-in streaming primitive; documented as the recommended approach; avoids issue #8177 |
| Process-snapshot <-> watcher handoff | Shared `Mutex<HashMap>` | tokio `mpsc` actor pattern | Avoids contention and lock-held-across-await footguns |

**Key insight:** The three painful problems of this phase — watching efficiently, correlating PIDs on Windows, and streaming at high frequency — all have ecosystem-blessed crates (`notify`, `sysinfo`, `tauri::ipc::Channel`). Phase 2's job is wiring, not building.

## Common Pitfalls

### Pitfall 1: ReadDirectoryChangesW Buffer Overflow on Windows Under Bursts

**What goes wrong:** When an agent runs a codemod or bulk-rename across a repo, Windows queues hundreds of FILE_NOTIFY_INFORMATION entries into a fixed kernel buffer. If the notify consumer thread can't drain it fast enough, the OS discards the entire buffer contents. Events are lost silently — `notify` cannot detect this.

**Why it happens:** ReadDirectoryChangesW allocates a single buffer per directory handle at open time. The buffer size is fixed for the handle's lifetime. `notify` uses a default hardcoded size and does NOT expose a config option to tune it (verified against `Config` struct docs — only `with_poll_interval`, `with_manual_polling`, `with_compare_contents`, `with_follow_symlinks` are exposed).

**How to avoid:**
1. **Aggressive debouncing at a reasonable tick window (150-250ms) to coalesce bursts before they hit the consumer pipeline** — the debouncer reads events from notify immediately but batches them before delivery
2. **Keep the notify callback a no-op:** blocking_send into tokio mpsc, nothing else
3. **Include a periodic reconciliation:** every 30 seconds, re-scan the file tree index and diff against expected state; log discrepancies as "drift detected"
4. **Expose a `droppedBatches` counter to the frontend** for observability
5. **If Phase 2 testing surfaces overflow under real burst loads, the fallback is `PollWatcher`** — higher latency but no buffer overflow risk

**Warning signs:** (a) notify delivers an `Event { kind: Other, ... }` with an `overflow` hint; (b) the file tree index drifts from reality after bursts; (c) sessions where more files were modified on disk than observed events

**Confidence:** HIGH — verified from notify issue tracker (#412, labeled `B-upstream/B-wontfix`) and Windows API docs

### Pitfall 2: notify Callback on Non-Tokio Thread

**What goes wrong:** The debouncer's callback closure runs on notify's internal OS-specific thread, not a tokio worker. Calling `tokio::sync::mpsc::Sender::send().await` from this thread panics with "there is no reactor running."

**Why it happens:** `notify_debouncer_full::new_debouncer` takes a `Fn(DebounceEventResult) + Send + 'static` callback. It is called from the watcher's thread.

**How to avoid:** Use `blocking_send` (on a bounded channel) OR use a `std::sync::mpsc::channel` as a sync bridge and a tokio task that drains it. The actor pattern in the Pattern 1 example shows the correct approach.

**Warning signs:** Panic with "there is no reactor running" on first file event; app crashes immediately after starting watch

**Confidence:** HIGH — verified via notify-debouncer-full example code

### Pitfall 3: Tauri Events Cause Crashes at High Frequency

**What goes wrong:** `app.emit()` and `window.emit()` invoke a JavaScript evaluation per event. Under burst load (100k+ rapid emits) the app crashes with stack overflow code 0xc0000409 on Windows. Tauri issue #8177, opened 2023, is still open as of 2026.

**Why it happens:** The underlying `futures_channel::mpsc` layer panics under extreme load; the fetch-based IPC bridge was not designed for sustained high throughput.

**How to avoid:**
1. **Don't use events for streaming** — use `tauri::ipc::Channel<T>` (documented as the streaming-optimized primitive)
2. **Even with Channel, batch aggressively** (a `FileEventBatch` should hold 10-500 events, not one at a time)
3. **Log events lost to a full channel** so performance regressions are visible

**Warning signs:** App crash in dev mode when dozens of events fire per second; "stack overflow" in the Windows Event Log

**Confidence:** HIGH — verified via Tauri issue #8177 and official Tauri docs ("not designed for low latency or high throughput situations")

### Pitfall 4: sysinfo::refresh_processes() Is Expensive on Windows

**What goes wrong:** Calling `System::refresh_processes_specifics(ProcessesToUpdate::All, ...)` on Windows reads the PEB of every process via `ReadProcessMemory`. On a typical dev box with 300+ processes, a full refresh can take 30-100ms.

**Why it happens:** To produce `cwd`/`cmd`/`environ` for non-self processes, sysinfo attaches to each process and performs virtual memory reads. There's no "list processes" fast path if you need those fields.

**How to avoid:**
1. **Don't refresh per-event** — poll at 1000ms ticks, use the stale snapshot for attribution
2. **Use `ProcessRefreshKind` to limit fields:** `ProcessRefreshKind::nothing().with_cwd(...).with_cmd(OnlyIfNotSet)` avoids reading heavy fields repeatedly
3. **Pre-filter by name** before doing expensive PEB reads (if sysinfo API allows — otherwise filter in your own candidate map)

**Warning signs:** PID polling task pegs a CPU core; UI frame drops every 1 second

**Confidence:** MEDIUM — inferred from sysinfo docs ("Refreshing all processes and their tasks can be quite expensive") and Windows PEB-read semantics; actual cost should be benchmarked during Wave 0

### Pitfall 5: Rename Events Delivered as Remove+Create

**What goes wrong:** On Windows and Linux, a file rename can be delivered as two separate events (Remove on old path, Create on new path) depending on whether source and dest are the same directory. Naively consuming these as Remove+Create corrupts the file tree index — the index shows the file as gone, then as new, with all history lost.

**Why it happens:** OS-level file IDs are not always stable across rename; notify needs a FileIdCache to track them.

**How to avoid:** `notify-debouncer-full` handles this via `FileIdCache` / `RecommendedCache` — you MUST pass `RecommendedCache::new()` to `new_debouncer_opt()` (or let `new_debouncer()` use it by default). The debouncer will coalesce Remove+Create pairs into a single `ModifyKind::Name(Both)` event.

**Warning signs:** File tree index loses files after rename; rename events appear as Remove followed by Create with no connection

**Confidence:** HIGH — documented in notify-debouncer-full

### Pitfall 6: Walking `.git/` and `node_modules/` Destroys Startup Time

**What goes wrong:** A fresh `npm install` can leave 50k files in `node_modules/`. Walking them at watch start adds seconds of latency and fills the tree index with noise.

**Why it happens:** The `ignore` crate respects `.gitignore` by default, but `.git/` itself is not usually in `.gitignore` — it's implicit. Hardcoded excludes must be added.

**How to avoid:** Use `ignore::overrides::OverrideBuilder` to add explicit excludes for `.git/`, `node_modules/`, `target/`, `build/`, `dist/`, `.next/`, `out/`. Or use `WalkBuilder::add_custom_ignore_filename` to ship an embedded `.agentignore`. Per D-10, these are hardcoded in Phase 2.

**Warning signs:** `start_watch` takes more than 500ms on a typical repo; tree index includes `node_modules/` paths

**Confidence:** HIGH

### Pitfall 7: Process Polling Misses Short-Lived Subagents

**What goes wrong:** A coding agent may spawn short-lived helper processes (e.g., `ripgrep`, `cargo check`) that touch files and exit in under 100ms. A 1000ms polling tick will miss them; events get marked Unattributed.

**Why it happens:** The PID-to-cwd cache only updates on the polling tick.

**How to avoid:** Accept this as a known limitation of best-effort attribution (D-06). Unattributed events are still delivered and visible in the Tower. Phase 3's agent self-report hooks (D-05) will supplement by announcing subprocess spawns.

**Warning signs:** Unattributed ratio > 20% during heavy agent activity

**Confidence:** HIGH — fundamental to polling-based correlation

## Runtime State Inventory

*(Omitted — this is a greenfield feature addition, not a rename/refactor/migration. No pre-existing runtime state to enumerate.)*

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (cargo) | All Rust code | ✓ | 1.87 (2025-05-06) | — |
| Node.js + npm | Frontend build | ✓ | 24.1.0 / 11.3.0 | — |
| git CLI | Worktree detection (D-08) | ✓ | 2.49.0 (Windows) | Parse `.git` file manually; degraded: single-worktree-only detection |
| Tauri v2 | Shell | ✓ (via Cargo) | ^2.10 | — |
| sqlx CLI | Migrations (not strictly needed — `sqlx::migrate!` macro is compile-time) | ✓ (optional) | — | Use embedded `migrate!` macro already in Phase 1 |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — all required tooling is present.

**Windows-specific dependencies:** `ReadDirectoryChangesW` is part of the Windows API and is always available. No additional installs needed. `NtQueryInformationProcess` (used by sysinfo on Windows) is available but may trigger some antivirus heuristics — sysinfo 0.31+ switched to "mainstream" Windows APIs to reduce false positives, so this is mitigated.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frontend framework | vitest 3.0 + @testing-library/react 16 + jsdom 26 |
| Rust framework | `cargo test` (built-in) with tokio `#[tokio::test]` for async tests |
| Rust config file | `src-tauri/Cargo.toml` `[dev-dependencies]` (none set for test deps yet — Wave 0 adds `tempfile`, `serial_test`) |
| Frontend config file | `vite.config.ts` (implicit vitest config — verify in Wave 0) |
| Quick run command (frontend) | `npm test -- --run src/__tests__/pipelineStore.test.ts` |
| Quick run command (Rust) | `cd src-tauri && cargo test -p aitc pipeline::` |
| Full suite command | `npm test && cd src-tauri && cargo test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FMON-01 | Debouncer delivers Create event when file is created in watched dir | integration (Rust) | `cargo test -p aitc pipeline::watcher::tests::detects_file_create -- --nocapture` | ❌ Wave 0 |
| FMON-01 | Debouncer delivers Modify event when file content is written | integration (Rust) | `cargo test -p aitc pipeline::watcher::tests::detects_file_modify -- --nocapture` | ❌ Wave 0 |
| FMON-01 | Debouncer delivers Remove event when file is deleted | integration (Rust) | `cargo test -p aitc pipeline::watcher::tests::detects_file_remove -- --nocapture` | ❌ Wave 0 |
| FMON-01 | Rename is delivered as ModifyKind::Name, not Remove+Create | integration (Rust) | `cargo test -p aitc pipeline::watcher::tests::rename_coalesced` | ❌ Wave 0 |
| FMON-01 | Ignored paths (`.git/`, `node_modules/`) produce no events | integration (Rust) | `cargo test -p aitc pipeline::ignore_filter::tests::excludes_standard_dirs` | ❌ Wave 0 |
| FMON-01 | Writes-only filter drops AccessKind events (D-11) | unit (Rust) | `cargo test -p aitc pipeline::events::tests::filter_writes_only` | ❌ Wave 0 |
| FMON-02 | Attribution returns Pid when exactly one candidate's cwd matches | unit (Rust) | `cargo test -p aitc pipeline::process_snapshot::tests::attributes_single_match` | ❌ Wave 0 |
| FMON-02 | Attribution returns Unattributed when no candidate matches | unit (Rust) | `cargo test -p aitc pipeline::process_snapshot::tests::unattributed_when_no_match` | ❌ Wave 0 |
| FMON-02 | Attribution returns Ambiguous when multiple candidates match | unit (Rust) | `cargo test -p aitc pipeline::process_snapshot::tests::ambiguous_when_multi_match` | ❌ Wave 0 |
| FMON-02 | ProcessSnapshot filters candidates by agent name allowlist | unit (Rust) | `cargo test -p aitc pipeline::process_snapshot::tests::filters_allowlist` | ❌ Wave 0 |
| FMON-03 | Walking a 10k-file tree completes in < 500ms | benchmark (Rust, ignored by default) | `cargo test -p aitc pipeline::tree_index::tests::bench_10k_walk -- --ignored` | ❌ Wave 0 |
| FMON-03 | Debouncer coalesces 1000 rapid writes into ≤10 batches at 150ms tick | integration (Rust) | `cargo test -p aitc pipeline::watcher::tests::coalesces_burst` | ❌ Wave 0 |
| FMON-03 | Zustand store ring-buffers at MAX_EVENTS (5000) | unit (frontend) | `npm test -- --run src/__tests__/pipelineStore.test.ts` | ❌ Wave 0 |
| FMON-04 | Porcelain parser handles single-worktree output | unit (Rust) | `cargo test -p aitc pipeline::worktree::tests::parses_single_worktree` | ❌ Wave 0 |
| FMON-04 | Porcelain parser handles multi-worktree output with detached/branch/locked | unit (Rust) | `cargo test -p aitc pipeline::worktree::tests::parses_multi_worktree` | ❌ Wave 0 |
| FMON-04 | is_shared_tree returns true when all candidate cwds match one worktree | unit (Rust) | `cargo test -p aitc pipeline::worktree::tests::shared_vs_isolated` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cargo test -p aitc pipeline::{touched_module}` + `npm test -- --run {touched_frontend_test}`
- **Per wave merge:** `cargo test -p aitc pipeline::` + `npm test`
- **Phase gate:** Full suite green (`npm test && cd src-tauri && cargo test`) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/Cargo.toml` `[dev-dependencies]` — add `tempfile = "3"` (temp repo fixtures), `serial_test = "3"` (serialize filesystem tests to avoid races)
- [ ] `src-tauri/tests/pipeline_integration.rs` OR `src-tauri/src/pipeline/*/tests.rs` (inline `#[cfg(test)] mod tests`) — inline is preferred given Phase 1 conventions
- [ ] `src/__tests__/pipelineStore.test.ts` — Zustand store ring buffer, ingest, reset behaviors
- [ ] `src/__tests__/usePipelineChannel.test.tsx` — hook channel registration (mock `@tauri-apps/api/core`)
- [ ] Test helper: `src-tauri/src/pipeline/test_util.rs` — `make_temp_repo()`, `spawn_fake_agent(cwd)`, `wait_for_batch()` utilities
- [ ] Bench harness: one `#[test] #[ignore]` benchmark per perf SLA (500ms walk, 10-batch coalesce) — run opt-in via `cargo test -- --ignored`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no (local desktop app, no auth surface introduced in Phase 2) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes (limited) | The watcher must not leak file contents across users on multi-user Windows; run with current user's identity only. Tauri default (no elevation) achieves this. |
| V5 Input Validation | yes | Paths received from notify events MUST be canonicalized before being used in database lookups or path prefix matching; use `std::path::Path::canonicalize` at the boundary and reject paths outside the watched repo root |
| V6 Cryptography | no | No secrets handled in Phase 2 |
| V7 Error Handling & Logging | yes | Log file paths at `tracing::debug!` only — avoid leaking repo file names to stdout in release builds. Use `tracing::warn!` for dropped batches, `tracing::error!` for watcher init failures. |
| V8 Data Protection | yes | In-memory event buffer holds paths (not contents). Process snapshot holds cmd/cwd strings. On app exit, Tauri drops app state automatically — no explicit zeroization needed for Phase 2 because contents are not captured. |
| V12 Files and Resources | yes | The watcher path MUST be validated as absolute, canonicalized, and within the user's home directory (or at least not `C:\Windows\` or `C:\Program Files\`). Reject symlinks that escape the repo root by default (notify's `Config::with_follow_symlinks(false)` for Linux/macOS; Windows ReadDirectoryChangesW does not follow symlinks by default). |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via rename event with `..` in payload | Tampering | Canonicalize every event path at the boundary; drop events whose canonical form escapes repo root |
| Symlink following leaks files outside repo | Information Disclosure | `notify::Config::with_follow_symlinks(false)` on Linux/macOS; document Windows default behavior |
| Unbounded event buffer → memory exhaustion DoS (bulk `rm -rf`, `git checkout` huge branch) | Denial of Service | Ring buffer cap (5000 events) in the Zustand store; bounded tokio mpsc (1024) between watcher callback and actor |
| PID enumeration of other users' processes (information disclosure) | Information Disclosure | Use `PROCESS_QUERY_LIMITED_INFORMATION` (sysinfo's default fallback); skip processes that fail to open |
| Shell injection via `git worktree list` repo path | Tampering | Use `std::process::Command::arg()` (not shell invocation); repo root is user-selected, not user-provided via IPC payload; still canonicalize before passing |
| Running child agent processes can read the event stream via event bus | Information Disclosure | Tauri events go only to the webview; agents subprocess don't have access to Tauri IPC — not applicable to Phase 2 |
| Large file tree walk locks the UI thread | DoS (UX) | Walk runs in `tauri::async_runtime::spawn_blocking` since `ignore::Walk` is sync; only the walk task blocks, not the UI |

### Security-Sensitive Phase 2 Operations

1. **Repo root selection:** The user picks the watched directory via a Tauri dialog (Phase 3 concern). Phase 2 receives an already-validated path from the frontend. Still canonicalize on receipt.
2. **Shell-out to git:** `git worktree list` is invoked with `Command::new("git").arg(...)` — safe from shell injection as long as `.arg()` is used, not `.arg_shell()`.
3. **Memory disclosure via tracing:** Debug logs with full paths can leak project structure if logs are shared. Gate path logging behind `#[cfg(debug_assertions)]` or `tracing::level!()`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `app.emit("file-events", ...)` for Rust→frontend streaming | `tauri::ipc::Channel<T>.send(...)` | Tauri v2.0 stable (2024-10-02) | Channels are the streaming primitive; events are for pub/sub lifecycle messages only |
| `notify` v5 with hand-rolled debouncer | `notify` v8+ with `notify-debouncer-full` | notify v6 (2023) + debouncer-full v0.1 (2023) | Handles rename coalescing and burst batching as a library concern |
| `walkdir` + manual `.gitignore` parsing | `ignore::WalkBuilder` | ripgrep 0.7 (2017) | gitignore is a solved problem — don't re-implement |
| `procfs` / `sysinfo` ~0.29 (`cwd` empty on Windows) | `sysinfo` 0.31+ (reads PEB of other processes on Windows) | sysinfo 0.31 (2024) | Windows PID attribution is now feasible without dropping to `ntdll` directly |
| `specta` v1 (commands only) | `tauri-specta` v2 (commands + events + channel types) | tauri-specta 2.0.0-rc.1 (2024) | Channel payload types can be code-generated into TypeScript |

**Deprecated / outdated:**
- **`notify::DebouncedEvent` enum (from old notify v4)** — gone. Modern notify uses `Event { kind: EventKind, paths: Vec<PathBuf>, attrs: ... }`. Any training-era code referencing `DebouncedEvent::Write(path)` is stale.
- **`sysinfo::ProcessExt` trait** — dissolved; `Process` now has inherent methods. Old code calling `use sysinfo::ProcessExt; process.name()` no longer compiles.
- **`std::sync::mpsc` for async work** — still fine for the sync-to-async bridge from notify's thread, but tokio mpsc is the standard for all tokio-internal messaging.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] 150ms debounce tick is sufficient to coalesce typical agent burst writes without introducing perceptible latency | Pattern 1, Pitfall 1 | Too short → buffer overflow still hits; too long → conflict detection in Phase 3 gets stale data. Wave 0 should benchmark under a realistic burst (e.g., `cargo build` + LSP reformat). |
| A2 | [ASSUMED] Agent-process name allowlist of `claude`, `claude-code`, `codex`, `opencode` covers Phase 2's discovery needs | Recommendation for D-07 | Missing an agent → Unattributed noise. User should confirm this list in plan-check. |
| A3 | [ASSUMED] 5000-event ring buffer in Zustand is sufficient for Phase 2 visibility (~30-60 seconds of typical activity) | Pattern 6 | Too small → users can't scroll back far enough; too large → React reconciliation slows. Easy to tune post-hoc. |
| A4 | [ASSUMED] In-memory event storage is sufficient; SQLite persistence is deferred to Phase 3 conflict events (D-04 recommendation) | Claude's recommendation D-04 | If Phase 3 needs raw event history for conflict replay, we'd have to add persistence retroactively. Acceptable risk. |
| A5 | [ASSUMED] PID polling cadence of 1000ms is acceptable for best-effort attribution | Pattern 3, Pitfall 4 | Short-lived subprocess writes get Unattributed. D-06 explicitly allows this. Benchmarking in Wave 0 may push this to 500ms if attribution accuracy suffers. |
| A6 | [ASSUMED] sysinfo's PEB-read on Windows does NOT require administrator privileges for same-user processes | Pattern 3 | If elevation is required for user processes, attribution fails in non-admin dev installs. Mitigation: sysinfo falls back to `PROCESS_QUERY_LIMITED_INFORMATION` and returns None for cwd — plan must handle None gracefully (already does by treating as Unattributed). |
| A7 | [ASSUMED] The existing `src-tauri/src/db/migrations` pattern continues for any new Phase 2 tables (if D-04 flips to SQLite persistence) | Module structure | Breaks if Phase 1 pattern changed — need to confirm against `src-tauri/src/db/mod.rs` in Wave 0 (already confirmed above: embedded `migrate!("./src/db/migrations")` pattern is in use) |
| A8 | [ASSUMED] Canvas 2D radar (Phase 4) will consume the file tree index directly from the Zustand store; no separate "radar index" needed | Pattern 4, D-12 rationale | If Phase 4 ends up needing a different tree representation, the in-memory index becomes redundant. Cheap to refactor. |
| A9 | [ASSUMED] `notify` v8.2 is stable enough to target; v9.0-rc.2 is not required for Phase 2 | Standard Stack | If v9 introduces a breaking change that Phase 2 needs (e.g., `EventKindMask::CORE` for kernel-level filtering), we may want to upgrade during Phase 2. Decision can be revisited in Wave 0 benchmark. |

**Decision points the planner should surface in plan-check:**
- **A1 (debounce tick):** Present 100ms / 150ms / 250ms options with tradeoff table
- **A2 (agent name allowlist):** Let user confirm or edit the initial list
- **A4 (in-memory vs SQLite):** The D-04 recommendation should be explicitly confirmed
- **D-01 substitution:** Events → Channel substitution must be confirmed before execution (this is the most important confirmation)

## Open Questions

1. **Does Tauri's `tauri::ipc::Channel` require an open Tauri command invocation, or can it outlive the command?**
   - What we know: `Channel` implements `Clone + Send + Sync` and can be stored in app state. Blog posts and the docs confirm background tasks can hold and send through a cloned channel.
   - What's unclear: The exact lifetime — if the frontend unmounts the webview window, does the channel's message pump die? Does resending to a "dead" channel return an error?
   - Recommendation: Write a 30-line smoke test in Wave 0 that registers a channel, then has a tokio task send 10 messages over 10 seconds, with the webview staying mounted. If this works, the pattern is sound. If not, fall back to re-registering the channel on every `start_watch`.

2. **How much does `sysinfo::System::refresh_processes_specifics` cost on a typical dev Windows box with ~300 processes?**
   - What we know: Docs say "can be quite expensive" but give no numbers.
   - What's unclear: Is 1000ms polling fine, or do we need 2000ms?
   - Recommendation: Add a `#[test] #[ignore]` microbenchmark in Wave 0. Target <50ms per refresh.

3. **Does notify's recommended watcher on Windows deliver any signal when ReadDirectoryChangesW's buffer overflows?**
   - What we know: Maintainers call this upstream and wontfix; it's been reported as missing events with no warning.
   - What's unclear: Whether notify v8.2+ has started propagating `ERROR_NOTIFY_ENUM_DIR` as an event. The CHANGELOG hints at "Windows: unaligned access fix" but nothing about overflow notification.
   - Recommendation: Wave 0 — instrument a burst test (write 5000 files in 1 second) and confirm how many events are delivered vs emitted. If <90% delivery, add the reconciliation pass mentioned in Pitfall 1.

4. **Is the existing Phase 1 splash-screen flow compatible with a watcher that starts at app launch?**
   - What we know: `lib.rs` has a `spawn` that waits 2s for splash then shows the main window. The watcher should probably start *after* the main window shows, not before, to avoid stalling splash → main transition.
   - What's unclear: Nothing, this is a design call.
   - Recommendation: Don't start the watcher at app init. Start it explicitly via a `start_watch` Tauri command from the frontend after the main window is ready. Stops automatically on app exit.

5. **How does this repo's existing `test` convention extend to Rust integration tests?**
   - What we know: Frontend uses vitest (`npm test`); Rust crate has `cargo test` but no integration tests exist yet.
   - What's unclear: Whether we put tests in `src-tauri/src/pipeline/*/tests.rs` inline modules or in `src-tauri/tests/`.
   - Recommendation: Inline `#[cfg(test)] mod tests` per module — matches the Rust community default, avoids the `tests/` directory's separate compilation cost.

## Sources

### Primary (HIGH confidence)

- [notify crate on GitHub](https://github.com/notify-rs/notify) — actively maintained, de facto standard
- [notify CHANGELOG](https://github.com/notify-rs/notify/blob/main/notify/CHANGELOG.md) — v8.2.0 (2025-08-03), v9.0.0-rc.2 (2026-02-14)
- [notify-debouncer-full CHANGELOG](https://github.com/notify-rs/notify/blob/main/notify-debouncer-full/CHANGELOG.md) — v0.7.0 (2026-01-23)
- [notify-debouncer-full docs.rs](https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/) — current API (0.7.x)
- [notify-debouncer-full example](https://github.com/notify-rs/notify/blob/main/examples/debouncer_full.rs) — verified construction pattern
- [notify Config docs](https://docs.rs/notify/latest/notify/struct.Config.html) — verified that Windows buffer size is NOT exposed
- [notify issue #412: dropped events at scale](https://github.com/notify-rs/notify/issues/412) — labeled B-upstream/B-wontfix
- [notify EventKind docs](https://docs.rs/notify/latest/notify/event/enum.EventKind.html) — Create/Modify/Remove/Access variants
- [sysinfo docs.rs (System)](https://docs.rs/sysinfo/latest/sysinfo/struct.System.html) — 0.38.4 API
- [sysinfo docs.rs (Process)](https://docs.rs/sysinfo/latest/sysinfo/struct.Process.html) — Windows-specific behavior
- [sysinfo source: windows/process.rs](https://github.com/GuillaumeGomez/sysinfo/blob/master/src/windows/process.rs) — confirmed PEB reading for other processes
- [sysinfo CHANGELOG](https://github.com/GuillaumeGomez/sysinfo/blob/main/CHANGELOG.md) — 0.35-0.38 release notes
- [ignore crate docs](https://docs.rs/ignore/latest/ignore/struct.WalkBuilder.html) — WalkBuilder, standard_filters, build_parallel
- [git-worktree docs](https://git-scm.com/docs/git-worktree) — porcelain format spec verified
- [Tauri v2 docs: Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/) — events vs Channel, performance guidance
- [Tauri issue #8177: event emit crashes at high frequency](https://github.com/tauri-apps/tauri/issues/8177) — still open, recommends throttling/Channels
- [Tauri ipc::Channel API docs (v2.10.2)](https://docs.rs/tauri/2.10.2/tauri/ipc/struct.Channel.html) — Clone/Send/Sync verified
- [tauri-specta v2 docs](https://specta.dev/docs/tauri-specta/v2) — typed events and commands
- [Tauri Async Rust Process blog](https://rfdonnelly.github.io/posts/tauri-async-rust-process/) — actor pattern for background tasks

### Secondary (MEDIUM confidence)

- [Understanding ReadDirectoryChangesW Part 2 (Jim Beveridge)](https://qualapps.blogspot.com/2010/05/understanding-readdirectorychangesw_19.html) — authoritative on Windows buffer semantics; old but still accurate
- [Tresorit Engineering: Using ReadDirectoryChangesW on Windows](https://medium.com/tresorit-engineering/how-to-get-notifications-about-file-system-changes-on-windows-519dd8c4fb01) — buffer overflow explanation
- [Hello Code: Tracking the current active process in Windows with Rust](https://hellocode.co/blog/post/tracking-active-process-windows-rust/) — windows-rs patterns

### Tertiary (LOW confidence, cross-verified)

- [ferrisetw docs](https://docs.rs/ferrisetw/latest/ferrisetw/) — ETW alternative, noted as out-of-scope for Phase 2
- [IBM: ReadDirectoryChangesW buffer overrun guide](https://www.ibm.com/support/pages/solving-notification-buffer-overrun-situations-during-jbb-windows-client) — corroborates that consumer speed, not buffer size, is the primary mitigation

## Metadata

**Confidence breakdown:**
- Standard stack (crates, versions, API shapes): HIGH — all verified against docs.rs, GitHub changelogs, and source code
- Architecture patterns (actor, Channel, attribution heuristic): HIGH — matches documented Tauri and notify patterns
- Common pitfalls: HIGH for Windows buffer overflow, Tauri emit crashes, rename coalescing; MEDIUM for sysinfo refresh cost (not benchmarked on this specific hardware)
- PID attribution accuracy on Windows: MEDIUM — sysinfo PEB read should work per source code inspection, but not empirically verified against a multi-agent workload
- Phase-to-Phase assumptions (Phase 4 radar consuming tree index): MEDIUM — Phase 4 not yet planned in detail

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (30 days — stack is stable; revisit if notify 9.0 GA lands or Tauri issue #8177 is fixed before then)
