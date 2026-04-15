# Phase 7: Graph-Based Codebase Map - Research

**Researched:** 2026-04-15
**Domain:** Force-directed graph visualization (Canvas 2D + d3-force) + tree-sitter dependency extraction (Rust)
**Confidence:** HIGH for stack + integration points, MEDIUM for perf targets (extrapolated from ecosystem benchmarks, not measured on this box)

## Summary

Phase 7 replaces the squarified-treemap radar with a force-directed graph. The locked decisions (D-01..D-24) are all implementable on the existing Tauri v2 + React 19 + Canvas 2D stack with two new dependencies: `d3-force` on the frontend and `tree-sitter` + four grammar crates on the Rust backend. No novel integration patterns are required — the existing `RadarCanvas` scaffolding (HiDPI + rAF dirty-flag loop + `useCanvasZoomPan`) stays, `useTreemapLayout` is swapped for a new `useGraphLayout`, `installRadarPipelineBridge` keeps its 500ms debounce, and a new `get_dependency_graph` Tauri command rides alongside `get_tree_index`.

The two real risks are (1) `d3-force` tick cost at 10k nodes, which community reporting puts at the edge of 60fps and will likely need viewport culling + charge `distanceMax` to land D-23; and (2) tree-sitter parse cost for a 10k-file repo, which needs `rayon` parallelism to hit D-24's <2s target. Both are mitigatable without changing any locked decision, but the planner should treat them as explicit risks and plan benchmarks.

**Primary recommendation:** Implement this phase as a five-wave plan: (Wave 0) install deps + wave-0 tests + new radarStore shape; (Wave 1) Rust tree-sitter dep extractor + `get_dependency_graph` command; (Wave 2) `useGraphLayout` hook wrapping a settle-then-freeze `d3.forceSimulation` + custom `forceCluster` + quadtree hit-test; (Wave 3) graph Canvas renderer with arrows, comet trails, agent dots, folder hulls, heat-map tint, conflict pulse; (Wave 4) minimap + manifest preservation + deletion of `useTreemapLayout` + visual verification. See Validation Architecture for test/sample-rate strategy.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Graph Engine + Layout**
- **D-01** Use `d3-force` for the force simulation. Verlet integration with `forceLink`, `forceManyBody`, `forceCenter`, custom `forceCluster`, `forceCollide`.
- **D-02** Render via Canvas 2D, reusing `RadarCanvas` scaffolding (HiDPI, rAF dirty-flag, ResizeObserver). No SVG, no WebGL. Hit-testing via spatial index (d3-quadtree or visx quadtree).
- **D-03** Layout cadence = **settle-then-freeze**: run simulation on tree load until alpha cools (~500 ticks or alpha < 0.01), cache final node positions in `radarStore`, re-warm only when (a) file tree mutates significantly or (b) user drags a node to pin.
- **D-04** **Full replacement** of treemap. Delete `useTreemapLayout`, treemap render code, and treemap-specific subcomponents that don't carry over. Single radar view = graph. No toggle, no hybrid.

**Dependency Extraction**
- **D-05** Dependency parsing in **Rust backend**, integrated into existing `pipeline` module. Parallelized via `rayon` over the file list from `build_tree_index`. Exposed via new Tauri command returning `Vec<{from: PathBuf, to: PathBuf, kind: EdgeKind}>`.
- **D-06** Use **tree-sitter** for cross-language import extraction. Default grammars: TypeScript, TSX, JavaScript, JSX, Rust, Python. ~5-10MB binary growth accepted.
- **D-07** External deps (anything resolving outside repo root — `node_modules`, vendored crates, system packages) are **skipped entirely**.
- **D-08** Edges are **directed** (A imports B = arrow A→B). Small arrow head at target node end.
- **D-09** Imports resolved to **absolute repo-relative paths**. Per-language rules: TS/JS honor `tsconfig.json` paths + `package.json` exports for in-repo packages; Rust honors `Cargo.toml` workspace members + `mod` declarations; Python honors package `__init__.py`. Unresolved imports dropped silently (logged).

**Forces + Node Sizing**
- **D-10** Node visual size is **fixed**. Every file = same dot.
- **D-11** Filesystem proximity gravity uses **per-directory cluster centroids**. Attraction strength inversely proportional to directory depth (deeper = tighter). Sibling dirs repel mildly via global `forceManyBody`. Implemented as custom `forceCluster`.
- **D-12** Folders rendered as **labeled bounded regions**: soft outline (convex hull or alpha-shape) around each folder's cluster + folder name label at centroid. Outlines use `outlineVariant` (#494847) at low opacity. Top-level dirs get larger labels; nested dirs get smaller, lower-opacity labels with progressive detail (visible only at moderate zoom).
- **D-13** Edge thickness is **uniform 1px** across all edges. No weight encoding.

**Agent Trail Visualization**
- **D-14** When agent touches file B after file A, animate **glowing comet head** along edge A→B over ~400ms with fading tail in agent color. If no edge exists, draw along straight line between node positions.
- **D-15** Trail **color is per-agent**, sourced from `getAgentColor(agentId)` → `AGENT_DOT_PALETTE`.
- **D-16** Each trail visible **10s** after animation. Decay: 100% opacity for first 2s, linear fade 100%→0% over remaining 8s.
- **D-17** Agent's "current position" dot snaps to most-recently-touched file node with a small pulse (reuse `RadarPulse` pattern). Comet animates the snap. Idle agents stop pulsing but stay placed.
- **D-18** Cap **10 active trails per agent** (reuse `MAX_LEAD_LINES_PER_AGENT` constant). Trails > 10s culled regardless of cap.

**Carry-over from Phases 4-6**
- **D-19** Heat map overlay (FMON-05) preserved. Existing `radarStore.contentionScores` renders as **node fill tint** instead of treemap rect tint. Reuse `computeContentionScore` and toggle UI unchanged.
- **D-20** Minimap preserved. Re-render to show graph extents (bounding box + viewport rect). Must **preserve commit `e62272d`** minimap-shift-on-manifest-open behavior.
- **D-21** Right-side agent manifest panel preserved unchanged. `selectAgent` carries over.
- **D-22** Conflict alert dots/badges on contended nodes preserved. `CNFL-01` conflict → node pulses red + conflict badge ring.

**Performance Targets**
- **D-23** Graph rendering: **5,000 nodes + edges at 60fps** during pan/zoom. 10,000 acceptable with progressive culling. Beyond 10k → fall back to warning.
- **D-24** Dependency-graph build: **<2s** for 10k-file repos on dev Windows box.

### Claude's Discretion
- Exact d3-force parameter tuning (charge strength, link distance, alpha decay, velocity decay).
- Custom `forceCluster` implementation details (centroid recomputation cadence, depth-decay function shape).
- Folder hull algorithm: convex hull vs alpha-shape vs Voronoi region.
- Comet trail curve: straight line vs Bézier vs Catmull-Rom.
- Tree-sitter grammar loading strategy: statically linked vs WASM.
- Spatial index: d3-quadtree vs visx quadtree vs hand-rolled R-tree.
- Threshold for "significant tree mutation" that re-warms simulation.
- New Tauri command name/shape (`get_dependency_graph` is a suggestion, not binding).
- New `radarStore` shape: node positions, pinned flag, simulation handle. Keep store-per-domain pattern.
- Whether to extract `graphStore` from `radarStore` or keep everything in `radarStore`.

### Deferred Ideas (OUT OF SCOPE)
- User-configurable trail duration (Phase 8+).
- Edge color/thickness encoding by import type (runtime vs type-only vs re-export).
- Node size encoding by in-degree or LOC.
- Hybrid graph + treemap zoom mode (explicitly rejected in D-04).
- External dependency aggregation as supernodes (explicitly rejected in D-07).
- Pinned-position persistence across app restarts.
- Edge bundling for clutter reduction.
- Lasso/multi-select interaction.
- Saving/exporting graph snapshots.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIZN-01 (rewrite) | 2D spatial radar plotting agents on codebase map | D-01, D-02 — d3-force + Canvas 2D produce spatial layout; agent dots at node positions (D-17) |
| VIZN-02 (rewrite) | Agent trajectory lead lines / trails | D-14, D-15, D-16, D-18 — comet trail along edges replaces treemap lead lines; per-agent color, 10s fade, 10-cap |
| VIZN-04 (rewrite) | Canvas 2D 10k+ file perf | D-23 — 5k @ 60fps target, 10k with viewport culling; existing rAF dirty-flag loop reused |
| VIZN-05 (rewrite) | Codebase map uses file tree structure as spatial layout | D-11 — per-directory centroid gravity makes folder proximity the layout force; folders become visible islands (D-12) |
| FMON-05 (preserve) | Heat map overlay shows contention intensity | D-19 — `contentionScores` + `computeContentionScore` reused verbatim; render as node fill tint |
| EMON-01 (pull forward) | Dependency-graph-based codebase map (v2 req) | D-05..D-09 — tree-sitter dep extraction in Rust, directed edges, in-repo-only |

## Project Constraints (from CLAUDE.md)

The following project directives apply and must be honored by the planner:

1. **Tauri v2 + React 19 + TypeScript** — already in place.
2. **Canvas 2D + visx math** for the radar — NOT WebGL. Canvas 2D explicitly recommended over PixiJS/WebGL for this project's 2D dots/lines workload.
3. **Tauri-specta** for all new Tauri commands — `#[tauri::command] #[specta::specta]` required so `src/bindings.ts` regenerates at build time.
4. **Zustand** for new state — keep one store per domain; `radarStore` is the home for graph state (per D-Discretion, splitting into `graphStore` is acceptable but not required).
5. **Tailwind v4 CSS-first tokens + Command Horizon design system** — phosphor green palette, zero-radius corners, thin-stroke icons.
6. **GSD Workflow Enforcement** — all edits go through a GSD command (this research is step 1).
7. **Commit after every change** (MEMORY.md) — planner should size plans so each task commits.
8. **vitest + cargo test** test frameworks — colocate `#[cfg(test)] mod tests` for Rust, `__tests__/*.test.tsx` for TS.
9. **Repo-relative path serialization** — commit `a1b15b6` established repo-relative forward-slash paths for tree_index entries; graph nodes/edges MUST follow the same convention.

## Standard Stack

### Core (new in this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `d3-force` | ^3.0.0 | Velocity-Verlet force simulation with `forceLink`, `forceManyBody` (Barnes-Hut), `forceCenter`, `forceCollide` + custom forces | De facto force-directed layout engine for JS. ~30KB. Tree-shakable — import only `d3-force` (no full d3 bundle). Canvas rendering is a first-class documented pattern [VERIFIED: npm view d3-force version → 3.0.0, 2021-06-05] [CITED: d3js.org/d3-force] |
| `d3-quadtree` | ^3.0.1 | O(log n) spatial index for hit-testing "which node is under the cursor" | Already used internally by `forceManyBody` (Barnes-Hut). Reusing the same library keeps bundle impact near zero and matches force-layout idioms [VERIFIED: npm view d3-quadtree version → 3.0.1] |
| `d3-polygon` | ^3.0.1 | `polygonHull(points)` for folder convex-hull rendering (D-12) | Andrew's monotone chain, O(n log n). Tiny (<3KB). Canvas-friendly output is a plain `[[x,y], ...]` array [VERIFIED: npm view d3-polygon version → 3.0.1] [CITED: d3js.org/d3-polygon] |
| `@types/d3-force` | ^3.0.10 | TypeScript types | [VERIFIED: npm view] |
| `@types/d3-quadtree` | ^3.0.6 | TypeScript types | [VERIFIED: npm view] |
| `@types/d3-polygon` | ^3.0.2 | TypeScript types | [VERIFIED: npm view] |

### Rust (new in this phase)

| Crate | Version | Purpose | Why Standard |
|-------|---------|---------|--------------|
| `tree-sitter` | ^0.26.8 | Incremental parser bindings — core parsing engine | De facto cross-language parser for code tooling (used by neovim, Helix, Zed, rust-analyzer via alternative backends). `Parser` is both `Send` and `Sync` — safe to use one per rayon worker thread [VERIFIED: cargo search tree-sitter → 0.26.8] [CITED: docs.rs/tree-sitter/0.26.8] |
| `tree-sitter-typescript` | ^0.23.2 | TypeScript + TSX grammars (ships both `LANGUAGE_TYPESCRIPT` and `LANGUAGE_TSX`) | Official maintainer-shipped grammar [VERIFIED: cargo search] |
| `tree-sitter-javascript` | ^0.25.0 | JavaScript + JSX grammar | Official [VERIFIED: cargo search] |
| `tree-sitter-rust` | ^0.24.2 | Rust grammar | Official [VERIFIED: cargo search] |
| `tree-sitter-python` | ^0.25.0 | Python grammar | Official [VERIFIED: cargo search] |
| `rayon` | ^1.12.0 | Work-stealing parallel iterator for per-file parsing | Standard Rust parallel iteration; `par_iter()` over the file list with one `Parser` per thread [VERIFIED: cargo search → 1.12.0] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| `d3-force` | `d3-force-3d`, `cola.js`, `ngraph.forcelayout` | `d3-force-3d` adds Z-axis (not needed); `cola.js` better for constraint satisfaction but 4x bigger and less canvas-native; `ngraph.forcelayout` faster at 50k+ nodes but tiny community, fewer integration patterns | Keep d3-force (D-01 locked) |
| `d3-quadtree` | visx `quadtree`, Flatbush, RBush | visx quadtree wraps d3-quadtree (adds no value here); Flatbush/RBush are R-tree variants, faster for static layouts but d3-quadtree is free (already imported transitively) | Keep d3-quadtree |
| `d3-polygon` (convex hull) | Alpha-shape (`concaveman`), Voronoi regions (`d3-delaunay`) | Alpha-shape produces tighter, concave outlines but 5-10x slower and needs parameter tuning per cluster density. Voronoi regions tessellate the whole plane — doesn't match "floating island" aesthetic. Convex hull is cleaner for sparse clusters | **Recommend convex hull** (D-12 left this to Claude's discretion) |
| `tree-sitter` (native) | `tree-sitter` via WASM | WASM lazy-loads grammars (smaller initial binary) but loses `Send + Sync` — can't parallelize with rayon. Static linking adds ~5-8MB to binary but preserves parallelism for D-24's <2s target | **Recommend static linking of grammars** |
| tree-sitter | Regex per-language | Rejected explicitly in CONTEXT.md specifics | — |
| tree-sitter | Full compilers (swc, oxc for TS) | swc/oxc are TS/JS-only; we need cross-language coverage. tree-sitter is the only sensible cross-language option even if it's 2-3x slower than swc for TS alone | Keep tree-sitter |

**Installation:**
```bash
# Frontend
npm install d3-force d3-quadtree d3-polygon
npm install -D @types/d3-force @types/d3-quadtree @types/d3-polygon

# Remove squarify when treemap is deleted (Wave 4):
npm uninstall squarify
```

```toml
# src-tauri/Cargo.toml additions
tree-sitter = "0.26"
tree-sitter-typescript = "0.23"
tree-sitter-javascript = "0.25"
tree-sitter-rust = "0.24"
tree-sitter-python = "0.25"
rayon = "1.12"
```

**Version verification:** All versions verified against npm registry and crates.io search on 2026-04-15. `d3-force 3.0.0` dates to 2021-06-05 — long-stable, no churn expected.

## Architecture Patterns

### Recommended Project Structure
```
src-tauri/src/pipeline/
├── deps/                         # NEW: dependency-graph extraction
│   ├── mod.rs                    # DependencyGraph type, build_dependency_graph()
│   ├── extract.rs                # tree-sitter parse + query per language
│   ├── resolve.rs                # per-language import resolution (tsconfig, Cargo, __init__)
│   └── queries/                  # S-expression queries as Rust consts
│       ├── typescript.rs
│       ├── javascript.rs
│       ├── rust.rs
│       └── python.rs
├── commands.rs                   # existing — add get_dependency_graph here
├── pipeline_state.rs             # existing — extend ActiveWatch with cached dep graph
└── tree_index.rs                 # existing — unchanged

src/
├── hooks/
│   ├── useGraphLayout.ts         # NEW: d3-force simulation wrapper
│   ├── useCanvasZoomPan.ts       # existing — unchanged
│   └── useTreemapLayout.ts       # DELETE in Wave 4
├── views/Radar/
│   ├── RadarCanvas.tsx           # REWRITE body (keep scaffolding)
│   ├── GraphRenderer.ts          # NEW: pure render functions (drawEdges, drawNodes, drawTrails, drawHulls)
│   ├── CometTrail.ts             # NEW: trail lifecycle + animation
│   ├── forceCluster.ts           # NEW: custom d3 force
│   ├── HeatMapOverlay.ts         # REFACTOR to accept node positions
│   ├── RadarMinimap.tsx          # REWRITE to render graph extents
│   ├── RadarManifest.tsx         # unchanged (D-21)
│   ├── AgentManifestRow.tsx      # unchanged
│   ├── AgentTooltip.tsx          # unchanged
│   └── AlertDetail.tsx           # unchanged
├── stores/
│   └── radarStore.ts             # REFACTOR: treeData → graphNodes+graphEdges+nodePositions
└── bindings.ts                   # auto-regenerated by tauri-specta
```

### Pattern 1: Settle-Then-Freeze Simulation (D-03)
**What:** Run d3-force with its internal timer disabled, manually tick in a loop until alpha cools, snapshot positions into `radarStore`, stop. Only re-warm on (a) significant tree mutation or (b) user pins/drags a node.

**When to use:** Any static-layout force-directed graph where you don't want continuous CPU usage. This is the canonical d3 pattern for non-interactive layouts.

**Example (useGraphLayout sketch):**
```typescript
// Source: https://d3js.org/d3-force/simulation (canonical manual-tick pattern)
import * as d3 from 'd3-force';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;         // repo-relative path
  dirDepth: number;   // for forceCluster depth weight
  dirKey: string;     // parent directory repo-relative path
}
interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  kind: 'import' | 'reexport' | 'typeonly';
}

export function runSettleLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const sim = d3.forceSimulation<GraphNode>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
        .id(n => n.id)
        .distance(40)
        .strength(0.3))                    // lower than default 1 for less rigidity at 5-10k scale
    .force('charge', d3.forceManyBody()
        .strength(-80)                     // repulsion
        .theta(0.9)                        // Barnes-Hut accuracy (default)
        .distanceMax(300))                 // critical for 10k-node perf (localize forces)
    .force('center', d3.forceCenter(0, 0).strength(0.05))
    .force('collide', d3.forceCollide(6))  // node radius + 2px gap
    .force('cluster', forceCluster())      // custom (D-11)
    .alphaDecay(0.04)                      // ~115 iterations to alphaMin=0.001; faster than default 300
    .velocityDecay(0.5)                    // slightly higher damping than default 0.4
    .stop();                               // disable internal timer; we tick manually

  // Settle loop — run until alpha cools, cap at 500 ticks (D-03)
  const MAX_TICKS = 500;
  for (let i = 0; i < MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
    sim.tick();
  }
  return nodes; // mutated in-place with final x, y
}

// Re-warm on pin/drag:
// node.fx = worldX; node.fy = worldY;
// sim.alpha(0.3).restart();  // BUT: we've stopped the internal timer, so actually:
// sim.alpha(0.3); for (let i=0; i<100; i++) sim.tick(); sim.stop();
```

**Default values for d3-force** [CITED: d3js.org/d3-force/simulation]:
- `alpha` = 1, `alphaMin` = 0.001, `alphaDecay` ≈ 0.0228 (300 iters), `alphaTarget` = 0, `velocityDecay` = 0.4
- `forceManyBody().strength()` = -30, `theta()` = 0.9, `distanceMin()` = 1, `distanceMax()` = Infinity
- `forceLink().distance()` = 30, `strength()` = `1 / Math.min(count(source), count(target))`, `iterations()` = 1

### Pattern 2: Custom `forceCluster` (D-11)
**What:** Per-tick attractive force pulling each node toward its parent directory's centroid. Centroid recomputed per tick (cheap: O(n)). Strength scales with directory depth so deeper dirs cluster tighter.

**When to use:** Every tick of the settle loop. Runs alongside `forceLink`, `forceManyBody`.

**Prior art:** `ericsoco/d3-force-cluster` (centroid attraction + collision packing), `vasturiano/d3-force-clustering` (cluster-ID grouping with dynamic center). Our case is directory-keyed, matches vasturiano's pattern more closely but we implement inline to control depth-decay.

**Recommended depth-decay shape:** `strength(depth) = baseStrength * (1 + depth * 0.4)`. Monotonic increase with depth so top-level folders barely cluster (global charge dominates), while deep folders like `src/pipeline/deps/` cluster tightly. Linear is simpler than exponential and easier to reason about; exponential over-clusters deeply nested code.

**Example:**
```typescript
// Source: adapted from https://observablehq.com/@nbremer/custom-cluster-force-layout
//         and https://github.com/ericsoco/d3-force-cluster
import type { Simulation } from 'd3-force';

interface ClusterNode extends d3.SimulationNodeDatum {
  dirKey: string;
  dirDepth: number;
}

export function forceCluster() {
  let nodes: ClusterNode[] = [];
  let strength = 0.08;          // base strength; tuned empirically from d3-force-cluster defaults
  const depthWeight = 0.4;      // per-depth multiplier

  // Recompute centroids once per tick. O(n) — negligible at 10k.
  function centroids(): Map<string, { cx: number; cy: number; n: number }> {
    const acc = new Map<string, { cx: number; cy: number; n: number }>();
    for (const node of nodes) {
      const e = acc.get(node.dirKey) ?? { cx: 0, cy: 0, n: 0 };
      e.cx += node.x ?? 0;
      e.cy += node.y ?? 0;
      e.n += 1;
      acc.set(node.dirKey, e);
    }
    for (const e of acc.values()) { e.cx /= e.n; e.cy /= e.n; }
    return acc;
  }

  function force(alpha: number) {
    const cs = centroids();
    for (const node of nodes) {
      const c = cs.get(node.dirKey);
      if (!c) continue;
      const k = strength * (1 + node.dirDepth * depthWeight) * alpha;
      node.vx = (node.vx ?? 0) + (c.cx - (node.x ?? 0)) * k;
      node.vy = (node.vy ?? 0) + (c.cy - (node.y ?? 0)) * k;
    }
  }
  force.initialize = (n: ClusterNode[]) => { nodes = n; };
  force.strength = (v?: number) => v === undefined ? strength : (strength = v, force);
  return force;
}
```

**Centroid recomputation cadence:** **per tick.** At 10k nodes, centroid calc is ~100k operations (one pass + divide) — dwarfed by `forceManyBody`'s Barnes-Hut (~`n log n` = ~130k ops) and `forceLink` (10k ops). Batching (every N ticks) would introduce layout artifacts without meaningful savings. [ASSUMED: centroid calc cheap relative to other forces — validated by ecosystem convention, not measured]

### Pattern 3: Canvas rAF Loop Integration
**What:** Replace `useTreemapLayout` return with cached node positions from `radarStore`. The existing rAF loop in `RadarCanvas.tsx` stays; it reads from `layoutRef` which now holds graph nodes/edges instead of treemap rects. The simulation tick loop runs outside the rAF loop (in `useGraphLayout`), and only **re-runs** on mutation / pin events.

**When to use:** When the graph is settled (D-03). During a re-warm, run a second rAF loop that tick+renders until alpha cools.

**Key insight:** The rAF render loop and the simulation tick loop are separate — render runs every frame (for animations: comet, pulse, hover), tick runs only during settle/rewarm windows.

### Pattern 4: Quadtree Hit-Testing
**What:** After settle, build a `d3-quadtree` from final node positions. On mouse move, `qt.find(worldX, worldY, maxRadius)` returns the closest node in O(log n).

**When to use:** Replaces the current `findRect` linear-scan loop in `RadarCanvas`'s `handleMouseMove`. Critical at 10k nodes — linear scan is 10k comparisons × 60Hz = 600k ops/sec just for hover.

**Example:**
```typescript
import { quadtree } from 'd3-quadtree';

const qt = quadtree<GraphNode>()
  .x(n => n.x!)
  .y(n => n.y!)
  .addAll(nodes);

// In handleMouseMove, after screenToWorld:
const found = qt.find(world.x, world.y, HIT_RADIUS / viewport.zoom);
```

Rebuild the quadtree only after settle — positions don't change between re-warms.

### Pattern 5: Comet Trail Animation (D-14..D-18)
**What:** On each new `FileEvent` for an agent, push a `Trail` record into `radarStore.activeTrails` keyed by `(agentId, fromPath, toPath, startTs)`. The Canvas rAF loop animates position along the edge (or straight line if no edge exists) over 400ms, then renders the fading tail for the remaining 9.6s. Trails are evicted when `age > 10_000ms` or per-agent count > 10.

**Frame budget (D-23):** At 5k nodes × ~10 agents × 10 trails = 500 trails max simultaneously. Per trail: ~5 tail segments × drawn as 1 quad strip or 1 gradient-stroke line. Total per frame: ~2500 line ops. Canvas 2D handles 10k+ lines per frame comfortably. [ASSUMED based on ecosystem convention — validate with benchmark in Wave 3]

**Recommended curve:** **Straight line for v1.** Catmull-Rom adds visual polish but requires control-point calculation per frame for every trail (500 trails × 60Hz × 4 control-point evals = 120k ops/sec). Straight lines match Command Horizon's "deliberate, brief, glanceable" aesthetic and are easier to reason about for edge-following vs free-flying (no-edge) trails. Upgrade to Bézier if needed in Phase 8+.

**Recommended interpolation:** `ease-out cubic` for the head position along the path. Reads as a "thrown blip" rather than constant-velocity. `t_eased = 1 - Math.pow(1 - t, 3)`.

**Tail rendering:** **Segmented gradient stroke.** For each trail, sample 6 points along the traversed path, draw as `ctx.lineTo` calls with per-segment `globalAlpha` ramping from current → full faded. Cheaper than true quad strips, and we already have color via `getAgentColor`.

### Pattern 6: Folder Hull Rendering (D-12)
**What:** For each directory with ≥3 child nodes, compute `d3.polygonHull(childPositions)` and render as a low-opacity stroke + faint fill. For dirs with < 3 nodes, render as a circle around the 1-2 nodes.

**When to use:** Once per frame after positions are known. Hull computation is O(n log n) per dir; for ~50 dirs × ~100 nodes average it's trivial (<1ms total).

**Progressive detail:**
- `zoom < 0.6`: Only top-level folder hulls + labels.
- `zoom >= 0.6 && < 2`: Depth ≤ 2 folders.
- `zoom >= 2`: All folder hulls and labels.

**Label placement:** Centroid of hull points. Use `polygonCentroid` from `d3-polygon` (same package).

**Single-child chain collapse (commit `a8fe89b`):** Apply the same collapse to folder hulls. If a directory has exactly one child directory and no file children, fold it into the child for display purposes. The tree walker already emits the collapsed form for the treemap; re-apply to the graph's dir grouping.

### Pattern 7: Rust Tree-sitter Parallel Parse
**Example:**
```rust
// Source: docs.rs/tree-sitter/0.26.8 + ecosystem convention (rayon par_iter + one Parser per thread)
use rayon::prelude::*;
use tree_sitter::{Parser, Query, QueryCursor};
use std::path::{Path, PathBuf};

pub fn build_dependency_graph(
    repo_root: &Path,
    files: &[PathBuf],
) -> Vec<DependencyEdge> {
    files
        .par_iter()
        .flat_map_iter(|path| {
            // One Parser per thread via rayon — Parser is Send + Sync but holds
            // mutable state, so keep it local to each work item.
            let mut parser = Parser::new();
            let lang = detect_language(path)?;
            parser.set_language(&lang.ts_language()).ok()?;
            let source = std::fs::read_to_string(path).ok()?;
            let tree = parser.parse(&source, None)?;
            let imports = extract_imports(&tree, &source, lang);
            let resolved = imports
                .into_iter()
                .filter_map(|imp| resolve_import(&imp, path, repo_root))
                .collect::<Vec<_>>();
            Some(resolved)
        })
        .flatten()
        .collect()
}
```

### Anti-Patterns to Avoid

- **Running d3-force's internal timer alongside rAF** — double timer, wasted ticks, race conditions on position writes. Always `.stop()` the internal timer and tick manually.
- **Storing the d3 Simulation handle in Zustand** — simulations hold mutable state, not JSON-serializable. Keep the handle in a `useRef` inside `useGraphLayout`. Serialize only the settled positions.
- **Recomputing the quadtree every frame** — positions only change during settle/rewarm. Rebuild only when the settled snapshot changes.
- **Using `ts.lineWidth = 0.5` at high zoom without dividing by zoom** — current code does `0.5 / zoom` for lead lines. Apply the same convention to graph edges: `1 / zoom` for world-space 1px lines.
- **Hit-testing on `ScreenCoord` when positions live in `WorldCoord`** — current `screenToWorld` is correct; reuse it. Don't transform the quadtree; transform the cursor instead.
- **Trusting `layout_index.run()` parallel walker order** — the Rust dep extractor must treat file order as arbitrary; don't assume sequential iteration.
- **Parsing grammars at runtime via WASM** — kills rayon parallelism (WASM modules aren't Send). Static-link grammars.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Force-directed simulation | Custom Verlet integrator | `d3-force` | 30KB, 14 years of edge-case fixes, Barnes-Hut charge, quadtree built-in |
| Spatial index for hit-test | Nested `if` box-checks | `d3-quadtree` | O(log n) vs O(n); already transitively imported |
| Convex hull | Graham scan / JS ports | `d3-polygon` `polygonHull` | ~3KB, Andrew's monotone chain, well-tested |
| JS/TS/Rust/Python parsing | Regex per import syntax | `tree-sitter` + grammars | Regex breaks on comments, strings, template literals, TSX generics, macro-embedded strings — explicitly rejected in CONTEXT.md specifics |
| Import path resolution | Manual string manip | Match on tsconfig/Cargo/`__init__.py` structurally | Monorepo workspace roots, path aliases, barrel re-exports each have well-known algorithms; rolling them from scratch invites silent drops |
| Tail gradient stroke | Per-pixel alpha blend | `CanvasRenderingContext2D` gradient + `lineTo` | Native Canvas is 10x faster than ImageData manipulation |
| Directory tree from paths | Plain object trie | Reuse `buildFileTree` from `useTreemapLayout` | Already handles WR-06 backslash normalization, single-child collapse, and is tested |

**Key insight:** This phase layers three mature libraries (d3-force, tree-sitter, d3-polygon) on the existing Canvas 2D scaffolding. Every piece of custom code (`forceCluster`, comet trails, graph-extents minimap) is thin — the heavy lifting is delegated. Avoid the temptation to "just write a Verlet integrator" or "just regex the imports" — both will cost 3x the time and fail on edge cases.

## Runtime State Inventory

> This phase is a **rewrite**, not a rename. Files are deleted/replaced, data shapes change. Each category:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | **None.** `radarStore` is in-memory only. `contentionScores` is recomputed from `conflictStore` + `pipelineStore.events`. SQLite holds no treemap-specific state. | None. Changing store shape is a code edit only. |
| Live service config | **None.** No external services reference treemap shape. | None. |
| OS-registered state | **None.** No tasks, notifications, or tray state references treemap. | None. |
| Secrets/env vars | **None.** | None. |
| Build artifacts | `squarify` npm package becomes unused after Wave 4. Bindings `src/bindings.ts` regenerates when new Rust commands land. | **Uninstall `squarify` in Wave 4.** **Regenerate bindings after adding `get_dependency_graph`** (automatic via `cargo build` + tauri-specta). |

**The canonical question:** *After every file is updated, what runtime systems still have the old shape cached?*
Answer: only the browser's in-memory Zustand store, which is re-hydrated on every app launch. Clean slate; no migration needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | tree-sitter + rayon compilation | ✓ (assumed — project builds) | rustc 1.94+ | — |
| `cargo` | crate install | ✓ | — | — |
| `npm` | d3-* install | ✓ | — | — |
| C compiler | tree-sitter grammars build scripts | ✓ on Linux/macOS; Windows requires MSVC | project already compiles notify (C) | Install Visual Studio Build Tools on Windows if missing |
| Python 3 | some tree-sitter grammars' build.rs | Usually ✓ | — | Install python3 if missing — rare with grammar crates 0.23+ which ship pre-generated C |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** MSVC Build Tools on Windows if not already installed — required for any C-compiling crate; project already depends on notify which also needs it.

## Common Pitfalls

### Pitfall 1: Coordinate System Mismatch
**What goes wrong:** d3-force places nodes around origin (0,0) with negative coords; Canvas/treemap used (0,0)-(width,height). Mixing the two makes nodes appear off-screen.
**Why it happens:** `forceCenter(0,0)` is natural for d3-force; Canvas is natural for tree-map. Different origins.
**How to avoid:** Settle in d3-space (origin at 0,0), then use `useCanvasZoomPan`'s existing world-coord system with the graph bounding box. On first settle, compute bounding box and set initial `viewport.panX/panY` so the graph is centered in the canvas viewport. The existing `screenToWorld` works unchanged — just call with world coords that can be negative.
**Warning signs:** Nodes appear in top-left corner; pan/zoom doesn't track cursor correctly.

### Pitfall 2: Simulation Memory Leak on Unmount
**What goes wrong:** If `useGraphLayout` doesn't call `sim.stop()` on unmount, the internal d3 timer (or a manual tick scheduler) keeps running and holds refs to nodes.
**Why it happens:** `useEffect` cleanup forgotten; React 19 StrictMode re-mounts in dev.
**How to avoid:** Always return a cleanup from `useEffect`: `return () => { sim.stop(); }`. Even though we run with `.stop()` after settle, calling `.stop()` again is a no-op and safe. If doing a re-warm in a separate rAF, `cancelAnimationFrame` on the rAF handle too.
**Warning signs:** CPU stays at 30-50% after navigating away from radar view.

### Pitfall 3: Stale Node Positions on Tree Mutation
**What goes wrong:** File added/removed; graph re-fetch returns new nodes with no positions. If we re-render before re-warm, new nodes appear at (undefined, undefined).
**Why it happens:** Re-warm trigger is debounced (500ms via `installRadarPipelineBridge`).
**How to avoid:** When merging new nodes: seed each new node's (x, y) with its parent-dir centroid (or canvas center if top-level). Kept-nodes preserve their current (x, y). Then re-warm with low `alpha(0.3)` — enough to absorb new nodes without uprooting existing clusters.
**Warning signs:** New files fly in from origin; layout "explodes" on every file add.

**Re-warm trigger threshold:** Add/remove nodes count ≥ **5 or ≥ 1% of total**, whichever is larger. Below that, just refetch positions-preserving. Above that, re-warm with `alpha(0.3)`.

### Pitfall 4: Tree-sitter Grammar Version Drift
**What goes wrong:** `tree-sitter-typescript` ^0.23 compiles against `tree-sitter` 0.22+; if Cargo picks a different minor it may fail with "Incompatible language version".
**Why it happens:** Grammar crates depend on a specific ABI range of the tree-sitter runtime.
**How to avoid:** Pin exact versions with `=` in Cargo.toml for first production cut: `tree-sitter = "=0.26.8"`, `tree-sitter-typescript = "=0.23.2"`, etc. Upgrade as a coordinated bump, not drift.
**Warning signs:** Runtime error `LanguageError { kind: IncompatibleLanguageVersion }` on first parse.

### Pitfall 5: Tauri-specta Serialization of d3 Handles
**What goes wrong:** Accidentally including the `d3.Simulation` object in a Zustand slice that gets persisted or serialized triggers a clone exception.
**Why it happens:** Simulations contain function refs, mutable state, cyclic graph data.
**How to avoid:** Keep simulation handle in a `useRef` INSIDE `useGraphLayout`. Only settled positions + metadata go into `radarStore`. Never put `d3.ForceLink`, `d3.Simulation`, or tree-sitter `Tree` objects into a Zustand store or pass them through Tauri IPC.
**Warning signs:** `DataCloneError: could not be cloned` at runtime.

### Pitfall 6: Phase 6 Minimap-Shift Regression
**What goes wrong:** Rewriting `RadarMinimap.tsx` without preserving the `right: isManifestOpen ? MANIFEST_W + 12 : 12` shift causes minimap to clip under the manifest panel.
**Why it happens:** Easy to miss during rewrite; no test currently covers it explicitly.
**How to avoid:** Copy the shift logic verbatim. Add a snapshot or computed-style test: "manifest open → minimap `right` = 292; manifest closed → `right` = 12."
**Warning signs:** Minimap visually overlaps manifest; or manifest panel pushes minimap off-screen right edge.
**Reference:** Commit `e62272d` ("fix(radar): shift minimap left when manifest panel opens").

### Pitfall 7: Single-Child Directory Chain Collapse (commit `a8fe89b`)
**What goes wrong:** Folder hulls for `src/views/Radar/` render as three nested outlines (src hull → views hull → Radar hull) when the only meaningful grouping is `src/views/Radar/*.tsx`.
**Why it happens:** `buildFileTree`'s collapse was for treemap-specific "top-level wrapper" only; the graph's folder-island view would apply collapse at every level.
**How to avoid:** Apply the collapse logic **per folder** during hull computation: if a directory has exactly one child directory and no file children, skip rendering a hull for it and let the child hull represent it. Label = concatenated path segments ("views/Radar" as one label).
**Warning signs:** Graph looks "over-grouped" — every island has 2-3 nested outlines.

### Pitfall 8: Repo-Relative Path Serialization (commit `a1b15b6`)
**What goes wrong:** Backend returns absolute paths; frontend's node IDs don't match `radarStore.contentionScores` keys (which are repo-relative).
**Why it happens:** Easy to skip `strip_prefix(repo_root)` in a new command.
**How to avoid:** In `get_dependency_graph`, emit `from` and `to` as repo-relative forward-slash paths (same convention as `get_tree_index` — see `commands.rs:285-290`). Add a test that asserts no node ID contains `\\` or starts with `/`.
**Warning signs:** Heat map doesn't highlight any graph nodes; contention scores key ≠ node ID.

### Pitfall 9: Simulation Explodes at High Node Count
**What goes wrong:** At 10k nodes with default `forceManyBody` (no `distanceMax`), the charge force computes n*log(n) ≈ 130k ops *per tick*, but more critically, the total repulsion spreads the graph to immense coordinates. Folder hulls become invisible, zoom fails.
**Why it happens:** Default `distanceMax = Infinity` means even nodes 5000px apart repel each other.
**How to avoid:** Set `distanceMax(300)` (explicit) and `strength(-80)` (milder than -30 default scaled for 10k). Combine with strong `forceCollide` + moderate `forceCenter` to keep the graph compact.
**Warning signs:** After settle, graph bounding box is 20000+ units wide; zoom-to-fit shows tiny dots.

### Pitfall 10: Trail Accumulation on High-Churn Files
**What goes wrong:** An agent writing to the same file every 200ms generates 50 comet trails in 10s. Cap (D-18) is 10; older trails must be culled.
**Why it happens:** Cap logic applied incorrectly (e.g., "oldest first" vs "newest overrides").
**How to avoid:** Use a FIFO per-agent ring buffer of length 10. Every new trail pushes; if buffer full, pop the oldest. Additionally, purge any trail with `age > 10_000ms` on every frame (handle the case where an agent idles for 15s — the 10 remaining trails still expire by age).
**Warning signs:** Trails never fully fade; graph clutters with old trails.

## Code Examples

### Example 1: New Tauri Command Shape

```rust
// src-tauri/src/pipeline/commands.rs — add alongside get_tree_index
// Source: existing pattern in commands.rs:268-305 (get_tree_index)

use crate::pipeline::deps::{build_dependency_graph, DependencyEdgeDto};

#[tauri::command]
#[specta::specta]
pub async fn get_dependency_graph(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<DependencyEdgeDto>, String> {
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let repo_root = active.repo_root.clone();
            let files: Vec<PathBuf> = active.tree_index
                .iter()
                .filter(|(_, node)| !node.is_dir)
                .map(|(path, _)| path.clone())
                .collect();
            // Move to blocking pool — tree-sitter parse is CPU-heavy.
            let edges = tauri::async_runtime::spawn_blocking(move || {
                build_dependency_graph(&repo_root, &files)
            })
            .await
            .map_err(|e| format!("spawn_blocking join: {e}"))?;
            Ok(edges)
        }
        None => Ok(Vec::new()),
    }
}
```

```rust
// src-tauri/src/pipeline/deps/mod.rs — DTO for IPC
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEdgeDto {
    /// Repo-relative forward-slash path of importing file.
    pub from: String,
    /// Repo-relative forward-slash path of imported file.
    pub to: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EdgeKind {
    Import,
    Reexport,
    TypeOnly,      // TS-specific: `import type`
    DynamicImport, // TS/JS: `import(...)`, `require()`
    Use,           // Rust `use`
    ModDecl,       // Rust `mod` (adds a child module)
    Cargo,         // Rust workspace-internal dep path (future)
    FromImport,    // Python `from x import y`
    ImportStmt,    // Python `import x`
}
```

**Incremental updates vs poll/refetch:** Stick with **poll/refetch** for v1. The `installRadarPipelineBridge` 500ms debounce already handles reactive refresh. A `Channel<DependencyGraphUpdate>` streaming incremental edges would require maintaining per-file parse caches in the backend and diffing — justifiable only if rebuilds exceed 2s (D-24). If benchmarks show >2s, revisit in Phase 8.

### Example 2: Tree-sitter Import Queries (S-expression)

```rust
// src-tauri/src/pipeline/deps/queries/typescript.rs
// Source: tree-sitter-typescript grammar node-types.json + official examples
//         https://github.com/tree-sitter/tree-sitter-typescript

/// Matches:
///   import foo from 'x'
///   import { a, b } from 'x'
///   import * as ns from 'x'
///   import type { T } from 'x'
///   export { x } from 'y'
///   export * from 'y'
///   import('x')          (dynamic)
///   require('x')         (CommonJS)
pub const TYPESCRIPT_IMPORTS: &str = r#"
    (import_statement source: (string (string_fragment) @path)) @import
    (export_statement source: (string (string_fragment) @path)) @reexport
    (call_expression
        function: (import)
        arguments: (arguments (string (string_fragment) @path))) @dynamic
    (call_expression
        function: (identifier) @_fn
        arguments: (arguments (string (string_fragment) @path))
        (#eq? @_fn "require")) @require
"#;
```

```rust
// src-tauri/src/pipeline/deps/queries/rust.rs
pub const RUST_IMPORTS: &str = r#"
    (use_declaration argument: (_) @path) @use
    (mod_item name: (identifier) @name) @mod
"#;
```

```rust
// src-tauri/src/pipeline/deps/queries/python.rs
pub const PYTHON_IMPORTS: &str = r#"
    (import_statement name: (dotted_name) @path) @import
    (import_from_statement
        module_name: (dotted_name) @path
        name: (dotted_name)*) @from
"#;
```

### Example 3: Import Resolution (per language)

```rust
// src-tauri/src/pipeline/deps/resolve.rs
use std::path::{Path, PathBuf};

pub fn resolve_ts_import(
    spec: &str,           // "./foo", "../bar/baz", "@/lib/x", "react"
    from_file: &Path,     // absolute path of the importing file
    repo_root: &Path,
    tsconfig_paths: &[(String, Vec<PathBuf>)], // parsed from tsconfig.json
) -> Option<PathBuf> {
    // 1. Relative: "./foo", "../bar"
    if spec.starts_with("./") || spec.starts_with("../") {
        let base = from_file.parent()?;
        let candidate = base.join(spec);
        return resolve_with_extensions(&candidate);
    }
    // 2. tsconfig paths alias: "@/lib/x"
    for (alias, targets) in tsconfig_paths {
        if let Some(rest) = spec.strip_prefix(alias.trim_end_matches('*')) {
            for target in targets {
                let candidate = repo_root.join(target.trim_end_matches('*')).join(rest);
                if let Some(p) = resolve_with_extensions(&candidate) { return Some(p); }
            }
        }
    }
    // 3. Bare specifier → external dep (D-07: skip)
    None
}

fn resolve_with_extensions(path: &Path) -> Option<PathBuf> {
    const EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"];
    for ext in EXTS {
        let candidate = path.with_extension(ext);
        if candidate.is_file() { return Some(candidate); }
    }
    // Directory with index.{ts,tsx,...}
    if path.is_dir() {
        for ext in EXTS {
            let candidate = path.join(format!("index.{}", ext));
            if candidate.is_file() { return Some(candidate); }
        }
    }
    None
}
```

**Out-of-scope cases (drop silently, log at TRACE):**
- Bare specifiers without matching in-repo workspace (external deps — D-07).
- `package.json` `exports` field conditional resolution (`require` vs `import`, `browser` vs `node`). Honor the `main` field only.
- Pnpm workspace protocol (`workspace:*`).
- Rust macro-embedded paths (`include_str!("./foo")`).
- Python namespace packages without `__init__.py`.
- Dynamic imports with non-literal specifiers (`import(variable)`).

### Example 4: radarStore Refactor Shape

```typescript
// src/stores/radarStore.ts — refactored shape

import type { DependencyEdgeDto } from '../bindings';

export interface GraphNode {
  id: string;              // repo-relative path
  dirKey: string;          // repo-relative parent dir path
  dirDepth: number;        // for forceCluster depth weight
  x?: number;              // set by d3-force, persisted after settle
  y?: number;
  fx?: number | null;      // user-pinned position (D-03)
  fy?: number | null;
}
export interface GraphEdge {
  source: string;          // node id (post-settle; pre-settle it's the node ref)
  target: string;
  kind: 'import' | 'reexport' | 'typeonly' | 'dynamic' | 'use' | 'mod' | 'from' | 'importStmt';
}
export interface ActiveTrail {
  id: string;              // `${agentId}|${fromPath}|${toPath}|${startTs}`
  agentId: string;
  fromPath: string;
  toPath: string;
  startTs: number;         // ms epoch; animated 0-400ms, fading 400-10000ms
}

interface RadarStore {
  // --- REMOVED ---
  // treeData: TreeIndexEntry[];        ← replaced
  // fetchTreeIndex: () => Promise<void>; ← replaced (fetches both tree AND graph now)

  // --- NEW ---
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  settledAt: number | null;           // ms epoch of last successful settle; null = not settled
  pinnedNodeIds: Set<string>;         // user-dragged pins (D-03)
  activeTrails: ActiveTrail[];        // D-14..D-18; capped 10/agent, 10s TTL
  fetchGraph: () => Promise<void>;    // calls get_tree_index + get_dependency_graph, resets settledAt
  pushTrail: (t: ActiveTrail) => void;
  pruneTrails: () => void;            // called from rAF loop
  pinNode: (id: string, x: number, y: number) => void;
  unpinNode: (id: string) => void;
  commitSettledPositions: (positions: Map<string, { x: number; y: number }>) => void;

  // --- UNCHANGED ---
  viewport: Viewport;
  selectedAgentId: string | null;
  isManifestOpen: boolean;
  heatMapEnabled: boolean;
  contentionScores: Map<string, number>;
  setViewport, selectAgent, toggleManifest, toggleHeatMap, updateContentionScores: ...;
}
```

**Keep in `radarStore` vs split into `graphStore`:**
**Recommendation: keep in `radarStore`.** The view is a single pane — graph + manifest + heat map + minimap + conflict overlays all render from the same frame. Splitting would require cross-store subscriptions for every overlay and tangle the `selectAgent` wiring. The store grows from ~8 fields to ~14 — still within "one store per domain" discipline. Revisit if it grows past 20 fields in Phase 8+.

**NOT stored in radarStore:**
- The `d3.Simulation` handle → `useRef` inside `useGraphLayout`.
- The `d3.Quadtree` hit-test index → `useRef` inside `RadarCanvas`, rebuilt when `settledAt` changes.
- The comet-head interpolation state → recomputed per frame from `ActiveTrail.startTs`.

### Example 5: Polygon Hull for Folder Islands

```typescript
// src/views/Radar/GraphRenderer.ts
import { polygonHull, polygonCentroid } from 'd3-polygon';

export function drawFolderHulls(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  zoom: number,
) {
  // Group by dirKey, skip dirs with < 3 nodes (render circle fallback instead)
  const byDir = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const arr = byDir.get(n.dirKey) ?? [];
    arr.push(n);
    byDir.set(n.dirKey, arr);
  }

  ctx.strokeStyle = 'rgba(73, 72, 71, 0.4)'; // #494847 @ 40%
  ctx.fillStyle   = 'rgba(73, 72, 71, 0.05)';
  ctx.lineWidth   = 1 / zoom;

  for (const [dirKey, members] of byDir) {
    if (dirKey === '') continue; // skip root aggregate
    if (shouldSkipByProgressiveDetail(dirKey, zoom)) continue;

    if (members.length >= 3) {
      const pts: [number, number][] = members.map(n => [n.x!, n.y!]);
      const hull = polygonHull(pts);
      if (!hull) continue;
      ctx.beginPath();
      for (let i = 0; i < hull.length; i++) {
        const [x, y] = hull[i];
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Label at centroid
      const [cx, cy] = polygonCentroid(hull);
      drawFolderLabel(ctx, dirKey, cx, cy, zoom);
    } else {
      // Fallback: circle around 1-2 nodes
      const cx = members.reduce((s, n) => s + n.x!, 0) / members.length;
      const cy = members.reduce((s, n) => s + n.y!, 0) / members.length;
      const r = 20 / zoom;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawFolderLabel(ctx, dirKey, cx, cy, zoom);
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SVG force-directed graph | Canvas 2D force-directed graph | ~2016-2018 (Bostock's canvas examples) | 10-100x render speedup for 1k+ nodes [CITED: ahoak/renderer-benchmark, reintech] |
| Custom AST per language | tree-sitter grammars | ~2018-2020 (neovim, Helix adopted) | Cross-language uniformity; one query language; incremental reparse |
| `d3-force-cluster` standalone | Inline custom `forceCluster` | 2021-present | Better control over depth-decay; d3-force-cluster unmaintained since 2017 |
| WebGL for 10k+ nodes | Canvas 2D + viewport culling | Still debated | Canvas 2D keeps the door open; WebGL only needed at 50k+ (VIZN-04 caps at 10k) |

**Deprecated/outdated:**
- `d3-force-cluster` (ericsoco) last update 2017 — works but we'll write our own for depth-decay control.
- `tree-sitter` < 0.20 — language API changed; pin ≥ 0.25.
- SVG + `d3.zoom()` — unusable past 2k nodes.

## Validation Architecture

**Nyquist Dimension 8 compliance. This section is mandatory — gsd-plan-checker consumes it.**

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | vitest ^3.0.0 + @testing-library/react ^16 + jsdom ^26 |
| Framework (Rust) | `cargo test` + `#[cfg(test)] mod tests` colocated; integration tests in `src-tauri/tests/` if cross-module |
| Config file (TS) | `vitest.config.ts` (existing — no changes needed) |
| Config file (Rust) | `src-tauri/Cargo.toml` `[dev-dependencies]` (existing: `tempfile`, `serial_test`) |
| Quick run command (TS, per-task) | `npm test -- --run path/to/file.test.ts` (< 5s for a single file) |
| Quick run command (Rust, per-task) | `cargo test -p aitc_lib <test_name>` (< 10s for a single test) |
| Full suite command (TS) | `npm test` (< 30s current) |
| Full suite command (Rust) | `cargo test --all` (< 2min current) |
| Phase gate | Both green + manual visual smoke on 3 repo sizes before `/gsd-verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| VIZN-01 (rewrite) | Graph renders agents as dots at node positions | unit + snapshot | `npm test -- src/views/Radar/__tests__/RadarCanvas.test.tsx` | ❌ Wave 0 |
| VIZN-01 (rewrite) | Agent dot snaps to most-recently-touched node (D-17) | unit | `npm test -- src/views/Radar/__tests__/RadarCanvas.test.tsx -t "agent dot snap"` | ❌ Wave 0 |
| VIZN-02 (rewrite) | Comet trail animates edge traversal 0→400ms (D-14) | unit (with fake timers) | `npm test -- src/views/Radar/__tests__/CometTrail.test.ts` | ❌ Wave 0 |
| VIZN-02 (rewrite) | Trail fades 100%→0% over 10s (D-16) | unit | `npm test -- -t "trail fade curve"` | ❌ Wave 0 |
| VIZN-02 (rewrite) | Trail cap 10 per agent (D-18) | unit | `npm test -- -t "trail FIFO cap"` | ❌ Wave 0 |
| VIZN-04 (rewrite) | Canvas 2D handles 5k nodes at interactive fps | integration (manual-visual + JS perf.now bench) | `npm test -- -t "graph 5k settle bench"` (asserts < 2s) | ❌ Wave 0 |
| VIZN-05 (rewrite) | Graph layout uses filesystem proximity (D-11) | unit (deterministic seed) | `npm test -- src/hooks/__tests__/useGraphLayout.test.ts -t "files in same dir cluster"` | ❌ Wave 0 |
| FMON-05 (preserve) | Heat map tint applies to graph nodes (D-19) | unit | `npm test -- src/views/Radar/__tests__/HeatMapOverlay.test.ts` | ❌ Wave 0 (refactor existing) |
| EMON-01 (pull fwd) | Rust extracts ES6 imports from .ts file | unit (fixture) | `cargo test -p aitc_lib deps::extract::ts_imports` | ❌ Wave 0 |
| EMON-01 (pull fwd) | Rust extracts Rust `use`/`mod` declarations | unit | `cargo test -p aitc_lib deps::extract::rs_imports` | ❌ Wave 0 |
| EMON-01 (pull fwd) | Rust extracts Python import/from-import | unit | `cargo test -p aitc_lib deps::extract::py_imports` | ❌ Wave 0 |
| EMON-01 (pull fwd) | External deps skipped (D-07) | unit | `cargo test -p aitc_lib deps::resolve::external_skipped` | ❌ Wave 0 |
| EMON-01 (pull fwd) | tsconfig path alias resolution | unit | `cargo test -p aitc_lib deps::resolve::tsconfig_alias` | ❌ Wave 0 |
| EMON-01 (pull fwd) | `get_dependency_graph` command returns edges | integration | `cargo test -p aitc_lib commands::dep_graph_integration` (uses `make_temp_repo`) | ❌ Wave 0 |
| EMON-01 (pull fwd) | 10k-file repo builds graph in < 2s (D-24) | bench (`#[ignore]`) | `cargo test -p aitc_lib -- --ignored bench_dep_graph_10k` | ❌ Wave 0 |
| D-20 | Minimap shifts with manifest open/close (e62272d) | snapshot | `npm test -- src/views/Radar/__tests__/RadarMinimap.test.tsx -t "shifts right when manifest open"` | ❌ Wave 0 (rewrite) |
| D-22 | Contended node pulses red | unit | `npm test -- -t "conflict badge ring on contended node"` | ❌ Wave 0 |
| D-11 | forceCluster depth-weight math | unit (pure fn) | `npm test -- src/views/Radar/__tests__/forceCluster.test.ts` | ❌ Wave 0 |
| D-03 | Settle-then-freeze stops at alphaMin or 500 ticks | unit | `npm test -- -t "settle terminates"` | ❌ Wave 0 |
| D-03 | Re-warm triggers on ≥5 node mutation | unit | `npm test -- -t "rewarm threshold"` | ❌ Wave 0 |
| D-23 | Graph quadtree hit-test < 1ms | bench (vitest perf) | `npm test -- -t "quadtree hit bench"` | ❌ Wave 0 |
| D-12 | Convex hull fallback for < 3 nodes | unit | `npm test -- -t "hull fallback 1-2 nodes"` | ❌ Wave 0 |
| D-12 | Single-child chain collapse on hulls | unit | `npm test -- -t "collapse single-child hull"` | ❌ Wave 0 |

### Sampling Rate (Nyquist cadence)

- **Per task commit:** quick run — the single test file for the unit under change. Target <10s. Enforces "commit after every change" rule.
- **Per wave merge:** full `npm test && cargo test --lib` suite. Target <2min. No `#[ignore]` benches.
- **Per phase gate (before `/gsd-verify-work`):**
  1. Full `npm test` green
  2. Full `cargo test --all` green
  3. `cargo test -- --ignored bench_dep_graph_10k` green (asserts D-24)
  4. Manual visual smoke on three repos: 100-file (self-repo subset), 1000-file (mid project), 5000-file (large OSS clone like react or rust-analyzer). Capture frame timing with devtools Performance tab; assert rAF frames consistently <16ms during pan/zoom.

### Wave 0 Gaps

All Wave 0 test scaffolding to create before implementation:

- [ ] `src/views/Radar/__tests__/RadarCanvas.test.tsx` — VIZN-01 (replaces existing Phase 4 tests)
- [ ] `src/views/Radar/__tests__/CometTrail.test.ts` — VIZN-02
- [ ] `src/views/Radar/__tests__/HeatMapOverlay.test.ts` — FMON-05 (refactor, was `HeatMapOverlay.test.ts` in Phase 5)
- [ ] `src/views/Radar/__tests__/RadarMinimap.test.tsx` — D-20
- [ ] `src/views/Radar/__tests__/forceCluster.test.ts` — D-11
- [ ] `src/views/Radar/__tests__/GraphRenderer.test.ts` — D-12, D-13
- [ ] `src/hooks/__tests__/useGraphLayout.test.ts` — D-03, D-11, D-23
- [ ] `src/stores/__tests__/radarStore.test.ts` — refactor existing
- [ ] `src-tauri/src/pipeline/deps/extract.rs` `mod tests` — EMON-01 per-language
- [ ] `src-tauri/src/pipeline/deps/resolve.rs` `mod tests` — EMON-01 per-language
- [ ] `src-tauri/src/pipeline/deps/mod.rs` `mod tests` — integration (build full graph from `make_temp_repo`)
- [ ] `src-tauri/src/pipeline/commands.rs` — extend with `get_dependency_graph` integration test
- [ ] Benchmark: `#[ignore]` test in `deps/mod.rs` asserting 10k-file repo builds < 2s (D-24)

**Determinism:** d3-force is not deterministic by default (uses `Math.random` for initial positions). For snapshot tests, seed with a PRNG replacement:
```typescript
// In test setup
import * as d3 from 'd3-force';
const seededRandom = mulberry32(42);
// Monkey-patch Math.random for the test — or explicitly assign node.x/y
// pre-simulation via `nodes.forEach((n, i) => { n.x = seededRandom() * 100; n.y = seededRandom() * 100; })`
```

The layout test should not assert exact coordinates but **relative** properties: "all nodes with `dirKey='src/pipeline'` are within 100 units of each other" (D-11 cluster property), "every edge has non-null source and target nodes", "no node has NaN position after settle".

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | d3-force at 5k nodes hits 60fps on modest hardware when configured with `distanceMax(300)` + `theta(0.9)` | Standard Stack, D-23 | If false, need viewport culling during settle or WebGL fallback. MEDIUM — ecosystem reports match this but I haven't measured on the dev Windows box. |
| A2 | Tree-sitter parse at ~5ms/file with a warm parser (incl. TS/TSX); 10k files × 5ms / N cores with rayon = <2s on 8-core | D-24 | If false, need per-file caching keyed by mtime. MEDIUM — tree-sitter benchmarks exist but numbers vary by file size. |
| A3 | Static-linking all 4 grammars adds 5-10MB to the Tauri binary | D-06 | If higher, consider conditional compilation per-OS. LOW — consistent with tree-sitter ecosystem reports. |
| A4 | Convex hull sufficient for folder islands (vs alpha-shape) | D-12, Pattern 6 | If hulls look ugly on scattered clusters, switch to alpha-shape. LOW risk — easy to swap later. |
| A5 | Straight-line comet trail reads well enough (vs Bézier) | D-14, Pattern 5 | If motion looks abrupt, upgrade to Catmull-Rom. LOW — cosmetic. |
| A6 | Per-tick centroid recomputation is cheap at 10k nodes | Pattern 2 | If profiling shows hot path, cache centroids for N ticks. LOW — O(n) pass dwarfed by charge force. |
| A7 | Keeping graph state in `radarStore` (not splitting) stays manageable at ~14 fields | Example 4 | If store becomes unwieldy, split into `graphStore`. LOW — easy to refactor. |
| A8 | `Parser` being `Send + Sync` means one-per-thread-in-rayon pattern works | Pattern 7 | If parser state cross-contaminates, use `thread_local!`. LOW — tree-sitter docs confirm. |
| A9 | `strip_prefix(repo_root)` works for all repo paths on Windows (same as `tree_index.rs`) | Pitfall 8 | If dep paths include symlinks, may fail. LOW — existing treemap already handled this. |
| A10 | Wave-0 test scaffolding takes 1 plan (~5 tasks) | Validation Architecture | If requirements expand, may need 2 plans. LOW. |
| A11 | Existing `RadarCanvas` Canvas scaffolding (HiDPI, rAF, ResizeObserver) is reusable as-is | Architecture, D-02 | If graph render needs different transform stack, may need rewrite. LOW — the scaffolding is a thin shell, will be trivially reused. |

**User decisions requiring confirmation before execution (CONTEXT.md left these to Claude's discretion — planner should confirm):**
- Grammar loading strategy: **static link all 4** (recommended) vs WASM lazy-load.
- Folder outline algorithm: **convex hull** (recommended) vs alpha-shape.
- Comet curve: **straight line** (recommended) vs Bézier.
- Store split: **keep in `radarStore`** (recommended) vs extract `graphStore`.
- Re-warm threshold: **≥5 node mutation or ≥1% of total** (recommended).

## Open Questions

1. **Should drag-to-pin be in v1?**
   - What we know: D-03 mentions "user drags a node to pin it" as a re-warm trigger.
   - What's unclear: Whether v1 includes the drag UI or just supports programmatic pinning.
   - Recommendation: **Include basic drag-to-pin** — the mouse-down/move/up handlers are already present in `useCanvasZoomPan`; adding "if target is a node, pin instead of pan" is ~30 LOC. Unpin with double-click. Flag this as a question for the planner to confirm.

2. **How aggressive should viewport culling be at 10k nodes?**
   - What we know: D-23 says 10k acceptable with "progressive culling".
   - What's unclear: Which primitives to cull (nodes, edges, labels, hulls, all).
   - Recommendation: Cull **labels** first (most expensive at zoom), then **edges** whose both endpoints are off-screen (at sub-pixel edge density), then **hulls** at extreme zoom-out (render as dots instead). Don't cull nodes themselves — they're cheap and missing dots look like bugs.

3. **Does the comet trail need to visually cross folder hulls, or stay above them in render order?**
   - Recommendation: **Trails render on top of hulls and edges, below agent dots.** Matches the phosphor-blip-on-CRT aesthetic.

4. **Should `get_dependency_graph` accept a filter (only certain languages)?**
   - Recommendation: **No for v1.** Keep the API simple (just returns all edges). Add filter in Phase 8 if a user workflow demands it.

5. **What happens when a file is renamed mid-session?**
   - What we know: `FileEventKind::Rename { from, to }` exists.
   - What's unclear: Whether the graph should migrate the node (preserve position) or re-parse.
   - Recommendation: On rename, find the node with `id == from`, update `id = to` and `dirKey`, keep (x, y) pinned briefly. Mark graph dirty so next debounced `fetchGraph()` re-extracts edges. This is a Wave 3 concern.

## Security Domain

> `security_enforcement` is absent from config.json → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (desktop app, no remote auth) |
| V3 Session Management | no | — |
| V4 Access Control | no | — (single-user desktop) |
| V5 Input Validation | **yes** | Validate repo-relative paths from backend don't escape repo root; reject `..` traversal in node IDs before querying SQLite (heat-map join). Use `Path::components()` to detect parent refs. |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via malicious import spec | Tampering | In `resolve.rs`, after resolution, verify the resolved path is `starts_with(repo_root)` before emitting edge. Any resolve result outside repo_root dropped (D-07 already implies this). |
| Tree-sitter parser panic on adversarial input | DoS | tree-sitter is designed to tolerate malformed input and always returns a tree. Wrap `parser.parse()` in a timeout (spawn in rayon with `Instant::now()` check — skip file if parse > 500ms). |
| Large repo exhausts memory during parse | DoS | `rayon` uses bounded thread pool. Per-file mmap via `read_to_string` is fine up to ~100MB per file; cap with `metadata.len() > 10MB → skip` in Wave 1. |
| Symlink loops during file walk | DoS | `ignore` crate (existing) does NOT follow symlinks by default. Verify this carries through to dep extraction — we reuse `tree_index` file list which is symlink-safe. |
| Dynamic import `import(variableName)` → false edge | Tampering | Skip non-literal dynamic imports (we only match `string` nodes in the query). Log at DEBUG so we can see drop rate. |

No cryptography, no authentication, no network surface added — this phase stays local. The security surface is entirely "Rust parses files on disk; frontend renders positions" and the path-traversal check above.

## Sources

### Primary (HIGH confidence)

- [d3-force simulation docs](https://d3js.org/d3-force/simulation) — default alpha/alphaDecay/velocityDecay values, manual tick pattern, fx/fy pinning
- [d3-force many-body docs](https://d3js.org/d3-force/many-body) — Barnes-Hut theta, strength defaults, distanceMax tuning
- [d3-force link docs](https://d3js.org/d3-force/link) — link distance/strength defaults
- [d3-polygon docs](https://d3js.org/d3-polygon) — `polygonHull` via Andrew's monotone chain, `polygonCentroid`
- [docs.rs/tree-sitter/0.26.8](https://docs.rs/tree-sitter/latest/tree_sitter/) — Parser API, `Send + Sync`, `set_language` signature
- `src-tauri/src/pipeline/commands.rs:268-305` — `get_tree_index` pattern; path for new `get_dependency_graph`
- `src-tauri/src/pipeline/ignore_filter.rs` — gitignore walker reused for dep parsing scope
- `src/hooks/useTreemapLayout.ts:130-151` — single-child chain collapse (commit `a8fe89b`); apply to hull grouping
- `src/views/Radar/RadarMinimap.tsx:85` — manifest-shift pattern (commit `e62272d`); preserve in new minimap
- Commit `a1b15b6` — repo-relative forward-slash path convention
- `CONTEXT.md` — all 24 locked decisions
- `REQUIREMENTS.md` — VIZN-01..05, FMON-05, EMON-01 definitions
- `CLAUDE.md` — project tech stack, Canvas 2D + visx + Zustand + tauri-specta discipline
- `package.json` — current dep versions (confirmed via `npm view`)
- `src-tauri/Cargo.toml` — Rust dep versions (confirmed via `cargo search`)
- `npm view d3-force version` → 3.0.0 (verified 2026-04-15)
- `npm view d3-quadtree version` → 3.0.1 (verified 2026-04-15)
- `npm view d3-polygon version` → 3.0.1 (verified 2026-04-15)
- `cargo search tree-sitter` → 0.26.8 (verified 2026-04-15)
- `cargo search tree-sitter-typescript` → 0.23.2 (verified 2026-04-15)
- `cargo search tree-sitter-javascript` → 0.25.0 (verified 2026-04-15)
- `cargo search tree-sitter-rust` → 0.24.2 (verified 2026-04-15)
- `cargo search tree-sitter-python` → 0.25.0 (verified 2026-04-15)
- `cargo search rayon` → 1.12.0 (verified 2026-04-15)

### Secondary (MEDIUM confidence)

- [Observable: Clustered Bubbles / d3](https://observablehq.com/@d3/clustered-bubbles) — cluster force prior art
- [Observable: Custom Cluster Force Layout (Nadieh Bremer)](https://observablehq.com/@nbremer/custom-cluster-force-layout) — adapted for `forceCluster` depth-decay
- [github.com/ericsoco/d3-force-cluster](https://github.com/ericsoco/d3-force-cluster) — centroid + collision pattern (unmaintained but canonical)
- [github.com/vasturiano/d3-force-clustering](https://github.com/vasturiano/d3-force-clustering) — cluster-ID grouping pattern
- [blog.scottlogic.com: Improving D3 Performance](https://blog.scottlogic.com/2015/11/02/improving-low-barrel-performance.html) — Canvas vs SVG perf at 1k+
- [reintech: Optimizing D3 Chart Performance](https://reintech.io/blog/optimizing-d3-chart-performance-large-data) — 10k points at 60fps on Canvas
- [blog.scottlogic.com: Rendering One Million Datapoints with D3+WebGL](https://blog.scottlogic.com/2020/05/01/rendering-one-million-points-with-d3.html) — upper bound; confirms 10k on Canvas is well within budget
- [github.com/tree-sitter/tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) — grammar + node-types reference
- [Medium: Benchmark TypeScript Parsers (Herrington Darkholme)](https://medium.com/@hchan_nvim/benchmark-typescript-parsers-demystify-rust-tooling-performance-025ebfd391a3) — tree-sitter positioned against swc/oxc; qualitative only

### Tertiary (LOW confidence — flagged for validation)

- Tree-sitter exact ms/file parse cost — no published 2025 TS benchmark with absolute numbers. Validate in Wave 1 bench.
- d3-force tick cost at 10k nodes — ecosystem claims "achievable at 60fps" but no published benchmark matches our exact force mix. Validate in Wave 2 bench.
- Grammar binary-size impact at 5-10MB — based on community reports, not measured for this project.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm / crates.io on 2026-04-15.
- Architecture patterns: HIGH — settle-then-freeze and custom force are canonical d3 patterns with first-party docs.
- Pitfalls: HIGH for the ones tied to code review (1, 6, 7, 8 — directly observed in this codebase); MEDIUM for ecosystem-common pitfalls (2, 3, 4, 5, 9, 10).
- Performance predictions (D-23, D-24): MEDIUM — extrapolated from ecosystem benchmarks; will be validated in Wave 1/2 benches.
- Security: HIGH — minimal surface, well-understood threat patterns.
- Validation Architecture: HIGH — vitest + cargo test patterns already established in this codebase.

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable stack, 30-day window). Re-verify tree-sitter grammar versions before Wave 1 since they update on a ~3-month cadence.

---

## RESEARCH COMPLETE

**Phase:** 7 — Replace current blocked Codebase Map with a graph-based codebase map
**Confidence:** HIGH for stack + integration, MEDIUM for perf targets (to be validated in Wave 1/2 benches)

### Key Findings

- `d3-force` 3.0.0 (≈30KB) is the right layout engine; pair with `d3-quadtree` 3.0.1 for hit-testing and `d3-polygon` 3.0.1 for folder hulls. Pattern: `.stop()` internal timer, manually tick up to 500 iterations or `alpha < 0.001`, snapshot positions into `radarStore`.
- Tree-sitter 0.26.8 (Rust) + grammars (`typescript 0.23.2`, `javascript 0.25.0`, `rust 0.24.2`, `python 0.25.0`) statically linked. `Parser` is `Send + Sync`; parallelize via `rayon::par_iter()` with one parser per work item. Adds ~5-10MB to the binary (accepted per D-06).
- Recommend keeping graph state in the existing `radarStore` rather than splitting — `viewport`, `selectedAgentId`, `heatMapEnabled` already colocate with what would be `graphStore`. Grows from ~8 to ~14 fields, still within project discipline.
- New Tauri command `get_dependency_graph` composes with existing `get_tree_index`: use the cached `ActiveWatch.tree_index` file list as the node set, parse each file on a `rayon` thread, return `Vec<DependencyEdgeDto>` with repo-relative forward-slash paths (matching commit `a1b15b6` convention).
- Two ecosystem-verified performance risks to D-23 and D-24 must be mitigated by tuning (`distanceMax(300)` on `forceManyBody`) and validated by `#[ignore]` benchmark tests in Wave 1. If benchmarks miss, fallback is viewport culling (D-23) or per-file mtime-keyed parse cache (D-24).

### File Created

`.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All versions verified against live npm / crates.io on 2026-04-15 |
| Architecture | HIGH | Settle-then-freeze, quadtree hit, custom force are canonical d3 patterns with first-party docs |
| Pitfalls (code-tied) | HIGH | Pitfalls 1, 6, 7, 8 pulled directly from existing codebase (`useTreemapLayout` collapse, `RadarMinimap` shift, `get_tree_index` path convention) |
| Pitfalls (ecosystem) | MEDIUM | Pitfalls 2, 3, 4, 5, 9, 10 based on d3/tree-sitter community reports |
| Perf targets (D-23, D-24) | MEDIUM | Ecosystem benchmarks support feasibility; need Wave 1/2 measurements on dev Windows box |
| Validation Architecture | HIGH | vitest + cargo test patterns already proven in Phases 2-6 |
| Security | HIGH | No new surface area; path-traversal check is the only mitigation needed |

### Open Questions

1. Drag-to-pin UI inclusion in v1 (recommend **yes**, ~30 LOC via `useCanvasZoomPan` extension)
2. Viewport culling aggression at 10k — recommend labels > edges > hulls cull order
3. File rename handling mid-session — recommend keep-id-migrate pattern in Wave 3
4. Grammar loading strategy: static-link all four (recommended) — needs planner confirmation

### Ready for Planning

Research complete. Planner (`gsd-planner`) can now break Phase 7 into 5 waves as outlined in Summary. `gsd-plan-checker` will find the required `## User Constraints`, `## Phase Requirements`, `## Validation Architecture` (Nyquist Dimension 8), and `## Security Domain` sections.
