// Phase 7 Plan 05 — CometTrail pure function contract tests.
//
// Covers D-14 (400ms ease-out-cubic head travel), D-15 (per-agent color),
// D-16 (opacity curve: 100% first 2s, linear fade to 0 over remaining 8s),
// D-18 (per-agent FIFO cap = 10, cull by age > 10_000ms).
import { describe, it, expect } from 'vitest';
import {
  interpolateHead,
  sampleTailSegments,
  cullExpiredTrails,
  trailOpacity,
  easeOutCubic,
  COMET_TRAVEL_MS,
  TRAIL_FULL_OPACITY_MS,
  TRAIL_FADE_DURATION_MS,
  TRAIL_TOTAL_LIFESPAN_MS,
  MAX_TRAILS_PER_AGENT,
} from '../CometTrail';
import type { ActiveTrail } from '../../../stores/radarStore';

function mkTrail(
  agentId: string,
  startTs: number,
  fromPath = 'a.ts',
  toPath = 'b.ts',
): ActiveTrail {
  return {
    id: `${agentId}|${fromPath}|${toPath}|${startTs}`,
    agentId,
    fromPath,
    toPath,
    startTs,
  };
}

describe('CometTrail constants (UI-SPEC §Motion)', () => {
  it('exports the 400ms / 2000ms / 8000ms / 10000ms / 10-cap constants', () => {
    expect(COMET_TRAVEL_MS).toBe(400);
    expect(TRAIL_FULL_OPACITY_MS).toBe(2000);
    expect(TRAIL_FADE_DURATION_MS).toBe(8000);
    expect(TRAIL_TOTAL_LIFESPAN_MS).toBe(10_000);
    expect(MAX_TRAILS_PER_AGENT).toBe(10);
  });
});

describe('easeOutCubic (D-14)', () => {
  it('returns 0 at t=0 and 1 at t=1', () => {
    expect(easeOutCubic(0)).toBeCloseTo(0, 6);
    expect(easeOutCubic(1)).toBeCloseTo(1, 6);
  });

  it('returns 0.875 at t=0.5 (1 - (1-0.5)^3)', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6);
  });

  it('clamps t outside [0,1]', () => {
    expect(easeOutCubic(-0.5)).toBeCloseTo(0, 6);
    expect(easeOutCubic(2)).toBeCloseTo(1, 6);
  });
});

describe('interpolateHead (D-14)', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  it('Test 1: at t=0 head sits at the source node', () => {
    const trail = mkTrail('a', 1000);
    const head = interpolateHead(trail, 1000, from, to);
    expect(head.x).toBeCloseTo(0, 6);
    expect(head.y).toBeCloseTo(0, 6);
  });

  it('Test 2: at t=400ms head reaches the target node', () => {
    const trail = mkTrail('a', 1000);
    const head = interpolateHead(trail, 1400, from, to);
    expect(head.x).toBeCloseTo(100, 6);
    expect(head.y).toBeCloseTo(0, 6);
  });

  it('Test 3: at t=200ms the eased fraction is 0.875', () => {
    const trail = mkTrail('a', 1000);
    const head = interpolateHead(trail, 1200, from, to);
    expect(head.x).toBeCloseTo(87.5, 4);
    expect(head.y).toBeCloseTo(0, 6);
  });

  it('clamps past t=400ms to the target', () => {
    const trail = mkTrail('a', 1000);
    const head = interpolateHead(trail, 5000, from, to);
    expect(head.x).toBeCloseTo(100, 6);
  });
});

describe('sampleTailSegments', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  it('Test 4: default segments parameter produces 6 samples', () => {
    const trail = mkTrail('a', 1000);
    const samples = sampleTailSegments(trail, 1200, from, to);
    expect(samples.length).toBe(6);
  });

  it('Test 5: youngest segment has highest alpha; oldest has lowest', () => {
    const trail = mkTrail('a', 1000);
    const samples = sampleTailSegments(trail, 1200, from, to);
    expect(samples[samples.length - 1].alpha).toBeGreaterThan(samples[0].alpha);
    // oldest = 0 alpha (i = 0 → alpha scale 0).
    expect(samples[0].alpha).toBeCloseTo(0, 6);
  });

  it('returns empty array when trail is expired', () => {
    const trail = mkTrail('a', 0);
    const samples = sampleTailSegments(trail, 11_000, from, to);
    expect(samples).toEqual([]);
  });

  it('segment widths taper from head (2px) to tail (0.5px)', () => {
    const trail = mkTrail('a', 1000);
    const samples = sampleTailSegments(trail, 1200, from, to);
    expect(samples[samples.length - 1].width).toBeCloseTo(2, 6);
    expect(samples[0].width).toBeCloseTo(0.5, 6);
  });
});

describe('trailOpacity curve (D-16)', () => {
  it('Test 12: age=1000ms (< 2000ms phase 1) → opacity = 1.0', () => {
    expect(trailOpacity(1000)).toBeCloseTo(1, 6);
  });

  it('age=2000ms boundary → opacity still 1.0 (top of fade phase)', () => {
    expect(trailOpacity(2000)).toBeCloseTo(1, 6);
  });

  it('Test 13: age=6000ms → 0.5 (halfway through 8000ms fade)', () => {
    expect(trailOpacity(6000)).toBeCloseTo(0.5, 6);
  });

  it('Test 14: age=10000ms → opacity = 0 (expired boundary)', () => {
    expect(trailOpacity(10_000)).toBe(0);
  });

  it('age > 10000ms → opacity = 0', () => {
    expect(trailOpacity(12_000)).toBe(0);
  });

  it('negative age → opacity = 0', () => {
    expect(trailOpacity(-100)).toBe(0);
  });
});

describe('cullExpiredTrails (D-16, D-18)', () => {
  it('Test 6: trail with startTs = now - 12_000 is dropped', () => {
    const now = 20_000;
    const trails = [mkTrail('a', now - 12_000)];
    const out = cullExpiredTrails(trails, now);
    expect(out.length).toBe(0);
  });

  it('Test 7: 12 trails for one agent within 10s → keep the 10 newest', () => {
    const now = 20_000;
    const trails: ActiveTrail[] = [];
    for (let i = 0; i < 12; i++) {
      // startTs spread across the last 5 seconds so none are expired.
      trails.push(mkTrail('a', now - 5_000 + i * 100));
    }
    const out = cullExpiredTrails(trails, now);
    expect(out.length).toBe(10);
    // Oldest 2 (startTs = now-5000 and now-4900) should be gone.
    const startTimes = new Set(out.map((t) => t.startTs));
    expect(startTimes.has(now - 5000)).toBe(false);
    expect(startTimes.has(now - 4900)).toBe(false);
    expect(startTimes.has(now - 5000 + 11 * 100)).toBe(true);
  });

  it('Test 8: per-agent caps are independent (A:11 → 10, B:8 → 8)', () => {
    const now = 20_000;
    const trails: ActiveTrail[] = [];
    for (let i = 0; i < 11; i++) trails.push(mkTrail('a', now - 5_000 + i * 10));
    for (let i = 0; i < 8; i++) trails.push(mkTrail('b', now - 5_000 + i * 10));
    const out = cullExpiredTrails(trails, now);
    const a = out.filter((t) => t.agentId === 'a');
    const b = out.filter((t) => t.agentId === 'b');
    expect(a.length).toBe(10);
    expect(b.length).toBe(8);
  });

  it('combines age cull with FIFO cap: expired trails dropped first, then cap applied', () => {
    const now = 20_000;
    const trails: ActiveTrail[] = [];
    // 5 expired (> 10s) + 11 fresh for agent "a".
    for (let i = 0; i < 5; i++) trails.push(mkTrail('a', now - 15_000 - i));
    for (let i = 0; i < 11; i++) trails.push(mkTrail('a', now - 1_000 + i));
    const out = cullExpiredTrails(trails, now);
    expect(out.length).toBe(10);
    expect(out.every((t) => now - t.startTs < TRAIL_TOTAL_LIFESPAN_MS)).toBe(true);
  });
});
