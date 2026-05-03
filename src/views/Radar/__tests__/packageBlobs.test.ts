// Path2D polyfill for jsdom (Canvas 2D constructors not available in test env).
// MUST be at the top, BEFORE any import that transitively loads packageBlobs.ts.
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: new (d?: string) => unknown }).Path2D =
    class Path2D {
      constructor(_d?: string) {}
    } as unknown as new (d?: string) => unknown;
}

import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphNode } from '../../../stores/radarStore';
import {
  derivePackageBlobs,
  selectWorkspaceBlobs,
  selectPackageBlobs,
  blobDiameterPx,
  _resetPackageBlobCacheForTest,
} from '../packageBlobs';

const fixtureNodes: GraphNode[] = [
  { id: 'src/App.tsx', dirKey: 'src', dirDepth: 1, x: 0, y: 0, kind: 'file' },
  { id: 'src/views/Radar/RadarCanvas.tsx', dirKey: 'src/views/Radar', dirDepth: 3, x: 100, y: 0, kind: 'file' },
  { id: 'src/stores/radarStore.ts', dirKey: 'src/stores', dirDepth: 2, x: 0, y: 100, kind: 'file' },
  { id: 'src-tauri/src/lib.rs', dirKey: 'src-tauri/src', dirDepth: 2, x: -100, y: 0, kind: 'file' },
  { id: 'bridge:get_tree_index', dirKey: 'bridge', dirDepth: 0, x: 999, y: 999, kind: 'bridge' },
];

const parentChildMap = new Map<string, Set<string>>([
  ['', new Set(['src', 'src-tauri'])],
  ['src', new Set(['src/views', 'src/stores'])],
  ['src/views', new Set(['src/views/Radar'])],
  ['src/views/Radar', new Set()],
  ['src/stores', new Set()],
  ['src-tauri', new Set(['src-tauri/src'])],
  ['src-tauri/src', new Set()],
]);

const contentionScores = new Map<string, number>([
  ['src/App.tsx', 0.2],
  ['src/views/Radar/RadarCanvas.tsx', 0.9],
  ['src/stores/radarStore.ts', 0.6],
]);

const conflictPaths = new Set<string>([
  'src/views/Radar/RadarCanvas.tsx',
  'src/stores/radarStore.ts',
]);

const activeAgentFiles = new Map<string, string>([
  ['agent-a', 'src/views/Radar/RadarCanvas.tsx'],
  ['agent-b', 'src/stores/radarStore.ts'],
  ['agent-c', 'src/stores/radarStore.ts'],
]);

function deriveFixtureBlobs() {
  return derivePackageBlobs({
    nodes: fixtureNodes,
    parentChildMap,
    contentionScores,
    conflictPaths,
    activeAgentFiles,
    settledAt: 1234,
  });
}

describe('package blob aggregation — Phase 13 Wave 0', () => {
  beforeEach(() => {
    _resetPackageBlobCacheForTest();
  });

  it('returns top-level package blobs only for workspace mode (D-05)', () => {
    const blobs = selectWorkspaceBlobs(deriveFixtureBlobs());
    expect(blobs.map((b) => b.packagePath).sort()).toEqual(['src', 'src-tauri']);
    expect(blobs.every((b) => b.depth === 1)).toBe(true);
  });

  it('returns sub-package blobs plus file-dot membership for package mode (D-07)', () => {
    const blobs = selectPackageBlobs(deriveFixtureBlobs(), 'src');
    expect(blobs.map((b) => b.packagePath).sort()).toEqual(['src/stores', 'src/views/Radar']);
    expect(blobs.find((b) => b.packagePath === 'src/views/Radar')?.fileIds).toContain(
      'src/views/Radar/RadarCanvas.tsx',
    );
  });

  it('uses sqrt file-count scaling with workspace and package clamps (D-08)', () => {
    expect(blobDiameterPx(1, 'workspace')).toBe(24); // clamp(24, sqrt(1) * 8, 96)
    expect(blobDiameterPx(144, 'workspace')).toBe(96); // clamp upper bound
    expect(blobDiameterPx(1, 'package')).toBe(20); // clamp(20, sqrt(1) * 8, 72)
    expect(blobDiameterPx(100, 'package')).toBe(72); // clamp upper bound
    expect(blobDiameterPx(9, 'package')).toBe(24); // sqrt(9) * 8
  });

  it('aggregates contentionScore, conflictCount, and activeAgentCount upward (D-06/D-15/D-16)', () => {
    const src = selectWorkspaceBlobs(deriveFixtureBlobs()).find((b) => b.packagePath === 'src');
    expect(src).toBeDefined();
    expect(src!.contentionScore).toBe(0.9);
    expect(src!.conflictCount).toBe(2);
    expect(src!.activeAgentCount).toBe(3);
  });

  it("excludes nodes where kind === 'bridge' from fileCount and package centroid", () => {
    const blobs = deriveFixtureBlobs();
    expect(blobs.some((b) => b.fileIds.includes('bridge:get_tree_index'))).toBe(false);
    const bridgeInfluenced = blobs.some((b) => b.cx > 500 || b.cy > 500);
    expect(bridgeInfluenced, "kind === 'bridge' must not affect centroid math").toBe(false);
    const totalFileCount = selectWorkspaceBlobs(blobs).reduce((sum, b) => sum + b.fileCount, 0);
    expect(totalFileCount).toBe(4);
  });

  it('reuses cached derivation for identical inputs until reset', () => {
    const first = deriveFixtureBlobs();
    const second = deriveFixtureBlobs();
    expect(second).toBe(first);

    _resetPackageBlobCacheForTest();
    expect(deriveFixtureBlobs()).not.toBe(first);
  });
});
