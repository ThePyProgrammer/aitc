# Phase 9: ARSENAL (Plugin / Skill / Tool / Hook Manager) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b
**Areas discussed:** Resource scope & taxonomy, Watcher integration approach, Page layout & navigation, CLAUDE.md editing UX

---

## Resource Scope & Taxonomy

### Q1: Which Claude resource categories should the manager page surface?
| Option | Description | Selected |
|--------|-------------|----------|
| Skills | ~/.claude/skills/ + cwd/.claude/skills/ — SKILL.md frontmatter (name, description, type). | ✓ |
| Agents | ~/.claude/agents/*.md + cwd/.claude/agents/*.md — markdown files defining sub-agents. | ✓ |
| Plugins | ~/.claude/plugins/installed_plugins.json + marketplaces — list installed plugins, source marketplace, enabled state. | ✓ |
| Hooks + Commands + Settings + MCP | Hook scripts, slash commands, settings.json files (global + project), MCP server configs. Bundled into one 'Configuration' tab. | ✓ |

**User's choice:** All four (multi-select).
**Notes:** Configuration tab acts as the catch-all for non-skill, non-agent, non-plugin resources.

---

### Q2: How should global (~/.claude/) vs project (cwd/.claude/) scopes be presented?
| Option | Description | Selected |
|--------|-------------|----------|
| Merged with origin badge | Single list per category. Each row tagged GLOBAL or PROJECT chip; project items override/shadow global with annotation. | |
| Two columns side-by-side | Global on left, project on right. Visual diff. | |
| Tabs per scope | Top-level tabs: Global / Project / Combined. | ✓ |

**User's choice:** Tabs per scope.
**Notes:** Cleaner separation; user can focus on one scope at a time.

---

### Q3: When project shadows/overrides a global resource of the same name, how do we surface that?
| Option | Description | Selected |
|--------|-------------|----------|
| Show both rows + 'shadowed' annotation | Project row with 'OVERRIDES GLOBAL' chip; global row dimmed underneath with 'SHADOWED' label. | |
| Show only the active (project) one | Hide the shadowed global row to reduce noise. | ✓ |
| Out of scope for v1 | Don't detect overrides yet — flat list from both scopes. | |

**User's choice:** Show only the active (project) one.
**Notes:** Override visualization deferred to future phase.

---

### Q4: What metadata should each resource row display?
| Option | Description | Selected |
|--------|-------------|----------|
| Name + description + scope chip + path | Click to expand/inspect. | ✓ |
| Just name + scope chip | Minimal density; everything else in detail panel. | |
| Name + description + scope + last-modified + file size | Full audit-log style row. | |

**User's choice:** Name + description + scope chip + path.
**Notes:** Matches the "what does Claude have access to" goal directly.

---

## Watcher Integration Approach

### Q1: How should ~/.claude/ and cwd/.claude/ filesystem changes be watched?
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated second watcher actor | Spawn a separate notify-debouncer-full per scope. Independent lifecycle. | |
| Extend existing pipeline watcher | Add ~/.claude and cwd/.claude as additional watch roots inside the existing pipeline. Single Debouncer, single Channel<T>. | ✓ |
| Polling instead of watcher | Cheap re-scan every N seconds. Doesn't match the phase's 'via the watcher' wording. | |

**User's choice:** Extend existing pipeline watcher.
**Notes:** Single Debouncer + path-based fan-out; need scope-aware ignore filter.

---

### Q2: How should resource events flow to the frontend?
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated claudeResourcesStore + Channel<T> | New Zustand store; backend pushes structured ResourceEvent over its own Channel<T>. | ✓ |
| Reuse pipelineStore with a 'kind' discriminator | Tag events as kind=claude_resource; mixes domains in one ring buffer. | |
| Pull-based: invoke list_claude_resources on focus + manual refresh | No streaming; watcher only invalidates a cache. | |

**User's choice:** Dedicated claudeResourcesStore + Channel<T>.
**Notes:** Combined with Q1 → single backend watcher, two channels routed by path.

---

### Q3: Where should resource parsing (frontmatter, JSON) happen?
| Option | Description | Selected |
|--------|-------------|----------|
| Rust backend | Backend parses SKILL.md frontmatter, settings.json, installed_plugins.json into typed structs. | ✓ |
| Frontend TypeScript | Backend just emits raw file events; frontend parses YAML/JSON. | |
| Hybrid | Backend parses well-known formats; frontend handles ad-hoc cases. | |

**User's choice:** Rust backend.
**Notes:** Type-safe via tauri-specta bindings.

---

### Q4: When the file watcher emits an event, should we re-parse incrementally or re-scan the whole scope?
| Option | Description | Selected |
|--------|-------------|----------|
| Incremental | Re-parse only the changed file, update one row in the store. | ✓ |
| Full re-scan on any event | Walk the whole .claude/ tree on every debounced batch. | |
| Debounced full re-scan (250-500ms) | Coalesce a burst of events, then re-scan once. | |

**User's choice:** Incremental.
**Notes:** Initial mount does a full scan; subsequent events update affected rows only.

---

## Page Layout & Navigation

### Q1: How should the manager page be laid out?
| Option | Description | Selected |
|--------|-------------|----------|
| Master/detail (left list, right detail) | Left rail: category list. Center: filtered rows. Right detail panel: selected resource. | ✓ |
| Tabs across top + scrollable list | Top tabs per category, single scrollable list below. | |
| Single long page with category sections | Everything visible at once, sectioned. | |

**User's choice:** Master/detail.
**Notes:** First master/detail layout in the app — plan should standardize the primitive.

---

### Q2: Where should the nav entry live in the sidebar?
| Option | Description | Selected |
|--------|-------------|----------|
| New top-level item, last position | Append after HISTORY. | |
| New top-level item, after TOWER | Insert near TOWER. Order: RADAR / TOWER / [NEW] / COMMS / CONFLICTS / HISTORY. | ✓ |
| Nested under TOWER | Sub-view of TOWER; requires expanding sidebar nav model. | |

**User's choice:** New top-level item, after TOWER.

---

### Q3: What's the page label and route?
| Option | Description | Selected |
|--------|-------------|----------|
| TOOLKIT / /toolkit | Fits ATC vocabulary. | |
| ARSENAL / /arsenal | More aggressive ATC vibe. 'What tools the agents are armed with'. | ✓ |
| CONFIG / /config | Plain and obvious. | |
| MANIFEST / /manifest | ATC term for 'list of cargo'. | |

**User's choice:** ARSENAL / /arsenal.

---

### Q4: Should the page support search/filter across all resources?
| Option | Description | Selected |
|--------|-------------|----------|
| Inline filter input per category | Single text field that filters the current category's rows. | ✓ |
| Global search across all categories | Top search bar across every category, grouped results. | |
| No search — just scroll | Defer until needed. | |

**User's choice:** Inline filter input per category.

---

## CLAUDE.md Editing UX

### Q1: Where should CLAUDE.md edits happen?
| Option | Description | Selected |
|--------|-------------|----------|
| Inline editor in the right detail panel | Textarea/markdown editor with Save/Discard. No modal switch. | ✓ |
| Modal editor | Edit button opens a centered modal full-screen-ish. | |
| Hand off to system editor | Spawn $EDITOR or `code <path>`. | |

**User's choice:** Inline editor in the right detail panel.

---

### Q2: Which CLAUDE.md files are editable from this page?
| Option | Description | Selected |
|--------|-------------|----------|
| cwd/CLAUDE.md | Project root CLAUDE.md. | ✓ |
| cwd/.claude/CLAUDE.md | Project-local Claude-specific CLAUDE.md. | ✓ |
| ~/.claude/CLAUDE.md | Global user CLAUDE.md (higher blast radius). | |
| Any CLAUDE.md found by the watcher | Including nested ones. | |

**User's choice:** cwd/CLAUDE.md and cwd/.claude/CLAUDE.md only.
**Notes:** Global ~/.claude/CLAUDE.md is read-only this phase.

---

### Q3: Should we show a diff before saving?
| Option | Description | Selected |
|--------|-------------|----------|
| Direct save with undo toast | Save writes immediately; toast offers Undo for ~10s. | ✓ |
| Show diff modal then confirm | 2-pane diff before write. | |
| Auto-save on every change (debounced) | No save button. | |

**User's choice:** Direct save with undo toast.

---

### Q4: What happens when the file changes externally while the editor has unsaved edits?
| Option | Description | Selected |
|--------|-------------|----------|
| Banner warning + 'Reload / Keep mine / View diff' | Non-blocking banner above the editor. | ✓ |
| Auto-reload (lose unsaved edits) | Reload silently. | |
| Block external changes from showing in editor | Editor stays on in-memory snapshot. | |

**User's choice:** Banner warning + Reload / Keep mine / View diff.
**Notes:** Mirrors VS Code's "file changed on disk" pattern.

---
