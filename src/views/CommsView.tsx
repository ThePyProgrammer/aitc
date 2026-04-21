// Phase 10 Plan 06 — CommsView extended with REQUESTS | CHAT tab switcher
// (D-19). URL `?tab=chat` toggles the body from the existing 3-panel
// approval layout to the ChatView. `[` / `]` keys cycle tabs. Preserves
// the full Phase 4 keyboard-shortcut surface on the REQUESTS tab.

import { useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCommsStore } from '../stores/commsStore';
import { useChatStore } from '../stores/chatStore';
import { CommsTabBar, type CommsTab } from '../components/ui/CommsTabBar';
import { RequestQueue } from './CommsHub/RequestQueue';
import { RequestDetail } from './CommsHub/RequestDetail';
import { TelemetryPanel } from './CommsHub/TelemetryPanel';
import { ChatView } from './CommsHub/ChatView';

export function CommsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  // T-10-33: narrow `?tab=` to the two allowed values before use.
  const activeTab: CommsTab =
    searchParams.get('tab') === 'chat' ? 'chat' : 'requests';

  const fetchRequests = useCommsStore((s) => s.fetchRequests);
  const subscribeToApprovals = useCommsStore((s) => s.subscribeToApprovals);
  const selectRequest = useCommsStore((s) => s.selectRequest);
  const requests = useCommsStore((s) => s.requests);
  const selectedRequestId = useCommsStore((s) => s.selectedRequestId);
  const setEditing = useCommsStore((s) => s.setEditing);
  const pendingRequests = useCommsStore((s) => s.pendingCount());
  const chatUnread = useChatStore((s) => s.totalUnread());

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

  const setTab = useCallback(
    (tab: CommsTab) => {
      setSearchParams(
        (prev) => {
          const np = new URLSearchParams(prev);
          np.set('tab', tab);
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Tab cycling — `[` / `]` cycle between REQUESTS and CHAT (any tab).
      if (!inInput && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        setTab(activeTab === 'requests' ? 'chat' : 'requests');
        return;
      }

      // Rest of the Phase 4 shortcuts only apply on the REQUESTS tab.
      if (activeTab !== 'requests') return;

      const pending = requests.filter((r) => r.status === 'pending');
      if (pending.length === 0 && e.key !== 'Escape') return;

      const currentIndex = pending.findIndex((r) => r.id === selectedRequestId);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex =
            currentIndex < pending.length - 1 ? currentIndex + 1 : 0;
          selectRequest(pending[nextIndex].id);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex =
            currentIndex > 0 ? currentIndex - 1 : pending.length - 1;
          selectRequest(pending[prevIndex].id);
          break;
        }
        case 'Enter': {
          if (currentIndex === -1 && pending.length > 0) {
            selectRequest(pending[0].id);
          }
          break;
        }
        case 'a': {
          if (selectedRequestId !== null && !e.ctrlKey && !e.metaKey) {
            if (!inInput) {
              useCommsStore.getState().approveRequest(selectedRequestId);
            }
          }
          break;
        }
        case 'd': {
          if (selectedRequestId !== null && !e.ctrlKey && !e.metaKey) {
            if (!inInput) {
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
    [
      activeTab,
      setTab,
      requests,
      selectedRequestId,
      selectRequest,
      setEditing,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const hasRequests = requests.length > 0;

  return (
    <div
      className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-surface"
      style={{ animation: 'phosphor-in 150ms ease' }}
    >
      <div className="px-6 pt-4 pb-0">
        <h1 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface">
          COMMUNICATIONS_HUB
        </h1>
      </div>
      <CommsTabBar
        active={activeTab}
        unreadChat={chatUnread}
        pendingRequests={pendingRequests}
        onTabChange={setTab}
      />
      <div className="flex-1 min-h-0">
        {activeTab === 'chat' ? (
          <ChatView />
        ) : hasRequests ? (
          <div className="flex h-full">
            {/* Left panel: Request Queue (280px fixed) */}
            <RequestQueue />
            {/* Center panel: Request Detail (flex-1) */}
            <RequestDetail />
            {/* Right panel: Telemetry (260px fixed) */}
            <TelemetryPanel />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
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
        )}
      </div>
    </div>
  );
}
