# Phase 1: Foundation + App Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 01-foundation-app-shell
**Areas discussed:** Sidebar behavior, Command palette UX, View placeholder content, Window chrome & system tray

---

## Sidebar Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed (icon-only) | 80px wide, shows only icons. Maximizes workspace. Feels like instrument panel. | ✓ |
| Expanded (icon + label) | 256px wide, shows icons and nav labels. More discoverable for first use. | |
| You decide | Claude's discretion based on wireframe aesthetic. | |

**User's choice:** Collapsed (icon-only)
**Notes:** User wants the instrument panel feel with maximum workspace.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Click toggle button | Explicit hamburger/chevron button. Predictable, no accidental triggers. | ✓ |
| Hover to expand | Expands on mouse hover, collapses when mouse leaves. Can be jittery. | |
| Keyboard shortcut only | Toggle with keybind. No visible toggle button. Minimalist. | |
| Click toggle + keyboard shortcut | Both visible button AND keyboard shortcut. Maximum flexibility. | |

**User's choice:** Click toggle button
**Notes:** None — straightforward preference for predictable behavior.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Phosphor green left edge + text glow | 2px primary left border on active item, subtle text shift. | |
| Full background highlight | surface-container-high background fill. More visible but heavier. | |
| You decide | Claude's discretion — pick what fits Command Horizon best. | ✓ |

**User's choice:** You decide
**Notes:** User defers to Claude for aesthetic judgment on active state styling.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, persist in SQLite | Store sidebar state in local database. Restores on next launch. | |
| No, always start collapsed | Always boot in collapsed state. Simple, predictable. | ✓ |

**User's choice:** No, always start collapsed
**Notes:** Simplicity over persistence for sidebar state.

---

## Command Palette UX

| Option | Description | Selected |
|--------|-------------|----------|
| Ctrl+K | Common in modern tools (Linear, Vercel, Slack). | |
| Ctrl+P | VS Code-style file finder. May conflict with print. | |
| Ctrl+Shift+P | VS Code command palette. More deliberate, avoids accidental triggers. | ✓ |
| You decide | Claude picks based on conflicts and ATC feel. | |

**User's choice:** Ctrl+Shift+P
**Notes:** Familiar developer shortcut, deliberate activation.

---

| Option | Description | Selected |
|--------|-------------|----------|
| View navigation only | Just 'Go to Radar', etc. Minimal but functional. | |
| Navigation + theme/settings | View navigation plus settings commands. Feels more complete. | |
| Navigation + recent actions | View navigation plus recent section showing last-visited views. | ✓ |

**User's choice:** Navigation + recent actions
**Notes:** Prepares UX pattern for future command history.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fuzzy match | Typing 'rad' matches 'Radar View'. Forgiving, fast. | ✓ |
| Prefix match | Only matches from start. Simpler, more predictable. | |
| You decide | Claude picks best approach. | |

**User's choice:** Fuzzy match
**Notes:** Standard modern palette behavior.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, glass overlay | surface-variant at 60% opacity with blur(20px). Matches DESIGN.md. | ✓ |
| No, solid panel | Solid surface-container-high background. Simpler. | |
| You decide | Claude picks based on DESIGN.md and performance. | |

**User's choice:** Yes, glass overlay
**Notes:** Full commitment to Command Horizon glassmorphism aesthetic.

---

## View Placeholder Content

| Option | Description | Selected |
|--------|-------------|----------|
| Static empty state cards | Centered message with icon, heading, body text, CTA button. | |
| Animated ambient states | Subtle ambient animations — pulsing indicators, status text. Feels alive when idle. | ✓ |
| Blueprint/wireframe mode | Ghosted outline of full view with dashed lines and annotations. | |

**User's choice:** Animated ambient states
**Notes:** User wants the app to feel alive even without data. Sells the ATC aesthetic.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, full radar sweep | Rotating green sweep line. 'NO CONTACTS' label. Iconic ATC feel. | |
| Minimal pulse only | Central pulsing dot with concentric rings. No sweep line. Simpler. | ✓ |
| You decide | Claude picks right level of ambient animation. | |

**User's choice:** Minimal pulse only
**Notes:** Ambient but not overdone. Sweep line reserved for when radar is actually active.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, disabled CTA | Show button but disable with tooltip about future update. Sets expectations. | ✓ |
| No CTA yet | Just animation and status text. No dead-end clicks. | |
| Informational text only | Brief description of what view will do. No buttons. | |

**User's choice:** Yes, disabled CTA
**Notes:** Sets expectations for the full product experience.

---

## Window Chrome & System Tray

| Option | Description | Selected |
|--------|-------------|----------|
| Custom title bar | Frameless window with custom-built window controls. More immersive. | ✓ |
| Native title bar | Standard Windows title bar. Familiar, no implementation overhead. | |
| Hybrid | Native controls, custom style. Middle ground. | |

**User's choice:** Custom title bar
**Notes:** Full commitment to the immersive Command Horizon aesthetic.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Minimize to system tray | App keeps running in background. Standard for monitoring tools. | ✓ |
| Close the app | Normal close behavior. App exits completely. | |
| Ask first time, remember choice | First close shows dialog with remember checkbox. | |

**User's choice:** Minimize to system tray
**Notes:** AITC is a monitoring tool that should always be "on".

---

| Option | Description | Selected |
|--------|-------------|----------|
| Single static icon | One AITC icon. No color changes. Right-click: Show, Quit. | ✓ |
| Green 'healthy' icon always | Green state by default. Sets visual language early. | |
| You decide | Claude picks appropriate tray behavior. | |

**User's choice:** Single static icon
**Notes:** No false signals — color states come when real data exists.

---

| Option | Description | Selected |
|--------|-------------|----------|
| No onboarding | Opens directly to Radar. Empty states serve as implicit onboarding. | |
| Brief splash screen | 2-3 second branded splash with logo and tagline. Then Radar view. | ✓ |
| Welcome modal | First-launch modal explaining AITC. Dismissible, shows once. | |

**User's choice:** Brief splash screen
**Notes:** Quick brand moment on boot, then straight to work.

---

## Claude's Discretion

- Active view sidebar highlight treatment
- Splash screen visual design details
- Ambient animation specifics for Tower, Comms, Conflicts empty states
- System tray icon design

## Deferred Ideas

None — discussion stayed within phase scope
