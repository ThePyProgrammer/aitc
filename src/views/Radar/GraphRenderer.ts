// D-12, D-13, D-19, VIZN-01.
// Pure render functions for the graph radar. Called by RadarCanvas's rAF loop.
// All sizes are world-space pixels; divide by zoom for visual constancy.
//
// Color tokens come from a GraphTheme threaded through every draw function;
// see src/views/Radar/themes.ts for the catalog. The legacy COLORS export is
// retained for a few sites (drawSelectedNode uses white stroke which is
// theme-independent).
// The render z-order in RadarCanvas walks these functions in sequence per
// 07-UI-SPEC §Component Inventory (steps 2-7 in this plan; 8-13 land in Plans
// 05 and 06).

import { polygonHull, polygonCentroid } from 'd3-polygon';
import { line, curveCatmullRomClosed } from 'd3-shape';
import type { GraphNode, GraphEdge, Viewport } from '../../stores/radarStore';
import type { GraphTheme } from './themes';
import { clusterAccentFor, THEMES, DEFAULT_THEME_ID } from './themes';

// Used as the optional-arg default across every draw function so legacy
// callers / tests that pre-date the theme arg still render with the
// original phosphor-classic palette.
const FALLBACK_THEME: GraphTheme = THEMES[DEFAULT_THEME_ID];

// Catmull-Rom closed spline for smooth hull outlines (ResearchOS technique).
const smoothHullLine = line().curve(curveCatmullRomClosed.alpha(0.5));

/**
 * Generate padded hull points by placing `resolution` points in a circle
 * of `radius` around each node center. This inflates the hull so it
 * doesn't hug nodes tightly. (ResearchOS NoteGraphView technique.)
 */
function paddedHullPoints(
  nodePoints: [number, number][],
  radius = 25,
  resolution = 10,
): [number, number][] {
  const result: [number, number][] = [];
  for (const [x, y] of nodePoints) {
    for (let i = 0; i < resolution; i++) {
      const angle = (i / resolution) * Math.PI * 2;
      result.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
  }
  return result;
}

// ───── Color tokens (Command Horizon phosphor green palette) ─────
export const COLORS = {
  // Node fills — dark green tint instead of neutral grey
  surfaceContainer: '#0f1a0e',
  surfaceContainerHigh: '#162015',
  surfaceContainerHighest: '#1e281c',
  // Edges + hull strokes — muted phosphor green
  outline: '#3d6b35',
  outlineVariant: '#2a4d24',
  // Text
  onSurface: '#d4ffc8',
  onSurfaceVariant: '#7fbf72',
  // Accents
  primary: '#8eff71',
  secondary: '#00cffc',
  error: '#ff7351',
} as const;

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

// ───── Heat-map color blend (D-19, UI-SPEC §Color heat-map ramp) ─────
/** Error token — the end of the heat-map ramp. Stable across themes. */
export const HEAT_RAMP_END = '#ff7351';

/** Parse a #rgb or #rrggbb hex string into a [r, g, b] triple in 0..255. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b];
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Interpolate from `theme.heatRampStart` → HEAT_RAMP_END along a contention
 * score in [0, 1]. Scores outside the range are clamped. If `theme` is
 * omitted, falls back to the phosphor-classic ramp start (#0f1a0e) so
 * existing callers / tests that pre-date the theme arg keep working.
 */
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

// ───── Viewport cull helper (UI-SPEC §Sizing progressive detail) ─────
/**
 * True when the given world-space point projects inside the canvas rectangle
 * extended by `padding` pixels on every side (default 100 per UI-SPEC).
 * Used by drawNodes / drawEdges / drawArrowHeads to skip off-screen geometry
 * at 5k+ node counts (D-23 target).
 */
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

// ───── Single-child directory chain collapse (commit a8fe89b ported to hull labels) ─────
/**
 * Produce a condensed label for a dirKey whose leading segments are all
 * single-child wrappers (no siblings, no own files). Walks from the root
 * down and strips segments until:
 *   - an ancestor has > 1 child, OR
 *   - an ancestor has its own file directly under it.
 * Returns the remaining segments joined with `/`. Preserves commit a8fe89b
 * behaviour at hull-label granularity.
 */
export function collapseSingleChildChain(
  dirKey: string,
  allDirKeysWithFiles: Set<string>,
  parentChildMap: Map<string, Set<string>>,
): string {
  const parts = dirKey.split('/');
  // Only strip strict ancestors (not the immediate parent directory of the
  // leaf) so we always keep at least one visible segment beyond the collapse
  // boundary. For `src/views/Radar` with src → views → Radar single-child
  // chain the expected label is `views/Radar`, not `Radar`.
  let collapseStart = 0;
  for (let i = 0; i < parts.length - 2; i++) {
    const ancestor = parts.slice(0, i + 1).join('/');
    const children = parentChildMap.get(ancestor);
    const hasOwnFiles = allDirKeysWithFiles.has(ancestor);
    if (!children || children.size > 1 || hasOwnFiles) {
      collapseStart = i;
      break;
    }
    // Ancestor is a single-child wrapper — continue stripping past it.
    collapseStart = i + 1;
  }
  return parts.slice(collapseStart).join('/');
}

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

// ───── drawFolderHulls (UI-SPEC §Component Inventory z-order steps 2-3) ─────
/**
 * Groups nodes by dirKey and for each group renders either:
 *   - a convex hull (≥3 points) via d3-polygon, or
 *   - a circle fallback centered on the centroid (<3 points).
 * Then places an UPPERCASE label at the centroid with progressive detail
 * (top-level = 12px bold 60%, nested = 10px regular 40%) per UI-SPEC §Color.
 */
export function drawFolderHulls(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  zoom: number,
  parentChildMap: Map<string, Set<string>>,
  dirsWithOwnFiles: Set<string>,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  const byDir = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    if (n.dirKey === '') continue;
    const arr = byDir.get(n.dirKey) ?? [];
    arr.push(n);
    byDir.set(n.dirKey, arr);
  }

  const lineW = 1 / zoom;
  for (const [dirKey, members] of byDir) {
    if (!shouldRenderHullAtZoom(members[0].dirDepth, zoom)) continue;
    ctx.strokeStyle = theme.hullStroke;
    ctx.fillStyle = theme.hullFill;
    ctx.lineWidth = lineW;

    const pts = members.map((n) => [n.x!, n.y!] as [number, number]);
    const padded = paddedHullPoints(pts, 25 / zoom);
    const hull = polygonHull(padded);

    let cx: number;
    let cy: number;
    if (hull && hull.length >= 3) {
      // Render smooth Catmull-Rom closed spline through hull points.
      const pathStr = smoothHullLine(hull);
      if (pathStr) {
        const path2d = new Path2D(pathStr);
        ctx.fill(path2d);
        ctx.stroke(path2d);
      }
      const centroid = polygonCentroid(hull);
      cx = centroid[0];
      cy = centroid[1];
    } else {
      // Fallback circle for dirs with <3 nodes or degenerate hulls.
      cx = members.reduce((s, n) => s + (n.x ?? 0), 0) / members.length;
      cy = members.reduce((s, n) => s + (n.y ?? 0), 0) / members.length;
      const r = 25 / zoom;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Label (collapsed-chain) — top-level depth 0/1 = 12px/zoom full alpha,
    // depth ≥2 = 10px/zoom dimmed via globalAlpha (keeps the theme color
    // intact so we don't have to parse/rewrite rgba strings).
    const label = collapseSingleChildChain(dirKey, dirsWithOwnFiles, parentChildMap);
    const isTop = members[0].dirDepth <= 1;
    const fontSize = (isTop ? 12 : 10) / zoom;
    ctx.font = `${isTop ? 'bold ' : ''}${fontSize}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.folderLabelColor;
    if (!isTop) ctx.globalAlpha = 0.67; // nested labels dimmed 40/60 of base.
    ctx.fillText(label.toUpperCase(), cx, cy - 6 / zoom);
    if (!isTop) ctx.globalAlpha = 1;
  }
}

// ───── drawEdges (UI-SPEC z-order step 4) ─────
/**
 * Uniform 1/zoom stroke per D-13. Edges whose both endpoints fall outside
 * the padded viewport rectangle are skipped.
 */
export function drawEdges(
  ctx: CanvasRenderingContext2D,
  edges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  zoom: number,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  ctx.strokeStyle = theme.edgeStroke;
  ctx.lineWidth = 1 / zoom;
  // Optional glow for bright themes (synthwave / plasma / electric-ice).
  // shadowBlur is in screen pixels (NOT affected by the canvas transform),
  // so we scale it WITH zoom and cap it — more zoom → more glow up to 4px;
  // zoomed out, glow shrinks to near zero so 5k-node views stay crisp.
  if (theme.edgeGlow) {
    ctx.shadowColor = theme.edgeGlow;
    ctx.shadowBlur = Math.min(4, zoom * 4);
  }
  for (const e of edges) {
    const sId =
      typeof e.source === 'string' ? e.source : (e.source as { id: string }).id;
    const tId =
      typeof e.target === 'string' ? e.target : (e.target as { id: string }).id;
    const a = positions.get(sId);
    const b = positions.get(tId);
    if (!a || !b) continue;
    if (
      !isInViewport(a, viewport, canvasWidth, canvasHeight) &&
      !isInViewport(b, viewport, canvasWidth, canvasHeight)
    ) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (theme.edgeGlow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
}

// ───── drawArrowHeads (UI-SPEC z-order step 5) ─────
/**
 * Triangle apex 5px (world) inset from the target node center, base 3px
 * wide. Culled at zoom < 0.6 (progressive detail) and skipped for edges
 * whose target is outside the padded viewport.
 */
export function drawArrowHeads(
  ctx: CanvasRenderingContext2D,
  edges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  zoom: number,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  if (zoom < 0.6) return;
  ctx.fillStyle = theme.arrowFill;
  const len = ARROW_LENGTH / zoom;
  const half = ARROW_BASE_WIDTH / zoom / 2;
  const inset = ARROW_INSET / zoom;
  for (const e of edges) {
    const sId =
      typeof e.source === 'string' ? e.source : (e.source as { id: string }).id;
    const tId =
      typeof e.target === 'string' ? e.target : (e.target as { id: string }).id;
    const a = positions.get(sId);
    const b = positions.get(tId);
    if (!a || !b) continue;
    if (!isInViewport(b, viewport, canvasWidth, canvasHeight)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < inset) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    const apexX = b.x - nx * inset;
    const apexY = b.y - ny * inset;
    const baseCx = apexX - nx * len;
    const baseCy = apexY - ny * len;
    const px = -ny;
    const py = nx;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(baseCx + px * half, baseCy + py * half);
    ctx.lineTo(baseCx - px * half, baseCy - py * half);
    ctx.closePath();
    ctx.fill();
  }
}

// ───── drawNodes (UI-SPEC z-order step 6) ─────
/**
 * Fills each node at world (x, y) with default surface-container fill (or
 * heatColor(score) when heatMapEnabled). Hovered nodes grow 5→6 world px.
 * Pinned nodes get a 5px (world) secondary-color lock badge offset +6,+6.
 * Viewport-culled via isInViewport.
 */
export function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  contentionScores: Map<string, number>,
  heatMapEnabled: boolean,
  hoveredId: string | null,
  zoom: number,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  ctx.lineWidth = 1 / zoom;
  const hasGlow = Boolean(theme.nodeGlow);
  const hasClusterAccents =
    theme.clusterAccents !== undefined && theme.clusterAccents.length > 0;

  // Two-pass drawing to avoid shadow state churn. On glow themes the old
  // code toggled ctx.shadowColor/shadowBlur per-node (5k state writes);
  // now we set shadow state once per pass:
  //
  //   Pass 1 — shadow OFF: heat-tinted nodes (error stroke, no glow).
  //   Pass 2 — shadow ON:  everything else (glow themes only; for non-glow
  //            themes there's only one pass and shadow is never touched).

  // ── Pass 1: heat-tinted nodes (shadow always off) ──
  if (heatMapEnabled) {
    if (hasGlow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      if (!isInViewport({ x: n.x, y: n.y }, viewport, canvasWidth, canvasHeight)) continue;
      const score = contentionScores.get(n.id) ?? 0;
      if (score <= 0) continue; // non-heat → pass 2
      ctx.fillStyle = heatColor(score, theme);
      ctx.strokeStyle = `rgba(255, 115, 81, ${score * 0.8})`;
      const r = hoveredId === n.id ? NODE_RADIUS_HOVERED : NODE_RADIUS_DEFAULT;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // ── Pass 2: non-heat nodes (shadow set once at the top) ──
  const glowPx = hasGlow ? Math.min(6, zoom * 6) : 0;
  if (hasGlow) {
    // For non-cluster themes, one shadowColor covers the whole pass.
    // For cluster themes, shadowColor changes per-accent but shadowBlur
    // stays constant — far cheaper than toggling on/off per node.
    ctx.shadowBlur = glowPx;
    if (!hasClusterAccents) ctx.shadowColor = theme.nodeGlow!;
  }
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    if (!isInViewport({ x: n.x, y: n.y }, viewport, canvasWidth, canvasHeight)) continue;
    const score = contentionScores.get(n.id) ?? 0;
    if (heatMapEnabled && score > 0) continue; // drawn in pass 1

    const isHover = hoveredId === n.id;
    ctx.fillStyle = isHover ? theme.nodeFillHover : theme.nodeFill;

    if (hasClusterAccents) {
      const accent = clusterAccentFor(n.dirKey, theme.clusterAccents!);
      ctx.strokeStyle = accent;
      if (hasGlow) ctx.shadowColor = accent;
    } else {
      ctx.strokeStyle = theme.nodeStroke;
    }

    const r = isHover ? NODE_RADIUS_HOVERED : NODE_RADIUS_DEFAULT;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (hasGlow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
}

// ───── drawFileLabels (UI-SPEC §Progressive Detail: zoom ≥ 4× shows file names) ─────
/**
 * At high zoom, render the file name (basename only) below each node so the
 * user can identify what each dot represents. Uses JetBrains Mono at 10px
 * (world-space / zoom) per UI-SPEC §Typography "Data-sm".
 * Viewport-culled. Only drawn when zoom >= FILE_LABEL_ZOOM_THRESHOLD (4×).
 */
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

// ───── drawSelectedNode (UI-SPEC z-order steps 7-8) ─────
/**
 * Ambient glow (40px / zoom radial gradient, 15% → 0 alpha in agent palette
 * color) + 1px white outer stroke at 80% opacity on the selected agent's
 * current-position node. No-op if node is undefined so Plans 05/06 can wire
 * agent-position tracking without causing visual regressions here.
 */
export function drawSelectedNode(
  ctx: CanvasRenderingContext2D,
  node: GraphNode | undefined,
  agentColor: string,
  zoom: number,
): void {
  if (!node || node.x === undefined || node.y === undefined) return;
  // Outer halo — solid fill at low alpha instead of a per-frame gradient.
  // Visually similar (soft glow) but avoids creating a CanvasGradient
  // object every frame.
  const haloR = 40 / zoom;
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = agentColor;
  ctx.beginPath();
  ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // 1px white outer stroke at 80%
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.arc(node.x, node.y, NODE_RADIUS_SELECTED + 1 / zoom, 0, Math.PI * 2);
  ctx.stroke();
}
