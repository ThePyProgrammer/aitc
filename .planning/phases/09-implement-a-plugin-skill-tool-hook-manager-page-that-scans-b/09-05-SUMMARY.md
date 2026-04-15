---
phase: 09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b
plan: 05
subsystem: arsenal
tags: [arsenal, ui, view, editor, claude-md, wave-3]
status: awaiting-human-verify
one_liner: "ARSENAL view assembly — sidebar + route + view components + ClaudeMdEditor save/undo flow; Tasks 1+2 complete; Task 3 (human-verify) pending."
requires:
  - src/App.tsx router
  - src/components/layout/Sidebar.tsx navItems
  - Wave 2 store + hook + layout primitive (09-04)
provides:
  - src/views/Arsenal/ArsenalView.tsx
  - src/views/Arsenal/ScopeTabs.tsx
  - src/views/Arsenal/CategoryRail.tsx
  - src/views/Arsenal/ResourceList.tsx
  - src/views/Arsenal/ResourceRow.tsx
  - src/views/Arsenal/DetailPanel.tsx
  - src/views/Arsenal/FrontmatterTable.tsx
  - src/views/Arsenal/ContentPreview.tsx
  - src/views/Arsenal/ClaudeMdEditor.tsx
  - src/views/Arsenal/EmptyState.tsx
affects:
  - src/App.tsx (+/arsenal route)
  - src/components/layout/Sidebar.tsx (ARSENAL nav item)
tech-stack:
  added: []
  patterns: [master-detail-shell, tanstack-virtual, tauri-specta-invoke]
key-files:
  created:
    - src/views/Arsenal/ArsenalView.tsx
    - src/views/Arsenal/ScopeTabs.tsx
    - src/views/Arsenal/CategoryRail.tsx
    - src/views/Arsenal/ResourceList.tsx
    - src/views/Arsenal/ResourceRow.tsx
    - src/views/Arsenal/DetailPanel.tsx
    - src/views/Arsenal/FrontmatterTable.tsx
    - src/views/Arsenal/ContentPreview.tsx
    - src/views/Arsenal/ClaudeMdEditor.tsx
    - src/views/Arsenal/EmptyState.tsx
    - src/views/Arsenal/__tests__/ArsenalView.test.tsx
    - src/views/Arsenal/__tests__/ArsenalView.keyboard.test.tsx
    - src/views/Arsenal/__tests__/ClaudeMdEditor.test.tsx
  modified:
    - src/App.tsx
    - src/components/layout/Sidebar.tsx
decisions:
  - "CONFIGURATION category groups [hook, command, settings, mcp, claudeMd] so CLAUDE.md rows are reachable (BLOCKER 4)"
  - "cwd threaded ArsenalView → DetailPanel → ClaudeMdEditor for readClaudeMd/writeClaudeMd (BLOCKER 3)"
  - "ContentPreview reuses readClaudeMd as a generic text-file reader (WARNING 3)"
  - "ARSENAL_EMPTY headline reserved but not wired — category-specific empty headlines always win for now"
metrics:
  duration: "Task 1+2 complete; Task 3 human-verify pending"
  completed_date: 2026-04-15
---

# Phase 9 Plan 5: ARSENAL View Assembly Summary (Pre-Verify)

## Status

Tasks 1 and 2 executed and committed. Task 3 is a `type="checkpoint:human-verify"` gate that requires the user to run the 12-step verification script manually against `npm run tauri dev`. This summary captures what was built and what awaits verification.

## Commits

- `1334734` — feat(09-05): add ARSENAL sidebar entry + /arsenal route + view scaffold (Task 1)
- `1c79297` — feat(09-05): add ARSENAL list/detail/editor components + save-undo flow (Task 2)

## What's Ready for Verification

**Sidebar + routing:**
- `Sidebar.tsx` navItems order is RADAR / TOWER / ARSENAL / COMMS / CONFLICTS / HISTORY (D-10).
- Lucide `Package` icon at strokeWidth 1.5 for ARSENAL.
- `App.tsx` router maps `{ path: 'arsenal', element: <ArsenalView /> }` under `<AppShell />`.

**View composition:**
- `ArsenalView` mounts `useClaudeResourcesChannel().start(activeRepo)` on mount, tears down on unmount. activeRepo sourced from `useRepoStore`.
- `MasterDetailShell` header / tabs / rail / list / detail slots wired.
- Local state: `activeCategory` (UiCategory), `activeScope` (ScopeTab), `filter`, `selectedId`.
- D-03 shadow suppression applied when activeScope === 'combined'.
- Rail counts respect the shadow rule at category level.
- Global `/` keyboard shortcut focuses the filter input (ignored while typing in INPUT/TEXTAREA).
- `phosphor-in 150ms ease` animation on the view root matches other views.

**Master/detail components:**
- `ScopeTabs` — GLOBAL / PROJECT / COMBINED, role=tablist/tab, 11px bold widest uppercase.
- `CategoryRail` — SKILLS / AGENTS / PLUGINS / CONFIGURATION with Lucide icons + count badges. `categoryGroup('configuration')` includes `'claudeMd'` (BLOCKER 4 acceptance criterion met).
- `ResourceList` — filter input (h-12), `@tanstack/react-virtual` estimateSize 56, role=listbox with arrow-key nav, Esc clears filter, auto-drops selection when the selected row leaves the filtered view.
- `ResourceRow` — h-14, Lock affordance for read-only, name + description + ScopeChip + truncated path.
- `DetailPanel` — PATH / METADATA / (CONTENT or EDIT) sections; ScopeChip + Lock header; routes to `ClaudeMdEditor` for `kind: 'claudeMd'` rows, else `ContentPreview`. Declares `cwd: string | null` prop (BLOCKER 3).
- `FrontmatterTable` — exhaustive switch over the tagged ResourceMetadata union; array fields comma-joined; missing fields render `—`.
- `ContentPreview` — loads via `invoke('readClaudeMd', { path, cwd })` (WARNING 3 reuse); error + loading states.
- `ClaudeMdEditor` — textarea, Save/Discard with two-click Discard confirmation, `UndoToast` on success, `SimpleToast` variants for `SAVE_FAILED — {filename}` (8s, error stripe) and `RESTORED — {filename}` (3s, primary stripe) per BLOCKER 5. Ctrl/Cmd+S saves, Esc triggers Discard when dirty / blurs when clean, ExternalChangeBanner renders when dirty + externalEdits stamps the path, silent reload when clean.
- `EmptyState` — frozen UI-SPEC copy for NO_SKILLS_INSTALLED / NO_AGENTS_REGISTERED / NO_PLUGINS_INSTALLED / NO_CONFIGURATION. ARSENAL_EMPTY headline reserved in the module as a commented future refinement.

**Acceptance criteria grep evidence:**
- `label: 'ARSENAL'` — Sidebar.tsx (1 match, correct entry)
- `icon: Package` — Sidebar.tsx (correct entry only)
- `path: 'arsenal'` — App.tsx (1 match)
- `'claudeMd'` — CategoryRail.tsx (in the CONFIGURATION group)
- `SAVE_FAILED — ` + `RESTORED — ` — ClaudeMdEditor.tsx
- `READ-ONLY — ~/.claude/CLAUDE.md editing is disabled this phase.` — ClaudeMdEditor.tsx
- `CONFIRM DISCARD` — ClaudeMdEditor.tsx
- `writeClaudeMd` + `readClaudeMd` — ClaudeMdEditor.tsx + ContentPreview.tsx
- `cwd: string | null` — ClaudeMdEditor.tsx + DetailPanel.tsx
- `estimateSize: () => 56` — ResourceList.tsx

## Tests

| File | Assertions | Status |
| --- | --- | --- |
| `ArsenalView.test.tsx` | 5 (heading, tabs, rail, start() called, empty state) | PASS |
| `ArsenalView.keyboard.test.tsx` | 3 (`/` focuses filter, ↓ moves selection, Esc clears filter) | PASS |
| `ClaudeMdEditor.test.tsx` | 11 (load/save/undo/discard/external-edit/readonly/ctrl-s/save-failed/restored/silent-reload/generic-reader) | PASS |

Total: **19/19 Arsenal tests green.** Full frontend suite: 269 passed + 4 todo. One pre-existing unrelated failure in `src/stores/__tests__/agentStore.test.ts` (mock mismatch for `options: null`) confirmed present on clean HEAD before this plan — not caused by Phase 9 work; will be handled outside this plan.

`npx tsc --noEmit` — clean (only pre-existing `bindings.ts` generator errors).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Narrowing compile error in `ResourceRow.isReadOnly`**
- **Found during:** Task 2 typecheck.
- **Issue:** After the `if (kind === 'claudeMd') return …` branch, the fallback comparison `metadata.kind !== 'claudeMd'` was always-true on the narrowed union and TypeScript rejected it.
- **Fix:** Return `true` directly — everything other than an editable CLAUDE.md is read-only in v1.
- **Files modified:** `src/views/Arsenal/ResourceRow.tsx`
- **Commit:** 1c79297

**2. [Rule 1 - Bug] Empty-state default headline**
- **Found during:** Task 1 test run.
- **Issue:** Plan acceptance test requires `NO_SKILLS_INSTALLED` for the default empty-store view (skill category, combined scope), but an `allCategoriesEmpty && scope === 'combined'` override would have emitted `ARSENAL_EMPTY` instead.
- **Fix:** Drop the override; category-specific headlines always win. `ARSENAL_EMPTY` remains in the copy inventory but unused — documented in the EmptyState module as a future refinement.
- **Files modified:** `src/views/Arsenal/EmptyState.tsx`
- **Commit:** 1334734

**3. [Rule 3 - Blocker] TanStack Virtual returns zero rows in jsdom**
- **Found during:** Task 2 keyboard test run.
- **Issue:** `useVirtualizer` computes zero visible rows when `offsetHeight === 0`, which is the default in jsdom — blocking the arrow-key navigation assertion.
- **Fix:** Stub `HTMLElement.prototype.offsetHeight/offsetWidth/clientHeight/clientWidth` to 600/800 in the keyboard test's `beforeEach`. Test-only change; production unaffected.
- **Files modified:** `src/views/Arsenal/__tests__/ArsenalView.keyboard.test.tsx`
- **Commit:** 1c79297

**4. [Rule 3 - Blocker] Default `invoke` mock returned `undefined`, ContentPreview threw on `.then`**
- **Found during:** Task 2 keyboard test run.
- **Issue:** Clicking a row mounts `DetailPanel → ContentPreview`, which calls `invoke(...).then(...)`; the bare `vi.fn()` mock returned undefined, causing a React commit-phase error.
- **Fix:** Point the default invoke mock at `mockResolvedValue({ content: '', editable: false, path: '' })` so ContentPreview resolves benignly in the keyboard test.
- **Files modified:** `src/views/Arsenal/__tests__/ArsenalView.keyboard.test.tsx`
- **Commit:** 1c79297

### Architectural notes

None — the plan was executed as specified. `ARSENAL_EMPTY` wiring is a deferred refinement (documented inline) rather than a deviation.

## Pending — Task 3 Human Verification Checklist

**Cannot be automated by the executor (per plan: `type="checkpoint:human-verify"`, `autonomous: false`).** User must run:

```
npm run tauri dev
```

then walk through the 12-step script in `09-05-PLAN.md <how-to-verify>`:

1. Build and launch; splash → main window.
2. Sidebar order RADAR / TOWER / ARSENAL / COMMS / CONFLICTS / HISTORY with Package icon.
3. Navigate to ARSENAL; verify heading, scope tabs, category rail populates within ~1s.
4. `/` focuses filter input; 3-4 chars filter rows live; Esc clears.
5. Arrow-key list nav; Enter focuses detail panel.
6. Click a skill; PATH / METADATA / CONTENT populate.
7. CLAUDE.md editor smoke — type " test ", Save, UNDO within 10s; then type " test2 ", Save, wait 10s, `cat CLAUDE.md` confirms persistence; reset.
8. External-change banner test — echo append while textarea is dirty → banner appears within ~500ms → RELOAD two-click confirm reloads disk content.
9. `~/.claude/CLAUDE.md` read-only banner (if exists on machine).
10. Shadow suppression (D-03) on a shared-name skill.
11. `touch ~/.claude/skills/<existing-skill>/SKILL.md` within 500ms updates the row.
12. Teardown — RADAR ↔ ARSENAL navigation; close/reopen preserves state.

**Resume signal:** user types "approved" or reports specific failures with step number.

## D-01..D-15 Honoring (pre-verify audit)

| Decision | Honored by |
| --- | --- |
| D-01 (4 categories) | `CategoryRail` items array |
| D-02 (scope tabs) | `ScopeTabs` |
| D-03 (shadow suppression) | `ArsenalView.shadowSuppress` + `selectCombined` selector |
| D-04 (row columns) | `ResourceRow` |
| D-05/06/07/08 (watcher plumbing) | Inherited from Waves 0-2 (verified by prior SUMMARYs) |
| D-09 (master/detail) | `MasterDetailShell` (Wave 2) |
| D-10 (sidebar slot) | `Sidebar.tsx` navItems order + `/arsenal` route |
| D-11 (per-category filter) | `ResourceList` filter input + onChange pipe |
| D-12 (inline editor) | `ClaudeMdEditor` mounted inside `DetailPanel` |
| D-13 (editable CLAUDE.md only) | Backend-owned (Plan 03 `is_editable`); editor forwards `cwd` prop (BLOCKER 3) |
| D-14 (save + undo toast) | `ClaudeMdEditor.handleSave/handleUndo` + `UndoToast` |
| D-15 (external-change banner) | `ExternalChangeBanner` + `externalEdits[path]` subscription |

## Known Stubs

None. All components are wired to real data sources (store selectors + invoke commands). `ARSENAL_EMPTY` headline is unused but annotated in the EmptyState module as a reserved copy token for a future banner refinement — not a rendering stub.

## Self-Check: PENDING FINAL UPDATE

The self-check block will be finalized (commits + file existence reverified, STATE.md/ROADMAP.md advanced) after the user completes Task 3 and approves the human-verify checkpoint. Deferring STATE + ROADMAP updates per orchestrator instruction that the executor pauses at human-verify.
