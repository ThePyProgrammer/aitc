# Phase 4: Core UI Views - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 04-core-ui-views
**Areas discussed:** Comms Hub layout, Approval workflow, Radar spatial mapping, Agent chat interface

---

## Comms Hub Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Match wireframe closely | 3 panels: request queue left, detail center, telemetry/chat right | ✓ |
| Simplified 2-panel | Drop right telemetry panel, request queue left, detail right | |
| You decide | Claude picks layout | |

**User's choice:** Match wireframe closely
**Notes:** 3-panel layout with full wireframe faithfulness

---

| Option | Description | Selected |
|--------|-------------|----------|
| Telemetry + mini agent chats | System load metrics, telemetry feed, plus mini expandable chat cards | ✓ |
| Agent activity only | Skip telemetry, show only agent mini-cards with recent activity | |
| You decide | Claude picks panel content | |

**User's choice:** Telemetry + mini agent chats
**Notes:** Information-dense right panel matching wireframe

---

| Option | Description | Selected |
|--------|-------------|----------|
| Color-coded status badges | Green/amber/red badges on each request card, sorted by time | ✓ |
| Chronological only | No priority indicators, simple time-ordered list | |
| You decide | Claude picks queue presentation | |

**User's choice:** Color-coded status badges
**Notes:** Consistent with Phase 3 StatusBadge component patterns

---

| Option | Description | Selected |
|--------|-------------|----------|
| Inline diff with syntax highlighting | Green/red highlighted lines in monospace code block | ✓ |
| Side-by-side diff | Before/after columns side by side | |
| You decide | Claude picks diff presentation | |

**User's choice:** Inline diff with syntax highlighting
**Notes:** JetBrains Mono per design system, matches COMM-03 requirement

---

## Approval Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Inline edit in diff view | Click line to edit, modify code directly in approval panel | ✓ |
| Separate edit modal | Modal with full code editor for proposed changes | |
| Text note only | Text description of desired changes, agent interprets | |
| You decide | Claude picks approach | |

**User's choice:** Inline edit in diff view
**Notes:** Minimal friction, stays in context

---

| Option | Description | Selected |
|--------|-------------|----------|
| Inline text input | Text field appears in detail panel, sends to agent, request stays pending | ✓ |
| Convert to chat thread | Transitions request into full chat thread | |
| You decide | Claude picks interaction pattern | |

**User's choice:** Inline text input
**Notes:** Same pattern as wireframe's message input

---

| Option | Description | Selected |
|--------|-------------|----------|
| Hook-based for Claude Code, simulated for others | Claude Code hooks generate real requests; other agents get synthetic requests on protected path writes | ✓ |
| Claude Code hooks only | Only Claude Code generates approval requests | |
| Manual trigger | User manually creates approval checkpoints | |
| You decide | Claude designs strategy | |

**User's choice:** Hook-based for Claude Code, simulated for others
**Notes:** User-configured protected paths (e.g., /src/config.ts, /migrations/**, /package.json)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Hook response for Claude Code, log-only for others | Claude Code blocks until decision; others get audit trail + alert | ✓ |
| All agents block | SIGSTOP/SIGCONT for all agents | |
| You decide | Claude designs response mechanism | |

**User's choice:** Hook response for Claude Code, log-only for others
**Notes:** Honest about what's technically possible per agent type

---

## Radar Spatial Mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Treemap layout | Directories = nested rectangles, files = cells, agent dots on cells | ✓ |
| Radial/circular layout | Root at center, directories as concentric rings | |
| Force-directed graph | Physics simulation positioning nodes | |
| You decide | Claude picks algorithm | |

**User's choice:** Treemap layout
**Notes:** Scales well to 10k+ files, intuitive directory-to-region mapping, matches VIZN-05

---

| Option | Description | Selected |
|--------|-------------|----------|
| Pulsing dots with lead lines | Colored dots with pulse animation, lead lines to touched files, hover tooltips | ✓ |
| Simple static dots | Colored dots without animation, click for details | |
| You decide | Claude designs dot behavior | |

**User's choice:** Pulsing dots with lead lines
**Notes:** Matches wireframe + VIZN-02 trajectory requirement

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, zoom + pan | Mouse wheel zoom, click-drag pan, progressive detail levels | ✓ |
| Zoom only, no pan | Mouse wheel zoom, auto-center on target | |
| You decide | Claude decides navigation model | |

**User's choice:** Yes, zoom + pan
**Notes:** Essential for VIZN-04 (10k+ files). 1x/3x/8x progressive detail levels

---

| Option | Description | Selected |
|--------|-------------|----------|
| Right-side agent manifest | Collapsible panel listing agents with status, mini Tower Control | ✓ |
| No sidebar, dots only | Full-screen canvas, info only via tooltips/clicks | |
| You decide | Claude decides based on wireframe | |

**User's choice:** Right-side agent manifest
**Notes:** Matches wireframe, shows agent details and alert log

---

## Agent Chat Interface

| Option | Description | Selected |
|--------|-------------|----------|
| Dual: inline + mini cards | Message input in detail panel + mini chat cards in right sidebar | ✓ |
| Single chat panel | One unified chat view in detail panel only | |
| You decide | Claude designs chat layout | |

**User's choice:** Dual: inline + mini cards
**Notes:** Match wireframe, click mini card to expand to full chat

---

| Option | Description | Selected |
|--------|-------------|----------|
| Claude Code hooks + queue for others | Claude Code via hooks (bidirectional), others via DB queue, delivery status indicators | ✓ |
| Stdin/stdout pipe | Pipe messages to launched agent stdin | |
| Log-only (no delivery) | Messages recorded but not delivered | |
| You decide | Claude designs delivery strategy | |

**User's choice:** Claude Code hooks + queue for others
**Notes:** Show delivery status: ✔ delivered | ⏳ queued | ✖ unsupported

---

| Option | Description | Selected |
|--------|-------------|----------|
| Threaded conversation | Full chat thread per agent, scrollable timeline, persisted in SQLite | ✓ |
| Single messages only | Fire-and-forget messages, no thread history | |
| You decide | Claude decides chat complexity | |

**User's choice:** Threaded conversation
**Notes:** Messages persist for Phase 5 session history (HIST-03)

---

## Claude's Discretion

- Treemap algorithm variant (squarified vs strip vs slice-and-dice)
- Canvas 2D render loop optimization strategy
- Protected path configuration UI design
- Chat message persistence schema
- Mini chat card animations
- Telemetry feed data sources and refresh interval
- Agent dot color assignment strategy

## Deferred Ideas

None — discussion stayed within phase scope
