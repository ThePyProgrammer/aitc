// Phase 2 pipeline hook.
//
// Constructs a tauri::ipc::Channel<FileEventBatch>, wires the channel's
// onmessage callback into the Zustand store, and exposes `register()` which
// calls the Tauri start_watch command to associate the backend watcher with
// this channel. Returns an unregister function that calls stop_watch.
//
// Note: this hook does NOT auto-start the watch on mount (per Research Open
// Question 4). The watch is triggered explicitly by Phase 3 UI (Tower Control
// "Watch this repo" button). Phase 2 just provides the machinery.

import { useCallback, useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { FileEventBatch, Worktree } from '../bindings';
import { usePipelineStore } from '../stores/pipelineStore';

export function usePipelineChannel() {
  const channelRef = useRef<Channel<FileEventBatch> | null>(null);

  // Construct the channel once on mount. onmessage pumps into the store.
  useEffect(() => {
    const channel = new Channel<FileEventBatch>();
    channel.onmessage = (batch) => {
      usePipelineStore.getState().ingest(batch);
    };
    channelRef.current = channel;
    return () => {
      // Dropping the ref is enough; the channel has no explicit close API.
      // Rust side will hit send() error and exit the forwarder loop.
      channelRef.current = null;
    };
  }, []);

  const register = useCallback(async (repoRoot: string): Promise<Worktree[]> => {
    if (!channelRef.current) {
      throw new Error('usePipelineChannel: channel not initialized yet');
    }
    const worktrees = await invoke<Worktree[]>('start_watch', {
      repoRoot,
      channel: channelRef.current,
    });
    usePipelineStore.getState().setWorktrees(worktrees);
    usePipelineStore.getState().setWatching(true);
    return worktrees;
  }, []);

  const unregister = useCallback(async () => {
    await invoke('stop_watch');
    usePipelineStore.getState().setWatching(false);
    usePipelineStore.getState().reset();
  }, []);

  return { register, unregister };
}
