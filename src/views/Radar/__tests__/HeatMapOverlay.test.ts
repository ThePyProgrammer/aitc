// Phase 7 Plan 06 — HeatMapOverlay refactored to delegate tint to
// GraphRenderer.heatColor (D-19, FMON-05). Legacy treemap-rect code path
// is gone; this file now exports tint helpers only.
import { describe, it, expect } from 'vitest';
import { heatTintForNode, heatTintIfActive } from '../HeatMapOverlay';
import { heatColor } from '../GraphRenderer';

describe('HeatMapOverlay (graph node tint) — Plan 06', () => {
  it('heatTintForNode(0) returns the default surface-container color (#0f1a0e)', () => {
    expect(heatTintForNode(0)).toBe('#0f1a0e');
  });

  it('heatTintForNode(0.5) equals GraphRenderer.heatColor(0.5) (delegation verified)', () => {
    expect(heatTintForNode(0.5)).toBe(heatColor(0.5));
  });

  it('heatTintForNode(1) returns error #ff7351 (D-19 ramp endpoint)', () => {
    expect(heatTintForNode(1)).toBe('#ff7351');
  });

  it('heatTintIfActive returns baseline #0f1a0e when heat map disabled, regardless of score', () => {
    expect(heatTintIfActive(0.9, false)).toBe('#0f1a0e');
  });

  it('heatTintIfActive returns baseline #0f1a0e when score is 0 even if enabled', () => {
    expect(heatTintIfActive(0, true)).toBe('#0f1a0e');
  });

  it('heatTintIfActive returns the heat blend when enabled and score > 0', () => {
    expect(heatTintIfActive(0.5, true)).toBe(heatColor(0.5));
    expect(heatTintIfActive(1, true)).toBe('#ff7351');
  });
});
