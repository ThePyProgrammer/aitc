import { beforeEach, describe, expect, it } from 'vitest';
import type { Category, Resource, ResourceEventBatch, Scope } from '../../bindings';
import {
  selectByCategoryScope,
  selectByScope,
  selectCombined,
  useClaudeResourcesStore,
} from '../../stores/claudeResourcesStore';

function makeResource(opts: {
  scope: Scope;
  category: Category;
  name: string;
  id?: string;
  path?: string;
}): Resource {
  const id = opts.id ?? `${opts.scope}::${opts.category}::${opts.name}`;
  return {
    id,
    scope: opts.scope,
    category: opts.category,
    name: opts.name,
    description: null,
    path: opts.path ?? `/fake/${id}`,
    metadata: { kind: 'skill', tools: null, allowedTools: null } as Resource['metadata'],
  };
}

function makeBatch(events: ResourceEventBatch['events'], droppedBatches = 0): ResourceEventBatch {
  return { events, batchId: 0, droppedBatches };
}

describe('claudeResourcesStore', () => {
  beforeEach(() => {
    useClaudeResourcesStore.setState({
      resourcesById: {},
      loaded: false,
      droppedBatches: 0,
      externalEdits: {},
    });
  });

  it('seed populates store with resources keyed by id and sets loaded=true', () => {
    const r1 = makeResource({ scope: 'global', category: 'skill', name: 'one' });
    const r2 = makeResource({ scope: 'project', category: 'agent', name: 'two' });
    useClaudeResourcesStore.getState().seed([r1, r2]);
    const s = useClaudeResourcesStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.resourcesById[r1.id]).toEqual(r1);
    expect(s.resourcesById[r2.id]).toEqual(r2);
  });

  it('applyBatch added inserts a new resource', () => {
    const r3 = makeResource({ scope: 'global', category: 'plugin', name: 'plug' });
    useClaudeResourcesStore.getState().applyBatch(makeBatch([{ kind: 'added', resource: r3 }]));
    expect(useClaudeResourcesStore.getState().resourcesById[r3.id]).toEqual(r3);
  });

  it('applyBatch removed deletes a resource by id', () => {
    const r = makeResource({ scope: 'global', category: 'skill', name: 'gone' });
    useClaudeResourcesStore.setState({ resourcesById: { [r.id]: r } });
    useClaudeResourcesStore.getState().applyBatch(makeBatch([{ kind: 'removed', id: r.id }]));
    expect(useClaudeResourcesStore.getState().resourcesById[r.id]).toBeUndefined();
  });

  it('applyBatch changed replaces the existing Resource by id', () => {
    const original = makeResource({ scope: 'global', category: 'skill', name: 'same' });
    const updated: Resource = { ...original, description: 'updated' };
    useClaudeResourcesStore.setState({ resourcesById: { [original.id]: original } });
    useClaudeResourcesStore
      .getState()
      .applyBatch(makeBatch([{ kind: 'changed', resource: updated }]));
    expect(useClaudeResourcesStore.getState().resourcesById[original.id]?.description).toBe(
      'updated',
    );
  });

  it('applyBatch externalEdit stamps timestamp in externalEdits map', () => {
    useClaudeResourcesStore
      .getState()
      .applyBatch(
        makeBatch([{ kind: 'externalEdit', path: '/cwd/CLAUDE.md', mtimeMs: 123456 }]),
      );
    expect(useClaudeResourcesStore.getState().externalEdits['/cwd/CLAUDE.md']).toBe(123456);
  });

  it('selectByCategoryScope filters by both category and scope', () => {
    const a = makeResource({ scope: 'global', category: 'skill', name: 'a' });
    const b = makeResource({ scope: 'project', category: 'skill', name: 'b' });
    const c = makeResource({ scope: 'global', category: 'agent', name: 'c' });
    useClaudeResourcesStore.setState({
      resourcesById: { [a.id]: a, [b.id]: b, [c.id]: c },
    });
    const result = selectByCategoryScope('skill', 'global')(useClaudeResourcesStore.getState());
    expect(result).toEqual([a]);
  });

  it('selectCombined suppresses shadowed globals when a project resource has the same name', () => {
    const globalFoo = makeResource({ scope: 'global', category: 'skill', name: 'foo' });
    const projectFoo = makeResource({ scope: 'project', category: 'skill', name: 'foo' });
    const globalBar = makeResource({ scope: 'global', category: 'skill', name: 'bar' });
    useClaudeResourcesStore.setState({
      resourcesById: {
        [globalFoo.id]: globalFoo,
        [projectFoo.id]: projectFoo,
        [globalBar.id]: globalBar,
      },
    });
    const combined = selectCombined('skill')(useClaudeResourcesStore.getState());
    expect(combined.length).toBe(2);
    expect(combined.find((r) => r.id === projectFoo.id)).toBeTruthy();
    expect(combined.find((r) => r.id === globalBar.id)).toBeTruthy();
    expect(combined.find((r) => r.id === globalFoo.id)).toBeUndefined();
  });

  it('droppedBatches accumulates', () => {
    useClaudeResourcesStore.getState().applyBatch(makeBatch([], 2));
    useClaudeResourcesStore.getState().applyBatch(makeBatch([], 3));
    expect(useClaudeResourcesStore.getState().droppedBatches).toBe(5);
  });

  it('reset clears everything', () => {
    const r = makeResource({ scope: 'global', category: 'skill', name: 'x' });
    useClaudeResourcesStore.setState({
      resourcesById: { [r.id]: r },
      loaded: true,
      droppedBatches: 7,
      externalEdits: { '/a': 1 },
    });
    useClaudeResourcesStore.getState().reset();
    const s = useClaudeResourcesStore.getState();
    expect(s.resourcesById).toEqual({});
    expect(s.loaded).toBe(false);
    expect(s.droppedBatches).toBe(0);
    expect(s.externalEdits).toEqual({});
  });

  it('selectByScope returns resources matching the scope regardless of category', () => {
    const a = makeResource({ scope: 'global', category: 'skill', name: 'a' });
    const b = makeResource({ scope: 'project', category: 'agent', name: 'b' });
    const c = makeResource({ scope: 'project', category: 'plugin', name: 'c' });
    useClaudeResourcesStore.setState({
      resourcesById: { [a.id]: a, [b.id]: b, [c.id]: c },
    });
    const result = selectByScope('project')(useClaudeResourcesStore.getState());
    expect(result.map((r) => r.id).sort()).toEqual([b.id, c.id].sort());
  });
});
