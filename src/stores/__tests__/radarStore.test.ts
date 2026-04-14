import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useRadarStore, getAgentColor, AGENT_DOT_PALETTE, installRadarPipelineBridge } from '../radarStore';
import type { TreeIndexEntry } from '../radarStore';
import { usePipelineStore } from '../pipelineStore';
import { buildFileTree, computeTreemapLayout } from '../../hooks/useTreemapLayout';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const sampleTree: TreeIndexEntry[] = [
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

  it('fetchTreeIndex calls invoke get_tree_index and sets treeData', async () => {
    mockInvoke.mockResolvedValueOnce(sampleTree);

    await useRadarStore.getState().fetchTreeIndex();

    expect(mockInvoke).toHaveBeenCalledWith('get_tree_index');
    expect(useRadarStore.getState().treeData).toEqual(sampleTree);
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
  it('converts flat TreeIndexEntry[] into nested tree structure with cumulative sizes', () => {
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

  it('calls fetchTreeIndex after debounce window when events change', () => {
    const spy = vi.spyOn(useRadarStore.getState(), 'fetchTreeIndex').mockResolvedValue(undefined);
    const unsub = installRadarPipelineBridge();
    usePipelineStore.setState({ events: [{ path: 'a.rs' } as any] });
    expect(spy).not.toHaveBeenCalled(); // debounced
    vi.advanceTimersByTime(600);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('debounces rapid event updates into one fetch', () => {
    const spy = vi.spyOn(useRadarStore.getState(), 'fetchTreeIndex').mockResolvedValue(undefined);
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
    const spy = vi.spyOn(useRadarStore.getState(), 'fetchTreeIndex').mockResolvedValue(undefined);
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
