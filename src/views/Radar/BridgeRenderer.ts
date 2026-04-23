// Phase 12 Plan 05 (Wave 4) — pure Canvas 2D draw functions for IPC bridge
// diamonds + the frontend/backend boundary line + screen-space anchor labels.
//
// Rationale (CONTEXT.md D-17..D-22, D-31):
//   - Bridges are visual skeleton — always rendered, independent of file-node
//     zoom culling. Rendered as 8px (world, divided by zoom for visual
//     constancy) rotated squares ("diamonds") string-along the boundary.
//   - The boundary is a thin horizontal world-space line at y=0 stretched to
//     the viewport extents so it always reads edge-to-edge.
//   - FRONTEND / TypeScript (above) and BACKEND / Rust (below) labels are
//     drawn in SCREEN space by the caller (see drawBoundaryAnchorLabels
//     preamble) so they stick to a fixed 12px inset regardless of pan/zoom.
//
// Analog: GraphRenderer.ts draw functions (PATTERNS.md §BridgeRenderer).
// Signature convention matches the rest of that file: pure functions take
// `(ctx, …data, zoom, viewport, canvasW, canvasH, theme = FALLBACK_THEME)`.
//
// Color token fallback chain (UI-SPEC §Color): `theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'`.
// Fallback literal #00cffc is the Command Horizon secondary token.

import type { GraphNode, Viewport } from '../../stores/radarStore';
import {
  type GraphTheme,
  THEMES,
  DEFAULT_THEME_ID,
} from './themes';

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
/**
 * Retained for optional future stroke-pattern decoration; dangling bridges
 * now carry colour (theme.nodeFill) as the primary signal per Phase 22 Fix 4.
 * Deletion tracked as a cleanup-pass follow-up.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const BRIDGE_DASH_PATTERN: [number, number] = [4, 3];
/** Global alpha for the world-space boundary line. */
export const BOUNDARY_LINE_OPACITY = 0.6;
/** Hit-test tolerance (world-space px @ zoom 1) for bridge diamonds. */
export const BRIDGE_HIT_RADIUS = 10;

// ───── drawBoundaryLine (D-18, UI-SPEC §Layout) ─────
/**
 * Strokes a thin horizontal line in world space at y=0 spanning the full
 * screen-width projected back into world space. Globalalpha capped at
 * BOUNDARY_LINE_OPACITY; line width 1/zoom so it stays visually 1px.
 */
export function drawBoundaryLine(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  viewport: Viewport,
  canvasWidth: number,
  _canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  // Phase 12 fix (quick/260422-dqu) — gate on bridges-present. On repos
  // without a Tauri IPC surface (e.g. TS + Python) `get_ipc_bridges`
  // returns an empty Vec, so the boundary line is meaningless — would
  // imply a FE/BE divide that doesn't exist. D-15/D-16 locked the Tauri-
  // binary layout assumption; this guard adds the runtime check.
  if (bridges.length === 0) return;
  const zoom = viewport.zoom || 1;
  const leftWorld = -viewport.panX / zoom;
  const rightWorld = (canvasWidth - viewport.panX) / zoom;
  ctx.save();
  ctx.strokeStyle = theme.hullStroke;
  ctx.globalAlpha = BOUNDARY_LINE_OPACITY;
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.moveTo(leftWorld, 0);
  ctx.lineTo(rightWorld, 0);
  ctx.stroke();
  ctx.restore();
}

// ───── drawBridgeNodes (D-17, UI-SPEC §Component Inventory) ─────
/**
 * Per-bridge 4-point diamond (moveTo + 3 lineTo + closePath):
 *   - Inner fill:   theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'
 *   - Inner stroke: theme.nodeStroke at 1/zoom
 *   - Dangling (callerCount=0 OR handlerFile=''): setLineDash(BRIDGE_DASH_PATTERN)
 *   - Channel-bearing (hasChannelArg): outer ring at BRIDGE_CHANNEL_STROKE_OFFSET/zoom
 *   - Selected: white 80%-alpha outer ring at BRIDGE_SELECTED_RING_OFFSET/zoom
 *
 * Hovered flag is accepted for future polish (cursor hint / faint tint) but
 * currently unused — selection wins visually.
 */
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
  const d = BRIDGE_HALF_DIAG / zoom;
  const baseFill =
    (theme as unknown as { edgeGlow?: string }).edgeGlow ??
    (theme as unknown as { arrowFill?: string }).arrowFill ??
    '#00cffc';
  for (const b of bridges) {
    if (b.x === undefined || b.y === undefined) continue;
    const isSelected =
      selectedBridgeId !== null && b.commandName === selectedBridgeId;
    const isDangling =
      b.callerCount === 0 ||
      b.callerCount === undefined ||
      !b.handlerFile;
    const hasChannel = b.hasChannelArg === true;

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
    // Dashed-stroke dangling signal dropped; colour (theme.nodeFill above)
    // is the primary signal. Retain the defensive setLineDash([]) reset in
    // case an upstream caller left the dash-state dirty.
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Channel-bearing outer ring (double-stroke).
    if (hasChannel) {
      ctx.save();
      const d2 = d + BRIDGE_CHANNEL_STROKE_OFFSET / zoom;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - d2);
      ctx.lineTo(b.x + d2, b.y);
      ctx.lineTo(b.x, b.y + d2);
      ctx.lineTo(b.x - d2, b.y);
      ctx.closePath();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = theme.nodeStroke;
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // Selected — white 80%-alpha outer ring.
    if (isSelected) {
      ctx.save();
      const d3 = d + BRIDGE_SELECTED_RING_OFFSET / zoom;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - d3);
      ctx.lineTo(b.x + d3, b.y);
      ctx.lineTo(b.x, b.y + d3);
      ctx.lineTo(b.x - d3, b.y);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // Reserved — hover polish lands in a future plan; accept the prop now
    // so the render-loop signature does not churn.
    void hoveredBridgeId;
  }
}

// ───── drawBridgeLabels (UI-SPEC §Progressive Detail ≥ 4×) ─────
/**
 * JetBrains Mono 10px (world / zoom) command-name above each diamond.
 * Only drawn at zoom >= BRIDGE_LABEL_ZOOM_THRESHOLD to keep low-zoom skeletons
 * clean (matches drawFileLabels behavior).
 */
export function drawBridgeLabels(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  zoom: number,
  _viewport: Viewport,
  _canvasWidth: number,
  _canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  if (zoom < BRIDGE_LABEL_ZOOM_THRESHOLD) return;
  const d = BRIDGE_HALF_DIAG / zoom;
  ctx.save();
  ctx.font = `${10 / zoom}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = theme.fileLabelColor ?? theme.nodeStroke;
  ctx.globalAlpha = 0.9;
  for (const b of bridges) {
    if (b.x === undefined || b.y === undefined) continue;
    if (!b.commandName) continue;
    ctx.fillText(b.commandName, b.x, b.y - d - BRIDGE_LABEL_OFFSET / zoom);
  }
  ctx.restore();
}

// ───── drawBoundaryAnchorLabels (UI-SPEC §Layout screen-space labels) ─────
/**
 * Compose an 80%-alpha backdrop fill from a theme's canvasBackground token.
 * All THEMES ship canvasBackground as a 6-char hex string; the `+ 'cc'`
 * suffix is the hex-alpha form of 80% (0xCC / 0xFF ≈ 0.8). Defensive regex
 * fallback: if a future theme authors rgba/hsl, return the raw value —
 * callers absorb the slight alpha mismatch rather than emit an invalid fill.
 */
function composeBackdropFill(canvasBg: string): string {
  return /^#[0-9a-f]{6}$/i.test(canvasBg) ? `${canvasBg}cc` : canvasBg;
}

/**
 * Screen-space (identity-transform) FRONTEND / TypeScript (above) and
 * BACKEND / Rust (below) anchor labels at leftX=12. Caller MUST wrap this
 * function with `ctx.save(); ctx.setTransform(1,0,0,1,0,0); … ctx.restore();`
 * — we assume identity pixel coordinates.
 *
 * boundaryScreenY = world y=0 projected to screen: `0*zoom + panY = panY`.
 * Clamps to [24, canvasHeight-24] so the labels stay on-screen when the
 * boundary itself is scrolled out of view.
 */
export function drawBoundaryAnchorLabels(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  viewport: Viewport,
  _canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  // Phase 12 fix (quick/260422-dqu) — see drawBoundaryLine note.
  if (bridges.length === 0) return;
  let boundaryScreenY = viewport.panY;
  if (boundaryScreenY < 24) boundaryScreenY = 24;
  if (boundaryScreenY > canvasHeight - 24) boundaryScreenY = canvasHeight - 24;
  const leftX = 12;
  // Swap folderLabelColor → fileLabelColor so the FE/BE axis labels read as
  // markers (not chrome). fileLabelColor is tuned for legibility against
  // busy graph regions in every theme.
  const labelColor = theme.fileLabelColor ?? theme.nodeStroke;
  // 80%-alpha backdrop pill per label stack.
  const pillFill = composeBackdropFill(theme.canvasBackground);

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Measure widest glyph per stack to size each pill. Fonts are set locally
  // per row; measure each row's text with its own font to get accurate widths.
  ctx.font = `700 10px "Space Grotesk", sans-serif`;
  const frontendW = ctx.measureText('FRONTEND').width;
  const backendW = ctx.measureText('BACKEND').width;
  ctx.font = `400 10px "JetBrains Mono", monospace`;
  const typescriptW = ctx.measureText('TypeScript').width;
  const rustW = ctx.measureText('Rust').width;

  const PAD_X = 8; // horizontal padding.
  const PAD_Y = 4; // vertical padding.

  const feStackW = Math.max(frontendW, typescriptW);
  const beStackW = Math.max(backendW, rustW);

  // FRONTEND stack (above boundary) — pill first, then bold + thin text.
  // Bold baseline y = boundaryScreenY - 18; thin baseline y = boundaryScreenY - 8.
  // Approximate 10px ascent; stack vertical extents:
  //   top    = (boundaryScreenY - 18) - 10 - PAD_Y
  //   bottom = (boundaryScreenY - 8) + PAD_Y
  const fePillX = leftX - PAD_X / 2;
  const fePillY = boundaryScreenY - 18 - 10 - PAD_Y;
  const fePillW = feStackW + PAD_X;
  const fePillH = 18 - 8 + 10 + PAD_Y * 2; // = 10 + 10 + 8 = 28
  ctx.fillStyle = pillFill;
  ctx.fillRect(fePillX, fePillY, fePillW, fePillH);

  ctx.fillStyle = labelColor;
  ctx.font = `700 10px "Space Grotesk", sans-serif`;
  ctx.globalAlpha = 1.0; // bold raised 0.8 → 1.0.
  ctx.fillText('FRONTEND', leftX, boundaryScreenY - 18);
  ctx.font = `400 10px "JetBrains Mono", monospace`;
  ctx.globalAlpha = 0.85; // thin raised 0.55 → 0.85.
  ctx.fillText('TypeScript', leftX, boundaryScreenY - 8);

  // BACKEND stack (below boundary).
  // Bold baseline y = boundaryScreenY + 18; thin baseline y = boundaryScreenY + 8.
  // Thin sits ABOVE bold in this stack.
  const bePillX = leftX - PAD_X / 2;
  const bePillY = boundaryScreenY + 8 - 10 - PAD_Y;
  const bePillW = beStackW + PAD_X;
  const bePillH = 18 - 8 + 10 + PAD_Y * 2; // = 28
  ctx.fillStyle = pillFill;
  ctx.fillRect(bePillX, bePillY, bePillW, bePillH);

  ctx.fillStyle = labelColor;
  ctx.font = `700 10px "Space Grotesk", sans-serif`;
  ctx.globalAlpha = 1.0;
  ctx.fillText('BACKEND', leftX, boundaryScreenY + 18);
  ctx.font = `400 10px "JetBrains Mono", monospace`;
  ctx.globalAlpha = 0.85;
  ctx.fillText('Rust', leftX, boundaryScreenY + 8);

  ctx.restore();
}
