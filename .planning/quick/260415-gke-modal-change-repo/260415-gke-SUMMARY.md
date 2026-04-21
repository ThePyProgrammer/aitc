---
task_id: 260415-gke
type: quick
status: complete
completed: 2026-04-15
duration: ~15min
tasks: 3
commits:
  - ab94b96
  - c273caa
key-files:
  modified:
    - src/components/repo/ChangeRepoButton.tsx
---

# Quick Task 260415-gke: Modal Change-Repo Dialog Summary

Replaced the inline confirmation row in the top-bar Change Repo button with a centered Motion-animated modal that mirrors DeployDialog's visual language (480px width, `surface/80` + `backdrop-blur-xl`, `outline/10` border, 150ms opacity + y-shift). The sticky top bar no longer expands vertically during the confirm flow.

## What Changed

**`src/components/repo/ChangeRepoButton.tsx`** — rewritten.

- Trigger button (unchanged styling, uses `RefreshCw` icon) now opens a modal instead of swapping to an inline row.
- Modal structure mirrors `DeployDialog`:
  - Header with `CHANGE_REPO` title and `X` close button
  - Body shows the currently monitored repo (path in mono, truncated with `title` tooltip) plus the warning copy "Switching repositories will stop the current watch. Unsaved agent session data is preserved."
  - Footer actions: `KEEP_CURRENT` (ghost) and `SWITCH_REPO` (primary) using the shared `Button` component.
- Primary action delegates to `useRepoStore.changeRepo()` unchanged — store contract preserved.
- Dismissal paths: backdrop click, X button, `KEEP_CURRENT`, **Escape key**.
- Primary action disables while `switching` is true (prevents double-spawning the native picker).
- Modal closes *before* invoking `changeRepo()` so the OS folder picker owns the foreground.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| T1 | Rewrite ChangeRepoButton with Motion-animated modal, mirroring DeployDialog tokens | `ab94b96` |
| T2 | Add Escape-to-close keyboard handler (listener registered only while open) | `c273caa` |
| T3 | `npx tsc --noEmit` run — only pre-existing unrelated errors in `src/bindings.ts` / `src/__tests__/theme.test.ts`; no new errors introduced | (verification only, no commit) |

## Verification

- `npx tsc --noEmit` — passes (pre-existing bindings.ts/theme.test.ts errors unchanged; no new errors from this change).
- Visual tokens match DeployDialog: `w-[480px]`, `bg-surface/80 backdrop-blur-xl border border-outline/10`, 150ms transitions, `font-headline text-sm font-bold uppercase tracking-widest` title.
- `useRepoStore.changeRepo` is untouched (no store contract change); existing repoStore tests still apply.
- Dismissal paths: backdrop `onClick` on outer motion.div (with `stopPropagation` on inner), X button `onClick`, `KEEP_CURRENT` button `onClick`, Escape keydown listener.
- ARIA: `role="dialog"`, `aria-modal="true"`, `aria-label="Change monitored repository"`, labeled close button.

## Deviations from Plan

None — plan executed as written. Escape handler (a nice-to-have in constraints, required in plan must-haves #4) is included via T2.

Note on T2 scope: the plan listed optional "lock scroll on open" parity with DeployDialog. DeployDialog doesn't lock scroll, so we preserved parity by not locking scroll (matches plan guidance "keep parity").

## Self-Check: PASSED

- `src/components/repo/ChangeRepoButton.tsx` — FOUND (modified).
- Commit `ab94b96` — FOUND.
- Commit `c273caa` — FOUND.
