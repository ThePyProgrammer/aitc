// Phase 10 — generic unread count badge (D-22). Distinct from
// PendingCountBadge (which is specifically the sidebar COMMS nav approval
// count). Used inline on CHAT tab label and per-agent master-list rows.

export interface UnreadBadgeProps {
  count: number;
  className?: string;
}

export function UnreadBadge({ count, className = '' }: UnreadBadgeProps) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      data-testid="unread-badge"
      aria-label={`${count} unread`}
      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1 bg-primary text-on-primary font-mono text-[10px] font-bold ${className}`.trim()}
    >
      {label}
    </span>
  );
}
