import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Package,
  Radar,
  Building2,
  Rocket,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSidebarStore } from '../../stores/sidebarStore';
import { ConflictNavBadge } from '../ui/ConflictNavBadge';
import { PendingCountBadge } from '../ui/PendingCountBadge';
import { useChatStore } from '../../stores/chatStore';

const navItems = [
  { to: '/radar', label: 'RADAR', icon: Radar },
  { to: '/tower', label: 'TOWER', icon: Building2 },
  { to: '/arsenal', label: 'ARSENAL', icon: Package },
  { to: '/comms', label: 'COMMS', icon: MessageSquare },
  { to: '/conflicts', label: 'CONFLICTS', icon: AlertTriangle },
  { to: '/history', label: 'HISTORY', icon: Clock },
] as const;

/**
 * Phase 10 Plan 06 (D-22) — tiny primary dot next to the COMMS nav label
 * when there is chat-unread signal AND the user is not on the CHAT tab
 * already. The pending-request count badge lives separately via
 * <PendingCountBadge />. This dot is the unified "something is new" signal
 * per 10-UI-SPEC.md § Sidebar.
 */
function ChatUnreadDot() {
  const totalUnread = useChatStore((s) => s.totalUnread());
  const location = useLocation();
  const onChatTab =
    location.pathname === '/comms' &&
    new URLSearchParams(location.search).get('tab') === 'chat';
  if (totalUnread === 0 || onChatTab) return null;
  return (
    <span
      aria-label={`${totalUnread} unread chat events`}
      title={`${totalUnread} unread chat events`}
      data-testid="chat-unread-dot"
      className="inline-block h-1.5 w-1.5 bg-primary"
    />
  );
}

export function Sidebar() {
  const expanded = useSidebarStore((s) => s.expanded);
  const toggle = useSidebarStore((s) => s.toggle);

  return (
    <aside
      className={`fixed left-0 top-14 bottom-0 z-40 flex flex-col bg-surface-container-low transition-[width] duration-200 ease-in-out ${
        expanded ? 'w-64' : 'w-20'
      }`}
    >
      {/* Toggle button */}
      <button
        onClick={toggle}
        className="flex h-11 w-full items-center justify-center text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-high hover:text-on-surface"
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {expanded ? (
          <ChevronLeft size={20} strokeWidth={1.5} />
        ) : (
          <ChevronRight size={20} strokeWidth={1.5} />
        )}
      </button>

      {/* Sector label */}
      {expanded && (
        <div className="px-6 pb-4 pt-2">
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            HORIZON_01
          </span>
        </div>
      )}

      {/* Navigation items */}
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex h-11 items-center transition-colors duration-150 ${
                isActive
                  ? 'border-l-2 border-primary bg-surface-container text-primary'
                  : 'border-l-2 border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
              } ${expanded ? '' : 'justify-center'}`
            }
          >
            <Icon
              size={20}
              strokeWidth={1.5}
              className={expanded ? 'ml-6' : ''}
            />
            {expanded && (
              <span className="ml-3 font-headline text-[14px] font-bold uppercase tracking-widest flex items-center gap-2">
                {label}
                {label === 'CONFLICTS' && <ConflictNavBadge />}
                {label === 'COMMS' && (
                  <>
                    <PendingCountBadge />
                    <ChatUnreadDot />
                  </>
                )}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Deploy agent button (disabled in Phase 1) */}
      <div className="p-3">
        <button
          disabled
          className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 bg-primary/10 text-primary opacity-50"
          title="Agent management available in a future update"
        >
          <Rocket size={18} strokeWidth={1.5} />
          {expanded && (
            <span className="font-headline text-[12px] font-bold uppercase tracking-widest">
              DEPLOY_AGENT
            </span>
          )}
        </button>
      </div>

      {/* Footer links */}
      {expanded && (
        <div className="flex gap-4 px-6 pb-4">
          <span className="cursor-default font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            TERMINAL
          </span>
          <span className="cursor-default font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            LOGS
          </span>
        </div>
      )}
    </aside>
  );
}
