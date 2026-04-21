// Phase 11 — shared test fixtures. Extracted from
// src/hooks/__tests__/useGraphLayout.test.ts:32-52 (Phase 7 Plan 03).
// Deterministic seeded graph (≤50 nodes); keeps each vitest run <100ms.
// Used by graphSimCore.test.ts, bufferPool.test.ts, graphSimBenchmark.test.ts.
// References: 11-PATTERNS.md §fixtures/tiny-graph.ts; 11-RESEARCH.md §Pitfall 1.

import type { InitMessage, ForceConfig } from '../../graphSimProtocol';

export function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedGraph(
  nodeCount: number,
  dirKey = 'src/foo',
): InitMessage['nodes'] {
  const out: InitMessage['nodes'] = [];
  for (let i = 0; i < nodeCount; i++) {
    out.push({
      id: `${dirKey}/n${i}.ts`,
      dirKey,
      dirDepth: dirKey.split('/').length,
    });
  }
  return out;
}

export const DEFAULT_FORCE_CONFIG: ForceConfig = {
  centerStrength: 0.05,
  clusterStrength: 0.08,
  linkStrength: 0.3,
  chargeStrength: -80,
  // Phase 12 (D-29, D-30): boundaryStrength is a required field on ForceConfig.
  // Fixture mirrors the radarStore DEFAULT_FORCE_CONFIG default.
  boundaryStrength: 0.15,
};

export const tinyGraph = {
  nodes: seedGraph(20),
  edges: [] as InitMessage['edges'],
  config: DEFAULT_FORCE_CONFIG,
};
