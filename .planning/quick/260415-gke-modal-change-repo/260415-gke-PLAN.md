# Quick Task 260415-gke: Modal Change-Repo dialog

## Goal
Replace the inline confirmation + picker flow in the top-bar Change Repo button with a centered modal, matching the DeployDialog visual pattern. The current inline layout pushes warning text across 3 lines and visually dominates the sticky top bar.

## Context
- Current implementation: `src/components/repo/ChangeRepoButton.tsx`
- Triggers `useRepoStore.changeRepo()` which opens the native folder picker
- Reference modal pattern: `src/views/TowerControl/DeployDialog.tsx` (Motion + AnimatePresence, backdrop blur, ABORT/confirm buttons)

## Must-haves
1. Top bar Change Repo button opens a centered modal instead of an inline confirm row.
2. Modal contains the warning copy ("Switching repositories will stop the current watch. Unsaved agent session data is preserved.") and shows the currently-monitored repo for reference.
3. Primary action "Switch repository" invokes `changeRepo()` (which opens the OS folder picker); secondary action "Keep current repo" / X button closes the modal.
4. Modal dismisses on backdrop click, Escape key, or close button.
5. Motion transitions (opacity + slight y-shift) match DeployDialog for visual consistency.
6. Top-bar layout no longer expands vertically when the flow is active — the modal overlays it.

## Nice-to-haves
- Disable primary action while the picker dialog is already open (prevent double-clicks spawning two pickers).

## Out of scope
- Changing the folder picker itself or the `changeRepo` store logic.
- Adding a repo history dropdown.

## Files likely touched
- `src/components/repo/ChangeRepoButton.tsx` — rewrite to render a trigger button + Modal.
- New component OR inline JSX inside ChangeRepoButton for the modal (prefer inline to keep scope tight).

## Verification
- Click Change Repo → modal appears, top-bar height unchanged.
- Clicking "Switch repository" closes modal and opens the OS folder picker.
- Escape / backdrop click / X button dismisses modal without side effects.
- Existing `repoStore.changeRepo` test still passes (no store contract change).

## Tasks
- [ ] T1 — Rewrite `ChangeRepoButton` to use a Motion-animated modal with backdrop, title, warning body, and two actions. Mirror DeployDialog style tokens (surface/80 backdrop-blur, outline/10 border, font-headline title).
- [ ] T2 — Add Escape-to-close keyboard handler while modal is open; lock scroll on open via body class or overflow-hidden (optional — DeployDialog doesn't do this, so keep parity).
- [ ] T3 — Run `npx tsc --noEmit` and visually compare existing DeployDialog spacing to verify consistency. Commit atomically.
