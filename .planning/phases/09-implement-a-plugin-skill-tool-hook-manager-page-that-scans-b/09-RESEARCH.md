# Phase 9: ARSENAL (Plugin / Skill / Tool / Hook Manager) - Research

**Researched:** 2026-04-15
**Domain:** Tauri v2 + React 19 desktop UI, notify-debouncer-full multi-root watching, YAML-frontmatter parsing in Rust, atomic CLAUDE.md edits with undo + external-change reconciliation
**Confidence:** HIGH (stack), HIGH (watcher extension), MEDIUM-HIGH (frontmatter shapes — verified against live filesystem + Anthropic docs), MEDIUM (CodeMirror 6 vs textarea — Claude's discretion call)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-15 — research these, do not propose alternatives)

**Resource Scope & Taxonomy**
- **D-01:** Surface four categories: Skills, Agents, Plugins, Configuration (Hooks + Commands + Settings + MCP bundled).
- **D-02:** Scope view uses **tabs**: Global | Project | Combined. Each tab shows the same category list filtered to that scope.
- **D-03:** When a project resource shadows a global resource of the same name, **show only the active (project) one**. Shadowed global row is hidden in v1, no annotation.
- **D-04:** Each resource row displays: name + one-line description + scope chip (GLOBAL/PROJECT) + full path. Click row → right detail panel.

**Watcher Integration**
- **D-05:** Extend the **existing pipeline watcher** (`src-tauri/src/pipeline/watcher.rs`) to add `~/.claude/` and `<cwd>/.claude/` as additional watch roots. Single Debouncer keeps the 150ms aggressive-debounce / RecommendedCache behavior.
- **D-06:** Events get **routed by path inside the pipeline**. Code-file events keep flowing into `pipelineStore` unchanged. Events under a `.claude/` root fan out into a **separate Channel<T> → `claudeResourcesStore`**. Two domains never mix in one ring buffer.
- **D-07:** **Rust backend parses** all resource formats (SKILL.md frontmatter, agent .md frontmatter, plugins/installed_plugins.json, settings.json, hook scripts (path/name only), commands/*.md, MCP configs). Backend pushes typed structs over the channel via tauri-specta. Frontend never parses YAML/JSON for these.
- **D-08:** Refresh strategy is **incremental**: a debounced batch identifies the changed files and only those rows are re-parsed. Initial mount does a single full scan to seed both scopes.

**Page Layout & Navigation**
- **D-09:** Layout is **master/detail** (left rail / center list / right detail panel).
- **D-10:** New top-level sidebar item **ARSENAL**, route `/arsenal`, position **after TOWER**. Final order: RADAR / TOWER / ARSENAL / COMMS / CONFLICTS / HISTORY.
- **D-11:** **Inline filter input per category** — text field above the row list filters the current category. No global cross-category search in v1.

**CLAUDE.md Editing UX**
- **D-12:** Editor is **inline in the right detail panel** with Save and Discard buttons. No modal, no system-editor handoff.
- **D-13:** Editable CLAUDE.md files: `<cwd>/CLAUDE.md` and `<cwd>/.claude/CLAUDE.md` only. `~/.claude/CLAUDE.md` is read-only this phase.
- **D-14:** Save flow: **direct save with undo toast**. Save writes immediately; non-blocking toast offers Undo for ~10 seconds.
- **D-15:** External-change conflict: when watcher reports an external write to a CLAUDE.md the user is currently editing (with unsaved changes), show a **non-blocking banner above the editor** with **Reload** / **Keep mine** / **View diff**.

### Claude's Discretion (research options, recommend)
- Exact UI primitives — textarea vs CodeMirror/Monaco for the editor. Recommend evaluating CodeMirror 6 since it's lightweight and matches the thin-stroke aesthetic better than Monaco.
- Toast component implementation — reuse existing toast system if one exists, else thin Motion-based toast.
- Detail-panel resize/collapse behavior.
- Empty-state copy when a category has zero resources in the selected scope.
- Sidebar icon for ARSENAL — pick from Lucide (`Package`, `Boxes`, `Wrench`, `Layers`).
- Whether `claudeResourcesStore` is one store with category selectors, or four sub-stores. Recommend single store for parity with `pipelineStore`.

> **UI-SPEC overrides:** the UI design contract has already locked several discretion items: Lucide `Package` for sidebar icon, single store, and **textarea (not CodeMirror) for the editor — CodeMirror deferred** (`ClaudeMdEditor.tsx` row in UI-SPEC component inventory). Research below evaluates CodeMirror 6 for completeness so a future phase can revisit, but the planner MUST build textarea per UI-SPEC.

### Deferred Ideas (OUT OF SCOPE — do not plan)
- Installing/removing/enabling/disabling plugins from the page (read-only inventory only)
- Authoring/scaffolding new hooks, skills, commands from the page
- Editing `~/.claude/CLAUDE.md` (global) — read-only this phase
- Editing settings.json, hook scripts, slash commands, MCP configs — read-only
- Detecting/visualizing project-shadows-global override conflicts
- 3-way merge UI for CLAUDE.md external-conflict resolution (banner offers Reload/Keep mine/View diff; the diff is read-only)
- Audit trail for CLAUDE.md edits
- Nested CLAUDE.md files in subdirectories
- Global cross-category search bar
</user_constraints>

## Project Constraints (from CLAUDE.md)

Directives extracted from `./CLAUDE.md` that the planner MUST honor:

| Directive | Source |
|----------|--------|
| Use **Tauri v2** (≥2.10) — IPC via `tauri-specta` for type-safe Rust↔TS bindings | CLAUDE.md → Tech Stack |
| Use **React 19.2**, **TypeScript 5.7+**, **Vite 8** | CLAUDE.md |
| State via **Zustand 5** (single store per domain, selector-based subscriptions) | CLAUDE.md |
| Styling via **Tailwind v4 `@theme`** tokens — never hex literals; zero-radius global rule | CLAUDE.md + UI-SPEC |
| Icons via **Lucide React** with `strokeWidth={1.5}` | CLAUDE.md + UI-SPEC |
| Animations via **Motion v12** (`AnimatePresence`, layout) | CLAUDE.md |
| Lists via **`@tanstack/react-virtual`** (already at ^3.13.23) | CLAUDE.md + UI-SPEC |
| Filesystem watching via **`notify` 8 + `notify-debouncer-full` 0.7** (already in Cargo.toml) | CLAUDE.md + Cargo.toml |
| SQLite via **`sqlx` 0.8** — but Phase 9 has **no DB writes** (in-memory undo, ephemeral state) | CLAUDE.md (not used here) |
| **Backend parses, frontend renders** — keep types via tauri-specta | CLAUDE.md + D-07 |
| **Tauri-specta `collect_commands!`** auto-syncs TS bindings — never hand-edit `src/bindings.ts` | `src-tauri/src/lib.rs` |
| Master/detail is **new** — establish a reusable primitive (`MasterDetailShell.tsx`) for future views | UI-SPEC + code_context |
| `RepoSessionProvider` is the source of `<cwd>` for the project-scope watcher | Phase 6 + AppShell.tsx |
| Channel<T> over `app.emit()` for high-throughput streaming (Phase 2 lock-in) | code_context |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| — | **No phase requirement IDs.** Phase 9 was added mid-milestone (`State.md → Roadmap Evolution`), and `phase_req_ids` is null. Plan frontmatter MUST set `requirements_addressed: []` — do **not** invent fake IDs. | n/a |

The phase still has a sharp behavioral spec (D-01..D-15 + UI-SPEC). Treat those as the implementation contract instead of REQ-IDs.

## Summary

ARSENAL is a read-only inventory page over Claude's resources at `~/.claude/` (global) and `<cwd>/.claude/` (project), plus an inline editor for two CLAUDE.md files. Every architectural piece has a precedent already shipped in the codebase:

- **Watcher:** `notify-debouncer-full` 0.7 supports calling `.watch(path, RecursiveMode::Recursive)` multiple times on a single Debouncer instance — events from all roots arrive on the one callback. The existing `spawn_watcher` (`src-tauri/src/pipeline/watcher.rs:58`) just needs an extension that takes an additional list of `extra_roots: Vec<PathBuf>` and calls `.watch()` on each, plus a path-based router on the consumer side that fans events into either `pipelineStore` (under `repo_root`) or `claudeResourcesStore` (under any `.claude/` root). Two existing pitfalls already handled — Windows RDCW debounce, FileIdCache rename coalescing — apply unchanged.
- **Channel:** Replicate the Phase 2 trio one-for-one (`useClaudeResourcesChannel.ts` + `claudeResourcesStore.ts` + new Tauri commands). The channel carries a typed `ResourceEvent { added | removed | changed; resource: Resource }` rather than raw file events, because all parsing happens in Rust per D-07.
- **Parsing:** `gray_matter` (24k downloads/month, MIT, deserializes to serde structs) for SKILL.md / agent.md / commands/*.md frontmatter. `serde_json` (already in deps) for installed_plugins.json + settings.json. No new YAML-only crate needed; gray_matter wraps `serde_yaml`.
- **CLAUDE.md editor:** UI-SPEC explicitly chose a `<textarea>` over CodeMirror for v1 (minimal-surface principle). This research validates that decision is sound — `@uiw/react-codemirror` v4 + `@codemirror/lang-markdown` 6.5 would add ~150-200KB gzipped for limited gain on what is essentially long-form prose with occasional fenced code. CodeMirror is documented as a deferred upgrade path.
- **Atomic save + undo:** Use `tempfile::NamedTempFile::persist()` for atomic writes (battle-tested, cross-platform). Backend keeps a write-fence registry — paths AITC just wrote keep a TTL token; the watcher router checks it before flagging an event as "external."

**Primary recommendation:** Build a new `claude_resources/` Rust module (mirror `pipeline/`'s shape), add an `extra_roots` parameter to `spawn_watcher` (or add a sibling `start_resources_watch` that owns its own Debouncer for cleaner lifecycle isolation — see Open Question 2), wire a path-router fanout, parse with gray_matter + serde_json on the backend, deliver typed `ResourceEvent` via Channel<T>, mirror `pipelineStore` for `claudeResourcesStore`, and ship `MasterDetailShell` as a reusable layout primitive.

## Standard Stack

### Core (already in repo — no install)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `notify` | 8.x [VERIFIED: src-tauri/Cargo.toml] | Cross-platform FS events | De facto Rust watcher; already in stack |
| `notify-debouncer-full` | 0.7 [VERIFIED: Cargo.toml; pairs with notify 8] | Debouncing + FileIdCache rename coalescing | Existing watcher uses it; supports multi-`watch()` calls on one Debouncer [CITED: docs.rs/notify-debouncer-full + notify-rs examples/debouncer_full.rs] |
| `serde` + `serde_json` | 1.x [VERIFIED: Cargo.toml] | (De)serialize installed_plugins.json, settings.json, IPC payloads | Already pervasive |
| `tauri-specta` / `specta` | 2.0.0-rc.21 / rc.22 [VERIFIED: Cargo.toml] | Type-safe IPC bindings | Already used; new commands & types just register here |
| `tokio` | 1.x [VERIFIED] | Async runtime, mpsc channels | Already pervasive |
| `tracing` | 0.1 [VERIFIED] | Structured logging | Already pervasive |
| `chrono` | 0.4 (with serde) [VERIFIED] | ISO timestamps in installed_plugins.json | Already used elsewhere |
| `tempfile` | 3.x [VERIFIED: dev-dependencies; promote to runtime dep] | Atomic CLAUDE.md writes via `NamedTempFile::persist()` [CITED: docs.rs/tempfile] | Already in dev-dependencies — promote to `[dependencies]` |
| `lucide-react` | ^1.7 [VERIFIED: package.json] | Icons (`Package`, `FileCode2`, `Bot`, `Boxes`, `Settings2`, `Lock`, `AlertCircle`, `RotateCcw`) | Existing icon system; UI-SPEC names every icon |
| `motion` | ^12 [VERIFIED: package.json] | Toast entrance/exit (`AnimatePresence`), banner slide, list `layout` prop | Already used in app for phosphor transitions |
| `@tanstack/react-virtual` | ^3.13.23 [VERIFIED: package.json] | Virtualized resource list (estimateSize 56) | Already in stack — UI-SPEC ResourceList pattern |
| `zustand` | ^5.0 [VERIFIED] | `claudeResourcesStore` | Mirror `pipelineStore` exactly |

### New (must add)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `gray_matter` | 0.2.x [VERIFIED: lib.rs/crates/gray_matter — 24k dl/month, 57 dependents] | Parse YAML frontmatter from SKILL.md, agents/*.md, commands/*.md into typed structs via serde derive | Battle-tested Rust port of jonschlinkert/gray-matter; supports YAML/JSON/TOML; pairs cleanly with serde_yaml under the hood [CITED: docs.rs/gray_matter] |
| `serde_yaml` | optional, transitive via gray_matter | YAML parsing | gray_matter pulls it; rarely needed standalone |

### Frontend additions
| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| **None required for v1** | — | UI-SPEC chose textarea for `ClaudeMdEditor.tsx` | CodeMirror evaluation kept in "Alternatives Considered" for the future-phase upgrade |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single shared Debouncer with extra `.watch()` calls | Two independent Debouncers (one per scope class) | Two Debouncers = cleaner teardown lifecycle on repo change, but doubles the OS-thread + tokio task count. The single-Debouncer approach is recommended (see Architecture Pattern 2). |
| `gray_matter` | `yaml-front-matter` (~9k dl/month) or hand-roll `serde_yaml` + `---` split | gray_matter is more maintained and supports JSON/TOML frontmatter for free if users adopt them later. yaml-front-matter is leaner but YAML-only. [CITED: lib.rs] |
| `tempfile::persist()` | `atomic-write-file` crate, or `atomicwrites` | All three implement the same write-temp-then-rename pattern; tempfile is already in dev-deps so promotion is free. [CITED: docs.rs/atomic-write-file, docs.rs/tempfile] |
| `<textarea>` | `@uiw/react-codemirror` 4.x + `@codemirror/lang-markdown` 6.5 | CodeMirror gives syntax highlighting + folding for ~150-200KB gz, React-19-compatible. **Deferred per UI-SPEC `ClaudeMdEditor.tsx` row** ("textarea, not CodeMirror, per minimal-surface principle"). [CITED: npm @uiw/react-codemirror, @codemirror/lang-markdown 6.5.0] |
| Frontend keeps undo snapshot | Backend keeps undo snapshot in a `RwLock<HashMap<PathBuf, UndoSnapshot { content, expires_at }>>` | Frontend-side is simpler — the `ClaudeMdEditor` already has the pre-save string in memory; on UNDO it just calls `write_claude_md` again with that string. **Recommend frontend.** Backend snapshot is only needed if undo must survive page navigation; UI-SPEC shows the toast lives in the view, so frontend is sufficient. |

**Installation:**
```bash
# Rust (src-tauri)
cargo add gray_matter
# Promote tempfile from dev-dep to runtime dep (edit Cargo.toml manually)

# Frontend: nothing new this phase
```

**Version verification (run before committing Cargo.toml change):**
```bash
cargo search gray_matter --limit 1
# Confirm published version + date; pin to exact "x.y" minor
```

## Architecture Patterns

### Recommended Project Structure

```
src-tauri/src/
├── claude_resources/                  # NEW module — mirror pipeline/
│   ├── mod.rs                          # re-exports
│   ├── commands.rs                     # list_claude_resources, read_claude_md,
│   │                                   #   write_claude_md, start_resources_watch (or merged into start_watch)
│   ├── events.rs                       # ResourceEvent, Resource, Scope, Category enums
│   ├── parse.rs                        # parse_skill, parse_agent, parse_command, parse_settings,
│   │                                   #   parse_installed_plugins, parse_hook_script_metadata
│   ├── scan.rs                         # initial-scan walker (knows the canonical .claude/ subtree shape)
│   ├── routing.rs                      # path → category, path → scope helpers
│   ├── undo_registry.rs                # OPTIONAL — only if backend-side undo is chosen (see Discretion)
│   └── write_fence.rs                  # AITC's-own-write registry (suppresses external-change banner)
└── pipeline/
    └── watcher.rs                      # EXTEND with optional `extra_roots: &[PathBuf]` parameter
                                         # OR keep untouched and let claude_resources own its own Debouncer
                                         # (see Open Question 2)

src/
├── views/
│   └── Arsenal/                        # NEW
│       ├── ArsenalView.tsx             # mounts useClaudeResourcesChannel, routes selection
│       ├── ScopeTabs.tsx
│       ├── CategoryRail.tsx
│       ├── ResourceList.tsx            # @tanstack/react-virtual, estimateSize 56
│       ├── ResourceRow.tsx
│       ├── ScopeChip.tsx
│       ├── DetailPanel.tsx
│       ├── FrontmatterTable.tsx
│       ├── ContentPreview.tsx
│       ├── ClaudeMdEditor.tsx          # textarea + Save/Discard
│       ├── ExternalChangeBanner.tsx
│       └── UndoToast.tsx
├── components/layout/
│   └── MasterDetailShell.tsx           # NEW reusable primitive (rail / list / detail slots)
├── stores/
│   └── claudeResourcesStore.ts         # Zustand, single store, category selectors
└── hooks/
    └── useClaudeResourcesChannel.ts    # mirror usePipelineChannel.ts
```

### Pattern 1: Single Debouncer, multi-root, path-router fanout (recommended for D-05/D-06)

**What:** One `Debouncer<RecommendedWatcher, RecommendedCache>` watches `repo_root`, `~/.claude/`, and (when a project is open) `<cwd>/.claude/`. The existing `process_debounce_result` function is split so its post-filter step routes each event into one of two output mpsc channels based on path prefix.

**When to use:** When all three roots have the same debounce/cache requirements (which they do — 150ms, FileIdCache rename coalescing).

**Why:** `notify-debouncer-full`'s `Debouncer::watch(path, RecursiveMode::Recursive)` can be called multiple times; events from all watched paths arrive through the same callback [CITED: docs.rs/notify-debouncer-full latest, notify-rs/notify examples/debouncer_full.rs]. Running one Debouncer keeps OS thread count and tokio task count bounded.

**Example sketch (illustrative — adapt to existing `spawn_watcher` shape):**
```rust
// Source: pattern derived from src-tauri/src/pipeline/watcher.rs and notify-rs docs
pub struct WatcherOutputs {
    pub handle: WatcherHandle,
    pub repo_initial_tree: HashMap<PathBuf, FileNode>,
    pub claude_initial_resources: Vec<Resource>,
}

pub fn spawn_watcher_multi(
    repo_root: &Path,
    claude_global: &Path,                       // ~/.claude/
    claude_project: Option<&Path>,              // <cwd>/.claude/ (None if not present)
    pipeline_tx: mpsc::Sender<FileEventBatch>,
    resources_tx: mpsc::Sender<ResourceEventBatch>,
) -> Result<WatcherOutputs, String> {
    let mut debouncer = new_debouncer(/* same args as today */)?;
    debouncer.watch(repo_root,    RecursiveMode::Recursive)?;
    debouncer.watch(claude_global, RecursiveMode::Recursive)?;
    if let Some(p) = claude_project {
        debouncer.watch(p, RecursiveMode::Recursive)?;
    }
    // process_debounce_result → router::dispatch(events, &repo_root, &claude_global, claude_project)
    //   - paths under repo_root && NOT under <cwd>/.claude → pipeline_tx
    //   - paths under any .claude/ root → re-parse via parse.rs → resources_tx
    Ok(/* … */)
}
```

### Pattern 2: ResourceEvent envelope (D-07 backend-parses)

**What:** The channel never carries raw file events to the frontend. Instead, the routing layer detects which subtree of `.claude/` a changed file belongs to (skills, agents, plugins, hooks, commands, settings, mcp), re-parses just that one file, and emits a typed event.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResourceEvent {
    Added    { resource: Resource },
    Removed  { id: ResourceId },
    Changed  { resource: Resource },
    /// External write to a CLAUDE.md path the user is currently editing.
    /// Distinct from Changed so the frontend can show the banner per D-15.
    ExternalEdit { path: PathBuf, mtime_ms: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: ResourceId,            // stable id: "{scope}::{category}::{name}"
    pub category: Category,        // Skill | Agent | Plugin | Hook | Command | Settings | Mcp | ClaudeMd
    pub scope: Scope,              // Global | Project
    pub name: String,
    pub description: Option<String>,
    pub path: PathBuf,
    pub metadata: ResourceMetadata, // category-specific (untagged enum or per-variant struct)
}
```

The Channel transport carries `ResourceEventBatch { events: Vec<ResourceEvent>, batch_id, dropped_batches }` to mirror `FileEventBatch`'s back-pressure handling.

### Pattern 3: Frontend-side undo (recommended over backend registry)

**What:** `ClaudeMdEditor` keeps the pre-save string in `useRef`. Save calls `write_claude_md(path, newContent)`. On success, mount `<UndoToast>` for 10s with `onUndo = () => write_claude_md(path, preSaveSnapshot)`. Toast unmounts → undo no longer reachable.

**Why simpler:** No backend state. No TTL cleanup task. Survives the same edit-flow lifecycle as the toast itself. Aligns with UI-SPEC's "no audit trail" deferral.

**Caveat:** Undo must be in the **same browser session** as the save. Acceptable because the toast is the only UI surface for undo.

### Pattern 4: Write-fence (suppress watcher self-events for AITC writes)

**What:** A small `RwLock<HashMap<PathBuf, std::time::Instant>>` in the `claude_resources` module records every path AITC writes. The expected entry TTL is ~2s (well over the 150ms debounce window). When the path-router about to emit a `Changed` for a CLAUDE.md, it checks the registry: if `now < expires_at`, drop the event (we caused it). If `now > expires_at`, emit `ExternalEdit` (per-D-15 the editor decides between silent refresh and banner based on whether the file is currently being edited — that state lives on the frontend in the editor view).

**Implementation sketch:**
```rust
pub struct WriteFence {
    inner: Arc<RwLock<HashMap<PathBuf, Instant>>>,
}
impl WriteFence {
    pub fn record(&self, path: PathBuf) {
        self.inner.write().unwrap().insert(path, Instant::now() + Duration::from_secs(2));
    }
    pub fn was_ours(&self, path: &Path) -> bool {
        match self.inner.read().unwrap().get(path) {
            Some(expiry) => Instant::now() < *expiry,
            None => false,
        }
    }
}
```

`write_claude_md` calls `fence.record(path.clone())` **after** the atomic rename succeeds and **before** returning to the frontend.

### Anti-Patterns to Avoid

- **Walking ~/.claude with the gitignore-aware walker** (`build_walker` from `pipeline/ignore_filter.rs`). The walker enforces `.gitignore` semantics, but `.claude/` is itself often gitignored at the project level — running it through `build_walker` would skip the directory entirely. Use `walkdir::WalkDir` (already a transitive dep via `ignore`) or `std::fs::read_dir` directly with an allowlist of subdirs.
- **Including `~/.claude/cache/`, `~/.claude/session-env/`, `~/.claude/projects/`, `~/.claude/backups/`, `~/.claude/downloads/` in the scan.** Live filesystem inspection (see Runtime State Inventory) shows `cache/` is 224K and `session-env/` regenerates per-session. Filter aggressively in `scan.rs` — only walk known canonical subdirs.
- **Sharing the same `claudeResourcesStore` ring buffer with file events.** D-06 forbids it. Keep two stores.
- **Letting the frontend do YAML parsing.** D-07 forbids it. All `gray_matter` parsing in Rust.
- **Hand-rolling YAML splitting on `---` markers.** Frontmatter formats vary (CRLF, BOM, escaped strings); use gray_matter.
- **Calling `std::fs::write(path, content)` directly for CLAUDE.md saves.** A power-loss mid-write corrupts the file. Use `tempfile::NamedTempFile::new_in(parent_dir)` + write + `persist(&path)`.
- **Using `app.emit()` for resource events.** Phase 2 lock-in (CONTEXT.md `code_context`) — Channel<T> only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom `---` splitter + serde_yaml | `gray_matter` crate | Handles delimiter variants, content body extraction, error reporting |
| Atomic file write | `fs::write` + manual rename | `tempfile::NamedTempFile::persist()` | Cross-platform atomicity is non-trivial; tempfile handles Windows ReplaceFile vs Unix rename(2) |
| Multi-root debouncing | New Debouncer per root, manual coalescing | Single `notify-debouncer-full` Debouncer, multiple `.watch()` calls | Library is built for this exact case |
| Toast countdown timer | `setInterval` + manual cleanup | Motion's `AnimatePresence` + a single `useEffect` with `setTimeout` cleanup | Existing app pattern; AnimatePresence handles exit animation |
| Diff view (for "View diff" action) | Custom diff renderer | `diff` (already in package.json `^8.0.4`) | Already used by Conflicts view |
| Filesystem walking with allowlist | `read_dir` recursion | `walkdir::WalkDir::new(root).into_iter().filter_entry(...)` | Stable, handles symlinks safely |
| Rename event coalescing | Track Remove+Create pairs | Already handled by `RecommendedCache` (FileIdCache) in existing watcher | Pitfall 5 from Phase 2 — solved |

**Key insight:** Every primitive ARSENAL needs already exists either in the repo (Channel<T> trio, Tailwind tokens, Motion patterns, `diff` package) or in a single battle-tested crate (gray_matter, tempfile). The phase is mostly composition.

## Runtime State Inventory

> **Phase 9 is greenfield (new module + new view + reuse existing trios).** This section confirms there is no stale runtime state to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 9 writes no DB rows. The undo snapshot lives in React state and dies with the toast. | None |
| Live service config | None — no plugin/service registers paths matching ARSENAL strings | None |
| OS-registered state | None — no OS scheduler entries reference ARSENAL/Claude resources | None |
| Secrets/env vars | None — settings.json may contain `env` blocks (read-only display); no secret rotation needed | None |
| Build artifacts | None — but `src/bindings.ts` will regenerate when new `#[specta::specta]` commands are added. Run `cargo build` in `src-tauri/` to refresh bindings before frontend imports them. | Document in plan: "Run `cargo build` after registering commands so `src/bindings.ts` regenerates." |

## Common Pitfalls

### Pitfall 1: Linux inotify watch limit (`fs.inotify.max_user_watches`)
**What goes wrong:** Each subdirectory under a recursive watch consumes one inotify watch descriptor. `~/.claude/skills/` on a heavy user (like the developer running this) currently shows **69 skill directories** plus `plugins/cache/` containing nested per-plugin caches. Adding `~/.claude/` recursively could push tens of thousands of watches when combined with the existing repo watch on a large monorepo.
**Why it happens:** Default Ubuntu / many distros: `max_user_watches = 8192`. On hitting the cap, `notify` returns an error from `.watch()` and silently stops emitting events from that point onward [CITED: watchexec.github.io/docs/inotify-limits, intellij-support.jetbrains.com inotify articles].
**How to avoid:**
1. Allowlist subdirs in the watcher itself — call `.watch()` once per known canonical subdir of `~/.claude/` (skills, agents, plugins, hooks, commands) plus the file-level paths for `settings.json` and `CLAUDE.md`. Do **not** recursively watch `~/.claude/cache`, `~/.claude/session-env`, `~/.claude/projects`, `~/.claude/backups`, `~/.claude/downloads`.
2. Catch `notify::Error` from `.watch()` calls and surface a tracing::warn rather than failing the whole watcher.
3. Optional: detect inotify errors and surface a one-time toast suggesting `sudo sysctl -w fs.inotify.max_user_watches=524288`.

**Warning signs:** Resource events stop arriving on Linux while file events keep working (different watch root reaching the cap independently).

### Pitfall 2: Windows ReadDirectoryChangesW (RDCW) overflow under burst writes
**What goes wrong:** When a plugin install triggers a burst of file creations under `~/.claude/plugins/cache/...`, RDCW's per-watch buffer can overflow.
**Why it happens:** Already documented in `pipeline/watcher.rs` (Pitfall 1 reference) — the existing 150ms aggressive debounce mitigates it.
**How to avoid:** Inherit the existing 150ms `DEBOUNCE_TICK_MS` constant. Do **not** create a separate Debouncer with different timings — that re-introduces the very problem the existing one solved.
**Warning signs:** `dropped_batches` counter incrementing in the resources channel.

### Pitfall 3: Self-write feedback loop (saving CLAUDE.md triggers a "changed" event for ourselves)
**What goes wrong:** Without a write-fence, every `write_claude_md` triggers a watcher event 50-150ms later, the resources channel emits `Changed`, the editor view sees its own write as "external," shows the banner, user confused.
**Why it happens:** Filesystem watchers don't know which process wrote the file (especially on Linux/macOS without ETW-style attribution).
**How to avoid:** Implement Pattern 4 (Write-fence). Record the path immediately after `persist()` succeeds; check the registry before emitting `ExternalEdit`. TTL > debounce window (2s is safe).
**Warning signs:** Banner appears the moment user clicks Save.

### Pitfall 4: External-change distinction requires editor state
**What goes wrong:** Backend doesn't know which CLAUDE.md is currently open in the editor with unsaved changes (per D-15). If backend always emits `ExternalEdit`, the editor will get banners for files the user isn't even looking at.
**How to avoid:** Backend emits `Changed` for *every* CLAUDE.md write that wasn't ours (regardless of editor state). The **frontend** decides what to do based on its own state:
- If the changed CLAUDE.md is not in the open detail panel → silent refresh.
- If it's in the detail panel and editor is clean (no unsaved changes) → silent refresh, repopulate textarea.
- If it's in the detail panel and editor has unsaved changes → mount `<ExternalChangeBanner>`.
**Warning signs:** Banner appears for files the user isn't editing.

### Pitfall 5: Path canonicalization mismatch on Windows
**What goes wrong:** `std::fs::canonicalize` on Windows emits `\\?\C:\...` (UNC long-path prefix). The repo path returned to the frontend (`detect_git_root`) doesn't have it. Path comparisons fail.
**How to avoid:** Reuse the existing `strip_unc(p)` helper from `pipeline/commands.rs` (lines 50-59) for every canonicalize() in the new module. Centralize it in `pipeline/mod.rs` if it's not already exported.
**Warning signs:** On Windows, scope tabs show empty; resource paths look like `\\?\C:\Users\...`.

### Pitfall 6: `~/` expansion in Rust
**What goes wrong:** Rust's `std::path::Path` does not expand `~` to home dir. Hardcoding `"~/.claude"` makes a literal `~` directory.
**How to avoid:** Use `dirs::home_dir()` (add `dirs = "5"` to Cargo.toml) or `std::env::var_os("HOME")` for Unix + `USERPROFILE` for Windows. Tauri also exposes `app.path().home_dir()`.
**Warning signs:** Scan finds nothing; debug logs show `/home/user/repo/~/.claude`.

### Pitfall 7: Empty `<cwd>/.claude/` should not be an error
**What goes wrong:** The project has no `.claude/` directory (this very project doesn't). `Debouncer.watch()` returns an error if the path doesn't exist.
**How to avoid:** Check existence before `.watch()`. If absent, log info and skip — the scope tab "PROJECT" simply shows `NO_RESOURCE_SELECTED` empty state.
**Warning signs:** Watcher startup fails on first-run for a project without `.claude/`.

### Pitfall 8: gray_matter version + content body trimming
**What goes wrong:** gray_matter's `Matter::parse(&str)` returns `ParsedEntity { data, content, excerpt, ... }`. The `content` field is the post-frontmatter markdown body. If you accidentally use `data` for the body, raw content preview will be empty.
**How to avoid:** Read gray_matter's `ParsedEntity` carefully; write a small unit test that asserts both `data.name` and the first 50 chars of `content` for a known SKILL.md fixture.

### Pitfall 9: Plugin map keys contain `@` character
**What goes wrong:** The live `installed_plugins.json` uses keys like `"rapid@pragnition-plugins"` (plugin@marketplace). Naive ID derivation may break if you split on `@`.
**How to avoid:** Treat the entire key as opaque. `name = key.split('@').next()`, `marketplace = key.split('@').nth(1)` — but store the full key as the canonical identifier.

## Code Examples

Verified patterns from existing repo + official sources.

### Multi-root watch (pattern adaptation of existing `spawn_watcher`)
```rust
// Source: extension of src-tauri/src/pipeline/watcher.rs:58 spawn_watcher
// + notify-rs/notify examples/debouncer_full.rs (multiple .watch() calls)
let mut debouncer = new_debouncer(
    Duration::from_millis(DEBOUNCE_TICK_MS),
    Some(Duration::from_millis(DEBOUNCE_TICK_MS)),
    move |res: DebounceEventResult| { let _ = sync_tx.send(res); },
)?;

// Existing root
debouncer.watch(&repo_root, RecursiveMode::Recursive)?;

// New: scoped Claude resource roots
debouncer.watch(&global_claude_root, RecursiveMode::Recursive)
    .unwrap_or_else(|e| tracing::warn!(error = %e, "watch global .claude failed"));
if let Some(proj) = &project_claude_root {
    if proj.exists() {
        debouncer.watch(proj, RecursiveMode::Recursive)
            .unwrap_or_else(|e| tracing::warn!(error = %e, "watch project .claude failed"));
    }
}
```

### gray_matter parse to typed struct
```rust
// Source: docs.rs/gray_matter typical usage pattern
use gray_matter::{Matter, engine::YAML};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct SkillFront {
    name: String,
    description: String,
    #[serde(default)]
    tools: Option<Vec<String>>,
    #[serde(default)]
    #[serde(rename = "allowed-tools")]
    allowed_tools: Option<Vec<String>>,
}

pub fn parse_skill(path: &Path) -> Result<(SkillFront, String), String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(&raw);
    let data = parsed.data
        .ok_or("missing frontmatter")?
        .deserialize::<SkillFront>()
        .map_err(|e| format!("invalid SKILL.md frontmatter: {e}"))?;
    Ok((data, parsed.content))
}
```

### Atomic write
```rust
// Source: docs.rs/tempfile NamedTempFile::persist
use tempfile::NamedTempFile;
use std::io::Write;

pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("path has no parent")?;
    let mut tmp = NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    tmp.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    // persist atomically replaces target on Windows + Unix
    tmp.persist(path).map_err(|e| format!("persist: {}", e.error))?;
    Ok(())
}
```

### Channel<T> hook (mirror of usePipelineChannel)
```typescript
// Source: extension of src/hooks/usePipelineChannel.ts
import { useCallback, useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { ResourceEventBatch, Resource } from '../bindings';
import { useClaudeResourcesStore } from '../stores/claudeResourcesStore';

export function useClaudeResourcesChannel() {
  const channelRef = useRef<Channel<ResourceEventBatch> | null>(null);

  useEffect(() => {
    const channel = new Channel<ResourceEventBatch>();
    channel.onmessage = (batch) => {
      useClaudeResourcesStore.getState().applyBatch(batch);
    };
    channelRef.current = channel;
    return () => { channelRef.current = null; };
  }, []);

  const start = useCallback(async (cwd: string | null) => {
    if (!channelRef.current) throw new Error('channel not ready');
    const initial = await invoke<Resource[]>('start_claude_resources_watch', {
      cwd,
      channel: channelRef.current,
    });
    useClaudeResourcesStore.getState().seed(initial);
  }, []);

  const stop = useCallback(async () => {
    await invoke('stop_claude_resources_watch');
    useClaudeResourcesStore.getState().reset();
  }, []);

  return { start, stop };
}
```

### Path-routing helper
```rust
// Source: new helper for claude_resources/routing.rs
pub fn classify(path: &Path, repo_root: &Path, global_claude: &Path,
                project_claude: Option<&Path>) -> Option<RoutedPath> {
    if let Some(p) = project_claude { if path.starts_with(p) { return Some(RoutedPath::Resource(Scope::Project)); } }
    if path.starts_with(global_claude) { return Some(RoutedPath::Resource(Scope::Global)); }
    if path.starts_with(repo_root) { return Some(RoutedPath::Pipeline); }
    None
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled `---` splitter + `serde_yaml` | `gray_matter` crate | gray_matter Rust port mature since ~2023 | Drop ~50 LOC of fragile parser code |
| Polling-based file refresh | notify + debouncer (already in stack) | notify 7+ era | Real-time, low CPU |
| Backend snapshot store for undo | Frontend snapshot in React state | This phase | Eliminates server state for ephemeral UI flow |
| Modal "file changed on disk" prompts (VSCode old) | Non-blocking banner with explicit Reload/Keep mine/View diff | UI-SPEC pattern (mirrors VS Code's current banner) | Lower friction for power users |
| Plain `fs::write` for config files | `tempfile::persist` atomic replace | tempfile 3.x | Power-loss safety |

**Deprecated/outdated:**
- **Monaco editor for in-app markdown editing on Tauri:** Heavy (~2 MB), pulls in WebWorker setup, designed for IDE-class workloads. UI-SPEC explicitly chose textarea now, CodeMirror 6 as future option.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | gray_matter handles SKILL.md/agent/command frontmatter without per-format quirks | Standard Stack | Low — fallback is per-format custom parsers; design isolates parsers in `parse.rs` |
| A2 | `tempfile::NamedTempFile::persist()` is fully atomic on all three target platforms | Code Examples | Low — tempfile docs explicitly cover Windows ReplaceFile path; failure mode is "rename returns error" which we'd surface as save error toast |
| A3 | The dev's project does not contain a `.claude/` directory | Runtime State Inventory | None — verified via `ls .claude/` (only `worktrees/` subdir, no resources). Watcher must handle absence gracefully (Pitfall 7) |
| A4 | `~/.claude/cache/`, `session-env/`, `projects/`, `backups/`, `downloads/` produce noise | Common Pitfalls | Low — verified by `du -sh` showing 224K cache + frequent session-env churn; these are excluded by allowlist |
| A5 | Frontend-side undo is sufficient (no need for backend snapshot store) | Pattern 3 | Low — toast lifecycle matches snapshot lifecycle; CONTEXT.md doesn't require cross-navigation undo |
| A6 | All scope changes happen via repo session change (RepoSessionProvider re-mount), so the project `.claude/` watch can be torn down + rebuilt with the project root | Architecture | Low — Phase 6 lock-in; watcher lifecycle is already tied to `activeRepo` |
| A7 | The phase has zero database writes | Runtime State Inventory | Low — D-12..D-15 only require disk writes for CLAUDE.md content; no audit trail (deferred) |

## Open Questions

1. **One Debouncer or two?**
   - What we know: Both work. Single Debouncer = lower OS thread count, simpler but couples the lifecycles of repo watch + Claude resources watch. Two Debouncers = independent lifecycles (Claude resources keep watching `~/.claude` even when no repo is active).
   - What's unclear: Should ARSENAL work when no repo is open? UI-SPEC implies yes (the Global tab is meaningful without a project).
   - **Recommendation:** **Two-watcher approach** — extend `spawn_watcher` to take an `extra_roots` param for the project `.claude/` (which co-lives with repo) AND add a separate `start_global_resources_watch` that owns its own Debouncer for `~/.claude/` and survives across repo-session changes. The planner should make a definitive call here in the design wave.

2. **Should `start_claude_resources_watch` be a separate Tauri command or fold into `start_watch`?**
   - What we know: `start_watch(repo_root, channel)` already does multiple things; adding `claude_channel` as another arg muddies its signature.
   - What's unclear: Cleaner to have a sibling `start_claude_resources_watch(cwd_or_null, channel)` that the frontend calls separately.
   - **Recommendation:** **Sibling command.** Better separation of concerns; either watch can fail independently.

3. **Should we watch `~/.claude/CLAUDE.md` for read-only updates?**
   - What we know: D-13 says global CLAUDE.md is read-only this phase. UI-SPEC shows it gets a `READ-ONLY` banner.
   - What's unclear: If the user externally edits `~/.claude/CLAUDE.md`, should the read-only viewer refresh?
   - **Recommendation:** Yes — the watcher already covers it via the recursive `~/.claude/` watch; the frontend just refreshes the viewer text. No banner needed because there are no local edits to conflict with.

4. **Hook script content vs metadata only?**
   - CONTEXT.md says: "hook scripts (path/name only — do not execute or read content as authoritative)."
   - **Recommendation:** Display path, filename, and the matcher/event from settings.json (which references the hook). Do **not** display script body to avoid implying it's editable.

5. **MCP servers — show password / env values?**
   - settings.json `mcpServers` entries can contain `env` blocks with API keys.
   - **Recommendation:** Display `command`, `args`, and **mask** any value in `env` whose key matches a regex like `(?i)token|secret|key|password|auth`. Show as `***` with a tooltip "value hidden". Out of scope to add a "reveal" toggle this phase.

6. **What's the source of `<cwd>` for the project-scope watcher when the user changes repo mid-session?**
   - What we know: `RepoSessionProvider` already handles this for the pipeline watcher (re-registers on `activeRepo` change).
   - **Recommendation:** Same pattern — `useClaudeResourcesChannel.start(cwd)` re-runs in a `useEffect([activeRepo])`. The Rust side stops the project portion of the watch, replaces it with the new cwd. (Global portion never restarts.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Cargo | Backend build | ✓ | stable | — |
| `notify` crate | Already declared | ✓ | 8 (Cargo.toml) | — |
| `notify-debouncer-full` | Already declared | ✓ | 0.7 | — |
| `tempfile` crate | Atomic writes | ✓ in dev-deps; promote to runtime | 3.x | atomic-write-file or hand-rolled |
| `gray_matter` crate | YAML frontmatter | ✗ (must add) | 0.2.x | yaml-front-matter, or split-on-`---` + serde_yaml |
| `dirs` crate (for `home_dir()`) | `~` expansion | ✗ (must add, ~5 LOC alternative exists) | 5.x | `std::env::var("HOME")` + Windows `USERPROFILE` |
| `~/.claude/` directory | Global resources scan | ✓ on dev machine; may not exist on fresh machine | — | Show empty-state per UI-SPEC `ARSENAL_EMPTY` |
| `<cwd>/.claude/` directory | Project resources scan | ✗ on this project | — | Skip project watch root, show `NO_RESOURCE_SELECTED` per scope-tab |
| Linux `fs.inotify.max_user_watches` ≥ 8192 | Recursive watching | ✓ usually | — | Allowlist subdirs (Pitfall 1) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `gray_matter` (alternatives exist but worse). `dirs` (trivial inline alternative).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Backend framework | `cargo test` + `serial_test` (already in dev-deps) |
| Frontend framework | Vitest 3 + @testing-library/react 16 + jsdom 26 (already configured) |
| Backend config | `src-tauri/Cargo.toml` `[dev-dependencies]` |
| Frontend config | `vitest.config.ts` (exists) |
| Quick run command (frontend) | `npm run test -- --run src/views/Arsenal src/stores/claudeResourcesStore src/hooks/useClaudeResourcesChannel` |
| Quick run command (backend) | `cd src-tauri && cargo test claude_resources --lib` |
| Full suite (frontend) | `npm run test` |
| Full suite (backend) | `cd src-tauri && cargo test --lib -- --test-threads=1` (serial_test enforces serialization for fs tests) |

### Phase Behaviors → Test Map
| Behavior (sourced from D-XX or UI-SPEC) | Test Type | Automated Command | File Exists? |
|-----------------------------------------|-----------|-------------------|--------------|
| **D-05/D-06** Single Debouncer watches both `~/.claude` and `<cwd>/.claude`; events route to correct channel | unit (Rust) | `cargo test claude_resources::routing::classify` | ❌ Wave 0 |
| **D-07** parse.rs deserializes a fixture SKILL.md to `SkillFront { name, description, tools }` | unit (Rust) | `cargo test claude_resources::parse::parse_skill_fixture` | ❌ Wave 0 |
| **D-07** parse.rs deserializes a fixture agent.md (with `model: sonnet`) | unit (Rust) | `cargo test claude_resources::parse::parse_agent_fixture` | ❌ Wave 0 |
| **D-07** parse.rs deserializes installed_plugins.json with multi-version array | unit (Rust) | `cargo test claude_resources::parse::parse_installed_plugins_fixture` | ❌ Wave 0 |
| **D-07** parse.rs deserializes settings.json hooks + mcpServers, masks env secrets | unit (Rust) | `cargo test claude_resources::parse::parse_settings_masks_env_secrets` | ❌ Wave 0 |
| **D-08** initial scan walks ~/.claude allowlist subdirs only (excludes cache/, session-env/) | unit (Rust) | `cargo test claude_resources::scan::scan_excludes_cache_dir` | ❌ Wave 0 |
| **Pitfall 7** scanner returns empty `ResourceEventBatch` cleanly when `<cwd>/.claude` doesn't exist | unit (Rust) | `cargo test claude_resources::scan::scan_missing_project_claude_is_ok` | ❌ Wave 0 |
| **Pattern 4** write-fence suppresses self-emitted Changed events for AITC writes | unit (Rust, time-based) | `cargo test claude_resources::write_fence::suppresses_within_ttl` | ❌ Wave 0 |
| **D-14** atomic_write replaces target file content; original mtime advances | unit (Rust) | `cargo test claude_resources::commands::write_claude_md_atomic` | ❌ Wave 0 |
| **D-14** undo flow: write A → write B → undo → file content == A | unit (Rust + frontend integration) | `cargo test claude_resources::commands::write_then_undo_restores` + Vitest equivalent | ❌ Wave 0 |
| **D-15** `ExternalChangeBanner` mounts iff editor has unsaved changes AND watcher reports Changed for the open path | unit (Vitest + RTL) | `npm run test -- ExternalChangeBanner` | ❌ Wave 0 |
| **D-03** combined-scope shadowing: when project + global skill share name, only project row in store | unit (Vitest) | `npm run test -- claudeResourcesStore.shadowing` | ❌ Wave 0 |
| **D-09/D-10/D-11** ArsenalView renders 4 categories, 3 scope tabs, filter input mutates list | unit (Vitest) | `npm run test -- ArsenalView` | ❌ Wave 0 |
| **UI-SPEC keyboard contract** ↑/↓ moves selection, Esc clears filter, Ctrl/Cmd+S saves | unit (Vitest + RTL `userEvent`) | `npm run test -- ArsenalView.keyboard` | ❌ Wave 0 |
| **D-15 banner copy contract** "RELOAD" / "KEEP MINE" / "VIEW DIFF" present, two-click confirmation works | unit (Vitest) | `npm run test -- ExternalChangeBanner.confirmations` | ❌ Wave 0 |
| **MasterDetailShell primitive** renders `rail`/`list`/`detail` slots with locked widths (220/flex/520) | unit (Vitest) | `npm run test -- MasterDetailShell` | ❌ Wave 0 |
| **Smoke** `cargo build` regenerates `src/bindings.ts` with new types | manual smoke (one-time, executor checks file diff) | `cd src-tauri && cargo build && git diff src/bindings.ts` | n/a |

### Sampling Rate
- **Per task commit:** `cargo test claude_resources --lib` (backend) and `npm run test -- src/views/Arsenal` (frontend) — < 30 s combined.
- **Per wave merge:** `cd src-tauri && cargo test --lib -- --test-threads=1` plus `npm run test`.
- **Phase gate:** Both full suites green before `/gsd-verify-work`. Manual UAT run on Linux for the inotify allowlist scenario (open ARSENAL with > 60 skills under `~/.claude/skills/`, confirm no errors and event flow remains live after editing one SKILL.md externally).

### Wave 0 Gaps
- [ ] `src-tauri/src/claude_resources/mod.rs` — module skeleton (declares `commands`, `events`, `parse`, `scan`, `routing`, `write_fence`, `undo_registry?`).
- [ ] `src-tauri/src/claude_resources/parse.rs` — `parse_skill`, `parse_agent`, `parse_command`, `parse_settings`, `parse_installed_plugins` with unit tests + fixtures.
- [ ] `src-tauri/tests/fixtures/claude_resources/` — fixture tree (one SKILL.md, one agent.md, one settings.json, one installed_plugins.json, one slash-command .md).
- [ ] `src-tauri/src/claude_resources/scan.rs` — initial scan with allowlist + tests.
- [ ] `src-tauri/src/claude_resources/routing.rs` — path classifier + unit tests.
- [ ] `src-tauri/src/claude_resources/write_fence.rs` — TTL registry + unit tests.
- [ ] `src/stores/claudeResourcesStore.ts` — Zustand store + selectors + unit tests.
- [ ] `src/hooks/useClaudeResourcesChannel.ts` + tests.
- [ ] `src/components/layout/MasterDetailShell.tsx` + tests.
- [ ] `src/views/Arsenal/__tests__/` directory.
- [ ] **Cargo.toml change:** add `gray_matter`, promote `tempfile` to runtime dep, optionally add `dirs`.
- [ ] **Bindings refresh step in plan:** plan must include "after registering new Tauri commands, run `cargo build` in src-tauri to regenerate `src/bindings.ts`."

## Sources

### Primary (HIGH confidence)
- `src-tauri/src/pipeline/watcher.rs` — existing watcher implementation, debounce constant, FileIdCache rationale
- `src-tauri/src/pipeline/events.rs` — Channel envelope conventions to mirror
- `src-tauri/src/pipeline/commands.rs` — Tauri command + state-management pattern (start/stop, broadcast fan-out)
- `src-tauri/src/lib.rs` — `tauri_specta::collect_commands!` + `.typ::<>` registration; bindings auto-export
- `src/hooks/usePipelineChannel.ts` + `src/stores/pipelineStore.ts` — Channel<T> + Zustand trio to clone
- `src/providers/RepoSessionProvider.tsx` — `<cwd>` + activeRepo lifecycle source
- `src-tauri/Cargo.toml` + `package.json` — verified existing versions
- `.planning/phases/09-.../09-CONTEXT.md` — D-01..D-15 locked decisions
- `.planning/phases/09-.../09-UI-SPEC.md` — design contract (textarea over CodeMirror, MasterDetailShell, ScopeChip, etc.)
- Live filesystem inspection of `~/.claude/` — confirmed installed_plugins.json shape, settings.json shape, hooks/ contents, agents/ count, skills/ count (69)
- [Anthropic Claude Code Skills docs](https://code.claude.com/docs/en/skills) — SKILL.md frontmatter contract: `name` (≤64 char, lowercase/hyphens), `description` (≤1024 char), optional `allowed-tools`
- [Anthropic Claude Code Sub-agents docs](https://code.claude.com/docs/en/sub-agents) — agent .md frontmatter: `name`, `description` required; `tools`, `model` optional
- [Anthropic Claude Code Slash Commands docs](https://code.claude.com/docs/en/slash-commands) — command .md frontmatter: `description`, `argument-hint`, `allowed-tools`
- [Anthropic Claude Code Settings docs](https://code.claude.com/docs/en/settings) — hierarchical settings.json with `permissions`, `hooks`, `mcpServers`
- [Anthropic Claude Plugins docs](https://code.claude.com/docs/en/discover-plugins) + GitHub issue #15754 — installed_plugins.json schema (version, scope, installPath, version, installedAt, lastUpdated, gitCommitSha)
- [docs.rs/notify-debouncer-full](https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/) + [notify-rs/notify examples/debouncer_full.rs](https://github.com/notify-rs/notify/blob/main/examples/debouncer_full.rs) — multi-watch usage pattern
- [docs.rs/tempfile](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html) — `persist()` atomicity guarantee

### Secondary (MEDIUM confidence)
- [docs.rs/gray_matter](https://docs.rs/gray_matter) + [lib.rs/crates/gray_matter](https://lib.rs/crates/gray_matter) — 24k dl/month, 57 dependents, MIT
- [docs.rs/atomic-write-file](https://docs.rs/atomic-write-file/latest/atomic_write_file/) — alternative atomic-write crate (cross-verified tempfile approach)
- [npm @uiw/react-codemirror](https://www.npmjs.com/package/@uiw/react-codemirror) + [npm @codemirror/lang-markdown](https://www.npmjs.com/package/@codemirror/lang-markdown) (latest 6.5.0) — for the deferred CodeMirror future-phase plan
- [watchexec inotify-limits](https://watchexec.github.io/docs/inotify-limits.html) + [JetBrains inotify article](https://intellij-support.jetbrains.com/hc/en-us/articles/15268113529362-Inotify-Watches-Limit-Linux) — Linux inotify cap workarounds

### Tertiary (LOW confidence)
- Various community blog posts about Claude Code customization — referenced for cross-validation but not relied on for any specific claim

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every Rust crate either already in Cargo.toml or has been verified on docs.rs/lib.rs; every frontend lib in package.json
- Architecture (multi-root watcher, path router, Channel<T> mirror): HIGH — single-Debouncer multi-watch confirmed by official examples; mirroring an existing Phase 2 trio is mechanical
- Frontmatter parsing: HIGH for SKILL.md/agent/command/settings (cross-verified Anthropic docs + live fixtures); MEDIUM for hooks (script body intentionally not parsed per CONTEXT.md)
- Atomic write + write-fence + frontend undo: HIGH — well-trodden patterns
- CodeMirror evaluation: MEDIUM — UI-SPEC already chose textarea, so this is informational only
- Inotify limit handling: MEDIUM-HIGH — depends on exact subdirs we allowlist; allowlist plan documented but not yet exercised at scale

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days — stack is mature, low churn risk)
