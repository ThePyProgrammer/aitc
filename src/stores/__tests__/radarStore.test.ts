import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  useRadarStore,
  getAgentColor,
  AGENT_DOT_PALETTE,
  installRadarPipelineBridge,
} from '../radarStore';
import { usePipelineStore } from '../pipelineStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

// Phase 7 Plan 04 removed the `useTreemapLayout` tree-shape tests — the
// treemap hook and `squarify` dependency are gone (D-04). The graph store
// exercises live below; Plan 06 will reintroduce graph-specific minimap
// tests against the new renderer.
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

// Phase 7 Plan 04: buildFileTree / computeTreemapLayout suites removed with
// the `useTreemapLayout` deletion (D-04). Graph-based layout is tested in
// `src/hooks/__tests__/useGraphLayout.test.ts` and the force+layout
// property tests landed in Plan 03.

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

// Phase 7 Plan 04: `computeTreemapLayout` tests removed — the function is
// gone along with `useTreemapLayout`. Reference `sampleTree` retained for
// the `fetchGraph` fixtures above.
void sampleTree;
