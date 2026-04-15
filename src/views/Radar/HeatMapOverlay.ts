// D-19, FMON-05.
// Heat-map overlay refactored for graph-mode radar: tints node fills directly
// (no separate Canvas layer). The primary render path lives in
// GraphRenderer.drawNodes which calls heatColor() per node. This file remains
// for callers that want the tint color in isolation (RadarMinimap, future
// overlays) and so any legacy `HeatMapOverlay` imports keep resolving.
//
// Legacy `drawHeatMap(treemapRects)` code path DELETED — Plan 04 removed the
// squarified treemap, so rect-based tinting is no longer meaningful.

import { heatColor } from './GraphRenderer';

/**
 * Default node fill (UI-SPEC §Color surface-container). Exported so callers
 * can branch to the baseline without re-hardcoding the hex.
 */
export const HEAT_BASELINE = '#1a1919';

/**
 * Returns the heat-blended fill color for a contention score in [0, 1].
 * Delegates to GraphRenderer.heatColor so the ramp stays consistent across
 * the main canvas and any overlay surfaces (e.g. the minimap).
 *
 * Score 0 → surface-container (#1a1919)
 * Score 1 → error (#ff7351)
 */
export function heatTintForNode(score: number): string {
  return heatColor(score);
}

/**
 * Convenience gate: returns the heat tint when the toggle is enabled AND the
 * score is non-zero; returns the baseline surface-container otherwise.
 * Matches the inline branching in GraphRenderer.drawNodes so the minimap
 * renders a visually-consistent reduction of the main canvas.
 */
export function heatTintIfActive(score: number, enabled: boolean): string {
  return enabled && score > 0 ? heatColor(score) : HEAT_BASELINE;
}
