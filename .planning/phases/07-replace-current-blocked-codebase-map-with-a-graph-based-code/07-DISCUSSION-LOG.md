# Phase 7: Graph-Based Codebase Map - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 07-replace-current-blocked-codebase-map-with-a-graph-based-code
**Areas discussed:** Graph engine + layout, Dependency extraction, Forces + node sizing, Agent trail visualization, Carry-over from prior phases

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Graph engine + layout | Library/algorithm: d3-force vs ngraph vs Cytoscape vs hand-rolled Verlet | ✓ |
| Dependency extraction | Where (Rust vs TS) and how (tree-sitter vs regex vs native AST) | ✓ |
| Forces + node sizing | Filesystem proximity → gravity model, node size encoding | ✓ |
| Agent trail visualization | Style of ephemeral movement between nodes | ✓ |

**User's choice:** All four selected.

---

## Graph engine + layout

### Q1: Which graph layout library?
| Option | Description | Selected |
|--------|-------------|----------|
| d3-force (Recommended) | Battle-tested JS, Verlet integration, configurable forces, ~30KB | ✓ |
| ngraph.forcelayout | Faster at 5k+ nodes (Barnes-Hut), tiny ~10KB, smaller ecosystem | |
| Custom Verlet on Canvas 2D | Hand-rolled physics, zero deps, own all the bugs | |

### Q2: Render target?
| Option | Description | Selected |
|--------|-------------|----------|
| Canvas 2D (Recommended) | Reuse existing RadarCanvas pipeline | ✓ |
| WebGL via PixiJS or sigma.js | Required for 50k+ nodes; CLAUDE.md flagged as overkill | |
| SVG via React | Easier interaction but breaks past ~2k nodes | |

### Q3: Layout cadence?
| Option | Description | Selected |
|--------|-------------|----------|
| Settle then freeze (Recommended) | Run sim until alpha cools, cache positions, re-run only on mutation/drag | ✓ |
| Continuous live simulation | Always-running tick loop | |
| Settle, then react to events | Settle once, re-warm briefly on file events | |

### Q4: Replace the treemap or coexist?
| Option | Description | Selected |
|--------|-------------|----------|
| Full replacement (Recommended) | Roadmap says "replace"; rip out treemap | ✓ |
| Toggle between treemap and graph | Keep both renderers | |
| Hybrid graph + treemap zoom mode | Progressive switching | |

---

## Dependency extraction

### Q1: Where should dependency parsing run?
| Option | Description | Selected |
|--------|-------------|----------|
| Rust backend (Recommended) | Parse on file events, expose via Tauri command, parallel via rayon | ✓ |
| TS frontend | Parse in Web Worker after fetchTreeIndex | |
| Hybrid Rust scans, TS resolves | Complicates architecture | |

### Q2: Which languages should be parsed for imports?
| Option | Description | Selected |
|--------|-------------|----------|
| TS/JS + Rust (Recommended) | Covers this codebase; regex-based extraction | |
| TS/JS + Rust + Python | Adds Python regex | |
| All languages via tree-sitter | Cross-language correctness, +5-10MB binary, ~50ms/file | ✓ |

**User's choice:** All languages via tree-sitter — accepted the binary size tradeoff for cross-language coverage.
**Notes:** Planner needs to pin grammar versions and decide static vs WASM lazy-load.

### Q3: How should external dependencies (node_modules, vendored crates) be represented?
| Option | Description | Selected |
|--------|-------------|----------|
| Skip entirely (Recommended) | Drop imports outside repo root; cleanest | ✓ |
| Aggregate as 'external' supernodes | Group by package name | |
| Show fully | Floods graph with thousands of external nodes | |

### Q4: Edge directionality?
| Option | Description | Selected |
|--------|-------------|----------|
| Directed with arrow on edge (Recommended) | Subtle arrow head; preserves import direction signal | ✓ |
| Undirected lines | Simpler render but loses hub-vs-leaf signal | |

---

## Forces + node sizing

### Q1: How should filesystem proximity create gravity?
| Option | Description | Selected |
|--------|-------------|----------|
| Per-directory cluster gravity (Recommended) | Each directory has invisible centroid; depth-weighted strength | ✓ |
| Pairwise sibling attraction | Files in same dir attract directly; O(n²) without quad-tree | |
| Path-prefix similarity force | Attraction by shared path prefix length; expensive | |

### Q2: What determines node visual size?
| Option | Description | Selected |
|--------|-------------|----------|
| In-degree (Recommended) | Hub files largest; surfaces architectural backbone | |
| File size on disk (LOC proxy) | Visual weight = scope; familiar from treemaps | |
| Fixed size, no encoding | Cleanest, loses an info channel | ✓ |
| Hybrid: in-degree area + file size ring thickness | Two channels per node | |

**User's choice:** Fixed size — clustering and density carry the information channels.

### Q3: Should folders be visible nodes/regions or invisible structure?
| Option | Description | Selected |
|--------|-------------|----------|
| Invisible — only files are nodes (Recommended) | Folders express through gravity only | |
| Folders as labeled bounded regions | Convex hull / soft outline + label | ✓ |
| Folders as their own larger nodes | Files orbit folder nodes; cluttered | |

**User's choice:** Folders as labeled bounded regions — explicit folder labels via convex hull / alpha-shape outlines with floating labels.

### Q4: How should edge weight affect rendering?
| Option | Description | Selected |
|--------|-------------|----------|
| Uniform thickness, no weight encoding (Recommended) | All edges 1px; matches Command Horizon minimalism | ✓ |
| Thickness scales with import count | Visual spaghetti risk | |
| Color-coded by edge type | Distinguishes runtime vs type-only vs re-export | |

---

## Agent trail visualization

### Q1: Trail style?
| Option | Description | Selected |
|--------|-------------|----------|
| Animated comet head along edge (Recommended) | Glowing dot travels A→B over ~400ms with fading tail | ✓ |
| Pulsing edge highlight | Edge brightens for ~2s then fades | |
| Breadcrumb dots persisting on visited nodes | Cumulative trail; no motion | |
| All three composed | Maximum information; most noise | |

### Q2: Trail color?
| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent palette (Recommended) | Reuse AGENT_DOT_PALETTE via getAgentColor | ✓ |
| Uniform phosphor green | Cleaner ATC feel, loses attribution | |
| Per-agent color, fading to white at the head | Comet head white-hot, tail in agent color | |

### Q3: Trail duration?
| Option | Description | Selected |
|--------|-------------|----------|
| 10 seconds (Recommended) | Spot a sequence without piling up | ✓ |
| 3 seconds | Easy to miss | |
| 30 seconds | Saturates busy scenes | |
| Configurable in settings | Adds settings UI surface | |

### Q4: Where does the agent dot live on the graph?
| Option | Description | Selected |
|--------|-------------|----------|
| On the most-recently-touched file node (Recommended) | Snaps to last file with a small pulse | ✓ |
| Floats between recent files (centroid) | Smoother; less precise | |
| Pinned to a fixed perimeter slot, lines drawn to active files | Different mental model entirely | |

---

## Carry-over from Phases 4-6

### Q1: Which existing radar features to preserve in the graph view? (multi-select)
| Option | Description | Selected |
|--------|-------------|----------|
| Heat map overlay (FMON-05) | Color-tint nodes by contention score; reuse computeContentionScore | ✓ |
| Minimap (Phase 6 work) | Re-render for graph extents; preserve manifest-open shift | ✓ |
| Right-side agent manifest panel | Phase 4 D-12; carries over for free | ✓ |
| Conflict alert dots/badges on contended nodes | Pulse + ring on conflict-affected nodes | ✓ |

**User's choice:** All four — full feature parity preservation.

---

## Claude's Discretion

(Captured in CONTEXT.md `<decisions>` § Claude's Discretion)

- Exact d3-force parameter tuning
- Custom forceCluster implementation details (depth-decay shape, centroid recomputation cadence)
- Folder hull algorithm (convex hull vs alpha-shape vs Voronoi)
- Comet trail curve type
- Tree-sitter grammar loading strategy (static vs WASM)
- Spatial index choice for hit-testing
- Tree-mutation threshold for re-warming the simulation
- New Tauri command shape and naming
- New radarStore shape; whether to split into a graphStore

## Deferred Ideas

- User-configurable trail duration
- Edge type color encoding
- Node size encoding by in-degree or LOC
- Hybrid graph+treemap zoom mode (rejected)
- External dep aggregation as supernodes (rejected)
- Pinned-position persistence across restarts
- Edge bundling for clutter reduction
- Lasso / multi-select
- Graph snapshot export
