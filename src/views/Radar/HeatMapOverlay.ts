// Phase 5 heat map overlay -- Canvas 2D render function.
//
// FMON-05, VIZN-03: Draws contention heat map over treemap file cells.
// Called from RadarCanvas render loop when heatMapEnabled is true.
// Colors follow Command Horizon green/amber/red gradient via contentionToColor.

import { contentionToColor } from '../../lib/contention';
import type { TreemapRect } from '../../hooks/useTreemapLayout';

/**
 * Draw heat map overlay on treemap file cells based on contention scores.
 *
 * Only draws over file cells (not directories). Skips cells with zero score
 * or sub-pixel size. Uses contentionToColor for the Command Horizon
 * green (0-0.3) -> amber (0.3-0.7) -> red (0.7-1.0) gradient.
 */
export function drawHeatMap(
  ctx: CanvasRenderingContext2D,
  rects: TreemapRect[],
  scores: Map<string, number>,
  zoom: number,
): void {
  for (const rect of rects) {
    if (!rect.isFile) continue;

    const score = scores.get(rect.path);
    if (!score || score <= 0) continue;

    const screenW = (rect.x1 - rect.x0) * zoom;
    const screenH = (rect.y1 - rect.y0) * zoom;

    // Sub-pixel culling
    if (screenW < 1 || screenH < 1) continue;

    const w = rect.x1 - rect.x0;
    const h = rect.y1 - rect.y0;
    const color = contentionToColor(score);

    ctx.fillStyle = color;
    ctx.fillRect(rect.x0, rect.y0, w, h);
  }
}
