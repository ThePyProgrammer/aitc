# Architecture

> Air traffic control for coding AI agents. A Tauri v2 desktop app that watches
> multiple concurrent agents (Claude Code, Codex, OpenCode, …) doing work on a
> single codebase, shows where each one is, gates their dangerous tool calls
> behind user approval, and lets you resolve conflicts when two of them stomp
> on the same file.

## Overview

AITC runs on the developer's workstation. A Rust backend senses: it watches the
filesystem with `notify`, snapshots process ancestry with `sysinfo`, and
attributes file events to the agent that caused them. A React frontend renders:
a radar view of the codebase as a force-directed graph, a tower-control
manifest of live agents, an approval queue for Claude Code PreToolUse hooks, a
merge UI for conflicts, and a browser over `~/.claude/`.

The key insight is that every interesting signal lives in the Rust process —
file events, process table, agent subprocesses, HTTP endpoints for
sidecar/self-register, SQLite. The frontend is a dumb renderer: it subscribes
to Tauri Channels and events, and every write goes back through a typed command
(`#[tauri::command] #[specta::specta]`). Types cross the IPC boundary through
`tauri-specta` — `src/bindings.ts` is generated on every debug build; hand
edits are reverted by `cargo build`.

A second Rust crate, `aitc-hook`, ships as a sidecar binary. Claude Code
invokes it per `PreToolUse`. It talks to the main app over loopback HTTP,
discovering the port via `~/.aitc/port`. **Every error path in the sidecar is a
fail-closed deny.** If AITC crashes or the port file is stale, nothing ships.

## Codemap

### Entry points

**`src-tauri/src/main.rs`** is six lines — it calls `aitc_lib::run()`.
**`src-tauri/src/lib.rs`** is the real entry. Reading it top-to-bottom is the
fastest way to understand startup:

1. `tracing_subscriber` init, reading `RUST_LOG`, default `info`, stderr.
2. `repo_session::capture_launch_cwd()` grabs CWD before Tauri eats argv.
3. `AgentRegistry::new()` plus three built-in adapters
   (`claude_code`, `codex`, `opencode`) registered up front.
4. `tauri_specta::Builder` — `collect_commands![…]` enumerates every
   IPC-exposed command; `.typ::<T>()` registers every DTO. Debug builds
   re-emit `src/bindings.ts`.
5. Plugins: `opener`, `sql`, `notification`, `dialog`, `shell` (the last one
   is required so `ShellExt::sidecar("aitc-hook")` resolves).
6. `.setup(...)` closure does, in order: tray, sidecar path resolution,
   **synchronous** DB init (`block_on`, see CR-01 below), `WaiterRegistry`,
   startup hook-reinstall, axum self-register server on port 9417 (or
   OS-assigned) with `~/.aitc/port` written atomically, `BackupManager`,
   splash-screen close, close-to-tray interceptor, and a Linux-only
   `webkit2gtk` zoom lock.
7. `RunEvent::Exit` terminates every AITC-launched agent — passive /
   self-registered agents are left alone because "those belong to the user."

**`src/main.tsx` → `src/App.tsx`** boots React. Routes use `createMemoryRouter`
(this is a webview, not a browser). `<AppShell>` wraps every route, which in
turn wraps `<Outlet>` in `<RepoSessionProvider>`. The provider lives outside
`<Outlet>` on purpose so route navigation doesn't tear down the pipeline
Channel.

### Rust backend (`src-tauri/src/`)

```
pipeline/        sense  — notify watcher + sysinfo attribution → Channel<FileEventBatch>
agents/          act    — AgentAdapter trait, registry, /register + /hook axum server
conflict/        detect — sliding-window engine + merge resolution + BackupManager
comms/           gate   — approval queue, protected paths, app_settings
chat_runtime/    talk   — long-lived Claude stream-json stdio supervisor
claude_resources/browse — multi-root watcher for ~/.claude and <cwd>/.claude
mcp/             serve  — MCP Streamable HTTP server co-hosted on self_register port
db/              store  — sqlx + SQLite; 6 migrations embedded at build time
aitc-hook/       gate   — separate crate, PreToolUse fail-closed sidecar
```

**`pipeline/`** is the sensing layer. `watcher.rs` owns a
`notify-debouncer-full` at 150 ms. `process_snapshot.rs` polls the process
table once a second. `commands.rs::start_watch` wires them together: raw
events → attributing stream → a `broadcast::channel` that fans out to the
frontend Channel, the conflict engine, and the protected-path watcher.
`passive_bridge.rs` reconciles the process snapshot against `AgentRegistry`,
creating `PASSIVE-{pid}` entries for unknown Claude processes. `deps/` is a
tree-sitter import-graph extractor feeding the radar. `port_file.rs` owns
`~/.aitc/port` with an RAII `PortFileGuard`.

**`agents/`** is where the agent lifecycle lives. `adapter.rs` defines the
`AgentAdapter` trait and the `AgentState` machine (explicit transition
validation, no `From<str>` shortcuts). `registry.rs` holds agents under
`RwLock<HashMap>` with `MAX_AGENTS = 1000` as an emergency ceiling.
`claude_code.rs`, `codex.rs`, `opencode.rs`, `generic.rs` are the four built-in
adapters — only `claude_code` sets `chat_duplex = true`. `self_register.rs`
(~650 LOC) is the axum server: `/register` (POST), `/hook` (POST, long-held),
`/mcp` (POST/GET/DELETE), a 10-req/s mutex-backed rate limiter, loopback-only
bind, PID liveness checks on every request, and an `AbandonGuard` that does
the atomic `UPDATE … WHERE status='pending'` on drop.
`hook_waiters.rs::WaiterRegistry` owns the oneshot channels that block HTTP
responses until the user resolves an approval. `hook_install.rs` hand-merges
`<cwd>/.claude/settings.local.json` atomically.

**`conflict/`** consumes pipeline batches through the broadcast channel and
produces `ConflictAlert`s via a sliding window keyed on `PathBuf`. The default
window is 5000 ms; adjustable at runtime via `update_conflict_window`.
`resolution.rs` is the merge-commit surface — `read_conflict_files`,
`apply_resolution`, `list_conflict_resolutions`, plus the history-table
queries. `backup.rs` snapshots files before any merge writes.

**`comms/`** is the approvals domain. `commands.rs` has `approve_request`,
`deny_request`, `ask_more_info`, `approve_with_edits` — each signals a
`HookDecision` back through `WaiterRegistry` AND writes history to SQLite.
`protected_path_trigger.rs` is a second subscriber to the pipeline broadcast
channel; it matches file writes against user-configured globs and synthesizes
approval requests from the pipeline side (the OR-semantics with tool-gated
approvals come from the D-19 pretool allowlist).

**`chat_runtime/`** supervises long-lived Claude `stream-json` subprocesses.
`parser.rs` reads stdout NDJSON with per-line bounds (`MAX_STREAM_JSON_LINE_BYTES = 1 MiB`,
`MAX_CHAT_MESSAGE_BYTES = 256 KiB`) and a 250 ms idle flush for partial
`text_delta` accumulation. `outbound.rs` is the stdin writer. `supervisor.rs`
awaits `child.wait()` and writes a `session_boundary` row on exit. All of this
is keyed off `LiveSessionRegistry`, which is the single owner of every
`stdin_tx`.

**`claude_resources/`** is the ARSENAL backend. It runs a *separate* notify
Debouncer from the main pipeline (D-05). `parse.rs` handles every file format
backend-side — the frontend never parses. `write_fence.rs` suppresses the
echo from our own atomic writes to `CLAUDE.md` files so the UI doesn't pop a
"file changed on disk" banner when the user just saved.

**`mcp/`** is a Streamable-HTTP MCP server co-hosted on the same axum router
as `/register` and `/hook`. It exposes two tools: `get_pending_user_messages`
(drain fallback when Claude's stdin isn't usable) and `request_user_input`
(forces an OS notification + transcript marker). `MAX_MCP_SESSIONS = 64` is a
DoS cap. `session_config.rs` writes per-agent `.claude/aitc-mcp-<agent_id>.json`
*before* spawning Claude, binding MCP-session → AITC-agent via an
`X-AITC-Session` header.

**`db/`** is thin. `init_db` opens a pool with `foreign_keys(true)` and
`max_connections(5)`, then runs `sqlx::migrate!("./src/db/migrations")`. Six
migrations: `001_initial_schema`, `002_phase3_enrichment`,
`003_comms_chat`, `004_phase5_resolution`, `005_pretool_use_hooks`,
`006_agent_events` (which deletes the old `chat_messages` table — see
invariants).

**`repo_session.rs`** captures the launch CWD in a `OnceLock`, honors
`AITC_REPO_OVERRIDE` for dev, and detects the git root by walking parent
directories for `.git` — **in pure Rust**, never by shelling out to
`git rev-parse`. This is a deliberate replacement (CR-02); `git` in an
attacker-controlled tree is an RCE surface via `core.fsmonitor` /
`core.hooksPath` (CVE-2022-41953, CVE-2024-32002 family).

### Frontend (`src/`)

**Views** are one per domain, each in its own directory:
`Radar/`, `TowerControl/`, `CommsHub/`, `Conflicts/`, `History/`, `Arsenal/`.
Root-level `*View.tsx` files are thin re-exports.

**Stores** follow a strict one-per-domain Zustand pattern:
`pipelineStore`, `agentStore`, `conflictStore`, `commsStore`, `chatStore`,
`radarStore`, `claudeResourcesStore`, `historyStore`, `repoStore`,
`paletteStore`, `sidebarStore`. No cross-store imports; cross-domain state
moves through Tauri events.

**Workers.** One worker: `graphSim.worker.ts` runs d3-force off the main
thread. The protocol is a discriminated union in `graphSimProtocol.ts`.
Positions cross the worker boundary as a transferable `ArrayBuffer` so we
don't copy on every tick.

**Integration hooks** are the bridge between React and managed Rust state:
`usePipelineChannel` (constructs the `Channel<FileEventBatch>` and passes it
to `start_watch`), `useClaudeResourcesChannel` (same pattern for ARSENAL),
`useChatChannel` (nine event subscriptions for the chat runtime),
`useGraphLayout` (drives the d3-force worker), `useCanvasZoomPan` (raw wheel
handlers for the radar — no react-konva on the hot path).

### Sidecar (`src-tauri/aitc-hook/`)

A separate workspace crate, bundled as a Tauri `externalBin`. Release profile:
`opt-level = "z"`, `lto = true`, `strip = true`, `panic = "abort"` — this
binary runs on every single Claude tool call.

Flow: Claude Code writes a `PreToolUse` JSON to the sidecar's stdin. The
sidecar resolves AITC's port (`AITC_PORT` env → `AITC_PORT_FILE_OVERRIDE` →
`~/.aitc/port`), POSTs a `HookRequest` to `http://127.0.0.1:{port}/hook`, and
translates AITC's `AitcDecision` into Claude's modern
`hookSpecificOutput.permissionDecision` envelope on stdout. `bypassPermissions`
short-circuits to Allow without contacting AITC — the
`--dangerously-skip-permissions` carve-out.

## Invariants

Rules that must not be broken. Most of these have cost blood to establish;
they're not style preferences.

- **Frontend never writes SQLite directly.** `tauri-plugin-sql` is granted
  `allow-select` but every mutation routes through a `#[tauri::command]`.
  (See `capabilities/default.json`; CLAUDE.md tech-stack row on
  `tauri-plugin-sql`.)
- **`src/bindings.ts` is generated. Never edit it.** Banner on line 5,
  `// @ts-nocheck` header, regenerated on every debug build by `tauri-specta`
  (`lib.rs:139-147`). If you need a new DTO on the TS side, add it to the
  `.typ::<T>()` chain in `lib.rs`.
- **One watcher per domain.** The main pipeline has exactly one `ActiveWatch`;
  `start_watch` drops the previous. ARSENAL runs its own separate Debouncer
  (`claude_resources/commands.rs`). Multi-repo support is deferred
  (`pipeline/pipeline_state.rs:13`).
- **The sidecar fails closed.** Every error path in `aitc-hook/src/main.rs`
  exits with code 2 and no stdout. Claude treats exit 2 + stderr as
  "block this call." If AITC is down, nothing ships. The only carve-out is
  `bypassPermissions` (Pitfall 1 + README commit `06fbf1e`).
- **Never emit the deprecated top-level `decision`/`reason` hook envelope.**
  Only `hookSpecificOutput.permissionDecision` is allowed. Test
  `envelope_never_contains_deprecated_decision_field` in
  `aitc-hook/tests/envelope_shapes.rs` guards against regression.
- **Full PIDs everywhere.** Never truncate PIDs with `% 10000` — this broke
  passive→launched reconciliation on modern OSes with PIDs > 10k
  (`hook_waiters.rs:16`, `self_register.rs:437-440`).
- **Atomic `WHERE status='pending'` on approval writes.** `AbandonGuard`
  (`self_register.rs:350-394`) and every approve/deny path gate on the row's
  current status so a race between client-disconnect and user-resolve can't
  clobber a decision (T-08-02).
- **Loopback only.** The axum server binds `127.0.0.1:{port}`. Never
  `0.0.0.0`. PID liveness checked on every `/register` and `/hook` (T-03-04 /
  T-08-03).
- **Pure-Rust `.git` detection.** `detect_git_root` walks parent directories;
  never shells to `git`. The old code path is an RCE surface in
  attacker-controlled trees (CR-02 in `repo_session.rs:32-51`).
- **Hand-merge `settings.local.json`, don't JSON-merge-patch it.** RFC 7396
  replaces arrays wholesale and will clobber user hook entries
  (`hook_install.rs:6-7`).
- **Synchronous DB init.** `lib.rs:205-217` uses `block_on` to finish
  migrations and manage the pool before any command fires (CR-01). Do not
  "clean this up" by spawning.
- **`chat_messages` + `ChatMessage` are dead.** Migration `006_agent_events`
  deletes the table; Phase 10 D-21 replaced them with `agent_events` + the
  `AgentEvent` DTO (`comms/types.rs:27-31`). Don't re-add without reverting
  Phase 10.
- **Agent adapters, not per-agent code.** New agents implement
  `AgentAdapter`. No `if agent_type == "claude_code" { … }` branches in
  view code; hide UI behind `adapter.capabilities()`. (Stated in CLAUDE.md
  constraints; evidenced by `agents/commands.rs:73` branching on
  `chat_duplex`.)

## Cross-cutting concerns

**Errors.** Rust commands return `Result<T, String>` at the IPC boundary.
Internal helpers use `?` with `String`-typed errors; the sidecar uses
`anyhow` because it's a standalone binary. Every frontend store carries an
`error: string | null` field and wraps `invoke()` calls in try/catch — no
global error boundary.

**Logging.** Rust uses `tracing` with `EnvFilter`, writing to stderr. Set
`RUST_LOG=aitc_lib=debug` for verbose. Frontend uses bare `console.*` —
there is no structured logger or telemetry sink.

**Config.** Three locations:
- `~/.aitc/port` — runtime port discovery for the sidecar (atomic
  tmp-then-rename, RAII removal on app Drop).
- `<app_data_dir>/aitc.db` — SQLite. The `app_settings` k/v table holds
  `pretool_gated_tools` (JSON array) and `last_repo_root`.
- `<cwd>/.claude/` — per-repo `settings.local.json` for hook install,
  `aitc-mcp-<agent_id>.json` per spawn for MCP config.

Env overrides: `AITC_REPO_OVERRIDE` (dev — point at a scratch repo),
`AITC_SIDECAR_PATH` (set by the app at startup for `claude_code::launch`),
`AITC_PORT` / `AITC_PORT_FILE_OVERRIDE` (sidecar + tests).

**Testing.** Frontend: Vitest + jsdom, colocated `__tests__/` under every
module. Rust: inline `#[cfg(test)] mod tests` plus integration tests in
`src-tauri/tests/` and `src-tauri/aitc-hook/tests/` (some `#[ignore]` because
they touch the filesystem for real). Manual UAT at `tests/manual/`.

**Security boundaries.** Summarized above as invariants. Tauri capabilities
(`src-tauri/capabilities/default.json`) are a tight allowlist — shell plugin
restricted to `binaries/aitc-hook` with `sidecar: true`. CSP in
`tauri.conf.json` forbids inline scripts and external `connect-src`.

## Architecture Decisions

This project doesn't use formal ADRs. The rationale layer lives in
`.planning/phases/NN-*/` — each phase has research, context, plan, and
verification artifacts, and the prose above references phase IDs (D-NN,
T-NN-NN, WR-NN, CR-NN, HIST-NN) that resolve into those folders.

If you're reading this document to orient yourself and want the "why" for
any rule above:

- Start at `.planning/STATE.md` for the current phase index.
- Browse `.planning/phases/08-*/` for the PreToolUse hook rationale,
  `10-*/` for chat-runtime, `11-*/` for the d3-force worker, `17-*/` for
  the conflict-triggered gating draft, `18-*/` for the registry-flooding
  fix, `19-*/` for chat transcript polish, `20-*/` for diff-aware polling.
- `README.md` has the high-level pitch plus the full roadmap table.
- `CLAUDE.md` has the tech-stack table with confidence scores.

If you add an accepted ADR later (`docs/adr/`), update the Invariants section
to reference it alongside the phase ID. Until then, phase artifacts are the
canonical "why."
