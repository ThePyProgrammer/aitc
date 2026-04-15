# Phase 9: Plugin / Skill / Tool / Hook Manager Page (ARSENAL) - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A new in-app view ("ARSENAL") that gives the developer a single console for **what does Claude have access to right now?**:

- Discovers Claude resources under both `~/.claude/` (global) and `<cwd>/.claude/` (project) by extending the existing pipeline file watcher to cover those scopes.
- Surfaces four resource categories: **Skills**, **Agents**, **Plugins**, and a bundled **Configuration** tab covering Hooks + Slash Commands + settings.json + MCP server configs.
- Provides inline editing for `<cwd>/CLAUDE.md` and `<cwd>/.claude/CLAUDE.md` from the same page.
- Real-time updates: when a skill is added/removed/edited on disk, the page reflects it without a refresh.

**Out of scope for this phase** (deferred ideas / future phases):
- Installing, removing, or enabling/disabling plugins from the page (read-only inventory only).
- Authoring/scaffolding new hooks, skills, or commands from the page.
- Editing `~/.claude/CLAUDE.md` (global) — read-only this phase due to blast radius.
- Editing settings.json, hook scripts, slash commands, MCP configs — read-only inventory only.
- Detecting/visualizing project-shadows-global override conflicts.
- Resolving CLAUDE.md merge conflicts (we surface "external change" but don't 3-way merge).

</domain>

<decisions>
## Implementation Decisions

### Resource Scope & Taxonomy
- **D-01:** Surface four categories: Skills, Agents, Plugins, Configuration (Hooks + Commands + Settings + MCP bundled).
- **D-02:** Scope view uses **tabs**: Global | Project | Combined. Each tab shows the same category list filtered to that scope.
- **D-03:** When a project resource shadows a global resource of the same name, **show only the active (project) one**. The shadowed global row is hidden in v1 — no annotation. (Defer override-visualization to a later phase.)
- **D-04:** Each resource row displays: **name + one-line description + scope chip (GLOBAL/PROJECT) + full path**. Click row → right detail panel for full content.

### Watcher Integration
- **D-05:** Extend the **existing pipeline watcher** (`src-tauri/src/pipeline/watcher.rs`) to add `~/.claude/` and `<cwd>/.claude/` as additional watch roots. Single Debouncer keeps the 150ms aggressive-debounce / RecommendedCache behavior already validated for code files.
- **D-06:** Events get **routed by path inside the pipeline**. Code-file events continue flowing into `pipelineStore` unchanged. Events whose path lives under a `.claude/` root fan out into a **separate Channel<T> → `claudeResourcesStore`**. The two domains never mix in the same ring buffer.
- **D-07:** **Rust backend parses** all resource formats: SKILL.md frontmatter, agent .md frontmatter, plugins/installed_plugins.json, settings.json, hook scripts (path/name only), commands/*.md, MCP configs. Backend pushes typed structs over the channel via tauri-specta bindings. Frontend never parses YAML/JSON for these.
- **D-08:** Refresh strategy is **incremental**: a debounced batch identifies the changed files and only those rows are re-parsed and updated in the store. Initial mount does a single full scan to seed both scopes.

### Page Layout & Navigation
- **D-09:** Layout is **master/detail**:
  - Left rail: category list (Skills / Agents / Plugins / Configuration).
  - Center: filtered resource rows for the active category + scope tab.
  - Right detail panel: selected resource — full path, parsed metadata, raw content preview, and (for editable CLAUDE.md files) the inline editor.
- **D-10:** New top-level sidebar item: **ARSENAL**, route `/arsenal`. Position: **after TOWER**. Final sidebar order: RADAR / TOWER / ARSENAL / COMMS / CONFLICTS / HISTORY.
- **D-11:** **Inline filter input per category** — text field above the row list filters the current category by name/description. No global cross-category search in v1.

### CLAUDE.md Editing UX
- **D-12:** Editor is **inline in the right detail panel** when a CLAUDE.md row is selected. Textarea/markdown editor with Save and Discard buttons. No modal, no system-editor handoff.
- **D-13:** Editable CLAUDE.md files: **`<cwd>/CLAUDE.md` and `<cwd>/.claude/CLAUDE.md` only**. `~/.claude/CLAUDE.md` is read-only this phase (higher blast radius).
- **D-14:** Save flow: **direct save with undo toast**. Save writes immediately to disk; a non-blocking toast offers Undo for ~10 seconds (Undo restores pre-save content). No diff modal, no auto-save.
- **D-15:** External-change conflict: when the watcher reports an external write to a CLAUDE.md the user is currently editing (with unsaved changes), show a **non-blocking banner above the editor** with three actions: **Reload** (discard local edits), **Keep mine** (overwrite external change on next save), **View diff** (open 2-pane diff for manual reconciliation).

### Claude's Discretion
- Exact UI primitives (textarea vs. CodeMirror/Monaco for the editor) — Claude picks during planning. Recommend evaluating CodeMirror 6 since it's lightweight and matches the "thin-stroke" aesthetic better than Monaco.
- Toast component implementation — reuse existing toast system if one exists, else thin Motion-based toast.
- Detail-panel resize/collapse behavior.
- Empty-state copy when a category has zero resources in the selected scope.
- Sidebar icon for ARSENAL — pick from Lucide (e.g., `Package`, `Boxes`, `Wrench`, `Layers`).
- Whether `claudeResourcesStore` is one store with category selectors, or four sub-stores. Recommend single store with selectors for parity with `pipelineStore`.

### Folded Todos
None — `gsd-tools todo match-phase 9` returned zero matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline / Watcher (extend, don't duplicate)
- `src-tauri/src/pipeline/watcher.rs` — existing notify-debouncer-full watcher. New scopes (`~/.claude`, `<cwd>/.claude`) become additional watch roots here. Note Pitfalls 1/2/5 already handled.
- `src-tauri/src/pipeline/events.rs` — `FileEventBatch` shape. New `ResourceEvent` type lives alongside (or in a new `claude_resources` module).
- `src-tauri/src/pipeline/mod.rs` — pipeline module structure + `ActiveWatch` lifecycle.
- `src-tauri/src/pipeline/commands.rs` — pattern for `start_watch`/`stop_watch` Tauri commands. Mirror for resource scan/list.
- `src-tauri/src/pipeline/tree_index.rs` — file-tree traversal pattern reusable for initial scan of `.claude/` subtrees.
- `src-tauri/src/pipeline/ignore_filter.rs` — `HARDCODED_EXCLUDES`. Confirm `.claude/` is NOT excluded; add scope-aware filtering.

### Frontend Integration Points
- `src/hooks/usePipelineChannel.ts` — Channel<T> bridge pattern. New `useClaudeResourcesChannel` follows the same shape.
- `src/stores/pipelineStore.ts` — ring-buffer + Zustand pattern to mirror in `claudeResourcesStore`.
- `src/App.tsx` — router; new `/arsenal` route registered here.
- `src/components/layout/Sidebar.tsx` — `navItems` array; insert ARSENAL after TOWER.
- `src/components/layout/AppShell.tsx` — pipeline channel mount point precedent.
- `src/views/` — existing view layout conventions (RadarView, TowerView, etc.) for the new `ArsenalView.tsx`.

### Tauri / IPC plumbing
- `src-tauri/src/lib.rs` — `tauri_specta::collect_commands!` registry; new commands (`list_claude_resources`, `read_claude_md`, `write_claude_md`, etc.) registered here. Bindings auto-generated to `src/bindings.ts`.
- `src/bindings.ts` — generated TypeScript bindings (regenerated on Rust changes).

### Project Conventions
- `CLAUDE.md` (project root) — tech stack constraints, design system reference.
- `.planning/phases/06-pipeline-activation-integration-wiring/06-CONTEXT.md` — pipeline + repo session decisions; `RepoSessionProvider` pattern is the source of `<cwd>` for the project-scope watcher.
- `.planning/phases/02-real-time-data-pipeline/02-CONTEXT.md` (and 02-RESEARCH.md) — Channel<T> over app.emit() rationale; ring-buffer pattern.
- `wireframes/vector_terminal/DESIGN.md` (if present) — Command Horizon design system (sidebar typography, surface tiers, Lucide stroke widths).

### Reference: Claude resource file shapes
- `~/.claude/skills/<plugin>/<skill>/SKILL.md` — frontmatter: `name`, `description`, `type` (sometimes more).
- `~/.claude/agents/*.md` — agent frontmatter (name, description, tools, model).
- `~/.claude/plugins/installed_plugins.json` — installed plugin registry (read-only here).
- `~/.claude/hooks/*.{js,sh}` — hook scripts (path + filename only — do not execute or read content as authoritative).
- `~/.claude/commands/*` — slash-command definitions.
- `~/.claude/settings.json` — global hook/permission/env config; mirror `<cwd>/.claude/settings.json` for project scope.
- `~/.claude/CLAUDE.md`, `<cwd>/CLAUDE.md`, `<cwd>/.claude/CLAUDE.md` — instruction files (the editable ones).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`spawn_watcher`** (`pipeline/watcher.rs`) — already supports a `repo_root` watch. Extending to multi-root requires either adding additional `Debouncer.watch(path, RecursiveMode::Recursive)` calls on the same Debouncer or instantiating a small dispatcher above the existing API.
- **`build_tree_index`** + `FileNode` — reusable for the initial-scan walk of `.claude/` subtrees.
- **Channel<T> + Zustand store + custom hook trio** (Phase 2/6) — a battle-tested pattern. Replicate one-for-one for Claude resources.
- **`tauri-specta` collect_commands!** — registering new commands auto-syncs TS bindings; no manual type maintenance.
- **`RepoSessionProvider`** — supplies the current `<cwd>` repo root; the project-scope `.claude/` watcher mounts/unmounts in lockstep with it.
- **Sidebar `navItems` pattern** — adding ARSENAL is one entry + one Lucide icon import.
- **View shell convention** (`RadarView`, `TowerView`, etc.) — `ArsenalView.tsx` follows the same shape: top-level component under `pt-14` `<main>`.

### Established Patterns
- **Channel<T> over `app.emit()`** for high-throughput streaming (Phase 2 lock-in).
- **Backend parses, frontend renders** — keeps types synchronized via tauri-specta.
- **Single Debouncer per repo** today — extending to multi-root keeps that primitive but needs path-based fan-out at the consumer side.
- **Master/detail layouts** are not yet present in the app; ARSENAL is the first. Plan should standardize a small layout primitive (left rail + center list + right panel) that future views can reuse.
- **Sidebar items use single-word uppercase labels with Lucide thin-stroke icons** — ARSENAL fits.
- **Routes use lowercase `/segment`** — `/arsenal` is consistent.

### Integration Points
- `src/App.tsx` route table: add `{ path: 'arsenal', element: <ArsenalView /> }`.
- `src/components/layout/Sidebar.tsx` `navItems`: insert `{ to: '/arsenal', label: 'ARSENAL', icon: <PickedLucideIcon> }` after TOWER.
- `src-tauri/src/lib.rs` command registry: add `claude_resources::commands::*` and (if needed) `claude_md::commands::*`.
- New module: `src-tauri/src/claude_resources/` (mirror the `pipeline/` module shape — `mod.rs`, `commands.rs`, `events.rs`, `parse.rs`, optionally `watcher_routing.rs`).
- New frontend store: `src/stores/claudeResourcesStore.ts`.
- New hook: `src/hooks/useClaudeResourcesChannel.ts`.
- New view: `src/views/Arsenal/ArsenalView.tsx` (+ subcomponents under that folder, following the `Radar/`, `TowerControl/` precedent).

</code_context>

<specifics>
## Specific Ideas

- The phase title's "tool" likely refers to Claude's MCP tools; we cover those via the MCP-server section of the Configuration tab. We do NOT scan every individual MCP tool exposed by every server (those are dynamic and live in server processes) — we list the configured servers from settings.json.
- "ARSENAL" naming chosen over TOOLKIT/CONFIG/MANIFEST: it reads as "the equipped capabilities of the agents," matching the ATC/military theme already in CONFLICTS, COMMS, TOWER.
- Tabs (Global | Project | Combined) sit at the top of the master/detail view, INSIDE the page (not in the sidebar). The sidebar holds only the top-level ARSENAL entry.
- Banner conflict resolution mirrors VS Code's "file changed on disk" pattern — a known mental model for the developer audience.

</specifics>

<deferred>
## Deferred Ideas

- **Plugin enable/disable + install/uninstall from ARSENAL** — read-only this phase. Future phase: write actions backed by `installed_plugins.json` mutations or the plugin marketplace API.
- **Hook authoring / scaffolding** — generate a new hook script from a template. Future phase.
- **Skill / agent / command authoring** — same; ARSENAL is read-only for these in v1.
- **Editing `~/.claude/CLAUDE.md`** (global) — explicitly excluded due to blast radius. Could be reconsidered behind an "advanced edits" toggle.
- **Editing settings.json, hook scripts, slash commands, MCP configs** — read-only for v1. Future phase if needed.
- **Visualizing project-shadows-global override conflicts** — currently we hide the shadowed global row. A future phase could add a "shadowed by project" annotation toggle.
- **Global cross-category search bar** — defer until resource counts grow beyond per-category filtering.
- **3-way merge UI for CLAUDE.md external-conflict resolution** — banner offers Reload / Keep mine / View diff; the diff is read-only, no merge editor.
- **Audit trail for CLAUDE.md edits** (who/when changed what). Useful for solo dev but out of scope.
- **Nested CLAUDE.md files** in subdirectories — not editable in v1 (only the two specified files are).

### Reviewed Todos (not folded)
None — no pending todos matched Phase 9.

</deferred>

---

*Phase: 09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b*
*Context gathered: 2026-04-15*
