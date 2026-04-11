# Phase 5: Conflict Resolution + History - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 05-conflict-resolution-history
**Areas discussed:** Merge UI layout, Heat map overlay, History browsing, Resolution workflow

---

## Merge UI Layout

| Option | Description | Selected |
|--------|-------------|----------|
| 3-panel side-by-side (Recommended) | Agent A (left) / Base + controls (center) / Agent B (right) — matches wireframe | |
| 2-panel inline diff | Agent A (left) / Agent B (right) with inline merge controls | |
| Unified diff + sidebar | Single unified diff with sidebar listing all conflict hunks | ✓ |

**User's choice:** Unified diff + sidebar
**Notes:** User preferred compactness over the wireframe's 3-panel approach

| Option | Description | Selected |
|--------|-------------|----------|
| Inline buttons per hunk (Recommended) | Each hunk shows Accept A / Accept B / Edit buttons inline | ✓ |
| Sidebar-driven resolution | Sidebar lists hunks, click to scroll and resolve from sidebar | |
| Toggle overlay | Base file with toggle between Agent A/B overlays | |

**User's choice:** Inline buttons per hunk

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom panel (Recommended) | Fixed panel below diff showing Agent A and B intent side by side | ✓ |
| Hunk-level tooltips | Hover to see intent in tooltip | |
| Sidebar section | Intent in sidebar below hunk navigator | |

**User's choice:** Bottom panel

---

## Heat Map Overlay

| Option | Description | Selected |
|--------|-------------|----------|
| Conflict count (Recommended) | Color = number of conflict alerts per file/region | |
| Multi-agent write frequency | Color = number of distinct agents writing recently | |
| Combined score | Weighted: conflict count (heavy) + write frequency (light) | ✓ |

**User's choice:** Combined score
**Notes:** User wanted more nuanced view showing hot zones before conflicts trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Cell background color (Recommended) | Cells shift dark → green → amber → red based on score | ✓ |
| Glow/border effect | Glowing border intensity on cells | |
| Opacity overlay | Semi-transparent colored overlay, toggle-able | |

**User's choice:** Cell background color

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle overlay (Recommended) | Toggle button on radar toolbar, off by default | ✓ |
| Always visible | Heat map always rendered as cell backgrounds | |

**User's choice:** Toggle overlay

---

## History Browsing

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated History view (Recommended) | 5th sidebar view with full-screen space | ✓ |
| Tab within Conflicts view | Tabs: Active / History within Conflicts | |
| Slide-out sidebar panel | Collapsible overlay panel from any view | |

**User's choice:** Dedicated History view

| Option | Description | Selected |
|--------|-------------|----------|
| Tabbed tables (Recommended) | Three tabs: Sessions / Conflicts / Approvals with sortable tables | ✓ |
| Unified timeline | Chronological feed mixing all event types | |
| Session-centric | Expandable session cards with nested conflicts/approvals | |

**User's choice:** Tabbed tables

| Option | Description | Selected |
|--------|-------------|----------|
| File count + top files (Recommended) | Total count on session + junction table for per-file drill-down | ✓ |
| Full file list | Every file path stored in junction table | |
| Count only | Just integer count on session record | |

**User's choice:** File count + top files

---

## Resolution Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit commit button (Recommended) | Resolve hunks, preview, then "Push to Production" writes to disk | ✓ |
| Auto-write per hunk | Each hunk resolution immediately writes to disk | |
| Stage + review | Build up staged diff, review complete merge, then apply | |

**User's choice:** Explicit commit button

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-resolution backup (Recommended) | Save both agent versions + base before writing merged file | ✓ |
| Git-based revert | No AITC backups, user reverts via git | |
| No undo | Resolution is final | |

**User's choice:** Pre-resolution backup

| Option | Description | Selected |
|--------|-------------|----------|
| Notify if capable (Recommended) | Use Phase 4 message delivery: hooks for Claude Code, queued for others, log-only fallback | ✓ |
| Log only | Record in DB, no active notification | |
| Always notify + pause | Notify and request agent to pause/acknowledge | |

**User's choice:** Notify if capable

---

## Claude's Discretion

- Syntax highlighting library for unified diff
- Backup storage strategy
- Hunk detection algorithm
- Heat map color gradient specifics
- Heat map score weighting formula
- History table columns and default sort
- Session file tracking implementation
- History view sidebar icon

## Deferred Ideas

None — discussion stayed within phase scope
