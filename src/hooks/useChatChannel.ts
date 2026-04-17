// Phase 10: chat subscription lifecycle hook.
//
// Wraps `useChatStore.subscribeToChat()` in the same shape as
// useClaudeResourcesChannel/usePipelineChannel: a pair of
// `{ subscribe, unsubscribe }` callbacks owning the Tauri listen fan-out.
//
// Per RESEARCH.md Pattern 7 note — chat event rates are well under 10/sec
// steady-state, so we favour `listen()`-in-store over a Channel<T> pump.

import { useCallback, useRef } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '../stores/chatStore';

export function useChatChannel() {
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const subscribe = useCallback(async () => {
    if (unlistenRef.current !== null) return;
    unlistenRef.current = await useChatStore.getState().subscribeToChat();
  }, []);

  const unsubscribe = useCallback(() => {
    const un = unlistenRef.current;
    unlistenRef.current = null;
    un?.();
  }, []);

  return { subscribe, unsubscribe };
}
