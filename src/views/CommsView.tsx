import { useEffect, useCallback } from 'react';
import { useCommsStore } from '../stores/commsStore';
import { RequestQueue } from './CommsHub/RequestQueue';
import { RequestDetail } from './CommsHub/RequestDetail';
import { TelemetryPanel } from './CommsHub/TelemetryPanel';

export function CommsView() {
  const fetchRequests = useCommsStore((s) => s.fetchRequests);
  const subscribeToApprovals = useCommsStore((s) => s.subscribeToApprovals);
  const selectRequest = useCommsStore((s) => s.selectRequest);
  const requests = useCommsStore((s) => s.requests);
  const selectedRequestId = useCommsStore((s) => s.selectedRequestId);
  const setEditing = useCommsStore((s) => s.setEditing);

  useEffect(() => {
    // Initial data fetch
    fetchRequests();

    // Start real-time subscription
    let unlisten: (() => void) | undefined;
    subscribeToApprovals().then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const pendingRequests = requests.filter((r) => r.status === 'pending');
      if (pendingRequests.length === 0) return;

      const currentIndex = pendingRequests.findIndex((r) => r.id === selectedRequestId);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = currentIndex < pendingRequests.length - 1 ? currentIndex + 1 : 0;
          selectRequest(pendingRequests[nextIndex].id);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : pendingRequests.length - 1;
          selectRequest(pendingRequests[prevIndex].id);
          break;
        }
        case 'Enter': {
          if (currentIndex === -1 && pendingRequests.length > 0) {
            selectRequest(pendingRequests[0].id);
          }
          break;
        }
        case 'a': {
          if (selectedRequestId !== null && !e.ctrlKey && !e.metaKey) {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT' && !target.isContentEditable) {
              useCommsStore.getState().approveRequest(selectedRequestId);
            }
          }
          break;
        }
        case 'd': {
          if (selectedRequestId !== null && !e.ctrlKey && !e.metaKey) {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT' && !target.isContentEditable) {
              useCommsStore.getState().denyRequest(selectedRequestId);
            }
          }
          break;
        }
        case 'Escape': {
          selectRequest(null);
          setEditing(null);
          break;
        }
      }
    },
    [requests, selectedRequestId, selectRequest, setEditing]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const hasRequests = requests.length > 0;

  if (!hasRequests) {
    return (
      <div
        className="min-h-[calc(100vh-56px)] bg-surface flex items-center justify-center"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-5 w-[2px] bg-secondary"
            style={{ animation: 'blink-cursor 1s step-end infinite' }}
          />
          <h2 className="mt-4 text-on-surface-variant font-headline text-sm font-bold uppercase tracking-widest">
            NO_PENDING_REQUESTS
          </h2>
          <p className="text-on-surface-variant/60 font-mono text-xs">
            All channels clear. Agent communications will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-[calc(100vh-56px)] bg-surface"
      style={{ animation: 'phosphor-in 150ms ease' }}
    >
      {/* Left panel: Request Queue (280px fixed) */}
      <RequestQueue />

      {/* Center panel: Request Detail (flex-1) */}
      <RequestDetail />

      {/* Right panel: Telemetry (260px fixed) */}
      <TelemetryPanel />
    </div>
  );
}
