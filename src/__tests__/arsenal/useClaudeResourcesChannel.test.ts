import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Resource, ResourceEventBatch } from '../../bindings';
import { useClaudeResourcesStore } from '../../stores/claudeResourcesStore';

// vi.mock is hoisted; we reach the fakes via the mocked module after mocking.
vi.mock('@tauri-apps/api/core', () => {
  const channels: unknown[] = [];
  class FakeChannel {
    onmessage: ((batch: ResourceEventBatch) => void) | null = null;
    constructor() {
      channels.push(this);
    }
    trigger(batch: ResourceEventBatch) {
      this.onmessage?.(batch);
    }
  }
  const invoke = vi.fn();
  return {
    Channel: FakeChannel,
    invoke,
    __registeredChannels: channels,
    __invokeMock: invoke,
  };
});

import * as tauriCore from '@tauri-apps/api/core';
import { useClaudeResourcesChannel } from '../../hooks/useClaudeResourcesChannel';

// Pull the fakes out through the mocked module (avoids hoist-order issues).
const registeredChannels = (tauriCore as unknown as {
  __registeredChannels: Array<{
    onmessage: ((batch: ResourceEventBatch) => void) | null;
    trigger: (batch: ResourceEventBatch) => void;
  }>;
}).__registeredChannels;
const invokeMock = (tauriCore as unknown as { __invokeMock: ReturnType<typeof vi.fn> })
  .__invokeMock;
const FakeChannelCtor = tauriCore.Channel as unknown as new () => unknown;

describe('useClaudeResourcesChannel', () => {
  beforeEach(() => {
    registeredChannels.length = 0;
    invokeMock.mockReset();
    useClaudeResourcesStore.setState({
      resourcesById: {},
      loaded: false,
      droppedBatches: 0,
      externalEdits: {},
    });
  });

  it('start invokes startClaudeResourcesWatch with cwd + channel and seeds the store', async () => {
    const seed: Resource[] = [
      {
        id: 'global::skill::seeded',
        scope: 'global',
        category: 'skill',
        name: 'seeded',
        description: null,
        path: '/fake/seeded',
        metadata: { kind: 'skill', tools: null, allowedTools: null } as Resource['metadata'],
      },
    ];
    invokeMock.mockResolvedValueOnce(seed);

    const { result } = renderHook(() => useClaudeResourcesChannel());
    await act(async () => {
      await result.current.start('/tmp/repo');
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0];
    expect(cmd).toBe('startClaudeResourcesWatch');
    expect((args as { cwd: string }).cwd).toBe('/tmp/repo');
    expect((args as { channel: unknown }).channel).toBeInstanceOf(FakeChannelCtor);
    expect(useClaudeResourcesStore.getState().resourcesById[seed[0].id]).toEqual(seed[0]);
    expect(useClaudeResourcesStore.getState().loaded).toBe(true);
  });

  it('channel.onmessage pumps batches into the store via applyBatch', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useClaudeResourcesChannel());
    await act(async () => {
      await result.current.start(null);
    });

    const channel = registeredChannels[0];
    const newResource: Resource = {
      id: 'global::skill::pushed',
      scope: 'global',
      category: 'skill',
      name: 'pushed',
      description: null,
      path: '/fake/pushed',
      metadata: { kind: 'skill', tools: null, allowedTools: null } as Resource['metadata'],
    };
    act(() => {
      channel.trigger({
        batchId: 1,
        droppedBatches: 0,
        events: [{ kind: 'added', resource: newResource }],
      });
    });

    expect(useClaudeResourcesStore.getState().resourcesById[newResource.id]).toEqual(newResource);
  });

  it('stop invokes stopClaudeResourcesWatch and resets the store', async () => {
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useClaudeResourcesChannel());
    await act(async () => {
      await result.current.start(null);
    });

    // Seed some state so we can verify reset cleared it.
    useClaudeResourcesStore.setState({
      resourcesById: { a: { id: 'a' } as Resource },
      loaded: true,
      droppedBatches: 2,
      externalEdits: { '/x': 1 },
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(invokeMock).toHaveBeenLastCalledWith('stopClaudeResourcesWatch');
    const s = useClaudeResourcesStore.getState();
    expect(s.resourcesById).toEqual({});
    expect(s.loaded).toBe(false);
    expect(s.droppedBatches).toBe(0);
    expect(s.externalEdits).toEqual({});
  });
});
