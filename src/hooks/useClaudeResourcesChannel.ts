// Phase 9 ARSENAL — Claude resources Channel<T> lifecycle hook (Plan 04 Wave 2).
//
// Mirrors usePipelineChannel (Phase 2) — constructs a Tauri Channel on mount,
// wires onmessage into the claudeResourcesStore.applyBatch pump, and exposes
// start(cwd)/stop() which drive the Plan 03 Tauri commands
// `startClaudeResourcesWatch` / `stopClaudeResourcesWatch`.
//
// start() returns the initial seed (full scan of both scopes) and populates the
// store via seed(). stop() resets the store to its empty state.

import { useCallback, useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { Resource, ResourceEventBatch } from '../bindings';
import { useClaudeResourcesStore } from '../stores/claudeResourcesStore';

export function useClaudeResourcesChannel() {
  const channelRef = useRef<Channel<ResourceEventBatch> | null>(null);

  useEffect(() => {
    const channel = new Channel<ResourceEventBatch>();
    channel.onmessage = (batch) => {
      useClaudeResourcesStore.getState().applyBatch(batch);
    };
    channelRef.current = channel;
    return () => {
      // Dropping the ref mirrors usePipelineChannel; Rust side exits its
      // forwarder loop on the next send() error.
      channelRef.current = null;
    };
  }, []);

  const start = useCallback(async (cwd: string | null): Promise<Resource[]> => {
    if (!channelRef.current) {
      throw new Error('useClaudeResourcesChannel: channel not ready');
    }
    const initial = await invoke<Resource[]>('start_claude_resources_watch', {
      cwd,
      channel: channelRef.current,
    });
    useClaudeResourcesStore.getState().seed(initial);
    return initial;
  }, []);

  const stop = useCallback(async () => {
    await invoke('stop_claude_resources_watch');
    useClaudeResourcesStore.getState().reset();
  }, []);

  return { start, stop };
}
