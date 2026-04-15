import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCommsStore } from '../../stores/commsStore';
import { ApprovalRequestCard } from './ApprovalRequestCard';

export function RequestQueue() {
  const requests = useCommsStore((s) => s.requests);
  const pendingCount = useCommsStore((s) => s.pendingCount());
  const parentRef = useRef<HTMLDivElement>(null);

  // Phase 8 Plan 05: queue shows pending rows first (newest first), then
  // abandoned rows (newest first) — abandoned rows remain visible but
  // non-interactive until fetchRequests drops them.
  const displayRequests = requests
    .filter((r) => r.status === 'pending' || r.status === 'abandoned')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const virtualizer = useVirtualizer({
    count: displayRequests.length,
    getScrollElement: () => parentRef.current,
    // Phase 8 Plan 05: bumped from 72 → 96 to fit the new preview-line row (D-14).
    estimateSize: () => 96,
    overscan: 5,
  });

  return (
    <div className="w-[280px] shrink-0 bg-surface-container-low flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <h2 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
          PENDING_APPROVALS
        </h2>
        {pendingCount > 0 && (
          <span className="font-mono text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5">
            {pendingCount}
          </span>
        )}
      </div>

      {/* Scrollable request list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {displayRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div
              className="h-5 w-[2px] bg-secondary"
              style={{ animation: 'blink-cursor 1s step-end infinite' }}
            />
            <p className="mt-4 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant text-center">
              ALL_CHANNELS_CLEAR
            </p>
            <p className="mt-1 font-mono text-[10px] text-on-surface-variant/60 text-center">
              No pending approval requests.
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <ApprovalRequestCard request={displayRequests[virtualItem.index]} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
