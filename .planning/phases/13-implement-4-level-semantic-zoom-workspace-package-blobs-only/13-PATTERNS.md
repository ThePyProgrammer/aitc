# Phase 13: Implement 4-level semantic zoom - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/views/Radar/semanticZoom.ts` | utility | transform | `src/views/Radar/GraphRenderer.ts` | role-match |
| `src/views/Radar/packageBlobs.ts` | utility | transform | `src/views/Radar/hullCache.ts` | exact |
| `src/views/Radar/PackageBlobRenderer.ts` | utility/renderer | transform | `src/views/Radar/BridgeRenderer.ts` | exact |
| `src/views/Radar/CodePreviewOverlay.tsx` | component | request-response | `src/views/Radar/BridgeTooltip.tsx` | role-match |
| `src/views/Radar/GraphRenderer.ts` | utility/renderer | transform | `src/views/Radar/GraphRenderer.ts` | exact self-modification |
| `src/views/Radar/hullCache.ts` | utility/cache | transform | `src/views/Radar/hullCache.ts` | exact self-modification |
| `src/views/Radar/RadarCanvas.tsx` | component/controller | event-driven | `src/views/Radar/RadarCanvas.tsx` | exact self-modification |
| `src/stores/radarStore.ts` | store | event-driven | `src/stores/radarStore.ts` | exact self-modification |
| `src-tauri/src/pipeline/deps/extract.rs` | service/utility | file-I/O transform | `src-tauri/src/pipeline/deps/extract.rs` | exact self-modification |
| `src/views/Radar/__tests__/semanticZoom.test.ts` | test | transform | `src/views/Radar/__tests__/GraphRenderer.test.ts` | role-match |
| `src/views/Radar/__tests__/packageBlobs.test.ts` | test | transform | `src/views/Radar/__tests__/hullCache.test.ts` | exact |
| `src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` | test | request-response | `src/views/Radar/__tests__/RadarCanvas.test.tsx` | role-match |
| `src/views/Radar/__tests__/GraphRenderer.test.ts` | test | transform | `src/views/Radar/__tests__/GraphRenderer.test.ts` | exact self-modification |

## Pattern Assignments

### `src/views/Radar/semanticZoom.ts` (utility, transform)

**Analog:** `src/views/Radar/GraphRenderer.ts`

**Imports pattern** (lines 13-20):
```typescript
import type { GraphNode, GraphEdge, Viewport } from '../../stores/radarStore';
import type { GraphTheme } from './themes';
import { clusterAccentFor, THEMES, DEFAULT_THEME_ID } from './themes';
// Phase 11.1 (T3): convex-hull math + Catmull-Rom spline + padded-point
// scatter + centroid all moved into hullCache.ts so drawFolderHulls can
// resolve pre-built bundles from a settledAt-keyed cache instead of re-
// running them every frame. See src/views/Radar/hullCache.ts.
import { getHullCache } from './hullCache';
```

**Core pure-helper pattern** (lines 155-166):
```typescript
// ───── Progressive detail (D-12, UI-SPEC) ─────
/**
 * Folder hulls respect three zoom tiers:
 *   zoom < 0.6        → only depth-0 hulls (coarse overview)
 *   0.6 ≤ zoom < 2    → depth ≤ 2 (mid fidelity)
 *   zoom ≥ 2          → all depths (full fidelity)
 */
export function shouldRenderHullAtZoom(dirDepth: number, zoom: number): boolean {
  if (zoom < 0.6) return dirDepth === 0;
  if (zoom < 2) return dirDepth <= 2;
  return true;
}
```

**Math/validation pattern** (lines 84-94):
```typescript
export function heatColor(score: number, theme?: GraphTheme): string {
  const clamped = Math.max(0, Math.min(1, score));
  const start = theme?.heatRampStart ?? '#0f1a0e';
  const [sr, sg, sb] = hexToRgb(start);
  const [er, eg, eb] = hexToRgb(HEAT_RAMP_END);
  const r = Math.round(sr + (er - sr) * clamped);
  const g = Math.round(sg + (eg - sg) * clamped);
  const b = Math.round(sb + (eb - sb) * clamped);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
```

**Apply:** implement semantic resolver as exported pure constants/types/functions, no React imports, no store writes. Clamp opacity values like `heatColor` clamps scores. Replace old three-tier `shouldRenderHullAtZoom` as the abstraction consumed by renderers/cache.

---

### `src/views/Radar/packageBlobs.ts` (utility, transform)

**Analog:** `src/views/Radar/hullCache.ts`

**Imports pattern** (lines 21-23):
```typescript
import { polygonHull, polygonCentroid } from 'd3-polygon';
import { line, curveCatmullRomClosed } from 'd3-shape';
import type { GraphNode } from '../../stores/radarStore';
```

**Cache state pattern** (lines 50-56):
```typescript
// Module-level state. Cleared on any (settledAt, zoom-bucket) change.
let cacheEpoch: string = '__sentinel__'; // never matches a real composite key
let cache: Map<string, HullCacheEntry> = new Map();

// Allocated once at module load; reused across rebuilds.
const smoothHullLine = line().curve(curveCatmullRomClosed.alpha(0.5));
```

**Membership and bridge-exclusion pattern** (lines 88-97):
```typescript
// Group nodes by dirKey. Skip empty-dirKey roots and uninitialized positions.
const byDir = new Map<string, GraphNode[]>();
for (const n of nodes) {
  if (n.x === undefined || n.y === undefined) continue;
  if (n.dirKey === '') continue;
  if (n.kind === 'bridge') continue;
  const arr = byDir.get(n.dirKey) ?? [];
  arr.push(n);
  byDir.set(n.dirKey, arr);
}
```

**Centroid fallback pattern** (lines 106-118):
```typescript
const pts = members.map((n) => [n.x!, n.y!] as [number, number]);
const padded = paddedHullPoints(pts, paddingRadius);
const hull = polygonHull(padded);
if (hull && hull.length >= 3) {
  const pathStr = smoothHullLine(hull);
  const smoothPath = pathStr ? new Path2D(pathStr) : null;
  const [cx, cy] = polygonCentroid(hull);
  cache.set(dirKey, { smoothPath, cx, cy, isCircleFallback: false, dirDepth });
} else {
  const cx = members.reduce((s, n) => s + (n.x ?? 0), 0) / members.length;
  const cy = members.reduce((s, n) => s + (n.y ?? 0), 0) / members.length;
  cache.set(dirKey, { smoothPath: null, cx, cy, isCircleFallback: true, dirDepth });
}
```

**Apply:** derive package blob entries from file nodes only. Use cache keys tied to graph topology/settled positions/contention/conflict/agent inputs, not raw rAF frame time. Preserve `kind === 'bridge'` exclusion.

---

### `src/views/Radar/PackageBlobRenderer.ts` (utility/renderer, transform)

**Analog:** `src/views/Radar/BridgeRenderer.ts`

**Imports pattern** (lines 21-26):
```typescript
import type { GraphNode, Viewport } from '../../stores/radarStore';
import {
  type GraphTheme,
  THEMES,
  DEFAULT_THEME_ID,
} from './themes';
```

**Renderer constants pattern** (lines 28-51):
```typescript
const FALLBACK_THEME: GraphTheme = THEMES[DEFAULT_THEME_ID];

// ───── Sizing constants (UI-SPEC §Sizing Tokens — world-space unless noted) ─────
/** Half-diagonal of the bridge diamond in world-space pixels. */
export const BRIDGE_HALF_DIAG = 8;
/** Gap between inner diamond and channel-bearing outer ring. */
export const BRIDGE_CHANNEL_STROKE_OFFSET = 2;
/** Gap between inner diamond and white selection ring. */
export const BRIDGE_SELECTED_RING_OFFSET = 3;
/** Vertical gap between diamond apex and command-name label. */
export const BRIDGE_LABEL_OFFSET = 6;
/** Zoom threshold beyond which bridge labels render (matches file labels). */
export const BRIDGE_LABEL_ZOOM_THRESHOLD = 4;
...
/** Hit-test tolerance (world-space px @ zoom 1) for bridge diamonds. */
export const BRIDGE_HIT_RADIUS = 10;
```

**Canvas draw function signature pattern** (lines 99-109):
```typescript
export function drawBridgeNodes(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  selectedBridgeId: string | null,
  hoveredBridgeId: string | null,
  zoom: number,
  _viewport: Viewport,
  _canvasWidth: number,
  _canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
```

**Canvas state-save pattern** (lines 125-149):
```typescript
// Inner diamond.
ctx.save();
ctx.beginPath();
ctx.moveTo(b.x, b.y - d);
ctx.lineTo(b.x + d, b.y);
ctx.lineTo(b.x, b.y + d);
ctx.lineTo(b.x - d, b.y);
ctx.closePath();
// Three-way fill: selected wins, then dangling uses theme.nodeFill
// (color as primary dangling signal), populated retains the cyan
// baseFill (edgeGlow ?? arrowFill ?? '#00cffc').
ctx.fillStyle = isSelected
  ? theme.nodeFillHover ?? baseFill
  : isDangling
    ? theme.nodeFill
    : baseFill;
ctx.fill();
ctx.strokeStyle = theme.nodeStroke;
ctx.lineWidth = 1 / zoom;
ctx.stroke();
ctx.setLineDash([]);
ctx.restore();
```

**Hit-test analog** from `src/views/Radar/RadarCanvas.tsx` (lines 852-869):
```typescript
const findBridgeAtWorld = useCallback(
  (worldX: number, worldY: number): GraphNode | null => {
    const r = BRIDGE_HIT_RADIUS / Math.max(viewport.zoom, 0.1);
    for (const n of graphNodes) {
      if (n.kind !== 'bridge') continue;
      if (n.x === undefined || n.y === undefined) continue;
      // Rectangular bounding-box containment (RESEARCH §Pattern — diamond
      // hit-test uses bbox at this scale).
      if (Math.abs(n.x - worldX) <= r && Math.abs(n.y - worldY) <= r) {
        return n;
      }
    }
    return null;
  },
  [graphNodes, viewport.zoom],
);
```

**Apply:** keep package blob draw/hit-test as pure exported functions with explicit `ctx`, data, zoom, viewport, canvas dimensions, theme. Divide world-space visual constants by zoom where the UI spec demands screen constancy.

---

### `src/views/Radar/CodePreviewOverlay.tsx` (component, request-response)

**Analog:** `src/views/Radar/BridgeTooltip.tsx` and `src/views/Radar/AgentTooltip.tsx`

**Imports pattern** from `BridgeTooltip.tsx` (lines 12-13):
```typescript
import type { IpcBridgeDto, IpcCallSite } from '../../bindings';
import type { GraphNode } from '../../stores/radarStore';
```

**Clamp-to-container pattern** from `BridgeTooltip.tsx` (lines 30-38):
```typescript
// UI-SPEC §Tooltip — wider than the 240px agent tooltip to fit signatures.
const tooltipW = 260;
const tooltipH = 140;
let left = mouseX + 12;
let top = mouseY + 12;
if (left + tooltipW > containerWidth) left = mouseX - tooltipW - 12;
if (top + tooltipH > containerHeight) top = mouseY - tooltipH - 12;
if (left < 0) left = 4;
if (top < 0) top = 4;
```

**Glassmorphism chrome pattern** from `BridgeTooltip.tsx` (lines 77-87):
```tsx
return (
  <div className="absolute z-50 pointer-events-none" style={{ left, top }}>
    <div
      className="p-3 border border-outline/20"
      style={{
        backgroundColor: 'rgba(36, 36, 36, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        width: tooltipW,
      }}
    >
```

**Safe text rendering pattern** from `AgentTooltip.tsx` (lines 1-5, 81-86):
```typescript
// T-04-12: Intent text rendered as JSX text node (React escaping).
// Never use dangerouslySetInnerHTML.
```
```tsx
{/* Intent text - JSX text node for XSS safety (T-04-12) */}
{agent.intent && (
  <p className="font-mono text-sm text-on-surface leading-tight line-clamp-2 overflow-hidden">
    {agent.intent}
  </p>
)}
```

**Metadata row pattern** from `RadarCanvas.tsx` (lines 1127-1154):
```tsx
<div className="font-mono text-xs text-on-surface font-bold truncate">
  {hoveredNode.id.includes('/')
    ? hoveredNode.id.slice(hoveredNode.id.lastIndexOf('/') + 1)
    : hoveredNode.id}
</div>
<div className="font-mono text-[10px] text-on-surface-variant/70 truncate mt-0.5">
  {hoveredNode.id}
</div>
<div className="flex items-center gap-3 mt-1.5 font-mono text-[10px] text-on-surface-variant">
  <span>
    DIR <span className="text-on-surface">{hoveredNode.dirKey || '(root)'}</span>
  </span>
  <span>
    DEPTH <span className="text-on-surface">{hoveredNode.dirDepth}</span>
  </span>
</div>
```

**Syntax-highlight pattern** from `src/hooks/useSyntaxHighlight.ts` (lines 92-112):
```typescript
export function highlightLines(
  highlighter: HighlighterCore,
  code: string,
  lang: string,
): string[] {
  const result = highlighter.codeToTokens(code, { lang, theme: 'github-dark' });

  return result.tokens.map((line) =>
    line
      .map((token) => {
        const color = safeCssColor(token.color ?? '#d4d4d4');
        // Shiki already HTML-escapes token content (T-05-07)
        const escaped = token.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<span style="color: ${color}">${escaped}</span>`;
      })
      .join(''),
  );
}
```

**Apply:** signature cards are DOM overlays with local expand/collapse state, clamped to canvas bounds, capped to 6 instances by selector logic, and safe by default. Render signatures/path metadata as JSX text. Only use `highlightLines` for expanded snippets; do not introduce raw `dangerouslySetInnerHTML` unless using the sanitized line output deliberately and with tests.

---

### `src/views/Radar/GraphRenderer.ts` (utility/renderer, transform)

**Analog:** self

**Constants pattern** (lines 45-58):
```typescript
// ───── Sizing tokens (UI-SPEC §Sizing, world-space) ─────
export const NODE_RADIUS_DEFAULT = 5;
export const NODE_RADIUS_HOVERED = 6;
export const NODE_RADIUS_SELECTED = 6;
export const NODE_HIT_RADIUS = 8;
export const ARROW_LENGTH = 5;       // world-space; divided by zoom in canvas calls
export const ARROW_BASE_WIDTH = 3;
export const ARROW_INSET = 5;         // distance from node center where arrow apex sits
export const FOLDER_HULL_FILL_ALPHA = 0.05;
export const FOLDER_HULL_STROKE_ALPHA = 0.4;
export const VIEWPORT_CULL_PADDING = 100;
export const PINNED_BADGE_SIZE = 5;
export const FILE_LABEL_ZOOM_THRESHOLD = 4; // UI-SPEC §Progressive Detail: ≥ 4× shows file-name labels
```

**Viewport culling pattern** (lines 96-118):
```typescript
export function isInViewport(
  point: { x: number; y: number },
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = VIEWPORT_CULL_PADDING,
): boolean {
  const sx = point.x * viewport.zoom + viewport.panX;
  const sy = point.y * viewport.zoom + viewport.panY;
  return (
    sx >= -padding &&
    sx <= canvasWidth + padding &&
    sy >= -padding &&
    sy <= canvasHeight + padding
  );
}
```

**File-label pattern to update** (lines 455-488):
```typescript
export function drawFileLabels(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  zoom: number,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  if (zoom < FILE_LABEL_ZOOM_THRESHOLD) return;
  const fontSize = 10 / zoom;
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.fillStyle = theme.fileLabelColor;
  ctx.globalAlpha = 0.8;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    if (!isInViewport({ x: n.x, y: n.y }, viewport, canvasWidth, canvasHeight)) continue;
    // Extract basename from repo-relative path (forward-slash convention).
    const basename = n.id.includes('/') ? n.id.slice(n.id.lastIndexOf('/') + 1) : n.id;
    ctx.fillText(basename, n.x, n.y + (NODE_RADIUS_DEFAULT + 3) / zoom);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
```

**Node drawing performance pattern** (lines 387-394):
```typescript
// Two-pass drawing to avoid shadow state churn. On glow themes the old
// code toggled ctx.shadowColor/shadowBlur per-node (5k state writes);
// now we set shadow state once per pass:
//
//   Pass 1 — shadow OFF: heat-tinted nodes (error stroke, no glow).
//   Pass 2 — shadow ON:  everything else (glow themes only; for non-glow
//            themes there's only one pass and shadow is never touched).
```

**Apply:** keep file-level primitives pure and theme-threaded. Move label threshold from raw `zoom >= 4` to semantic FILE/CODE opacity or threshold `>= 2` per UI spec. Do not hide IPC edges: `drawEdges` already boosts `invokes`/`handles` alpha (lines 291-304), so planner should gate non-IPC edges separately at orchestration if needed.

---

### `src/views/Radar/hullCache.ts` (utility/cache, transform)

**Analog:** self

**Obsolete duplicate gate to replace** (lines 25-36):
```typescript
// Phase 11.1 — duplicate of GraphRenderer.ts::shouldRenderHullAtZoom to avoid
// a circular import (hullCache → GraphRenderer → hullCache). The three-tier
// zoom gate is small and stable; if it changes, update both copies. The
// filter MUST run inside the cache build — without it, we pay convex-hull +
// Catmull-Rom + Path2D construction for every deep-nested directory even
// though drawFolderHulls skips them at paint time, which dominated the
// per-rebuild cost on user hardware.
function shouldBuildHullAtZoom(dirDepth: number, zoom: number): boolean {
  if (zoom < 0.6) return dirDepth === 0;
  if (zoom < 2) return dirDepth <= 2;
  return true;
}
```

**Cache epoch pattern** (lines 72-86):
```typescript
/**
 * Resolve per-directory hull bundles, rebuilding the cache on any change
 * to (settledAt, zoom-bucket). Zoom-bucket granularity is 0.1.
 */
export function getHullCache(
  nodes: GraphNode[],
  zoom: number,
  settledAt: number | null,
): Map<string, HullCacheEntry> {
  const zoomBucket = Math.round(zoom * 10) / 10;
  const epoch = `${settledAt ?? 'null'}|${zoomBucket}`;
  if (epoch === cacheEpoch) return cache;

  cacheEpoch = epoch;
  cache = new Map();
```

**Bridge exclusion invariant** (lines 17-19, 91-94):
```typescript
// Invariant: kind === 'bridge' nodes are excluded from hull membership.
// Bridges are pinned on the y=0 boundary line and would drag folder centroids
// toward it if included. Enforced inside the group-by-dirKey loop below.
```
```typescript
if (n.x === undefined || n.y === undefined) continue;
if (n.dirKey === '') continue;
if (n.kind === 'bridge') continue;
```

**Apply:** either import the new pure semantic helper to remove duplicate gate logic, or confine hullCache to low-level geometry while `packageBlobs` owns semantic representation. Preserve the cheap cache-epoch behavior and `_resetHullCacheForTest` export.

---

### `src/views/Radar/RadarCanvas.tsx` (component/controller, event-driven)

**Analog:** self

**Imports/orchestration pattern** (lines 27-60):
```typescript
import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Flame, AlertTriangle, Info } from 'lucide-react';
import {
  useRadarStore,
  getAgentColor,
  type GraphNode,
} from '../../stores/radarStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useAgentStore } from '../../stores/agentStore';
import { useConflictStore } from '../../stores/conflictStore';
import { useCanvasZoomPan } from '../../hooks/useCanvasZoomPan';
import { useGraphLayout } from '../../hooks/useGraphLayout';
import {
  drawFolderLabels,
  drawEdges,
  drawArrowHeads,
  drawNodes,
  drawSelectedNode,
  drawFileLabels,
  NODE_HIT_RADIUS,
} from './GraphRenderer';
...
import { BridgeTooltip } from './BridgeTooltip';
```

**Bridge/file split pattern** (lines 704-711):
```typescript
// Phase 12 fix (quick/260422-dqu) — derive bridgeNodes ONCE per frame
// up-front so the boundary line (step 3), bridge diamonds/labels
// (steps 12-13), and screen-space anchor labels (steps 22-24) can all
// share the same filter + gate on bridges-present.
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');
// Phase 22 Fix 1 (D-01) — sibling to bridgeNodes so drawNodes + drawFileLabels
// render the file-node subset only, eliminating the aura-circle defect.
const fileNodes = filterRenderableFileNodes(liveNodes);
```

**Live worker position hot path** (lines 643-701):
```typescript
const simulating = isSimulatingRef.current;
const live = simNodesRef.current;
let liveNodes: typeof s.graphNodes = s.graphNodes;
let livePositions = s.positions;
if (
  simulating &&
  live.positions.byteLength > 0 &&
  live.ids.length > 0
) {
  // Repopulate simPositionMap from the Float32Array (reads via
  // live.positions[i * 2] / live.positions[i * 2 + 1] — the
  // Worker-populated Transferable buffer; ids[i] resolves the
  // matching node id for the consumer-facing Map<string,{x,y}>
  // contract preserved from Phase 7).
  simPositionMap.clear();
  for (let i = 0; i < live.ids.length; i++) {
    simPositionMap.set(live.ids[i], {
      x: live.positions[i * 2],
      y: live.positions[i * 2 + 1],
    });
  }
  livePositions = simPositionMap;
  ...
}
```

**Render sequence pattern** (lines 713-805):
```typescript
if (bridgeNodes.length > 0) {
  drawBoundaryLine(ctx, bridgeNodes, vp, w, h, s.theme);
}

drawFolderLabels(
  ctx,
  liveNodes,
  vp.zoom,
  s.settledAt,
  s.parentChildMap,
  s.dirsWithOwnFiles,
  s.theme,
);
drawEdges(ctx, s.graphEdges, livePositions, vp.zoom, vp, w, h, s.theme);
drawArrowHeads(ctx, s.graphEdges, livePositions, vp.zoom, vp, w, h, s.theme);
drawNodes(
  ctx,
  fileNodes,
  s.contentionScores,
  s.heatMapEnabled,
  s.hoveredNodeId,
  vp.zoom,
  vp,
  w,
  h,
  s.theme,
);
drawFileLabels(ctx, fileNodes, vp.zoom, vp, w, h, s.theme);
...
drawCometTrails(ctx, s.activeTrails, livePositions, now, vp.zoom);
...
drawConflictPulses(ctx, s.activeConflictPaths, livePositions, now, vp.zoom);
drawConflictBadges(ctx, s.activeConflictPaths, livePositions, vp.zoom);
```

**Hit-test precedence pattern** (lines 883-902):
```typescript
// Phase 12 — try bridge hit first. Bridges sit on the boundary line
// and should win over file nodes near y≈0 since they're visually
// foremost in the z-order.
const bridge = findBridgeAtWorld(world.x, world.y);
if (bridge && bridge.commandName) {
  setHoveredBridgeId(bridge.commandName);
  setHoveredNodeId(null);
  onHoveredAgentChange?.(null, sx, sy);
  return;
}
setHoveredBridgeId(null);

const found = quadtreeRef.current?.find(
  world.x,
  world.y,
  NODE_HIT_RADIUS / Math.max(viewport.zoom, 0.1),
);
const nextId = found?.id ?? null;
setHoveredNodeId(nextId);
```

**Zoom HUD pattern to extend** (lines 1099-1102):
```tsx
{/* Zoom indicator */}
<div className="absolute bottom-3 left-3 font-mono text-[10px] text-on-surface-variant/50 select-none">
  {viewport.zoom.toFixed(1)}x
</div>
```

**Apply:** derive semantic state from `viewport.zoom` without changing `useCanvasZoomPan`. Add package/file/code draw calls into this rAF sequence. Keep bridge hit testing first, then code cards, agents, package/file active semantic representation per UI spec. Put semantic label next to the existing zoom indicator.

---

### `src/stores/radarStore.ts` (store, event-driven)

**Analog:** self

**Store imports pattern** (lines 18-39):
```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { computeContentionScore } from '../lib/contention';
import type { ConflictAlert } from './conflictStore';
import { usePipelineStore } from './pipelineStore';
import type {
  DependencyEdgeDto,
  EdgeKind,
  IpcBridgeDto,
  IpcCallSite,
} from '../bindings';
import { GRAPH_HALF_WIDTH } from '../workers/graphSimConfig';
import {
  cullExpiredTrails,
  MAX_TRAILS_PER_AGENT,
  TRAIL_TOTAL_LIFESPAN_MS,
} from '../views/Radar/CometTrail';
import {
  THEMES,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
} from '../views/Radar/themes';
```

**GraphNode extension pattern** (lines 43-65):
```typescript
export interface GraphNode {
  id: string;              // repo-relative path (or `bridge:<commandName>` for bridges)
  dirKey: string;          // repo-relative parent dir path (synthetic "bridge" for bridge nodes)
  dirDepth: number;        // depth from repo root, for forceCluster (D-11)
  x?: number;
  y?: number;
  fx?: number | null;      // user-pinned x (D-03) / deterministic alpha x-spread (D-14 for bridges)
  fy?: number | null;      // user-pinned y (D-03) / 0 for bridges (D-13)
  // Phase 12 (D-10): kind discriminator; undefined treated as 'file' for BC.
  kind?: 'file' | 'bridge';
  // Phase 12 (D-16): language classification for forceBoundary routing; only
  // populated on file nodes (undefined on bridges + language-agnostic files).
  language?: 'ts' | 'rust';
  // Phase 12 bridge-only fields (undefined on file nodes).
  commandName?: string;
  rustName?: string;
  handlerFile?: string;
  handlerLine?: number;
  signatureSummary?: string;
  hasChannelArg?: boolean;
  callerFiles?: IpcCallSite[];
  callerCount?: number;
}
```

**Precomputed directory data pattern** (lines 148-152, 375-391):
```typescript
/** Pre-computed from graphNodes on fetchGraph — avoids 20k string ops
 *  per render via useMemo. Maps parent dir → set of child dirs. */
parentChildMap: Map<string, Set<string>>;
/** Dirs that directly contain at least one file node. */
dirsWithOwnFiles: Set<string>;
```
```typescript
// Pre-compute parentChildMap + dirsWithOwnFiles once here instead
// of per-render via useMemo. Eliminates ~20k slice/join string ops
// from the React render path for a 5k-node graph. Bridges are
// intentionally excluded — they are not part of the folder tree.
const pcm = new Map<string, Set<string>>();
const dwof = new Set<string>();
for (const n of fileNodes) {
  dwof.add(n.dirKey);
  const parts = n.dirKey === '' ? [] : n.dirKey.split('/');
  for (let i = 0; i < parts.length; i++) {
    const parent = i === 0 ? '' : parts.slice(0, i).join('/');
    const child = parts.slice(0, i + 1).join('/');
    const s = pcm.get(parent) ?? new Set<string>();
    s.add(child);
    pcm.set(parent, s);
  }
}
```

**Error-handling pattern** (lines 223-237, 401-403):
```typescript
fetchGraph: async () => {
  try {
    // Phase 12 (V-12-16, D-08): widened to three-leg Promise.all — bridges
    // are best-effort; a single backend failure leaves the other slots
    // intact thanks to the per-leg .catch() guards.
    const [treeIndex, edges, bridges] = await Promise.all([
      invoke<TreeIndexEntryRaw[]>('get_tree_index'),
      invoke<DependencyEdgeDto[]>('get_dependency_graph'),
      invoke<IpcBridgeDto[]>('get_ipc_bridges').catch((err) => {
        // Per-leg catch so a bridge-scan failure does not clobber the
        // tree/edges work that already completed.
        console.error('get_ipc_bridges failed:', err);
        return [] as IpcBridgeDto[];
      }),
    ]);
```
```typescript
} catch {
  // Best-effort: leave existing slots as-is on failure.
}
```

**Apply:** avoid adding semantic level to Zustand if it updates on every wheel event; prefer pure helper. If signatures/path metadata need store shape, extend `GraphNode` with optional fields and preserve best-effort `fetchGraph` behavior.

---

### `src-tauri/src/pipeline/deps/extract.rs` (service/utility, file-I/O transform)

**Analog:** self

**Imports pattern** (lines 15-24):
```rust
use crate::pipeline::deps::queries::{
    javascript::JAVASCRIPT_IMPORTS, python::PYTHON_IMPORTS, rust::RUST_IMPORTS,
    typescript::TYPESCRIPT_IMPORTS,
};
use crate::pipeline::deps::EdgeKind;
use std::cell::RefCell;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tree_sitter::{Language, ParseOptions, Parser, Query, QueryCursor, StreamingIterator};
```

**Thread-local parser/query cache pattern** (lines 26-35):
```rust
// Perf (Plan-02 deviation Rule 1): the hot path used to rebuild `Query::new`
// from the S-expression source on every call. At 10k files × 5 imports that's
// 50k query compiles (~2-5ms each on Rust/TS grammars). Cache one `Parser`
// and one `Query` per language per thread — rayon reuses the same worker
// threads across parallel iterations, so thread_local storage amortizes the
// setup cost. Brings the 10k benchmark from 24s → <2s on a 14-core box.
thread_local! {
    static PARSERS: RefCell<[Option<Parser>; 6]> = const { RefCell::new([None, None, None, None, None, None]) };
    static QUERIES: RefCell<[Option<Query>; 6]> = const { RefCell::new([None, None, None, None, None, None]) };
}
```

**Guard constants pattern** (lines 48-54):
```rust
/// T-07-A: maximum source-file size submitted to the parser. Files larger than
/// this are skipped (empty Vec returned, logged at TRACE). 1 MiB.
pub const MAX_FILE_SIZE_BYTES: u64 = 1_048_576;

/// T-07-A: per-file wall-clock parse budget. Parser is interrupted via the
/// ParseOptions progress callback once elapsed exceeds this.
pub const MAX_PARSE_DURATION: Duration = Duration::from_millis(500);
```

**Language detection pattern** (lines 72-82):
```rust
pub fn detect_language(path: &Path) -> Option<SourceLanguage> {
    match path.extension()?.to_str()? {
        "ts" | "mts" | "cts" => Some(SourceLanguage::TypeScript),
        "tsx" => Some(SourceLanguage::Tsx),
        "js" | "mjs" | "cjs" => Some(SourceLanguage::JavaScript),
        "jsx" => Some(SourceLanguage::Jsx),
        "rs" => Some(SourceLanguage::Rust),
        "py" => Some(SourceLanguage::Python),
        _ => None,
    }
}
```

**File I/O and parse timeout pattern** (lines 107-177):
```rust
pub fn parse_and_extract(path: &Path, language: SourceLanguage) -> Vec<RawImport> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    if metadata.len() > MAX_FILE_SIZE_BYTES {
        tracing::trace!(
            path = %path.display(),
            size = metadata.len(),
            "dep_graph: skipping oversize file"
        );
        return Vec::new();
    }
    let source = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    ...
    let started = Instant::now();
    // T-07-A: wall-clock parse budget via ParseOptions progress callback.
    let mut progress = |_state: &tree_sitter::ParseState| -> ControlFlow<()> {
        if started.elapsed() > MAX_PARSE_DURATION {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    };
    ...
    if started.elapsed() > MAX_PARSE_DURATION {
        tracing::trace!(path = %path.display(), "dep_graph: parse exceeded wall-clock budget");
        return Vec::new();
    }

    extract_imports(&tree, &source, language)
})
}
```

**Apply:** optional signature extraction must reuse the same file-size cap, parse budget, language detection, parser/query cache, and empty-Vec-on-failure behavior. Do not add LSP/indexer dependencies.

---

### `src/views/Radar/__tests__/semanticZoom.test.ts` (test, transform)

**Analog:** `src/views/Radar/__tests__/GraphRenderer.test.ts`

**Test imports pattern** (lines 12-29):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drawFolderHulls,
  drawEdges,
  drawArrowHeads,
  drawNodes,
  drawSelectedNode,
  heatColor,
  isInViewport,
  collapseSingleChildChain,
  shouldRenderHullAtZoom,
  NODE_RADIUS_DEFAULT,
  NODE_RADIUS_HOVERED,
  ARROW_LENGTH,
  ARROW_INSET,
  VIEWPORT_CULL_PADDING,
} from '../GraphRenderer';
import type { GraphNode, GraphEdge } from '../../../stores/radarStore';
import { THEMES } from '../themes';
```

**Pure helper assertion pattern** (lines 140-155):
```typescript
describe('shouldRenderHullAtZoom (progressive detail, D-12)', () => {
  it('shows only depth-0 folders at zoom < 0.6 (Test 9)', () => {
    expect(shouldRenderHullAtZoom(0, 0.5)).toBe(true);
    expect(shouldRenderHullAtZoom(1, 0.5)).toBe(false);
    expect(shouldRenderHullAtZoom(2, 0.5)).toBe(false);
  });
  it('shows depth ≤ 2 at 0.6 ≤ zoom < 2 (Test 10)', () => {
    expect(shouldRenderHullAtZoom(0, 1)).toBe(true);
    expect(shouldRenderHullAtZoom(2, 1)).toBe(true);
    expect(shouldRenderHullAtZoom(3, 1)).toBe(false);
  });
  it('shows all depths at zoom ≥ 2', () => {
    expect(shouldRenderHullAtZoom(5, 2)).toBe(true);
    expect(shouldRenderHullAtZoom(10, 5)).toBe(true);
  });
});
```

**Apply:** assert anchors 0.6/2/4, crossfade band `[anchor - 0.10, anchor + 0.10]`, exact dominant-level labels, opacity clamp, and higher-detail tie-break at `0.5`.

---

### `src/views/Radar/__tests__/packageBlobs.test.ts` (test, transform)

**Analog:** `src/views/Radar/__tests__/hullCache.test.ts`

**Path2D polyfill pattern** (lines 3-10):
```typescript
// Path2D polyfill for jsdom (Canvas 2D constructors not available in test env).
// MUST be at the top, BEFORE any import that transitively loads hullCache.ts.
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: new (d?: string) => unknown }).Path2D =
    class Path2D {
      constructor(_d?: string) {}
    } as unknown as new (d?: string) => unknown;
}
```

**D3 mock pattern** (lines 12-35):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hullSpy = vi.fn();
const centroidSpy = vi.fn();
vi.mock('d3-polygon', async () => {
  const actual = await vi.importActual<typeof import('d3-polygon')>('d3-polygon');
  return {
    ...actual,
    polygonHull: (...args: Parameters<typeof actual.polygonHull>) => {
      hullSpy(...args);
      return actual.polygonHull(...args);
    },
    polygonCentroid: (...args: Parameters<typeof actual.polygonCentroid>) => {
      centroidSpy(...args);
      return actual.polygonCentroid(...args);
    },
  };
});
```

**Cache test pattern** (lines 47-82):
```typescript
describe('hullCache (D-08..D-11)', () => {
  beforeEach(() => {
    _resetHullCacheForTest();
    hullSpy.mockClear();
    centroidSpy.mockClear();
  });

  it('D-08: calls polygonHull once per dir when settledAt + zoom unchanged', () => {
    getHullCache(nodes, 1.0, 1000);
    getHullCache(nodes, 1.0, 1000);
    expect(hullSpy).toHaveBeenCalledTimes(1); // one dir × one call
  });

  it('D-09: rebuilds when settledAt changes', () => {
    getHullCache(nodes, 1.0, 1000);
    getHullCache(nodes, 1.0, 2000);
    expect(hullSpy).toHaveBeenCalledTimes(2);
  });
```

**Apply:** test file-count scaling, top-level vs subpackage selection, bridge exclusion, conflict priority, active-agent counts, label importance, and cache invalidation. Keep mocks ESM-safe like hullCache tests.

---

### `src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` (test, request-response)

**Analog:** `src/views/Radar/__tests__/RadarCanvas.test.tsx`

**React component test imports** (lines 12-20):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type {
  GraphNode,
  GraphEdge,
  Viewport,
  ActiveTrail,
} from '../../../stores/radarStore';
import type { FileEvent } from '../../../bindings';
```

**DOM environment shim pattern** (lines 22-41):
```typescript
// jsdom has no ResizeObserver — inject a no-op shim before any component
// mounts. The RadarCanvas observes its container size to drive HiDPI
// rescaling; the test harness does not exercise resize behavior.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
    NoopResizeObserver;
}
// rAF may be missing or run synchronously in jsdom — coerce to setTimeout 0
// so the render loop runs once after mount and tests can inspect draw calls.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame =
    (cb: () => void): number => setTimeout(cb, 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame =
    (h: number): void => clearTimeout(h as unknown as NodeJS.Timeout);
}
```

**Mock-store pattern** (lines 220-240):
```typescript
vi.mock('../../../stores/radarStore', () => {
  const useRadarStore = Object.assign(
    (selector: (s: typeof mockRadarState) => unknown) => selector(mockRadarState),
    {
      getState: () => mockRadarState,
      setState: (
        patch:
          | Partial<typeof mockRadarState>
          | ((s: typeof mockRadarState) => Partial<typeof mockRadarState>),
      ) => {
        const next = typeof patch === 'function' ? patch(mockRadarState) : patch;
        Object.assign(mockRadarState, next);
      },
    },
  );
  return {
    useRadarStore,
    getAgentColor: (_id: string) => '#8eff71',
    installRadarPipelineBridge: () => () => undefined,
  };
});
```

**Component assertion pattern** (lines 409-429):
```typescript
it('renders GRAPH_OVERLOAD banner at ≥10k nodes (D-23)', () => {
  const nodes: GraphNode[] = Array.from({ length: 10_001 }, (_, i) => ({
    id: `f${i}.ts`,
    dirKey: '',
    dirDepth: 0,
  }));
  mockRadarState.graphNodes = nodes;
  const { getByText } = render(<RadarCanvas />);
  expect(getByText('GRAPH_OVERLOAD')).toBeTruthy();
});
```

**Apply:** test cap of 6 cards, fallback strings `PATH_METADATA` and `SIGNATURES_UNAVAILABLE`, `EXPAND_SNIPPET`/`COLLAPSE_SNIPPET` local state, clamped position styles, and no destructive/edit actions.

---

### `src/views/Radar/__tests__/GraphRenderer.test.ts` (test, transform)

**Analog:** self

**Mock Canvas context pattern** (lines 35-87):
```typescript
function createMockCtx() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const assignments: Record<string, unknown[]> = {
    fillStyle: [],
    strokeStyle: [],
    lineWidth: [],
    font: [],
    textAlign: [],
    textBaseline: [],
  };
  const record = (fn: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ fn, args });
    });
  ...
  return ctx;
}
```

**Draw function assertion pattern** (lines 252-281):
```typescript
describe('drawEdges (D-13)', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses 1 / zoom uniform stroke for every edge (Test 4)', () => {
    const ctx = createMockCtx();
    const edges: GraphEdge[] = [
      { source: 'a', target: 'b', kind: 'import' },
      { source: 'b', target: 'c', kind: 'import' },
    ];
    const positions = new Map<string, { x: number; y: number }>([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 0 }],
      ['c', { x: 200, y: 0 }],
    ]);
    drawEdges(ctx, edges, positions, 2, VIEWPORT, CANVAS_W, CANVAS_H);
    const widths = (ctx as any)._assignments.lineWidth;
    // lineWidth was set to 1 / 2 = 0.5 before stroking
    expect(widths).toContain(0.5);
  });
```

**Apply:** update tests that assume hull visibility is the main zoom API. Add assertions for file labels at `zoom >= 2`/FILE level, non-IPC edge hiding at workspace/package, IPC edge preservation, and theme-token usage.

## Shared Patterns

### Pure render/helper modules
**Source:** `src/views/Radar/GraphRenderer.ts`, `src/views/Radar/BridgeRenderer.ts`  
**Apply to:** `semanticZoom.ts`, `packageBlobs.ts`, `PackageBlobRenderer.ts`, modified `GraphRenderer.ts`
```typescript
const FALLBACK_THEME: GraphTheme = THEMES[DEFAULT_THEME_ID];

export function drawBridgeNodes(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  selectedBridgeId: string | null,
  hoveredBridgeId: string | null,
  zoom: number,
  _viewport: Viewport,
  _canvasWidth: number,
  _canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
```

### Bridge/file separation
**Source:** `src/views/Radar/RadarCanvas.tsx` lines 704-711 and `src/views/Radar/hullCache.ts` lines 91-94  
**Apply to:** all package blob derivation, render, hit-test, and aggregation code
```typescript
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');
const fileNodes = filterRenderableFileNodes(liveNodes);
```
```typescript
if (n.x === undefined || n.y === undefined) continue;
if (n.dirKey === '') continue;
if (n.kind === 'bridge') continue;
```

### Hit-test z-order
**Source:** `src/views/Radar/RadarCanvas.tsx` lines 883-902  
**Apply to:** `RadarCanvas.tsx` semantic hit-test integration
```typescript
// Phase 12 — try bridge hit first. Bridges sit on the boundary line
// and should win over file nodes near y≈0 since they're visually
// foremost in the z-order.
const bridge = findBridgeAtWorld(world.x, world.y);
if (bridge && bridge.commandName) {
  setHoveredBridgeId(bridge.commandName);
  setHoveredNodeId(null);
  onHoveredAgentChange?.(null, sx, sy);
  return;
}
setHoveredBridgeId(null);
```

### Viewport culling and visual constancy
**Source:** `src/views/Radar/GraphRenderer.ts` lines 96-118, `src/views/Radar/BridgeRenderer.ts` lines 110-116  
**Apply to:** package blob labels, file labels, code card selection, blob hit target
```typescript
export function isInViewport(
  point: { x: number; y: number },
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = VIEWPORT_CULL_PADDING,
): boolean {
  const sx = point.x * viewport.zoom + viewport.panX;
  const sy = point.y * viewport.zoom + viewport.panY;
  return (
    sx >= -padding &&
    sx <= canvasWidth + padding &&
    sy >= -padding &&
    sy <= canvasHeight + padding
  );
}
```
```typescript
const d = BRIDGE_HALF_DIAG / zoom;
const baseFill =
  (theme as unknown as { edgeGlow?: string }).edgeGlow ??
  (theme as unknown as { arrowFill?: string }).arrowFill ??
  '#00cffc';
for (const b of bridges) {
  if (b.x === undefined || b.y === undefined) continue;
```

### Store best-effort backend invocation
**Source:** `src/stores/radarStore.ts` lines 223-237 and 401-403  
**Apply to:** optional signature/snippet data fetching if added to graph fetch
```typescript
try {
  const [treeIndex, edges, bridges] = await Promise.all([
    invoke<TreeIndexEntryRaw[]>('get_tree_index'),
    invoke<DependencyEdgeDto[]>('get_dependency_graph'),
    invoke<IpcBridgeDto[]>('get_ipc_bridges').catch((err) => {
      console.error('get_ipc_bridges failed:', err);
      return [] as IpcBridgeDto[];
    }),
  ]);
  ...
} catch {
  // Best-effort: leave existing slots as-is on failure.
}
```

### Parser guardrails
**Source:** `src-tauri/src/pipeline/deps/extract.rs` lines 48-54 and 107-123  
**Apply to:** any backend exported-symbol/signature extraction
```rust
pub const MAX_FILE_SIZE_BYTES: u64 = 1_048_576;
pub const MAX_PARSE_DURATION: Duration = Duration::from_millis(500);
```
```rust
let metadata = match std::fs::metadata(path) {
    Ok(m) => m,
    Err(_) => return Vec::new(),
};
if metadata.len() > MAX_FILE_SIZE_BYTES {
    tracing::trace!(
        path = %path.display(),
        size = metadata.len(),
        "dep_graph: skipping oversize file"
    );
    return Vec::new();
}
let source = match std::fs::read_to_string(path) {
    Ok(s) => s,
    Err(_) => return Vec::new(),
};
```

### DOM overlay safety
**Source:** `src/views/Radar/AgentTooltip.tsx` lines 1-5 and `src/hooks/useSyntaxHighlight.ts` lines 101-108  
**Apply to:** `CodePreviewOverlay.tsx`
```typescript
// T-04-12: Intent text rendered as JSX text node (React escaping).
// Never use dangerouslySetInnerHTML.
```
```typescript
const escaped = token.content
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
return `<span style="color: ${color}">${escaped}</span>`;
```

### Test harness patterns
**Source:** `src/views/Radar/__tests__/GraphRenderer.test.ts`, `src/views/Radar/__tests__/hullCache.test.ts`, `src/views/Radar/__tests__/RadarCanvas.test.tsx`  
**Apply to:** all new/extended Phase 13 tests
```typescript
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D { constructor(_d?: string) {} };
}
```
```typescript
const calls: Array<{ fn: string; args: unknown[] }> = [];
const assignments: Record<string, unknown[]> = {
  fillStyle: [],
  strokeStyle: [],
  lineWidth: [],
  font: [],
  textAlign: [],
  textBaseline: [],
};
```

## No Analog Found

None. Every planned file has either an exact self-modification analog or a close Radar renderer/component/test analog.

## Metadata

**Analog search scope:** `/home/prannayag/pragnition/htx/aitc/src/views/Radar`, `/home/prannayag/pragnition/htx/aitc/src/stores`, `/home/prannayag/pragnition/htx/aitc/src/hooks`, `/home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps`  
**Files scanned:** 222 TypeScript/TSX source files counted; 31 Radar files listed; 13 analog files read  
**Project skills:** none found under `.claude/skills/` or `.agents/skills/`; `.claude/` contains MCP/settings/worktree files only  
**Pattern extraction date:** 2026-05-03
