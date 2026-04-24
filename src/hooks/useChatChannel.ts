// Phase 10: chat subscription lifecycle hook.
//
// Wraps `useChatStore.subscribeToChat()` in the same shape as
// useClaudeResourcesChannel/usePipelineChannel: a pair of
// `{ subscribe, unsubscribe }` callbacks owning the Tauri listen fan-out.
//
// Per RESEARCH.md Pattern 7 note — chat event rates are well under 10/sec
// steady-state, so we favour `listen()`-in-store over a Channel<T> pump.
//
// Race-safety (Phase 19.6 — fixes streaming-delta duplication under
// React.StrictMode):
//
// subscribeToChat() is async and runs ~10 awaited listen() calls
// internally. Under StrictMode, useEffect mount-unmount-mount fires
// before the FIRST subscribe() resolves: cleanup sees unlistenRef.current
// as null (still in flight), so the listeners aren't torn down; the
// second mount then fires subscribe() again, registering a SECOND fan-out
// alongside the first. Every Tauri event then fires both fan-outs and
// the streaming-delta buffer gets every chunk appended twice ("HiHi").
//
// Track the in-flight promise so concurrent subscribe() calls share it,
// and have unsubscribe() await it before tearing down.

import { useCallback, useRef } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';

export function useChatChannel() {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const inFlightRef = useRef<Promise<UnlistenFn> | null>(null);

  const subscribe = useCallback(async () => {
    if (unlistenRef.current !== null) return;
    if (inFlightRef.current !== null) {
      // A concurrent caller is already subscribing — share its promise
      // instead of issuing a parallel subscribeToChat().
      await inFlightRef.current;
      return;
    }
    const promise = useChatStore.getState().subscribeToChat();
    inFlightRef.current = promise;
    try {
      unlistenRef.current = await promise;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    // If subscribe is mid-flight, await its resolution before tearing
    // down so we don't leak the listeners it was about to register.
    if (inFlightRef.current !== null) {
      try {
        const un = await inFlightRef.current;
        unlistenRef.current = null;
        un?.();
      } catch {
        unlistenRef.current = null;
      }
      return;
    }
    const un = unlistenRef.current;
    unlistenRef.current = null;
    un?.();
  }, []);

  return { subscribe, unsubscribe };
}
