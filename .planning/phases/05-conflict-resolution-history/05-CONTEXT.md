# Phase 5: Conflict Resolution + History - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a 3-way merge UI for resolving file conflicts between concurrent agents (unified diff with per-hunk resolution controls and agent intent context), a file heat map overlay on the Phase 4 treemap radar showing cross-agent contention intensity, and a dedicated History view for browsing past agent sessions, resolved conflicts, and approval decision logs. This phase transforms conflict alerts into actionable resolutions and adds a persistent audit trail.

</domain>

<decisions>
## Implementation Decisions

### Merge UI Layout
- **D-01:** Unified diff view with sidebar hunk navigator — NOT the 3-panel side-by-side from the wireframe. Single unified diff showing the conflicting file, with a sidebar listing all conflict hunks for quick navigation (click hunk in sidebar to scroll to it)
- **D-02:** Inline per-hunk resolution controls — each conflicting hunk shows colored markers for Agent A and Agent B changes, with Accept A | Accept B | Edit buttons rendered directly inline in the diff. Clicking resolves that hunk in place. Similar to VS Code merge editor inline decorations
- **D-03:** Bottom panel for agent intent — fixed panel below the diff showing Agent A and Agent B intent cards side by side. Always visible while scrolling through hunks. Displays adapter-extracted intent (Phase 3 D-08) or "No intent available" fallback

### Heat Map Overlay
- **D-04:** Combined contention score — weighted formula using conflict count (heavy weight) + multi-agent write frequency (lighter weight). More nuanced than conflict-only: shows "hot zones" even before conflicts trigger
- **D-05:** Cell background color rendering — treemap cells shift from default dark surface to warm colors (green → amber → red) based on contention score. Uses Command Horizon's status color language (green=healthy, amber=warning, red=critical)
- **D-06:** Toggle-able overlay — heat map is a toggle button on the radar toolbar. Off by default so the clean treemap is the primary view. User enables when they want to see contention patterns

### History Browsing
- **D-07:** Dedicated History view — 5th view in the sidebar (Radar, Tower, Comms, Conflicts, History). Full-screen space for tables, filters, and data. Clean separation of real-time monitoring vs retrospective browsing
- **D-08:** Tabbed tables layout — three tabs: Sessions | Conflicts | Approvals. Each tab shows a filterable, sortable table with columns relevant to that record type. Click a row to expand inline details. Uses TanStack Virtual for performance with large datasets
- **D-09:** File count + top files per session — store total file count on the session record, plus per-file write counts in a junction table (`session_files`). History view shows count in the table row; expand to see top 10 most-touched files

### Resolution Workflow
- **D-10:** Explicit commit button — user resolves hunks individually (changes preview live in the diff), then clicks "Push to Production" / "Apply Resolution" button to write the merged file to disk. Nothing changes on disk until the user commits. Matches wireframe's "PUSH TO PRODUCTION" button
- **D-11:** Pre-resolution backup — before writing the merged file, save a backup of both agent versions and the base file. Conflict history record links to these snapshots. User can "Revert" from the history view to restore the pre-resolution state
- **D-12:** Notify agents if capable — use Phase 4 message delivery infrastructure: Claude Code receives notification via hooks, other agents get a queued message if adapter supports it, log-only otherwise. Show delivery status indicator in the resolution record

### Claude's Discretion
- Syntax highlighting library for the unified diff view (e.g., Prism, Shiki, or manual tokenization)
- Backup storage strategy (SQLite BLOB, filesystem snapshots in an AITC data directory, or temp files)
- Hunk detection algorithm for producing the unified diff from two agent versions + base
- Heat map color gradient specifics (exact green/amber/red hex values within Command Horizon palette)
- Heat map score weighting formula (conflict count weight vs write frequency weight)
- History table column specifics and default sort order
- Session file tracking implementation (event-driven accumulation vs query-time aggregation)
- Sidebar navigation icon for the new History view

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wireframes
- `wireframes/conflict_resolution_center/screen.png` — Conflict Resolution wireframe (3-panel layout reference — Phase 5 uses unified diff instead, but header/footer/intent sections are still relevant)
- `wireframes/conflict_resolution_center/code.html` — Conflict Resolution code reference
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (status colors for heat map, typography for diff view, elevation for panels)

### Technology Stack
- `CLAUDE.md` — Technology stack decisions including Canvas 2D for radar, TanStack Virtual for large tables, Motion for animations, Zustand for state

### Existing Backend Code
- `src-tauri/src/conflict/types.rs` — `ConflictAlert`, `ConflictState`, `FileWriteRecord` types — the data model Phase 5 merge UI consumes
- `src-tauri/src/conflict/engine.rs` — `ConflictEngine` sliding-window detection — Phase 5 reads conflict data from this
- `src-tauri/src/conflict/commands.rs` — Existing conflict Tauri commands (list_conflicts, dismiss_conflict, get/update_conflict_settings)
- `src-tauri/src/agents/adapter.rs` — Agent adapter trait with intent extraction — feeds merge UI intent panel
- `src-tauri/src/db/migrations/001_initial_schema.sql` — Existing schema: `agent_sessions`, `conflict_events`, `approval_requests`, `app_settings` — Phase 5 adds migrations for enrichment + new tables

### Existing Frontend Code
- `src/stores/conflictStore.ts` — Conflict Zustand store (ConflictAlert type, subscribeToEvents, dismissConflict) — Phase 5 extends for resolution workflow
- `src/stores/agentStore.ts` — Agent store with intent data
- `src/views/ConflictsView.tsx` — Current placeholder ("ZERO_CONFLICTS_DETECTED") — Phase 5 replaces with merge UI
- `src/views/RadarView.tsx` — Phase 4 treemap radar — Phase 5 adds heat map overlay layer

### Phase Context
- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` — Phase 3 decisions: conflict engine (D-10 window, D-11 alerts, D-12 per-file + hunk hints), agent intent (D-08), notifications (D-09)
- `.planning/phases/04-core-ui-views/04-CONTEXT.md` — Phase 4 decisions: treemap radar (D-09), agent chat/message delivery (D-14), approval workflow, Canvas 2D rendering

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConflictAlert` type with `hunk_hints_a`/`hunk_hints_b` byte ranges — merge UI uses these to locate conflicting regions within the file
- `ConflictState` with `get_active()`, `dismiss()` — extend with resolution status tracking
- `conflictStore` Zustand store — extend with resolution state (selected hunks, resolution choices, merged content preview)
- Phase 4 radar Canvas 2D rendering — heat map adds an additional render pass on the same canvas
- `StatusBadge` component — reuse for resolution status badges in history tables
- TanStack Virtual — already in deps for Phase 4, reuse for history tables
- Phase 4 message delivery infrastructure — reuse for agent notification on resolution

### Established Patterns
- **Zustand store per domain:** existing stores → new `historyStore`, extend `conflictStore` with resolution state
- **Tauri commands:** `#[tauri::command] #[specta::specta]` pattern for new resolution and history commands
- **SQLite migrations:** sequential numbered migrations in `src-tauri/src/db/migrations/`
- **Real-time events:** `listen()` pattern for conflict-resolved events
- **Canvas 2D rendering:** Phase 4 treemap render loop — heat map composites on top

### Integration Points
- `src/views/ConflictsView.tsx` — Replace placeholder with merge UI (unified diff + sidebar + intent panel)
- `src/views/RadarView.tsx` — Add heat map toggle and overlay render pass
- `src/App.tsx` — Add History route and sidebar nav item
- `src-tauri/src/conflict/` — New resolution commands, backup management
- `src-tauri/src/db/migrations/` — New migration for `session_files` junction table, `conflict_resolutions` table with backup references, enriched `conflict_events`
- `src/stores/` — New `historyStore.ts`, extend `conflictStore.ts`

</code_context>

<specifics>
## Specific Ideas

- The unified diff approach diverges from the wireframe's 3-panel layout — user chose this for compactness. The wireframe's header (file path, collision ID, time info) and bottom intent panel are still relevant
- Pre-resolution backups create a safety net that makes the "Push to Production" button less scary — user can always revert from History
- Heat map combined score means even "warm" areas (multi-agent writes without conflicts) are visible — proactive awareness before conflicts happen
- The 5th History view completes the app's view set: Radar (spatial), Tower (agents), Comms (requests), Conflicts (resolution), History (audit trail)
- Session file tracking via junction table enables the "top 10 most-touched files" drill-down without storing full file lists in memory

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-conflict-resolution-history*
*Context gathered: 2026-04-11*
