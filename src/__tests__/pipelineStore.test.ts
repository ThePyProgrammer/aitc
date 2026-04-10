import { beforeEach, describe, expect, it } from 'vitest';
import type { FileEvent, FileEventBatch, ProcessInfo, Worktree } from '../bindings';
import { MAX_EVENTS, usePipelineStore } from '../stores/pipelineStore';

function makeEvent(path: string): FileEvent {
  return {
    path,
    kind: { kind: 'modify' } as FileEvent['kind'],
    timestampMs: Date.now(),
    attribution: { kind: 'unattributed' } as FileEvent['attribution'],
  };
}

function makeBatch(events: FileEvent[], droppedBatches = 0): FileEventBatch {
  return { events, batchId: 0, droppedBatches };
}

describe('pipelineStore', () => {
  beforeEach(() => {
    // Reset to initial state before each test
    usePipelineStore.setState({
      events: [],
      eventCount: 0,
      processes: [],
      worktrees: [],
      isWatching: false,
      droppedBatches: 0,
    });
  });

  it('initial state has empty collections and false/zero flags', () => {
    const s = usePipelineStore.getState();
    expect(s.events).toEqual([]);
    expect(s.eventCount).toBe(0);
    expect(s.processes).toEqual([]);
    expect(s.worktrees).toEqual([]);
    expect(s.isWatching).toBe(false);
    expect(s.droppedBatches).toBe(0);
  });

  it('ingest prepends events newest first and increments eventCount', () => {
    const batch = makeBatch([
      makeEvent('/a.rs'),
      makeEvent('/b.rs'),
      makeEvent('/c.rs'),
    ]);
    usePipelineStore.getState().ingest(batch);
    const s = usePipelineStore.getState();
    expect(s.events.length).toBe(3);
    expect(s.eventCount).toBe(3);
    // Order: events array order matches batch.events order (first event at index 0).
    expect(s.events[0].path).toBe('/a.rs');
    expect(s.events[2].path).toBe('/c.rs');
  });

  it('ingest trims to MAX_EVENTS ring buffer size', () => {
    const big = Array.from({ length: MAX_EVENTS + 500 }, (_, i) => makeEvent(`/f${i}.rs`));
    usePipelineStore.getState().ingest(makeBatch(big));
    const s = usePipelineStore.getState();
    expect(s.events.length).toBe(MAX_EVENTS);
    expect(s.eventCount).toBe(MAX_EVENTS + 500); // eventCount is cumulative, not capped
    // Most recent events preserved: since batch order places new events at the start,
    // slice(0, MAX_EVENTS) keeps the first MAX_EVENTS of the batch.
    expect(s.events[0].path).toBe('/f0.rs');
  });

  it('ingest accumulates droppedBatches counter', () => {
    usePipelineStore.getState().ingest(makeBatch([], 1));
    usePipelineStore.getState().ingest(makeBatch([], 2));
    expect(usePipelineStore.getState().droppedBatches).toBe(3);
  });

  it('setWorktrees replaces worktrees array', () => {
    const wts: Worktree[] = [
      {
        path: '/home/dev/repo',
        head: 'abc',
        branch: 'main',
        isMain: true,
        isBare: false,
        detached: false,
        locked: false,
      },
    ];
    usePipelineStore.getState().setWorktrees(wts);
    expect(usePipelineStore.getState().worktrees).toEqual(wts);
  });

  it('setProcesses replaces processes array', () => {
    const ps: ProcessInfo[] = [
      { pid: 1234, name: 'claude', cwd: '/home/dev/repo', exe: null, parentPid: 42 } as ProcessInfo,
    ];
    usePipelineStore.getState().setProcesses(ps);
    expect(usePipelineStore.getState().processes).toEqual(ps);
  });

  it('setWatching toggles isWatching', () => {
    usePipelineStore.getState().setWatching(true);
    expect(usePipelineStore.getState().isWatching).toBe(true);
    usePipelineStore.getState().setWatching(false);
    expect(usePipelineStore.getState().isWatching).toBe(false);
  });

  it('reset clears events, eventCount, droppedBatches but preserves worktrees and processes', () => {
    const wts: Worktree[] = [
      { path: '/x', head: null, branch: null, isMain: true, isBare: false, detached: false, locked: false },
    ];
    usePipelineStore.getState().setWorktrees(wts);
    usePipelineStore.getState().ingest(makeBatch([makeEvent('/a.rs')], 5));
    usePipelineStore.getState().reset();
    const s = usePipelineStore.getState();
    expect(s.events).toEqual([]);
    expect(s.eventCount).toBe(0);
    expect(s.droppedBatches).toBe(0);
    expect(s.worktrees).toEqual(wts); // preserved
  });
});
