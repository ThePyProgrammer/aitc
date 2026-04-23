// Phase 22 Plan 01 (Wave 0 — RED) — aura-filter witness tests.
// Witnesses: W-22-01 (drawNodes receives bridge-free array), W-22-02 (drawFileLabels
// receives same filtered snapshot; pure-file arrays pass identity-through).

import { describe, it, expect } from 'vitest';
import { filterRenderableFileNodes } from '../RadarCanvas';
import type { GraphNode } from '../../../stores/radarStore';

function makeBridge(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: `bridge:${overrides.commandName ?? 'ping'}`,
    dirKey: 'bridge',
    dirDepth: 0,
    kind: 'bridge',
    x: 0,
    y: 0,
    commandName: 'ping',
    handlerFile: 'src-tauri/src/handlers.rs',
    handlerLine: 1,
    hasChannelArg: false,
    callerCount: 1,
    ...overrides,
  };
}

function makeFileNode(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: overrides.id ?? 'src/a.ts',
    dirKey: overrides.dirKey ?? 'src',
    dirDepth: overrides.dirDepth ?? 1,
    kind: 'file',
    x: 0,
    y: 0,
    ...overrides,
  } as GraphNode;
}

describe('filterRenderableFileNodes (Phase 22 Fix 1)', () => {
  it('W-22-01: excludes every kind==="bridge" node from a mixed live array', () => {
    const live = [
      makeFileNode({ id: 'a' }),
      makeBridge({ commandName: 'ping' }),
      makeFileNode({ id: 'b' }),
      makeBridge({ commandName: 'startWatch' }),
    ];
    const filtered = filterRenderableFileNodes(live);
    expect(filtered.every((n) => n.kind !== 'bridge')).toBe(true);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('W-22-02: pure-file array passes through (identity by length, preserves order)', () => {
    const live = [
      makeFileNode({ id: 'a' }),
      makeFileNode({ id: 'b' }),
      makeFileNode({ id: 'c' }),
    ];
    const filtered = filterRenderableFileNodes(live);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('W-22-02: preserves kind===undefined nodes (Phase 12 D-10 backward-compat — undefined === "file")', () => {
    const live: GraphNode[] = [
      { id: 'legacy', dirKey: 'src', dirDepth: 1, x: 0, y: 0 } as GraphNode, // no kind field
      makeBridge({ commandName: 'ping' }),
    ];
    const filtered = filterRenderableFileNodes(live);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('legacy');
  });

  it('W-22-01: returns empty array when input is all bridges', () => {
    const live = [makeBridge({ commandName: 'a' }), makeBridge({ commandName: 'b' })];
    expect(filterRenderableFileNodes(live)).toHaveLength(0);
  });
});
