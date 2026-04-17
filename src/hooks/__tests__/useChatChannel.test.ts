import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChatChannel } from '../useChatChannel';
import { useChatStore } from '../../stores/chatStore';

describe('useChatChannel', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('subscribe calls chatStore.subscribeToChat and unsubscribe unlistens', async () => {
    const unlistenSpy = vi.fn();
    const subscribeSpy = vi.fn().mockResolvedValue(unlistenSpy);
    // Replace the store method with a spy.
    useChatStore.setState({ subscribeToChat: subscribeSpy });

    const { result } = renderHook(() => useChatChannel());
    await result.current.subscribe();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    result.current.unsubscribe();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });

  it('subscribe is idempotent (second call is a no-op)', async () => {
    const unlistenSpy = vi.fn();
    const subscribeSpy = vi.fn().mockResolvedValue(unlistenSpy);
    useChatStore.setState({ subscribeToChat: subscribeSpy });

    const { result } = renderHook(() => useChatChannel());
    await result.current.subscribe();
    await result.current.subscribe();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });
});
