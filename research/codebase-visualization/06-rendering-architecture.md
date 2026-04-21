# Rendering Architecture: 7-Layer Canvas Stack

> Separate what changes rarely (the graph) from what changes every frame (the agents).

## The Problem

AITC's current rendering pipeline redraws everything every frame:
- Clear canvas
- Draw hulls (static until graph changes)
- Draw edges (static until graph changes)
- Draw nodes (static until graph changes)
- Draw file labels (static)
- Draw agent trails (animated, 60fps)
- Draw agent dots (animated, 60fps)
- Draw conflict pulses (animated, 60fps)

For a 5K-node graph, the static layers account for ~90% of the draw calls but only need updating when the graph changes (on `fetchGraph` or `commitSettledPositions`). The animated agent layer is cheap (10-50 draw calls) but needs 60fps.

## Recommended: 7-Layer Architecture

Based on ATC display layer separation and game rendering patterns:

| Layer | Content | Update Trigger | Method |
|-------|---------|---------------|--------|
| **1** | Canvas background (theme color) | Theme change | Canvas 2D fill |
| **2** | Package hulls + labels | Graph settle / fetch | Offscreen canvas |
| **3** | Heatmap overlay | Contention score change | Offscreen canvas |
| **4** | Dependency edges + arrows | Graph settle / fetch | Offscreen canvas |
| **5** | File nodes + file labels | Graph change + hover | Offscreen canvas |
| **6** | Agent trails + dots + conflict pulses | Every frame (60fps) | Live canvas |
| **7** | Popovers, alerts, UI controls | User interaction | DOM overlay |

### How Offscreen Caching Works

```
On graph change:
  1. Create/resize OffscreenCanvas for layers 1-5
  2. Draw hulls, edges, nodes to the offscreen canvas
  3. Store the offscreen canvas as a bitmap

Every frame (rAF):
  1. Composite cached bitmap to main canvas (one drawImage call)
  2. Apply viewport transform
  3. Draw layer 6 (agents) on top — only 10-50 draw calls
  4. Done
```

**Cost reduction:** From ~10K+ draw calls per frame (5K nodes x arc+fill+stroke) to ~1 drawImage + ~50 agent draw calls. That's a 200x reduction in per-frame canvas operations.

### When to Invalidate the Cache

The offscreen canvas needs redrawing when:
- `graphNodes` or `graphEdges` change (new fetch)
- `settledAt` fires (simulation finished)
- `hoveredNodeId` changes (single node needs highlight — can use a partial redraw)
- `heatMapEnabled` or `contentionScores` change
- `theme` changes
- Canvas resizes
- Viewport pans or zooms (the offscreen is in world space, so this just means re-compositing at the new transform — no redraw needed!)

**Pan/zoom is free** with this architecture. The offscreen canvas is drawn in world coordinates. Compositing just applies the viewport transform to the cached bitmap. Only actual graph data changes require a full redraw.

## Current Architecture vs Target

| Aspect | Current (Phase 7) | Target (Phase 14) |
|--------|-------------------|-------------------|
| **Layout** | Main thread d3-force | WebWorker (Phase 11) |
| **Graph rendering** | Redraw all 5K nodes every dirty frame | Offscreen cache, composite per frame |
| **Agent rendering** | Mixed into same draw pass | Separate layer, 60fps independent of graph size |
| **Hover highlight** | Full redraw on hover change | Partial redraw (just the hovered node) |
| **Zoom/pan** | Redraw everything | Re-composite cached bitmap (zero draw calls) |
| **Position map** | ~~New Map per frame~~ Reused Map (fixed) | Same |
| **Store subscriptions** | ~~9 selectors~~ 1 useShallow (fixed) | Same |
| **Shadow state** | ~~Per-node writes~~ Batched (fixed) | Same |

## Implementation Strategy (Phase 14)

### Step 1: Create offscreen canvas ref

```typescript
const offscreenRef = useRef<OffscreenCanvas | null>(null);
const offscreenDirtyRef = useRef(true);
```

### Step 2: Separate dirty flags

```typescript
// Graph-level dirty (triggers offscreen redraw)
const graphDirtyRef = useRef(true);
// Frame-level dirty (triggers composite + agent draw)
const frameDirtyRef = useRef(true);
```

Graph-level dirty triggers on: graphNodes, graphEdges, settledAt, heatMapEnabled, contentionScores, theme changes.
Frame-level dirty triggers on: viewport, activeTrails, agentFileVersion, activeConflictPaths (animated elements).

### Step 3: Two-phase render loop

```typescript
function render() {
  // Phase A: rebuild offscreen if graph changed
  if (graphDirtyRef.current) {
    drawToOffscreen(offscreenCtx, ...);
    graphDirtyRef.current = false;
    frameDirtyRef.current = true;
  }
  
  // Phase B: composite + agents (every dirty frame)
  if (frameDirtyRef.current) {
    ctx.drawImage(offscreenRef.current, ...); // one call
    drawAgentLayer(ctx, ...);                 // ~50 calls
    frameDirtyRef.current = false;
  }
  
  requestAnimationFrame(render);
}
```

### Step 4: Hover optimization

Hovering a node currently triggers a full redraw. With offscreen caching:
- Keep the cached bitmap as-is
- Redraw just the hovered node (1 arc + 1 fill + 1 stroke) on top of the composite
- Or: maintain a tiny "hover overlay" canvas (just the hovered node + its highlight ring)

## Performance Budget

Target: **16.6ms per frame** (60fps)

| Operation | Current Cost (5K nodes) | With Offscreen Cache |
|-----------|------------------------|---------------------|
| Canvas clear | 0.1ms | 0.1ms |
| Draw hulls | ~2ms | 0ms (cached) |
| Draw edges | ~3ms | 0ms (cached) |
| Draw nodes | ~4ms | 0ms (cached) |
| Draw labels | ~1ms | 0ms (cached) |
| Composite bitmap | N/A | ~0.5ms (one drawImage) |
| Draw agents | ~0.5ms | ~0.5ms |
| **Total** | **~10.6ms** | **~1.1ms** |

That frees up ~9.5ms per frame — enough headroom for semantic zoom computations, hover effects, and smooth pan/zoom at any scale.

## Alternative: Multiple Stacked Canvases

Instead of one canvas with offscreen compositing, use multiple `<canvas>` elements stacked via CSS:

```html
<div class="radar-container">
  <canvas class="layer-graph" />    <!-- Layers 1-5, redrawn on graph change -->
  <canvas class="layer-agents" />   <!-- Layer 6, redrawn every frame -->
  <div class="layer-dom" />          <!-- Layer 7, HTML overlay -->
</div>
```

**Pros:** Simpler code (no offscreen canvas API). Each canvas has its own context.
**Cons:** Multiple canvas elements on a HiDPI display = more VRAM. Stacking order via z-index can be finicky. Transform sync between canvases needs careful management.

**Recommendation:** Start with offscreen canvas (single `<canvas>` element) because it avoids the multi-canvas sync problem. Fall back to stacked canvases if the OffscreenCanvas API has browser compatibility issues.

## Sources

- ATC display layer architecture (EUROCONTROL standards)
- [OffscreenCanvas MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- Game rendering pipeline patterns (separating static terrain from animated sprites)
- Software Cities semantic zoom (Seillier et al., 2025)
