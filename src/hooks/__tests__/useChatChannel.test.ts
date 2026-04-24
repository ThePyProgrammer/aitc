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

  // Phase 19.6 — guards the StrictMode double-mount race that caused
  // streaming-delta duplication. If subscribe() is invoked twice
  // concurrently (mount → unmount-no-op → remount, all before the first
  // subscribeToChat() resolves), the in-flight promise must be shared so
  // only ONE underlying fan-out is registered.
  it('concurrent subscribe() calls share one underlying subscribeToChat()', async () => {
    const unlistenSpy = vi.fn();
    let resolveSub: ((un: () => void) => void) | null = null;
    const subscribeSpy = vi.fn().mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveSub = resolve;
        }),
    );
    useChatStore.setState({ subscribeToChat: subscribeSpy });

    const { result } = renderHook(() => useChatChannel());
    // Two concurrent calls — neither resolves until we call resolveSub.
    const p1 = result.current.subscribe();
    const p2 = result.current.subscribe();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    resolveSub!(unlistenSpy);
    await Promise.all([p1, p2]);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    await result.current.unsubscribe();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe awaits an in-flight subscribe before tearing down', async () => {
    const unlistenSpy = vi.fn();
    let resolveSub: ((un: () => void) => void) | null = null;
    const subscribeSpy = vi.fn().mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveSub = resolve;
        }),
    );
    useChatStore.setState({ subscribeToChat: subscribeSpy });

    const { result } = renderHook(() => useChatChannel());
    // Start subscribe but don't resolve yet.
    const subPromise = result.current.subscribe();
    // Unsubscribe while subscribe is in-flight — must NOT no-op.
    const unsubPromise = result.current.unsubscribe();
    // Now resolve the in-flight subscribe.
    resolveSub!(unlistenSpy);
    await Promise.all([subPromise, unsubPromise]);
    // The unlisten registered by the awaited subscribe must have been
    // called — otherwise the listeners leak (the original bug).
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });
});
