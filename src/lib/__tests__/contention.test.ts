import { describe, it, expect } from 'vitest';
import { computeContentionScore, contentionToColor } from '../contention';

describe('computeContentionScore', () => {
  it('returns 0 when there are no conflicts and no agents', () => {
    expect(computeContentionScore(0, 0, 10, 5)).toBe(0);
  });

  it('returns 1.0 at maximum conflicts and agents', () => {
    expect(computeContentionScore(10, 5, 10, 5)).toBe(1.0);
  });

  it('returns weighted score for partial values', () => {
    // conflictNorm = 5/10 = 0.5, writeNorm = (1-1)/(5-1) = 0
    // score = 0.5 * 0.7 + 0 * 0.3 = 0.35
    const score = computeContentionScore(5, 1, 10, 5);
    expect(score).toBeCloseTo(0.35, 5);
  });

  it('clamps to 1.0 when inputs exceed maximums', () => {
    const score = computeContentionScore(20, 10, 10, 5);
    expect(score).toBe(1.0);
  });

  it('handles maxConflicts=0 and maxAgents=1 edge cases', () => {
    expect(computeContentionScore(5, 1, 0, 1)).toBe(0);
  });
});

describe('contentionToColor', () => {
  it('returns transparent for score 0', () => {
    expect(contentionToColor(0)).toBe('rgba(0, 0, 0, 0)');
  });

  it('returns green-range rgba for low scores (0-0.3)', () => {
    const color = contentionToColor(0.15);
    expect(color).toMatch(/^rgba\(142, 255, 113,/);
    // alpha = 0.15 / 0.3 * 0.25 = 0.125
    expect(color).toContain('0.125');
  });

  it('returns amber-range rgba for mid scores (0.3-0.7)', () => {
    const color = contentionToColor(0.5);
    expect(color).toMatch(/^rgba\(255, 209, 111,/);
    // alpha = 0.15 + ((0.5 - 0.3) / 0.4) * 0.2 = 0.15 + 0.1 = 0.25
    expect(color).toContain('0.25');
  });

  it('returns red-range rgba for high scores (0.7-1.0)', () => {
    const color = contentionToColor(1.0);
    expect(color).toMatch(/^rgba\(255, 115, 81,/);
    // alpha = 0.2 + ((1.0 - 0.7) / 0.3) * 0.25 = 0.2 + 0.25 = 0.45
    expect(color).toContain('0.45');
  });

  it('returns green at score 0.3 boundary', () => {
    const color = contentionToColor(0.3);
    // At exactly 0.3, should be green range: alpha = 0.3/0.3*0.25 = 0.25
    expect(color).toMatch(/^rgba\(142, 255, 113,/);
  });
});
