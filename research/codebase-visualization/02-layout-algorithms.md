# Layout Algorithms for Codebase Visualization

> 18 algorithms surveyed across 8 families. The right choice depends on scale — d3-force for now, hybrid treemap+force at 10K+, GPU at 50K+.

## Algorithm Families at a Glance

| Family | Best For | Scale | Hierarchy | Stability |
|--------|---------|-------|-----------|-----------|
| Force-directed | Exploratory, organic clusters | 1-100K | Custom forces | High with cooling |
| Hierarchical (Sugiyama) | Dependency depth visualization | 100-2K | Explicit layers | Deterministic |
| Treemap | Space-efficient overview | 50K+ | Recursive containment | Varies |
| Compound (fCoSE) | Nested packages + forces | 5-10K | Native compound nodes | Good |
| Radial | Focus+context from entry point | 100-1K | Concentric rings | High |
| Space-filling curves | Dense binary/metric heatmaps | Millions | None | Perfect |
| GPU-accelerated | Massive graphs | 100K-1M+ | Via clustering | Good |
| GNN-accelerated | Future (not browser-ready) | 10-100x faster | Learned | Research |

## Force-Directed: The Current Approach

### d3-force (what AITC uses now)

- **Composable force model** -- plug in custom forces (our `forceCluster` for directory grouping)
- **Barnes-Hut** O(n log n) many-body via quadtree (theta=0.9 default)
- **Alpha cooling** -- converges in ~300 ticks, configurable via `alphaDecay`
- **Node pinning** via `fx`/`fy` -- our drag-to-pin feature uses this
- **Scale:** 5K nodes @ 30fps on Canvas 2D, 7K with WebGL rendering

**WebWorker pattern (Phase 11):** Simulation runs in a worker at its own framerate. Main thread renders independently. Transfer positions via `Float32Array` Transferable objects (~29ms vs ~268ms structured clone). This is the single highest-impact optimization available.

### ForceAtlas2 (potential upgrade)

- **Degree-dependent repulsion** -- `F_r = (k_i + 1)(k_j + 1) / d` -- hub files repel more strongly, naturally spacing out core modules
- **LinLog mode** -- `F_a = ln(d+1)` attraction, reveals community structure aligned with Newman's modularity
- **Adaptive speed** -- each node has independent velocity; oscillating nodes slow automatically
- **638ms** to quasi-optimal layout for ~23K nodes (vs 20s for Fruchterman-Reingold)
- Available as JS: `graphology-layout-forceatlas2` with built-in WebWorker

### Benchmarks (2025 study, 481 datasets)

| Config | Max Nodes @ 30fps |
|--------|-------------------|
| D3-WebGL | 7,000 |
| D3-Canvas | 5,000 |
| ECharts-Canvas | 3,000 |
| D3-SVG | 2,000 |
| G6-Canvas | 1,000 |

## Compound Layouts: The Natural Fit

### fCoSE (Fast Compound Spring Embedder)

The most natural algorithm for nested codebase structure:

- **Compound nodes** -- packages are containers, files are children. Forces work across nesting levels.
- **Spectral initialization** -- fast deterministic starting positions (no random jitter)
- **Constraint support** -- fixed positions, alignment, relative placement
- **12.5ms typical runtime** (vs 369ms for CoLa with similar quality)
- Zero edge crossings and zero node-node overlaps in benchmarks

**Why it matters for AITC:** fCoSE is what you get if you designed a layout algorithm specifically for "directories contain files, files have dependencies." Our current d3-force + custom `forceCluster` is a hand-rolled approximation of what fCoSE does natively.

## Treemaps: Space-Efficient Containment

### Voronoi Treemap

- **Organic-looking districts** -- each package is an irregularly-shaped blob, not a rigid rectangle
- Area proportional to a metric (LOC, file count, activity)
- Recursive tessellation for hierarchy
- FoamTree implementation handles 100K+ nodes on 100+ nesting levels
- **Stability:** moderate -- iterative Lloyd's relaxation, smoother transitions than squarified

### Squarified Treemap

- 100% space usage, no wasted whitespace
- O(n log n) layout, very fast
- **Stability:** LOW -- "dramatic discontinuous changes" on data updates. Items jump between positions.
- Not suitable for animated/real-time displays

**AITC verdict:** Voronoi for the hybrid approach (Phase 13+). The organic shapes are more visually distinctive and memorable. Squarified is better for dense static overviews.

## Hybrid: The Recommended Architecture

**Strategy:** treemap for package space allocation + force-directed within packages.

1. **Voronoi treemap** allocates screen regions to top-level packages. Area = total LOC or file count. Guarantees no overlap and 100% space usage.
2. **Force-directed** (d3-force or ForceAtlas2) positions files within each package region based on dependency edges.
3. **Cross-package edges** render as bundled curves following treemap boundaries.

This avoids the core weakness of each approach alone:
- Pure force-directed loses package boundaries at scale (everything blurs together)
- Pure treemap can't show dependency relationships (it only knows hierarchy)
- The hybrid gets both: clear package regions AND dependency-driven file positions

## Incremental Layout: Preserving Mental Map

When files change, the layout must NOT reorganize dramatically. Users build a mental map of "where things are."

**Strategies:**
1. **Pin unchanged nodes** -- only moved/changed nodes and their 1-hop neighbors get freedom
2. **Warm start** -- initialize from previous layout, not random. Converge in 5-10 ticks, not 300.
3. **Constrained anchoring** -- `forceX`/`forceY` push each node toward its previous position, with strength proportional to age (older = stronger anchor)
4. **Gentle alpha reheating** -- set `alphaTarget = 0.1` briefly, let it cool back to 0

**AITC already does some of this** (pin via `fx`/`fy`, settle-then-freeze pattern). Phase 11 formalizes it.

## GPU Acceleration: Future Scale

| Library | Engine | Scale | Notes |
|---------|--------|-------|-------|
| **cosmos.gl** | WebGL 2 | 1M+ nodes | All computation on GPU. iOS broken (missing extension). |
| **GraphWaGu** | WebGPU compute | 100K nodes / 2M edges | Research prototype. First WebGPU graph layout. |
| **ParaGraphL** | WebGL fragment shaders | 3K nodes tested | Up to 489x speedup. Hack (GPGPU via fragment shaders). |
| **NeuLay** | GNN | 10-100x over FDL | Learns optimal positions. Not browser-ready. |

**When to consider:** If AITC needs to visualize 50K+ file monorepos interactively. Not needed at current ~5K scale.

## Progressive Scale Strategy

| Codebase Size | Layout | Phase |
|--------------|--------|-------|
| < 1K files | d3-force + module gravity | Current |
| 1-10K files | d3-force/ForceAtlas2 in WebWorker | Phase 11 |
| 10-50K files | Voronoi treemap + force within | Phase 13+ |
| > 50K files | GPU (cosmos.gl) + hierarchical clustering | Future |

## Sources

Full source list (60 URLs) available in `outputs/codebase-spatial-representation-research-layout.md`.

Key references:
- [ForceAtlas2 paper (PLOS ONE)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679)
- [fCoSE paper (IEEE TVCG)](https://yoksis.bilkent.edu.tr/pdf/files/15807.pdf)
- [d3-force docs](https://d3js.org/d3-force/simulation)
- [Semantic Zoom for Software Cities (2025)](https://arxiv.org/html/2510.00003v1)
- [NeuLay (Nature Communications)](https://www.nature.com/articles/s41467-023-37189-2)
- [Graph viz efficiency benchmark (PMC 2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12061801/)
