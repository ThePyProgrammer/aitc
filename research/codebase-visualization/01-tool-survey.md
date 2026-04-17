# Tool Survey: How Existing Tools Represent Codebases

> 14 tools surveyed. The landscape splits into visual graph tools (pretty but limited scale), matrix tools (scalable but not spatial), and text tools (infinite scale but no navigation).

## Comparison Matrix

| Tool | Data Structure | Layout | Hierarchy | Scale Ceiling |
|------|---------------|--------|-----------|---------------|
| **Sourcetrail** | Symbol dependency graph | Sugiyama (layered) | Expand/collapse + bundling | ~1000s visible |
| **CodeSee** | Multi-level dep graph | Proprietary auto-layout | Service -> Dir -> File | Production-scale |
| **Understand** | Static analysis multi-graph | Graphviz (dot + fdp) | Expandable tree headers | ~100s (graph), 100K+ (DSM) |
| **JetBrains DSM** | Dependency matrix | Topological sort ordering | Module/package/class tree | 100K+ classes |
| **aider repomap** | File reference graph | PageRank (textual) | Indented text tree | Unlimited (token-budgeted) |
| **GitHub dep graph** | Package DAG | Tabular list | Direct vs transitive | Production-scale |
| **Gephi** | Generic graph | ForceAtlas2 / OpenOrd | Louvain clustering | 100K (FA2), 1M+ (OpenOrd) |
| **CodeScene** | VCS behavioral data | Circle-packing | Dir nesting = circle nesting | 10K+ files |
| **Emerge** | Dep + inheritance graph | D3 force + Louvain | Inferred clusters | Whole-project |
| **CodeFlower** | File tree | D3 force-directed | Implicit via links | ~1-5K nodes |

## Tools Most Relevant to AITC

### Sourcetrail (Open Source, Discontinued)

The closest prior art to what we're building. Key design decisions worth stealing:

- **Unified SQLite database** across all indexed languages -- all symbols in one graph regardless of source language
- **Typed nodes** (file, namespace, class, function, variable) with **color by category** (grey=types, yellow=functions, blue=variables)
- **Typed edges** (include, call, use, inherit, override) with distinct visual styles
- **Bundle nodes** collapse >20 children into a single aggregate, preventing visual overload
- **Trail layout** -- a horizontal path-finding view between two symbols, configurable depth + filters

**What it lacked:** No agent activity overlay. No real-time file watching. Cross-language edges were implicit, not explicit IPC connections.

### aider repomap

Not visual, but the ranking algorithm is gold:

- **PageRank on file reference graph** -- files are ranked by their "importance" in the dependency network
- **Personalization weights** -- files in the current context get 100x weight, biasing the ranking toward what's relevant right now
- **Token-budgeted output** -- the map grows to fill available context, showing more detail for important files
- **tree-sitter AST parsing** for 130+ languages -- same approach AITC already uses for dep extraction

**AITC application:** Use PageRank to decide which nodes to render at low zoom levels. A 50K-file codebase doesn't need to show all 50K dots -- show the top-ranked 500 at workspace zoom, expand to full detail as you zoom in.

### Gephi / ForceAtlas2

The benchmark for graph layout quality:

- **ForceAtlas2** -- degree-dependent repulsion where hub nodes (imported by many) get stronger repulsion, naturally spacing out core modules
- **LinLog mode** -- logarithmic attraction reveals community structure, making package boundaries visually apparent
- **Barnes-Hut** O(n log n) -- quadtree spatial decomposition makes force computation tractable at 100K nodes
- **Adaptive speed** -- each node has independent velocity; unstable (oscillating) nodes automatically slow down

**AITC application:** ForceAtlas2 in LinLog mode would make our directory clusters tighter and more visually distinct than the current d3-force. Available as a JavaScript library (graphology-layout-forceatlas2) with WebWorker support.

### CodeScene / code-maat

Behavioral analysis from git history, not just static structure:

- **Temporal coupling** -- files that change together in commits are linked, even if they have no import relationship
- **Hotspots** -- files ranked by `complexity x change frequency`, surfacing where bugs are most likely
- **Circle-packing layout** -- space-efficient nested circles where directory hierarchy = visual containment
- **Color = code health** -- red circles = high churn + high complexity, blue = stable and clean

**AITC application:** Temporal coupling edges would reveal hidden dependencies that import analysis misses. A file in the TS frontend that always changes alongside a Rust backend handler? That's a coupling the import graph doesn't show but agents should know about.

### Emerge

Automatic clustering without manual configuration:

- **Louvain modularity** -- community detection algorithm that finds natural clusters in the dependency graph
- Files that heavily import each other cluster together, even across directory boundaries
- Clusters are colored independently, making "actual" module boundaries visible vs "filesystem" boundaries

**AITC application:** Louvain clustering could replace or augment our directory-based `forceCluster`. Some codebases have files that logically belong together but live in different directories (e.g., a `utils/auth.ts` that's tightly coupled to `views/Login/`).

## Three Hierarchy Patterns

Every spatial tool faces the same problem: how to show file -> module -> package -> service in one view.

### Pattern 1: Expand/Collapse (Sourcetrail, Understand)
Click a package node to explode it into its files. Click again to collapse. Pro: familiar tree interaction. Con: loses spatial context when collapsed.

### Pattern 2: Containment (CodeScene, D3 treemap)
Packages are regions that literally contain their files. Recursive subdivision. Pro: hierarchy always visible. Con: deep nesting wastes space.

### Pattern 3: Zoom Levels (CodeSee, CodeViz)
Different views at different zoom levels -- service-level map at one zoom, file-level at another. Pro: each level is optimized for its granularity. Con: transitions between levels can be disorienting.

**AITC recommendation:** Pattern 2 (containment via hull boundaries) at file/package level, with Pattern 3 (semantic zoom) across the full range. This is what Phase 13 implements.

## Sources

Full source list (41 URLs) available in `outputs/codebase-spatial-representation-research-tools.md`.

Key references:
- [Sourcetrail docs](https://github.com/CoatiSoftware/Sourcetrail/blob/master/DOCUMENTATION.md)
- [ForceAtlas2 paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679)
- [aider repomap implementation](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py)
- [Emerge](https://github.com/glato/emerge)
- [CodeScene hotspots](https://codescene.io/docs/guides/technical/hotspots.html)
