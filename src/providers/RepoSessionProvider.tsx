// Phase 6: App-lifetime pipeline provider (D-05 decision).
// Mount point: ABOVE <Outlet/> in AppShell so the Channel outlives route navigation (Pitfall 1).

import { useEffect, useRef, type ReactNode } from 'react';
import { useRepoStore } from '../stores/repoStore';
import { usePipelineChannel } from '../hooks/usePipelineChannel';
import { installRadarPipelineBridge } from '../stores/radarStore';

export function RepoSessionProvider({ children }: { children: ReactNode }) {
  const { register, unregister } = usePipelineChannel();
  const activeRepo = useRepoStore((s) => s.activeRepo);
  const isPaused = useRepoStore((s) => s.isPaused);
  const resolvedOnce = useRef(false);

  // Resolve repo on mount (exactly once across StrictMode double-invoke).
  // WR-05: Only latch `resolvedOnce` on success. If the initial resolve throws
  // (e.g., transient Tauri IPC failure during startup), leave the ref false so
  // a subsequent mount / re-render can retry instead of stranding the user on
  // the error banner.
  useEffect(() => {
    if (resolvedOnce.current) return;
    let cancelled = false;
    (async () => {
      try {
        await useRepoStore.getState().resolveInitialRepo();
        if (!cancelled) resolvedOnce.current = true;
      } catch (err) {
        useRepoStore.getState().setError(String(err));
        // leave resolvedOnce false so the next mount can retry
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // D-08: Install pipelineStore.events → radarStore.fetchGraph bridge
  // (Phase 7 Plan 03 replaced fetchTreeIndex with fetchGraph).
  // Unsubscribe on unmount to prevent debounce leaks (T-06-05-01).
  useEffect(() => {
    const unsub = installRadarPipelineBridge();
    return unsub;
  }, []);

  // Register when activeRepo changes (and not paused); unregister on pause or unmount.
  useEffect(() => {
    if (!activeRepo || isPaused) return;
    let cancelled = false;
    register(activeRepo).catch((err) => {
      if (cancelled) return;
      useRepoStore.getState().setError(String(err));
    });
    return () => {
      cancelled = true;
      unregister().catch(() => { /* swallow -- best-effort cleanup */ });
    };
  }, [activeRepo, isPaused, register, unregister]);

  return <>{children}</>;
}
