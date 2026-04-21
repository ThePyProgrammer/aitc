// Phase 11 — graphSimCore unit tests (D-22, D-24).
// Wave 0 stub with it.todo markers. Wave 1 fleshes out assertions.
// References: 11-VALIDATION.md §Per-Task Verification Map; 11-RESEARCH.md §Pattern 7.

import { describe, it, expect } from 'vitest';
import { makeGraphSimCore } from '../graphSimCore';
import { tinyGraph } from './fixtures/tiny-graph';

describe('graphSimCore — Phase 11 (D-22, D-24)', () => {
  it('exports a factory that returns a GraphSimCore stub with 8 methods', () => {
    const core = makeGraphSimCore({
      onTick: () => {},
      onSettled: () => {},
      onError: () => {},
    });
    expect(typeof core.init).toBe('function');
    expect(typeof core.topology).toBe('function');
    expect(typeof core.updateConfig).toBe('function');
    expect(typeof core.pin).toBe('function');
    expect(typeof core.unpin).toBe('function');
    expect(typeof core.tick).toBe('function');
    expect(typeof core.returnBuffer).toBe('function');
    expect(typeof core.dispose).toBe('function');
    // Confirm fixture loads.
    expect(tinyGraph.nodes.length).toBe(20);
  });

  // Wave 1 replaces these with real assertions.
  it.todo('init builds sim and fast-settles synchronously before first onTick (D-19)');
  it.todo('tick() emits Float32Array via onTick callback (D-05)');
  it.todo('onSettled fires once alpha <= alphaMin (D-15)');
  it.todo('updateConfig alpha-restarts to FORCE_CONFIG_ALPHA=0.35 (D-10)');
  it.todo('pin sets fx/fy on named node within 0.5px (D-20, D-21)');
  it.todo('unpin clears fx/fy on named node (D-20)');
  it.todo('returnBuffer re-enters the pool (D-06)');
  it.todo('sequence counter bumps on topology (D-12)');
  it.todo('detached-buffer: after onTick transfers, byteLength===0 until returnBuffer (Pitfall T-4)');
  it.todo('backpressure: with 2 outstanding, worker uses spare then skips transfer (D-09, D-34)');
  it.todo('graphSimCore source has no self/postMessage/Worker references (D-22)');
  it.todo('fastSettle=false path: no synchronous pre-tick loop');
});
