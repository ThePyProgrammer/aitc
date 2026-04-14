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
  useEffect(() => {
    if (resolvedOnce.current) return;
    resolvedOnce.current = true;
    useRepoStore.getState().resolveInitialRepo().catch((err) => {
      useRepoStore.getState().setError(String(err));
    });
  }, []);

  // D-08: Install pipelineStore.events → radarStore.fetchTreeIndex bridge.
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
