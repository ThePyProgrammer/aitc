# Semantic Zoom: 4-Level Progressive Detail

> Not just making things bigger when you zoom in — changing what you see entirely.

## What Is Semantic Zoom?

**Geometric zoom** scales everything uniformly. Zoom in and text gets bigger, dots get bigger, lines get thicker. At extreme zoom levels, you see either too much detail (zoomed in on one file, lost context) or too little (zoomed out, everything is dots).

**Semantic zoom** changes the *representation* based on zoom level. At low zoom you see package blobs with aggregate metrics. At medium zoom you see individual files. At high zoom you see code content. Each level is optimized for its purpose.

## The 4-Level Model

Based on Software Cities research (Seillier et al., 2025) and CodeSee's 3-level approach, adapted for AITC:

### Level 1: Workspace (0.05x - 0.2x)

**What you see:** Package blobs with names and aggregate metrics.

- Hulls rendered as filled regions (no individual file dots)
- Package name centered, bold, uppercase
- Aggregate metrics: file count, total LOC, recent activity heat color
- Agent dots visible (but no trails, no data blocks)
- Cross-package edges shown as thick bundled curves between package centers

**Purpose:** "Where are the big modules? Which ones are active?"

### Level 2: Package (0.2x - 0.5x)

**What you see:** Sub-packages become visible, files appear as colored dots.

- Sub-package hulls with labels
- File nodes as small dots (current behavior)
- Dots colored by type/status (not just theme default)
- Cross-package dependency edges visible
- Agent dots + abbreviated data blocks (callsign only)

**Purpose:** "What's in this package? How do packages connect?"

### Level 3: File (0.5x - 2x)

**What you see:** File names, full dependency edges, agent activity.

- File name labels (current `drawFileLabels` at zoom >= 4, lowered to 0.5)
- Full dependency edge arrows with directionality
- Agent trails + full data blocks + pulse rings
- Hover popover with metadata (current implementation)
- Conflict badges and pulse rings

**Purpose:** "Which specific files are involved? What's the agent doing?"

### Level 4: Code (2x+)

**What you see:** File content preview, function signatures.

- Inline code preview (first ~5 lines, syntax highlighted)
- Function/class signatures extracted from AST
- Method-level dependency edges (function A calls function B)
- Full agent activity detail including velocity vectors

**Purpose:** "What code is in this file? What functions connect?"

## Current State vs Target

AITC currently has a 3-tier system in `shouldRenderHullAtZoom`:

```typescript
// Current (GraphRenderer.ts)
if (zoom < 0.6) return dirDepth === 0;  // coarse overview
if (zoom < 2) return dirDepth <= 2;     // mid fidelity  
return true;                             // all depths
```

This is **visibility-based** (show/hide hulls by depth). The target is **representation-based** (change what each element looks like).

### Migration Path

| Current Feature | Level 1 (0.05-0.2x) | Level 2 (0.2-0.5x) | Level 3 (0.5-2x) | Level 4 (2x+) |
|----------------|---------------------|---------------------|-------------------|----------------|
| **Hulls** | Filled regions, no nodes | Sub-package hulls visible | Full detail | Full detail |
| **Nodes** | Hidden | Small dots | Named dots | Content preview |
| **Edges** | Bundled package→package | Individual but thin | Full arrows | Method-level |
| **Labels** | Package name only | Package + sub-package | File names | Code preview |
| **Agents** | Dot only | Dot + callsign | Full data block + trail | Full + velocity |

## Implementation Strategy (Phase 13)

1. Define a `ZoomLevel` enum: `WORKSPACE | PACKAGE | FILE | CODE`
2. Compute current level from `viewport.zoom` with the thresholds above
3. Pass `zoomLevel` alongside `zoom` to every draw function
4. Each draw function branches on `zoomLevel` for its representation:
   - `drawFolderHulls(ctx, nodes, zoom, zoomLevel, ...)` — filled blobs at WORKSPACE, outlined at PACKAGE+
   - `drawNodes(ctx, nodes, zoom, zoomLevel, ...)` — hidden at WORKSPACE, dots at PACKAGE, named at FILE
   - `drawEdges(ctx, edges, zoom, zoomLevel, ...)` — bundled at WORKSPACE, individual at PACKAGE+

## Performance Implications

Semantic zoom is a **performance win**, not just a visual improvement:

- **At WORKSPACE level:** skip all node rendering (5K fewer arc calls), skip file labels, bundle edges into ~50 package-to-package curves instead of thousands of file-to-file edges
- **At PACKAGE level:** render dots but skip names (no fillText calls)
- **At FILE level:** current behavior
- **At CODE level:** only render visible nodes (viewport culling already handles this)

The render loop becomes cheaper at low zoom where there are more nodes in view.

## Prior Art

- **CodeSee:** 3 levels (service, directory, file) with click-to-drill
- **Software Cities (Seillier et al., 2025):** 4 LoD levels with k-Means clustering for efficient distance computation
- **GraphMaps (De Luca et al.):** Pre-built layers for each zoom level of a multi-level tree, enabling smooth semantic transitions
- **Google Maps:** The original semantic zoom — roads at low zoom, buildings at medium, addresses at high

## Sources

- Seillier et al., "Semantic Zoom and Mini-Maps for Software Cities," 2025 -- https://arxiv.org/html/2510.00003v1
- De Luca et al., "Multi-level tree based approach for interactive graph visualization with semantic zoom," 2019 -- https://arxiv.org/abs/1906.05996
- Wiens et al., "Semantic Zooming for Ontology Graph Visualizations," K-CAP 2017
