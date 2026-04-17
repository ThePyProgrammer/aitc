# Synthesis & Recommendations

> The big picture: what we're building and why.

## Key Findings

1. **No existing tool combines spatial code visualization with agent activity overlay.** Sourcetrail does code graphs. Kiali does service meshes. ATC radar does moving entities. Nobody does all three. AITC is genuinely novel.

2. **The recommended layout is hybrid compound**: Voronoi treemap for package-level space allocation + force-directed for file positioning within packages, with 4-level semantic zoom. This maps to how developers think: "where is this package?" (macro) then "where is this file?" (micro).

3. **Cross-language boundaries should be first-class graph citizens**, not just edge annotations. Parse `tauri-specta`'s `bindings.ts` to detect the IPC surface. Render bridge nodes on a visible boundary line.

4. **Agent overlay should follow ATC radar patterns**: target symbol + data block + leader line + history trail. Three-tier conflict alerting adapted from TCAS.

5. **At ~5k nodes**, d3-force with Barnes-Hut in a WebWorker is sufficient. Beyond 10k, hybrid treemap+force. Beyond 50k, GPU.

## 10 Design Principles

1. **IPC commands as first-class bridge nodes** -- not just edges, but visible diamond gateway nodes on the frontend/backend boundary
2. **Spatial separation with visible boundary** -- frontend left, backend right, IPC bridge in the middle
3. **Language-based color coding** -- distinct accent per language/runtime (already partially implemented via graph themes)
4. **Typed edges** -- import (thin solid), IPC call (thick dashed), type-share (dotted), temporal coupling (faint weighted)
5. **4-level semantic zoom** -- workspace -> package -> file -> code (extends current 3-tier `shouldRenderHullAtZoom`)
6. **ATC-pattern agent overlay** -- dot + trail + data block + leader line (partially implemented with comet trails)
7. **3-tier conflict escalation** -- advisory (directory) -> warning (file) -> critical (function), adapted from TCAS
8. **Progressive layout strategy** -- d3-force now, hybrid treemap+force at scale, GPU if needed
9. **WebWorker layout computation** -- biggest single perf win still on the table
10. **Offscreen canvas caching** -- separate static graph (layers 1-5) from animated agent layer (layer 6)

## What We Already Have vs What's Missing

| Aspect | Current State | Target State | Gap |
|--------|--------------|-------------|-----|
| Graph data | Files + import edges | Typed nodes + typed edges + IPC bridges | Phase 12, 16 |
| Layout | d3-force on main thread | d3-force in WebWorker | Phase 11 |
| Zoom | 3-tier show/hide | 4-level semantic zoom with representation changes | Phase 13 |
| Rendering | Single canvas pass per frame | 7-layer with offscreen cache | Phase 14 |
| Agent viz | Comet trails + dots + pulse | ATC data blocks + leader lines + velocity vectors | Phase 15 |
| Clustering | Directory-based only | Directory + Louvain community detection | Phase 16 |
| Cross-language | Not visualized | IPC bridge nodes on visible boundary | Phase 12 |
| Conflict tiers | Single-tier (file level) | 3-tier: directory / file / function | Phase 15 |

## Open Questions

1. **Voronoi vs squarified treemap** for package regions -- need to prototype both. Voronoi is organic but less stable; squarified is space-efficient but jumpy.
2. **GNN-based layout (NeuLay)** -- 10-100x speedup, finds better layouts. Not in browser JS yet. Monitor.
3. **Temporal coupling detection cost** -- git history analysis may be expensive. Consider caching / background computation.
4. **Agent intent metadata** -- velocity vectors need task scope data that file watchers alone don't provide. May need agent-reported intent.
5. **Multi-canvas vs single canvas** for the 7-layer architecture -- benchmark both on target hardware.
