// Phase 10 — REQUESTS | CHAT tab switcher inside CommsView (D-19).
// Mirrors HistoryView tab bar pattern verbatim: h-11, px-6, border-b-2
// primary underline, 11px bold tracking-widest uppercase.
// Wave 0 (Plan 01) accepts callbacks so this is testable in isolation.
// Plan 06 wires this to URL `?tab=` state.

import { UnreadBadge } from './UnreadBadge';

export type CommsTab = 'requests' | 'chat';

export interface CommsTabBarProps {
  active: CommsTab;
  unreadChat: number;
  pendingRequests: number;
  onTabChange: (tab: CommsTab) => void;
}

export function CommsTabBar({
  active,
  unreadChat,
  pendingRequests,
  onTabChange,
}: CommsTabBarProps) {
  return (
    <div
      role="tablist"
      data-testid="comms-tab-bar"
      className="flex h-11 items-end gap-0 px-6"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'requests'}
        onClick={() => onTabChange('requests')}
        className={`px-4 pb-2 flex items-center gap-2 font-headline text-[11px] uppercase tracking-widest transition-colors duration-150 ${
          active === 'requests'
            ? 'border-b-2 border-primary text-primary'
            : 'border-b-2 border-transparent text-on-surface-variant hover:text-on-surface'
        }`}
      >
        REQUESTS
        <UnreadBadge count={pendingRequests} />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'chat'}
        onClick={() => onTabChange('chat')}
        className={`px-4 pb-2 flex items-center gap-2 font-headline text-[11px] uppercase tracking-widest transition-colors duration-150 ${
          active === 'chat'
            ? 'border-b-2 border-primary text-primary'
            : 'border-b-2 border-transparent text-on-surface-variant hover:text-on-surface'
        }`}
      >
        CHAT
        <UnreadBadge count={unreadChat} />
      </button>
    </div>
  );
}
