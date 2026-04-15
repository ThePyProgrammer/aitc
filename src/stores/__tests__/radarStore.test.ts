import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  useRadarStore,
  getAgentColor,
  AGENT_DOT_PALETTE,
  installRadarPipelineBridge,
} from '../radarStore';
import { usePipelineStore } from '../pipelineStore';
import { buildFileTree, computeTreemapLayout } from '../../hooks/useTreemapLayout';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

// Plan 03 moved the store away from `treeData: TreeIndexEntry[]` to
// `graphNodes` + `graphEdges`. We still exercise `buildFileTree` /
// `computeTreemapLayout` (they are used by RadarMinimap per Phase 6 until
// Plan 06 lands the graph minimap), so keep the tree-shape fixtures.
interface TreeFixtureEntry {
  path: string;
  size: number;
  isDir: boolean;
  depth: number;
}
const sampleTree: TreeFixtureEntry[] = [
  { path: 'src', size: 0, isDir: true, depth: 1 },
  { path: 'src/main.ts', size: 100, isDir: false, depth: 2 },
  { path: 'src/app.ts', size: 200, isDir: false, depth: 2 },
  { path: 'lib', size: 0, isDir: true, depth: 1 },
  { path: 'lib/utils.ts', size: 50, isDir: false, depth: 2 },
];

describe('radarStore', () => {
  beforeEach(() => {
    useRadarStore.getState().reset();
    vi.clearAllMocks();
  });

  it('fetchGraph invokes get_tree_index + get_dependency_graph and populates graphNodes/graphEdges', async () => {
    // Plan 03 Task 1 Test 4: both commands called; file entries become
    // GraphNodes (dirs filtered); edges mapped to {source,target,kind}.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_tree_index') return Promise.resolve(sampleTree);
      if (cmd === 'get_dependency_graph') {
        return Promise.resolve([
          { from: 'src/main.ts', to: 'src/app.ts', kind: 'import' },
          { from: 'src/app.ts', to: 'lib/utils.ts', kind: 'import' },
        ]);
      }
      return Promise.reject(new Error('unexpected invoke ' + cmd));
    });

    await useRadarStore.getState().fetchGraph();

    expect(mockInvoke).toHaveBeenCalledWith('get_tree_index');
    expect(mockInvoke).toHaveBeenCalledWith('get_dependency_graph');
    const s = useRadarStore.getState();
    expect(s.graphNodes).toHaveLength(3);
    const byId = new Map(s.graphNodes.map((n) => [n.id, n]));
    expect(byId.get('src/main.ts')).toMatchObject({
      id: 'src/main.ts',
      dirKey: 'src',
      dirDepth: 1,
    });
    expect(byId.get('lib/utils.ts')).toMatchObject({
      dirKey: 'lib',
      dirDepth: 1,
    });
    expect(s.graphEdges).toHaveLength(2);
    expect(s.graphEdges[0]).toMatchObject({
      source: 'src/main.ts',
      target: 'src/app.ts',
      kind: 'import',
    });
    // fetchGraph resets settledAt so useGraphLayout re-settles.
    expect(s.settledAt).toBeNull();
  });

  it('fetchGraph filters out directory entries — graph nodes are file-only', async () => {
    // Plan 03 Task 1 Test 5.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_tree_index') return Promise.resolve(sampleTree);
      if (cmd === 'get_dependency_graph') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected invoke ' + cmd));
    });
    await useRadarStore.getState().fetchGraph();
    const nodes = useRadarStore.getState().graphNodes;
    // sampleTree has 2 dirs + 3 files → 3 nodes.
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => !n.id.endsWith('/'))).toBe(true);
    // No node id matches a dir entry.
    expect(nodes.find((n) => n.id === 'src')).toBeUndefined();
    expect(nodes.find((n) => n.id === 'lib')).toBeUndefined();
  });

  it('fetchGraph drops edges referencing unknown nodes', async () => {
    // Edges pointing at files that don't exist in tree_index are
    // silently dropped — Pitfall 8 (path drift) regression guard.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_tree_index') return Promise.resolve(sampleTree);
      if (cmd === 'get_dependency_graph') {
        return Promise.resolve([
          { from: 'src/main.ts', to: 'src/app.ts', kind: 'import' },
          { from: 'src/main.ts', to: 'ghost.ts', kind: 'import' }, // dropped
          { from: 'ghost.ts', to: 'src/app.ts', kind: 'import' }, // dropped
        ]);
      }
      return Promise.reject(new Error('unexpected invoke ' + cmd));
    });
    await useRadarStore.getState().fetchGraph();
    const edges = useRadarStore.getState().graphEdges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'src/main.ts', target: 'src/app.ts' });
  });

  it('fetchGraph is best-effort: invoke rejection leaves slots unchanged', async () => {
    mockInvoke.mockRejectedValue(new Error('nope'));
    await useRadarStore.getState().fetchGraph();
    const s = useRadarStore.getState();
    expect(s.graphNodes).toEqual([]);
    expect(s.graphEdges).toEqual([]);
  });

  it('pinNode sets fx/fy and adds to pinnedNodeIds', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_tree_index') return Promise.resolve(sampleTree);
      if (cmd === 'get_dependency_graph') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected invoke ' + cmd));
    });
    await useRadarStore.getState().fetchGraph();
    useRadarStore.getState().pinNode('src/main.ts', 100, 200);

    const s = useRadarStore.getState();
    const pinned = s.graphNodes.find((n) => n.id === 'src/main.ts');
    expect(pinned?.fx).toBe(100);
    expect(pinned?.fy).toBe(200);
    expect(s.pinnedNodeIds.has('src/main.ts')).toBe(true);
  });

  it('unpinNode clears fx/fy and removes from pinnedNodeIds', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_tree_index') return Promise.resolve(sampleTree);
      if (cmd === 'get_dependency_graph') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected invoke ' + cmd));
    });
    await useRadarStore.getState().fetchGraph();
    useRadarStore.getState().pinNode('src/main.ts', 100, 200);
    useRadarStore.getState().unpinNode('src/main.ts');

    const s = useRadarStore.getState();
    const node = s.graphNodes.find((n) => n.id === 'src/main.ts');
    expect(node?.fx).toBeNull();
    expect(node?.fy).toBeNull();
    expect(s.pinnedNodeIds.has('src/main.ts')).toBe(false);
  });

  it('commitSettledPositions writes x/y back to graphNodes and sets settledAt', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_tree_index') return Promise.resolve(sampleTree);
      if (cmd === 'get_dependency_graph') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected invoke ' + cmd));
    });
    await useRadarStore.getState().fetchGraph();
    expect(useRadarStore.getState().settledAt).toBeNull();

    const positions = new Map([
      ['src/main.ts', { x: 50, y: 60 }],
      ['lib/utils.ts', { x: -10, y: 0 }],
    ]);
    const t0 = Date.now();
    useRadarStore.getState().commitSettledPositions(positions);
    const s = useRadarStore.getState();
    const main = s.graphNodes.find((n) => n.id === 'src/main.ts');
    const utils = s.graphNodes.find((n) => n.id === 'lib/utils.ts');
    expect(main?.x).toBe(50);
    expect(main?.y).toBe(60);
    expect(utils?.x).toBe(-10);
    expect(utils?.y).toBe(0);
    expect(s.settledAt).not.toBeNull();
    expect(s.settledAt ?? 0).toBeGreaterThanOrEqual(t0);
  });

  it('reset clears graph slots and nulls settledAt', () => {
    useRadarStore.setState({
      graphNodes: [{ id: 'x', dirKey: '', dirDepth: 0 }],
      graphEdges: [{ source: 'x', target: 'y', kind: 'import' }],
      settledAt: 123,
      pinnedNodeIds: new Set(['x']),
      activeTrails: [
        { id: 'a|x|y|1', agentId: 'a', fromPath: 'x', toPath: 'y', startTs: 1 },
      ],
    });
    useRadarStore.getState().reset();
    const s = useRadarStore.getState();
    expect(s.graphNodes).toEqual([]);
    expect(s.graphEdges).toEqual([]);
    expect(s.settledAt).toBeNull();
    expect(s.pinnedNodeIds.size).toBe(0);
    expect(s.activeTrails).toEqual([]);
  });

  it('setViewport updates zoom, panX, panY', () => {
    useRadarStore.getState().setViewport({ zoom: 3, panX: 100, panY: 200 });

    const vp = useRadarStore.getState().viewport;
    expect(vp.zoom).toBe(3);
    expect(vp.panX).toBe(100);
    expect(vp.panY).toBe(200);
  });

  it('setViewport merges partial viewport', () => {
    useRadarStore.getState().setViewport({ zoom: 5 });

    const vp = useRadarStore.getState().viewport;
    expect(vp.zoom).toBe(5);
    expect(vp.panX).toBe(0); // default
    expect(vp.panY).toBe(0); // default
  });

  it('selectAgent sets selectedAgentId', () => {
    useRadarStore.getState().selectAgent('agent-001');
    expect(useRadarStore.getState().selectedAgentId).toBe('agent-001');

    useRadarStore.getState().selectAgent(null);
    expect(useRadarStore.getState().selectedAgentId).toBeNull();
  });

  it('getAgentColor returns consistent color from 8-color palette based on hash of agent ID', () => {
    const color1 = getAgentColor('agent-001');
    const color2 = getAgentColor('agent-001');
    expect(color1).toBe(color2); // consistent

    expect(AGENT_DOT_PALETTE).toContain(color1); // from palette

    // Different IDs should (likely) produce different colors
    const color3 = getAgentColor('agent-002');
    expect(AGENT_DOT_PALETTE).toContain(color3);
  });
});

describe('buildFileTree', () => {
  it('converts flat tree entries into nested tree structure with cumulative sizes', () => {
    const tree = buildFileTree(sampleTree);

    expect(tree.name).toBe('root');
    expect(tree.isDir).toBe(true);
    expect(tree.children.length).toBeGreaterThan(0);

    // Find src dir
    const srcDir = tree.children.find((c) => c.name === 'src');
    expect(srcDir).toBeDefined();
    expect(srcDir!.isDir).toBe(true);
    expect(srcDir!.children).toHaveLength(2);
    // Cumulative size = 100 + 200
    expect(srcDir!.size).toBe(300);

    // Find lib dir
    const libDir = tree.children.find((c) => c.name === 'lib');
    expect(libDir).toBeDefined();
    expect(libDir!.size).toBe(50);
  });

  it('handles empty input', () => {
    const tree = buildFileTree([]);
    expect(tree.name).toBe('root');
    expect(tree.children).toHaveLength(0);
    expect(tree.size).toBe(0);
  });

  it('handles single file', () => {
    const tree = buildFileTree([
      { path: 'readme.md', size: 42, isDir: false, depth: 1 },
    ]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe('readme.md');
    expect(tree.children[0].size).toBe(42);
    expect(tree.size).toBe(42);
  });

  it('collapses single-child directory chains starting at root', () => {
    // Regression guard: when every file lives under the same chain of
    // wrapper directories (absolute path prefix, or a nearly-empty monorepo
    // subtree), buildFileTree must flatten the chain so the treemap doesn't
    // waste canvas real estate on empty boxes.
    const tree = buildFileTree([
      { path: 'packages/only-app/src/main.ts', size: 100, isDir: false, depth: 3 },
      { path: 'packages/only-app/src/app.ts', size: 200, isDir: false, depth: 3 },
    ]);
    // Expected collapse: root -> packages -> only-app -> src becomes root=src
    expect(tree.name).toBe('src');
    expect(tree.isDir).toBe(true);
    expect(tree.size).toBe(300);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.map((c) => c.name).sort()).toEqual(['app.ts', 'main.ts']);
  });

  it('stops collapsing at the first branching directory', () => {
    const tree = buildFileTree([
      { path: 'repo/src/main.ts', size: 100, isDir: false, depth: 2 },
      { path: 'repo/lib/utils.ts', size: 50, isDir: false, depth: 2 },
    ]);
    // root -> repo has 2 children (src, lib) — collapse stops at `repo`.
    expect(tree.name).toBe('repo');
    expect(tree.children.map((c) => c.name).sort()).toEqual(['lib', 'src']);
  });

  it('does not collapse past a file leaf', () => {
    // Guard against infinite-loop edge case: single child that is a file.
    const tree = buildFileTree([
      { path: 'readme.md', size: 42, isDir: false, depth: 1 },
    ]);
    expect(tree.name).toBe('root');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].isDir).toBe(false);
  });
});

describe('installRadarPipelineBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePipelineStore.setState({ events: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls fetchGraph after debounce window when events change', () => {
    const spy = vi.spyOn(useRadarStore.getState(), 'fetchGraph').mockResolvedValue(undefined);
    const unsub = installRadarPipelineBridge();
    usePipelineStore.setState({ events: [{ path: 'a.rs' } as any] });
    expect(spy).not.toHaveBeenCalled(); // debounced
    vi.advanceTimersByTime(600);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('debounces rapid event updates into one fetch', () => {
    const spy = vi.spyOn(useRadarStore.getState(), 'fetchGraph').mockResolvedValue(undefined);
    const unsub = installRadarPipelineBridge();
    for (let i = 0; i < 5; i++) {
      usePipelineStore.setState({ events: [{ path: `${i}.rs` } as any] });
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(600);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('unsubscribe stops further fetches', () => {
    const spy = vi.spyOn(useRadarStore.getState(), 'fetchGraph').mockResolvedValue(undefined);
    const unsub = installRadarPipelineBridge();
    unsub();
    usePipelineStore.setState({ events: [{ path: 'x.rs' } as any] });
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('computeTreemapLayout', () => {
  it('produces rectangles with x0,y0,x1,y1 from flat file list', () => {
    const tree = buildFileTree(sampleTree);
    const rects = computeTreemapLayout(tree, 800, 600);

    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r).toHaveProperty('x0');
      expect(r).toHaveProperty('y0');
      expect(r).toHaveProperty('x1');
      expect(r).toHaveProperty('y1');
      expect(r).toHaveProperty('path');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('depth');
      expect(r).toHaveProperty('isFile');
      expect(r.x1).toBeGreaterThanOrEqual(r.x0);
      expect(r.y1).toBeGreaterThanOrEqual(r.y0);
    }
  });

  it('handles empty input', () => {
    const tree = buildFileTree([]);
    const rects = computeTreemapLayout(tree, 800, 600);
    expect(rects).toHaveLength(0);
  });

  it('handles single file', () => {
    const tree = buildFileTree([
      { path: 'readme.md', size: 42, isDir: false, depth: 1 },
    ]);
    const rects = computeTreemapLayout(tree, 800, 600);
    expect(rects.length).toBeGreaterThanOrEqual(1);
    const fileRect = rects.find((r) => r.name === 'readme.md');
    expect(fileRect).toBeDefined();
    expect(fileRect!.isFile).toBe(true);
  });
});
