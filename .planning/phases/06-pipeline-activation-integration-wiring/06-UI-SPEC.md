---
phase: 6
slug: pipeline-activation-integration-wiring
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-11
---

# Phase 6 — UI Design Contract

> Visual and interaction contract for the integration-wiring surfaces added in Phase 6. This phase introduces no new screens; it adds three small UI affordances on top of the existing Command Horizon shell: a **repo picker dialog flow**, a **pause/resume monitoring toggle**, and a **"Change repo" action**. The radar becomes live-updating (no new visual vocabulary — the existing Canvas renderer just refreshes reactively). All values below are derived from existing tokens in `src/styles/theme.css` and the Command Horizon system in `wireframes/vector_terminal/DESIGN.md` — no new design language is introduced.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (custom Command Horizon system, Tailwind v4 CSS-first) |
| Preset | not applicable |
| Component library | none — custom components under `src/components/` (established Phase 1) |
| Icon library | Lucide React (stroke-width 1.5) |
| Font | Space Grotesk (headlines/labels), JetBrains Mono (body/data/paths) |

Source of truth: `src/styles/theme.css` (@theme tokens), `wireframes/vector_terminal/DESIGN.md`.

---

## Spacing Scale

Uses the existing project tokens verbatim (multiples of 4). No new values introduced this phase.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | Icon-to-label gap inside pause/resume pill and "Change repo" button |
| sm | 8px | Horizontal padding of the repo-status strip entries; gap between title-bar controls |
| md | 16px | Dialog content padding; gap between form rows in the folder-picker trigger card |
| lg | 24px | Dialog outer padding; vertical rhythm between dialog sections |
| xl | 32px | Top/bottom padding of the empty-state "No repo selected" block |
| 2xl | 48px | Vertical offset of the centered "Open repository" empty state |
| 3xl | 64px | n/a this phase |

Exceptions: none. Touch targets for the pause/resume toggle and "Change repo" button must be >= 32px tall (reuses existing Button `sm` size from Phase 1).

---

## Typography

All values are existing Command Horizon scales — no new type sizes.

| Role | Size | Weight | Line Height | Font |
|------|------|--------|-------------|------|
| Body (dialog copy, status strip label) | 14px | 400 | 1.5 | JetBrains Mono |
| Label (button text, toggle state, "Change repo") | 12px | 500 | 1.2 | Space Grotesk, uppercase, letter-spacing 0.08em |
| Heading (dialog title "Open repository") | 20px | 500 | 1.2 | Space Grotesk |
| Display (repo path in title bar — monospace truncated middle) | 14px | 400 | 1.2 | JetBrains Mono |

Exactly 4 sizes, 2 weights (400, 500). No weight 600+ anywhere in this phase.

---

## Color

Maps directly to existing `@theme` tokens. 60 / 30 / 10 is the Command Horizon baseline; accent is reserved — this phase does NOT introduce new accent surfaces.

| Role | Value | Token | Usage |
|------|-------|-------|-------|
| Dominant (60%) | `#0e0e0e` | `--color-surface` / `--color-background` | App background; dialog backdrop overlay (at 80% alpha) |
| Secondary (30%) | `#1a1919` / `#201f1f` | `--color-surface-container` / `--color-surface-container-high` | Dialog card surface, repo-status strip background, pause-state pill fill |
| Accent (10%) | `#8eff71` | `--color-primary` (phosphor green) | See "Accent reserved for" below |
| Destructive | `#ff7351` | `--color-error` | "Stop watch" confirmation text in Change-Repo flow only |
| Warning/Amber | `#ffd16f` | `--color-tertiary` | Paused-state indicator (monitoring is off but not a failure) |

**Accent reserved for (exhaustive list for this phase):**
1. The primary CTA button label in the repo picker dialog ("Open repository")
2. The active/running state dot in the pause-resume toggle (pulsing when watching)
3. The current-repo path text in the title-bar repo chip (on hover only — non-hover is `on-surface`)

Accent is NOT used for: the "Change repo" button (neutral text), the pause button chrome (neutral chrome with amber dot when paused), dialog borders, folder-list rows, validation hints.

Error color is NOT used for pause (pausing is not an error). Use `--color-tertiary` (amber) for paused state.

---

## Copywriting Contract

All UI copy for Phase 6 is fixed here. Executor uses these verbatim.

| Element | Copy |
|---------|------|
| Primary CTA (repo dialog) | `Open repository` |
| Secondary CTA (repo dialog) | `Cancel` |
| Dialog title | `Open repository` |
| Dialog body (no CWD repo case) | `No git repository detected in the current working directory. Choose a folder to monitor.` |
| Folder-picker trigger label | `Choose folder...` |
| Empty state heading (no repo ever opened) | `No repository open` |
| Empty state body | `AITC watches a git repository to track agent activity. Open a repo to begin monitoring.` |
| Empty state CTA | `Open repository` |
| Pause toggle (currently watching) | `Pause monitoring` |
| Pause toggle (currently paused) | `Resume monitoring` |
| Pause status chip — watching | `WATCHING` (mono, accent phosphor green, pulsing dot) |
| Pause status chip — paused | `PAUSED` (mono, amber `--color-tertiary`, static dot) |
| Change-repo action label | `Change repo` |
| Change-repo confirmation (destructive sub-action) | `Switching repositories will stop the current watch. Unsaved agent session data is preserved.` |
| Change-repo confirm button | `Switch repository` |
| Change-repo cancel button | `Keep current repo` |
| Error state — picker cancelled | Silent (no toast; restore prior state) |
| Error state — not a git repo | `That folder is not a git repository. Pick a folder containing a .git directory.` |
| Error state — watcher failed to start | `Couldn't start file watcher: {reason}. Try reopening the folder or restarting AITC.` |
| Error state — permission denied | `AITC can't read that folder. Grant access or pick another location.` |

Tone: terse, technical, lowercase sentence copy with capitalized proper nouns (AITC, .git). Labels on buttons/chips are uppercase Space Grotesk per Command Horizon.

---

## Component Inventory (new in Phase 6)

Reuse-first. New components only where none exist.

| Component | Reused / New | Location | Purpose |
|-----------|--------------|----------|---------|
| `RepoPickerDialog` | NEW | `src/components/repo/RepoPickerDialog.tsx` | Modal shown when no repo is resolvable; wraps `@tauri-apps/plugin-dialog` `open({ directory: true })` behind a styled trigger card |
| `RepoStatusChip` | NEW | `src/components/repo/RepoStatusChip.tsx` | Title-bar chip showing truncated repo path + watching/paused state dot |
| `PauseMonitoringToggle` | NEW | `src/components/repo/PauseMonitoringToggle.tsx` | Icon-label button toggling `repoStore.isPaused` |
| `ChangeRepoButton` | NEW | `src/components/repo/ChangeRepoButton.tsx` | Opens confirmation, then re-invokes the picker |
| `Button` (primary/secondary/ghost variants) | REUSED | existing from Phase 1 | All CTAs |
| `Dialog` / modal shell | REUSED | existing from Phase 1 command palette pattern | Modal backdrop + centered surface |
| `StatusBadge` | REUSED | existing from Phase 3/5 | Not extended this phase |
| `Icon` (Lucide) | REUSED | `FolderOpen`, `Pause`, `Play`, `RefreshCw`, `AlertTriangle` | stroke-width 1.5 |

Placement:
- `RepoStatusChip` + `PauseMonitoringToggle` + `ChangeRepoButton` sit in the app title bar, right-aligned, in that order, separated by `sm` (8px) gaps. Title bar height is unchanged from Phase 1.
- `RepoPickerDialog` is a root-level modal mounted by `RepoSessionProvider` (per RESEARCH.md Pattern 1).

---

## Interaction States

| Surface | States Required |
|---------|-----------------|
| `PauseMonitoringToggle` | idle-watching (accent dot pulsing), hover-watching (surface-container-high), pressed-watching, idle-paused (amber dot static), hover-paused, disabled (no active repo — outline dim, tooltip "Open a repository first") |
| `RepoStatusChip` | idle (mono path, `on-surface-variant`), hover (path brightens to `on-surface`, full path revealed in tooltip), focused |
| `ChangeRepoButton` | idle, hover (surface-container-high), pressed, confirming (opens inline confirmation menu, not a nested modal) |
| `RepoPickerDialog` | mounted-initial (focus on primary CTA), picker-open (Tauri native dialog takes focus), validating (spinner inside CTA, CTA disabled), error (inline message under picker trigger, red-ish `--color-error-dim`) |
| Radar (live updating) | no new state — existing idle/active/heatmap states are unchanged; reactive refresh is invisible except for dots moving |

Animation: reuse existing `animations.css` radar pulse for the watching dot. No new keyframes in this phase. Dialog entry/exit uses the existing "Phosphor Transition" (150ms opacity fade + scanline wipe) from DESIGN.md.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none (project does not use shadcn) | not applicable |
| third-party | none | not applicable |

No component registries are used or added. The only new dependency is the first-party `@tauri-apps/plugin-dialog` (plus its Rust counterpart `tauri-plugin-dialog`), which is a Tauri-maintained plugin — not a UI component registry.

---

## Upstream Source Map

| Decision | Source |
|----------|--------|
| Zero-radius corners, Space Grotesk/JetBrains Mono, phosphor greens | `wireframes/vector_terminal/DESIGN.md` (Command Horizon) |
| Exact color hex values | `src/styles/theme.css` @theme tokens (Phase 1) |
| Spacing scale | `src/styles/theme.css` --spacing-* tokens (Phase 1) |
| Repo picker + pause + change-repo affordances | CONTEXT.md decisions D-01, D-03, D-04 |
| Amber (not red) for paused | Authored in this spec: pause is informational, not an error |
| `RepoSessionProvider` as modal host | RESEARCH.md Pattern 1 |
| Radar live-update (no new visuals) | CONTEXT.md D-08 + RESEARCH.md Pattern 2 |
| Copy for "unidentified" passive agents | CONTEXT.md D-06 — but passive-agent visual is already specified in Phase 3/4 UI (unnamed dot); no new copy required here |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
