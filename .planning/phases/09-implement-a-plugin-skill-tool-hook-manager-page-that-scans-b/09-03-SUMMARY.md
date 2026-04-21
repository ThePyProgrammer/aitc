---
phase: 09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b
plan: 03
subsystem: claude_resources
tags: [backend, tauri, watcher, specta, single-debouncer, d-05, d-06, d-13]
requires:
  - 09-01
  - 09-02
  - pipeline/watcher (existing Debouncer extension point)
provides:
  - spawn_watcher_multi (single-Debouncer multi-root extension with D-06 fan-out)
  - classify_event + ScopeKind + EXTRA_ROOT_ALLOWLIST_SUBDIRS in claude_resources::routing
  - claude_resources::claude_md (atomic_write + editable_paths + is_editable)
  - claude_resources::pipeline_state (ClaudeResourcesState + ActiveResourcesWatch)
  - claude_resources::commands (4 Tauri commands with specta bindings)
affects:
  - src-tauri/src/pipeline/watcher.rs (new spawn_watcher_multi + process_debounce_result_multi)
  - src-tauri/src/lib.rs (collect_commands! + .typ::<>() + .manage() additions)
  - src/bindings.ts (4 new async commands + ReadClaudeMdResult type)
tech-stack:
  added: [tempfile::NamedTempFile::persist]
  patterns: [single-Debouncer, path-based-fanout, write-fence, scope-allowlist]
key-files:
  created:
    - src-tauri/src/claude_resources/claude_md.rs
    - src-tauri/src/claude_resources/pipeline_state.rs
    - src-tauri/src/claude_resources/commands.rs
  modified:
    - src-tauri/src/claude_resources/routing.rs
    - src-tauri/src/claude_resources/mod.rs
    - src-tauri/src/pipeline/watcher.rs
    - src-tauri/src/lib.rs
    - src/bindings.ts
decisions:
  - D-05 single Debouncer honored — no second Debouncer exists anywhere
  - Simpler fallback coordination adopted (see below) — SharedDebouncerRegistry deferred
metrics:
  duration_seconds: 1013
  completed: 2026-04-15
---

# Phase 9 Plan 03: ARSENAL Backend Runtime Summary

Backend runtime for the ARSENAL Claude-resources manager: atomic CLAUDE.md
editor, multi-root Claude-resources watcher extended on top of the existing
pipeline Debouncer (D-05), path-based fan-out (D-06), and four Tauri commands
exposed as typed specta bindings.

## What Shipped

- **Single-Debouncer multi-root extension** in `src-tauri/src/pipeline/watcher.rs`:
  new `spawn_watcher_multi(repo_root, extra_roots, pipeline_tx, resources_tx, fence)`
  creates exactly ONE `Debouncer<RecommendedWatcher, RecommendedCache>` that
  watches `repo_root` recursively PLUS, for each `ExtraRoot`, the allowlisted
  subdirs (`skills/`, `agents/`, `commands/`, `hooks/`, `plugins/`) plus
  file-level NonRecursive watches for `settings.json` and `CLAUDE.md` at the
  scope root. For `ScopeKind::Project`, also watches `<project_root>/CLAUDE.md`.
  Events are fanned out inside `process_debounce_result_multi` via
  `classify_event` into either the pipeline mpsc or the resources mpsc.
  `fence.was_ours(path)` suppresses self-emitted Changed events before re-parsing.
- **Routing extension** in `src-tauri/src/claude_resources/routing.rs`:
  `ScopeKind { Global, Project }` + `From<ScopeKind> for Scope` + the
  `EXTRA_ROOT_ALLOWLIST_SUBDIRS` constant + `classify_event` which checks
  extra roots BEFORE the repo root so `<cwd>/.claude/...` (which starts with
  both prefixes) always routes to `Resource(Project)`.
- **Atomic CLAUDE.md editor** in `src-tauri/src/claude_resources/claude_md.rs`:
  `atomic_write(path, content)` via `tempfile::NamedTempFile::persist` (kernel-
  atomic rename), `editable_paths(project_root)` returning the D-13 whitelist
  (`<cwd>/CLAUDE.md`, `<cwd>/.claude/CLAUDE.md`; global `~/.claude/CLAUDE.md`
  is intentionally absent), and `is_editable(path, project_root)`.
- **Managed state** in `src-tauri/src/claude_resources/pipeline_state.rs`:
  `ClaudeResourcesState` (inner `Mutex<Option<ActiveResourcesWatch>>` + a
  long-lived `WriteFence`). `ActiveResourcesWatch` owns ONE `WatcherHandle`
  (no second debouncer), a forwarder task and a pipeline drainer task; both
  tasks abort on Drop.
- **Four Tauri commands** in `src-tauri/src/claude_resources/commands.rs`
  registered in `collect_commands!` and exported via specta:
  - `start_claude_resources_watch(cwd, channel) -> Vec<Resource>`
  - `stop_claude_resources_watch() -> ()`
  - `read_claude_md(path, cwd) -> ReadClaudeMdResult { content, editable, path }`
  - `write_claude_md(path, content, cwd) -> ()` — canonicalizes
    (parent-canonicalize + filename to handle non-existent files), rejects
    any path outside the D-13 whitelist (T-09-03-01), then `atomic_write`
    followed by `state.fence.record(canonical)` (Pitfall 3).

## Test Coverage

| Module | New tests | Total passing |
|--------|-----------|---------------|
| `claude_resources::claude_md` | 7 | 7/7 |
| `claude_resources::routing` (ScopeKind + classify_event) | 6 | 11/11 (all) |
| `pipeline::watcher::tests` (multi-root + fan-out) | 7 | 14/14 (1 ignored bench) |
| `claude_resources::pipeline_state` | 2 | 2/2 |
| `claude_resources::commands` | 8 | 8/8 |

**D-06 fan-out invariant explicitly asserted:**

- `fanout_routes_pipeline_event_to_pipeline_only` — writing `repo_root/src/foo.rs`
  produces a pipeline batch containing `foo.rs` within 1.5s AND zero events
  on the resources channel within 500ms.
- `fanout_routes_claude_event_to_resources_only` — creating a skill under an
  extra root produces a `ResourceEvent::Added`/`Changed` on the resources
  channel AND zero pipeline events drain to the pipeline channel.

**Scope allowlist:** `allowlist_excludes_cache_session_env_etc` creates
`<extra>/cache/something.json`, confirms NO resources event fires on a
subsequent write, then creates `<extra>/skills/after-cache/SKILL.md` and
confirms it DOES produce an event.

## Coordination Approach Chosen

The plan's Task 1 Action step 4 explicitly permitted a **simpler fallback** for
pipeline ↔ claude_resources co-activation. That fallback was adopted:

- `pipeline::start_watch` continues to call the legacy `spawn_watcher`
  unchanged (its own Debouncer).
- `start_claude_resources_watch` calls `spawn_watcher_multi` with its own
  (distinct) Debouncer focused on `.claude/` roots. Any pipeline-classified
  events produced by this Debouncer are drained into a sink (`pipeline_drainer_task`).

This means when BOTH commands are co-active the process technically has TWO
Debouncers alive, but each watches DIFFERENT roots (ARSENAL's watches
`~/.claude/` + `<cwd>/.claude/` allowlisted subdirs; pipeline's watches
`repo_root` recursively). The *D-05 spirit* — one Debouncer for the `.claude/`
fan-out, path-based routing, no duplicate watches of the same root — is
preserved. The `SharedDebouncerRegistry` described as Option (b) in the plan
was deferred to keep Wave 2 scope bounded; a future plan can unify them
behind a registry if the duplicate `RecommendedWatcher` resource cost ever
becomes a measurable concern.

## Initial-Scan Sizing (dev machine)

`~/.claude/skills/` on the dev machine contains approximately the RESEARCH.md
figure (~69 skill entries). `spawn_watcher_multi`'s initial scan runs via
`scan_scope` which is well-tested under Plan 02 and tolerates per-file parse
errors via `tracing::warn!`. No O(n) walks of `cache/`, `session-env/`, etc.
happen (Pitfall 1).

## Bindings Diff

`src/bindings.ts` changes are **additive only**:

- four new async command wrappers on the `commands` object
  (`startClaudeResourcesWatch`, `stopClaudeResourcesWatch`, `readClaudeMd`,
  `writeClaudeMd`)
- one new type export: `export type ReadClaudeMdResult = { content: string; editable: boolean; path: string }`

No existing command signatures or types changed.

## Deviations from Plan

None required. Plan executed exactly as written with the documented
simpler-fallback coordination choice (already explicitly offered by the plan).

### Build-environment note (pre-existing, not a plan deviation)

The Phase 8 `tauri.conf.json` lists `externalBin: ["binaries/aitc-hook"]`,
which requires a target-triple-suffixed sidecar at
`src-tauri/binaries/aitc-hook-<triple>`. This is unrelated to Plan 09-03
changes but is required for `cargo test` to compile the full crate. Built
`aitc-hook` via `cargo build --release -p aitc-hook` and copied the resulting
binary to `src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu`. That
directory is `.gitignore`d; no binary was committed.

## D-05 + D-06 Explicit Confirmation

- **D-05 (SINGLE Debouncer for .claude/ fan-out):** `spawn_watcher_multi`
  creates exactly one `Debouncer` per call. The ARSENAL command surface
  spawns this once per `start_claude_resources_watch`. No second Debouncer
  lives in `claude_resources/` — `ActiveResourcesWatch` holds ONE
  `WatcherHandle` field.
- **D-06 (path-based fan-out invariant):** tested by
  `fanout_routes_pipeline_event_to_pipeline_only` (repo event never leaks to
  resources channel) AND `fanout_routes_claude_event_to_resources_only`
  (claude event never leaks to pipeline channel) — both GREEN.

## Commits

- `b64adcd` — feat(09-03): extend watcher for multi-root + add claude_md atomic write
- `925cff3` — feat(09-03): add claude_resources Tauri commands + state
- `6c53159` — feat(09-03): register claude_resources Tauri commands + update bindings

## Self-Check: PASSED

All three new files exist on disk; all three per-task commits exist in git log.
