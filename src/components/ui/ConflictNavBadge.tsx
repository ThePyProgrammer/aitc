import { motion } from 'motion/react';
import { useConflictStore } from '../../stores/conflictStore';

/**
 * Conflict count badge with radar-ping pulse animation for the sidebar.
 * Shows nothing when conflict count is 0.
 * Uses aria-live="polite" for screen reader announcements.
 */
export function ConflictNavBadge() {
  const count = useConflictStore((s) => s.alerts.filter((a) => !a.dismissed).length);

  if (count === 0) return null;

  return (
    <span className="relative inline-flex items-center gap-1" aria-live="polite">
      {/* Count */}
      <span className="font-mono text-[10px] font-bold text-error">
        {count}
      </span>

      {/* Dot with ping animation */}
      <span className="relative inline-flex h-2 w-2">
        {/* Ping ring */}
        <motion.span
          className="absolute inset-0 rounded-full bg-error/30"
          animate={{ scale: [1, 2.5], opacity: [0.3, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
        />
        {/* Solid dot */}
        <span className="relative h-2 w-2 rounded-full bg-error" />
      </span>
    </span>
  );
}
