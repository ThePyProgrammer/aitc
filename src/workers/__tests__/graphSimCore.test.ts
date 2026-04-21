// Phase 11 — graphSimCore unit tests (D-22, D-24).
// Drives the pure core synchronously (schedule = inline fn()) to cover
// D-05 (Float32Array AoS), D-10 (updateConfig alpha-restart), D-12
// (sequence bump on topology), D-15 (settled at alphaMin), D-19 (fast
// settle inside init), D-20/D-21 (pin/unpin fx/fy), D-34 (≤3 buffers).
// References: 11-VALIDATION.md §Per-Task Verification Map; 11-RESEARCH.md §Pattern 7.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeGraphSimCore } from '../graphSimCore';
import type { InitMessage, WorkerOut } from '../graphSimProtocol';
import { seedGraph, DEFAULT_FORCE_CONFIG } from './fixtures/tiny-graph';

// Queue-based scheduler: each test drains the queue manually via core.tick()
// or by popping callbacks. Avoids recursion at settle-scale (inline fn()
// would stack-overflow for long settle chains).
function makeQueueScheduler(): {
  schedule: (fn: () => void) => void;
  queue: Array<() => void>;
} {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => {
      queue.push(fn);
    },
    queue,
  };
}

function initMsg(
  nodeCount = 20,
  dirKey = 'src/foo',
  sequence = 1,
): InitMessage {
  return {
    type: 'init',
    sequence,
    nodes: seedGraph(nodeCount, dirKey),
    edges: [],
    config: DEFAULT_FORCE_CONFIG,
    alpha: 1,
    fastSettle: true,
  };
}

describe('graphSimCore — Phase 11 (D-22, D-24)', () => {
  it('factory returns all 8 methods as functions', () => {
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      { onTick: () => {}, onSettled: () => {}, onError: () => {} },
      { schedule: s.schedule },
    );
    ['init', 'topology', 'updateConfig', 'pin', 'unpin', 'tick', 'returnBuffer', 'dispose']
      .forEach((k) =>
        expect(
          typeof (core as unknown as Record<string, unknown>)[k],
        ).toBe('function'),
      );
    core.dispose();
  });

  it('init with fastSettle=true emits first onTick synchronously (D-19)', () => {
    const ticks: Extract<WorkerOut, { type: 'tick' }>[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => ticks.push({ type: 'tick', ...m }),
        onSettled: () => {},
        onError: () => {
          throw new Error('unexpected');
        },
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(20));
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks[0].positions).toBeInstanceOf(Float32Array);
    expect(ticks[0].positions.length).toBe(20 * 2);
    core.dispose();
  });

  it('positions Float32Array is AoS [x0,y0,x1,y1,...] of length N*2 (D-05)', () => {
    let lastTick: Extract<WorkerOut, { type: 'tick' }> | null = null;
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => {
          lastTick = { type: 'tick', ...m };
        },
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(30));
    expect(lastTick).not.toBeNull();
    expect(lastTick!.positions.length).toBe(30 * 2);
    // Values are finite floats (sim produced real positions).
    for (let i = 0; i < lastTick!.positions.length; i++) {
      expect(Number.isFinite(lastTick!.positions[i])).toBe(true);
    }
    core.dispose();
  });

  it('onSettled fires with alpha <= alphaMin when sim cools (D-15)', () => {
    let settled: Extract<WorkerOut, { type: 'settled' }> | null = null;
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: () => {},
        onSettled: (m) => {
          settled = { type: 'settled', ...m };
        },
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(10));
    // Drain the scheduler queue until settled (each dequeued callback
    // may re-enqueue itself). Safety bound: 10000 iterations.
    let guard = 0;
    while (!settled && s.queue.length > 0 && guard < 10000) {
      const next = s.queue.shift()!;
      next();
      guard++;
    }
    expect(settled).not.toBeNull();
    expect(settled!.alpha).toBeLessThanOrEqual(0.001);
    core.dispose();
  });

  it('updateConfig alpha-restarts to FORCE_CONFIG_ALPHA=0.35 (D-10)', () => {
    const alphas: number[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => alphas.push(m.alpha),
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(10));
    alphas.length = 0;
    core.updateConfig({ ...DEFAULT_FORCE_CONFIG, linkStrength: 0.5 });
    // updateConfig emits a tick immediately so consumers observe the
    // reheated alpha on the spot.
    expect(alphas.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(alphas[0] - 0.35)).toBeLessThan(0.05);
    core.dispose();
  });

  it('pin sets fx/fy; node position stays near pin target (D-20, D-21)', () => {
    const ticks: Extract<WorkerOut, { type: 'tick' }>[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => {
          ticks.push({ type: 'tick', ...m });
          // Return buffers so we don't hit backpressure during long ticks.
          core.returnBuffer(m.positions.buffer);
        },
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    const msg = initMsg(5);
    core.init(msg);
    const targetId = msg.nodes[2].id;
    core.pin(targetId, 123, 456);
    for (let i = 0; i < 50; i++) core.tick();
    const last = ticks[ticks.length - 1];
    const idx = 2; // seedGraph preserves order
    expect(Math.abs(last.positions[idx * 2] - 123)).toBeLessThan(1);
    expect(Math.abs(last.positions[idx * 2 + 1] - 456)).toBeLessThan(1);
    core.dispose();
  });

  it('unpin clears fx/fy so node is free to move (D-20)', () => {
    const ticks: Extract<WorkerOut, { type: 'tick' }>[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => {
          ticks.push({ type: 'tick', ...m });
          core.returnBuffer(m.positions.buffer);
        },
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    const msg = initMsg(5);
    core.init(msg);
    const targetId = msg.nodes[2].id;
    core.pin(targetId, 999, 999);
    for (let i = 0; i < 10; i++) core.tick();
    core.unpin(targetId);
    for (let i = 0; i < 100; i++) core.tick();
    const last = ticks[ticks.length - 1];
    // After unpin, node drifts away from (999, 999) under other forces.
    const dx = last.positions[2 * 2] - 999;
    const dy = last.positions[2 * 2 + 1] - 999;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(1);
    core.dispose();
  });

  it('sequence counter bumps on topology; outbound ticks carry new sequence (D-12)', () => {
    const ticks: Extract<WorkerOut, { type: 'tick' }>[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => ticks.push({ type: 'tick', ...m }),
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(10, 'src/foo', 1));
    ticks.length = 0;
    core.topology({
      type: 'topology',
      sequence: 2,
      nodes: seedGraph(10, 'src/bar'),
      edges: [],
      config: DEFAULT_FORCE_CONFIG,
    });
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks[0].sequence).toBe(2);
    core.dispose();
  });

  it('returnBuffer re-wraps ArrayBuffer so next acquire succeeds (D-06)', () => {
    const ticks: Extract<WorkerOut, { type: 'tick' }>[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => ticks.push({ type: 'tick', ...m }),
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(10));
    // After init, up to 3 buffers may be outstanding. Return them and
    // confirm the core keeps emitting.
    for (const t of ticks) core.returnBuffer(t.positions.buffer);
    ticks.length = 0;
    for (let i = 0; i < 5; i++) core.tick();
    expect(ticks.length).toBeGreaterThan(0);
    core.dispose();
  });

  it('backpressure: without returnBuffer, ≤3 buffers emitted before skips (D-09, D-34)', () => {
    const ticks: Extract<WorkerOut, { type: 'tick' }>[] = [];
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => ticks.push({ type: 'tick', ...m }),
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(10));
    // fastSettle emits one tick at init; the first emitTick has already
    // fired. Without returnBuffer, subsequent acquire() returns null and
    // emits are skipped at steady state.
    const before = ticks.length;
    for (let i = 0; i < 50; i++) core.tick();
    // Pool caps at 3; emitted count can grow at most to 3 across the
    // whole core lifetime (no returns). At steady state, ticks.length
    // plateaus at ≤3.
    expect(ticks.length).toBeLessThanOrEqual(3);
    expect(ticks.length).toBeGreaterThanOrEqual(before);
    core.dispose();
  });

  it('dispose() halts ticking — subsequent tick() is a no-op', () => {
    let count = 0;
    const s = makeQueueScheduler();
    const core = makeGraphSimCore(
      {
        onTick: (m) => {
          count++;
          core.returnBuffer(m.positions.buffer);
        },
        onSettled: () => {},
        onError: () => {},
      },
      { schedule: s.schedule },
    );
    core.init(initMsg(10));
    core.dispose();
    const before = count;
    core.tick();
    core.tick();
    expect(count).toBe(before); // no new ticks after dispose
  });

  it('graphSimCore source has no self / postMessage / onmessage / Worker references (D-22, D-24)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'graphSimCore.ts'), 'utf8');
    expect(src).not.toMatch(/\bself\b/);
    expect(src).not.toMatch(/\bpostMessage\b/);
    expect(src).not.toMatch(/\bonmessage\b/);
    expect(src).not.toMatch(/\bnew Worker\b/);
    // Also: no zustand / react / tauri / bindings imports.
    expect(src).not.toMatch(
      /from '(zustand|react|@tauri-apps[^']*|\.\.\/stores[^']*|\.\.\/bindings[^']*)'/,
    );
  });
});
