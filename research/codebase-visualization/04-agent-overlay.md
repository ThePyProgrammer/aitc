# Agent Overlay & ATC Radar Patterns

> How to show AI agents moving across a codebase map. Adapted from decades of Air Traffic Control display research, collaborative editing, and RTS game minimaps.

## Prior Art: 11 Domains Analyzed

### Air Traffic Control Radar (most mature)

ATC displays have been refined over 50+ years through FAA and EUROCONTROL human factors research. Each aircraft (agent) on the radar shows:

- **Target symbol** -- small dot/cross at current position
- **Data block** -- rectangular text label with callsign, altitude, speed, destination
- **Leader line** -- thin line connecting data block to target (repositionable to reduce clutter)
- **History trail** -- 4-6 prior position dots in muted blue, fading with age
- **Velocity vector** -- line extending from target in direction of travel, length = predicted distance in 1-5 minutes

**Color coding (EUROCONTROL):**
- Green: active, normal
- Amber: advisory, coordination needed
- Red: conflict alert, separation violation
- Blue/grey: history trails, inactive
- White: uncorrelated, system messages

### TCAS / Short-Term Conflict Alert

Three-tier escalation model for when aircraft get too close:

| Level | TCAS Term | Trigger | Response |
|-------|-----------|---------|----------|
| Normal | No alert | Adequate separation | Standard display |
| Advisory (TA) | Traffic Advisory | Proximity threshold | Amber circle, increased attention |
| Warning (RA) | Resolution Advisory | Imminent conflict | Red symbol, blinking, voice alert, evasive action |

STCA uses a **2-minute look-ahead** to predict conflicts before they happen.

### Collaborative Editing (Figma, VS Code Live Share)

- Colored cursors with avatar labels
- Real-time position tracking (latency < 100ms)
- "Follow mode" -- camera snaps to another user's viewport
- MIT CSAIL research defines 2-axis design space: **situatedness** (overlaid vs external) x **specificity** (generic vs custom)

### RTS Game Minimaps (StarCraft)

- Three-tier fog-of-war: unexplored (black) / explored (dim) / visible (bright)
- Color-coded unit dots (green=friendly, red=enemy)
- Click-to-navigate -- clicking minimap jumps main viewport
- Unit movement trails in some games

## Recommended Agent Representation

### 4 Modes (togglable, not mutually exclusive)

| Mode | Visual | When to Use | Perf Cost |
|------|--------|-------------|-----------|
| **Dot** | Colored circle at last-touched file | Default -- simple, low noise | Minimal |
| **Trail** | 6-point history trail with opacity decay | Tracking movement patterns | Low (6 dots per agent) |
| **Heatmap** | File-level color intensity by touch count | Retrospective "where did the agent work?" | Medium (per-node color lookup) |
| **Territory** | Voronoi zones colored per agent | "Who owns what?" overview | High (Voronoi computation) |

### What We Already Have

AITC's current implementation covers parts of Dot + Trail:
- **Agent dots** -- colored circles at last-touched file position (`drawAgentDots` in CometTrail.ts)
- **Comet trails** -- gradient-stroked polylines with 400ms head travel + 10s opacity decay (`drawCometTrails`)
- **Pulse rings** -- expanding rings while agent is active, suppressed after 30s idle
- **Conflict pulses** -- expanding red rings on contended files (RadarCanvas.tsx)

### What Phase 15 Adds

1. **Data blocks** (ATC-style labels on leader lines):
```
┌─────────────────────────┐
│ CLAUDE-CODE             │  agent callsign
│ src/views/Radar/...tsx  │  current file
│ ACTIVE  12 files/5min   │  activity rate
│ ▸ "Implementing themes" │  intent (if available)
└─────────────────────────┘
       │
       │  leader line (repositionable)
       ▼
       ● agent dot
```

2. **6-point history trail** (replacing current continuous comet):
   - 6 discrete positions (like ATC radar dots)
   - Exponential opacity decay: position 1 = 100%, 2 = 60%, 3 = 36%, 4 = 22%, 5 = 13%, 6 = 8%
   - 60-second total lifetime
   - More readable than continuous gradient at any zoom level

3. **Velocity vectors** -- line extending from agent dot showing predicted movement direction, based on recent file access pattern

4. **3-tier conflict escalation** (adapted from TCAS):

| Tier | Trigger | Visual | Current AITC State |
|------|---------|--------|--------------------|
| **Advisory** | Same directory | Agent dots turn amber | Not implemented |
| **Warning** | Same file | Pulsing orange ring | Partially (conflict pulse) |
| **Critical** | Same function/lines | Red expanding ring + blinking badge | Not implemented |

## Trail Persistence & Decay

Based on ATC history trail research and cognitive load studies:

- **Keep it short** -- 6 positions max. ATC research shows 4-6 history dots are optimal for tracking without overwhelming.
- **Exponential decay** -- each position at 60% opacity of the previous. Most recent is vivid, oldest is barely visible.
- **60-second lifetime** -- trails fade completely after 1 minute of no new file events from that agent.
- **Idle detection** -- after 30 seconds, pulse rings stop but the center dot remains. After 60 seconds, the trail fades but the dot stays at last-known position.

### Current vs Recommended

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Trail type | Continuous gradient polyline | 6 discrete dots (ATC style) |
| Trail duration | 10s (2s full + 8s fade) | 60s (exponential decay) |
| Head animation | 400ms ease-out-cubic travel | Keep (it's good) |
| Conflict tiers | 1 (file level) | 3 (directory / file / function) |
| Data blocks | Hover popover on node | Leader-line attached to agent dot |
| Velocity vectors | None | Line showing predicted direction |

## Canvas Rendering: Layer 6

Agent overlay lives on **Layer 6** of the 7-layer rendering architecture (see [Rendering Architecture](06-rendering-architecture.md)). This layer redraws every frame at 60fps while the static graph (layers 1-5) is cached.

Layer 6 draws in this order:
1. Territory zones (if enabled) -- colored Voronoi regions behind everything
2. Heatmap overlay (if enabled) -- per-node alpha blending
3. History trail dots (6 per agent) -- muted, behind active elements
4. Comet head (if animating) -- bright, travelling along edge
5. Agent center dots -- always on top of trails
6. Pulse rings -- expanding, semi-transparent
7. Conflict rings/badges -- error color, highest visual priority

## Information Density & Cognitive Load

ATC research target: **3-5 second comprehension time** per radar sweep. The operator should be able to assess the situation in one glance.

**Auto-declutter rules:**
- At workspace zoom (0.05-0.2x): show only agent dots, no data blocks, no trails
- At package zoom (0.2-0.5x): show dots + abbreviated data blocks (callsign only)
- At file zoom (0.5-2x): full data blocks + trails + pulse rings
- At code zoom (2x+): everything including velocity vectors

This maps directly to the semantic zoom levels defined in Phase 13.

## Sources

Full source list (45 URLs) available in `outputs/codebase-spatial-representation-research-agents.md`.

Key references:
- [EUROCONTROL colour study](https://www.eurocontrol.int/publication/use-colour-controller-displays)
- [FAA STARS display spec](https://www.faa.gov/air_traffic/technology/stars)
- [TCAS introduction (SKYbrary)](https://www.skybrary.aero/articles/tcas)
- [Figma multiplayer design](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [MIT CSAIL awareness display taxonomy](https://dl.acm.org/doi/10.1145/1240624.1240714)
