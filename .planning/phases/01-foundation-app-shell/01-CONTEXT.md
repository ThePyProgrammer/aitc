# Phase 1: Foundation + App Shell - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a launchable Tauri v2 desktop application with 4 navigable views (Radar, Tower, Comms, Conflicts) styled to the Command Horizon design system, a command palette for quick navigation, system tray presence, and SQLite database with initial schema and migrations.

</domain>

<decisions>
## Implementation Decisions

### Sidebar Behavior
- **D-01:** Sidebar starts collapsed (icon-only, 80px) on every launch — no persisted state
- **D-02:** Sidebar expands/collapses via a click toggle button (hamburger/chevron) at the top of the sidebar — no hover-to-expand, no keyboard shortcut
- **D-03:** Active view highlighting style is Claude's discretion — pick what fits Command Horizon best

### Command Palette UX
- **D-04:** Command palette opens with Ctrl+Shift+P keyboard shortcut
- **D-05:** Phase 1 palette offers view navigation ("Go to Radar", etc.) plus a recent actions section showing last-visited views
- **D-06:** Search uses fuzzy matching (typing "rad" matches "Radar View")
- **D-07:** Command palette uses glassmorphism floating style — surface-variant (#262626) at 60% opacity with backdrop-filter: blur(20px), centered modal overlay per DESIGN.md "Glass & Gradient" rule

### View Placeholder Content
- **D-08:** Empty views show animated ambient states — subtle animations that make the app feel alive even without agent data (e.g., pulsing indicators, status text)
- **D-09:** Radar empty state uses a minimal pulse animation (central pulsing dot with concentric rings) — NOT a full rotating sweep line
- **D-10:** Each empty view includes a disabled CTA button with tooltip: "Agent management available in a future update" — sets expectations for the full product without creating dead-end clicks

### Window Chrome & System Tray
- **D-11:** Custom title bar (Tauri decorations:false, frameless window) with custom-built window controls (minimize, maximize, close) matching Command Horizon aesthetic
- **D-12:** Clicking the close button (X) minimizes the app to the system tray instead of quitting — app keeps running in background, double-click tray icon to restore
- **D-13:** System tray shows a single static AITC icon in Phase 1 — no color state changes since no agent data exists yet. Right-click menu: "Show" and "Quit"
- **D-14:** App shows a brief branded splash screen (2-3 seconds) on launch with AITC logo and "COMMAND HORIZON" tagline, then opens to Radar view

### Claude's Discretion
- Active view sidebar highlight treatment (D-03) — pick between phosphor green left edge, background fill, or combination based on Command Horizon aesthetic
- Splash screen visual design details — animation style, fade-in/out timing
- Ambient animation specifics for Tower, Comms, and Conflicts empty states (D-08 establishes the pattern, details are flexible)
- System tray icon design (static, so just needs to be recognizable at small size)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Complete Command Horizon design system specification (colors, typography, elevation, components, do's/don'ts)

### Wireframes
- `wireframes/airspace_radar/` — Radar view wireframe and code reference
- `wireframes/agent_control_tower/` — Tower Control view wireframe and code reference
- `wireframes/communications_hub/` — Communications Hub view wireframe and code reference
- `wireframes/conflict_resolution_center/` — Conflict Resolution view wireframe and code reference
- `wireframes/vector_terminal/` — Design system base wireframe (shared chrome, sidebar, color system)

### UI Contract
- `.planning/phases/01-foundation-app-shell/01-UI-SPEC.md` — Phase 1 UI design contract (spacing, typography, color tokens, copywriting, component specs)

### Technology Stack
- `CLAUDE.md` — Technology stack decisions (Tauri v2, React 19, Zustand, Tailwind CSS v4, Canvas 2D, etc.)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing source code — greenfield project. All components built from scratch.

### Established Patterns
- No patterns established yet. Phase 1 sets the foundation patterns for all subsequent phases.

### Integration Points
- Tauri v2 window management APIs for custom title bar and system tray
- SQLite via sqlx for initial database schema
- React Router (or equivalent) for view navigation
- Zustand stores for sidebar state and command palette state

</code_context>

<specifics>
## Specific Ideas

- Splash screen should feel like a "system boot" — matches the ATC instrument cluster metaphor
- Ambient animations in empty views should be subtle enough to not distract but present enough to convey "the system is alive and monitoring"
- The command palette glassmorphism should feel like a HUD overlay appearing over the dark room

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-app-shell*
*Context gathered: 2026-04-07*
