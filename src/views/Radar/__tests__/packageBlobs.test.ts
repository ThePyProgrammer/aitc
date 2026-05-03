import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { GraphNode } from '../../../stores/radarStore';
import {
  _resetPackageBlobCacheForTest,
  blobDiameterPx,
  derivePackageBlobs,
  selectPackageBlobs,
  selectWorkspaceBlobs,
} from '../packageBlobs';
import { drawPackageBlobs, findPackageBlobAtWorld } from '../PackageBlobRenderer';

function createMockCtx() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const assignments: Record<string, unknown[]> = {
    fillStyle: [],
    strokeStyle: [],
    shadowColor: [],
    shadowBlur: [],
    lineWidth: [],
    font: [],
    textAlign: [],
    textBaseline: [],
    globalAlpha: [],
  };
  const record = (fn: string) => vi.fn((...args: unknown[]) => calls.push({ fn, args }));
  const ctx = {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    _calls: calls,
    _assignments: assignments,
  } as unknown as CanvasRenderingContext2D & {
    _calls: Array<{ fn: string; args: unknown[] }>;
    _assignments: Record<string, unknown[]>;
  };
  for (const prop of Object.keys(assignments)) {
    let cur: unknown;
    Object.defineProperty(ctx, prop, {
      get: () => cur,
      set: (v: unknown) => {
        cur = v;
        assignments[prop].push(v);
      },
    });
  }
  return ctx;
}

const nodes: GraphNode[] = [
  { id: 'src/a.ts', dirKey: 'src', dirDepth: 1, x: 0, y: 0 },
  { id: 'src/nested/b.ts', dirKey: 'src/nested', dirDepth: 2, x: 20, y: 0 },
  { id: 'tests/a.test.ts', dirKey: 'tests', dirDepth: 1, x: 100, y: 0 },
  { id: 'bridge:ping', kind: 'bridge', dirKey: 'src', dirDepth: 1, x: 999, y: 999 },
];

describe('package blob derivation', () => {
  beforeEach(() => _resetPackageBlobCacheForTest());

  it('excludes bridge nodes and selects top-level workspace blobs', () => {
    const blobs = derivePackageBlobs({ nodes });
    const workspace = selectWorkspaceBlobs(blobs);
    const src = workspace.find((b) => b.dirKey === 'src')!;

    expect(src.fileCount).toBe(2);
    expect(src.memberFileIds).toEqual(['src/a.ts', 'src/nested/b.ts']);
    expect(src.centroid.x).toBe(10);
    expect(workspace.map((b) => b.dirKey)).toEqual(['src', 'tests']);
  });

  it('derives visible package blobs from subpackage dirKeys', () => {
    const blobs = selectPackageBlobs(derivePackageBlobs({ nodes }));
    expect(blobs.map((b) => b.dirKey).sort()).toEqual(['src', 'src/nested', 'tests']);
  });

  it('uses square-root file-count scaling with workspace/package clamps', () => {
    expect(blobDiameterPx(1, 'workspace')).toBe(24);
    expect(blobDiameterPx(4, 'workspace')).toBe(24);
    expect(blobDiameterPx(400, 'workspace')).toBe(96);
    expect(blobDiameterPx(1, 'package')).toBe(20);
    expect(blobDiameterPx(400, 'package')).toBe(72);
  });

  it('aggregates heat, conflicts, active agents, and importance', () => {
    const blobs = selectWorkspaceBlobs(derivePackageBlobs({
      nodes,
      contentionScores: new Map([['src/a.ts', 0.5], ['src/nested/b.ts', 0.9]]),
      activeConflictPaths: ['src/a.ts'],
      activeAgentFiles: ['src/nested/b.ts'],
    }));
    const src = blobs.find((b) => b.dirKey === 'src')!;

    expect(src.contentionScore).toBe(0.9);
    expect(src.conflictCount).toBe(1);
    expect(src.activeAgentCount).toBe(1);
    expect(src.importance).toBeCloseTo(2 + (1 * 50) + (1 * 25) + (0.9 * 20));
  });

  it('returns cached derivation for identical inputs', () => {
    const first = derivePackageBlobs({ nodes });
    const second = derivePackageBlobs({ nodes });
    expect(second).toBe(first);
  });
});

describe('PackageBlobRenderer', () => {
  it('renders conflict badges and conflict red overrides heat/activity styling', () => {
    const [blob] = selectWorkspaceBlobs(derivePackageBlobs({
      nodes,
      contentionScores: new Map([['src/a.ts', 1]]),
      activeConflictPaths: ['src/a.ts'],
      activeAgentFiles: ['src/a.ts'],
    }));
    const ctx = createMockCtx();
    drawPackageBlobs(ctx, [blob], {
      zoom: 1,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      canvasWidth: 800,
      canvasHeight: 600,
    });

    expect(ctx._assignments.strokeStyle).toContain('#ff7351');
    expect(ctx._assignments.fillStyle).toContain('#ff7351');
    expect(ctx._calls.filter((c) => c.fn === 'fillText').some((c) => c.args[0] === '1')).toBe(true);
  });

  it('uses a 44px minimum hit diameter divided by zoom', () => {
    const blob = {
      id: 'workspace:tiny',
      dirKey: 'tiny',
      depth: 1,
      fileCount: 1,
      centroid: { x: 0, y: 0 },
      diameterPx: 10,
      contentionScore: 0,
      conflictCount: 0,
      activeAgentCount: 0,
      label: 'TINY',
      importance: 1,
      memberFileIds: ['tiny.ts'],
    };

    expect(findPackageBlobAtWorld([blob], 21, 0, 1)).toBe(blob);
    expect(findPackageBlobAtWorld([blob], 23, 0, 1)).toBeNull();
    expect(findPackageBlobAtWorld([blob], 10.5, 0, 2)).toBe(blob);
  });
});
