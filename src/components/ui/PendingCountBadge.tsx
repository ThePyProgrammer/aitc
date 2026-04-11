import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useCommsStore } from '../../stores/commsStore';

/**
 * Pending approval count badge for the COMMS sidebar nav item.
 * Shows nothing when count is 0.
 * Pulses (scale 1.0 to 1.2, 300ms) when new request arrives.
 */
export function PendingCountBadge() {
  const count = useCommsStore((s) => s.pendingCount());
  const prevCountRef = useRef(count);
  const isNew = count > prevCountRef.current;

  useEffect(() => {
    prevCountRef.current = count;
  }, [count]);

  if (count === 0) return null;

  return (
    <span className="relative inline-flex items-center gap-1" aria-live="polite">
      {/* Count */}
      <motion.span
        className="font-mono text-[10px] font-bold text-primary"
        animate={isNew ? { scale: [1, 1.2, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        {count}
      </motion.span>

      {/* Dot with pulse animation */}
      <span className="relative inline-flex h-2 w-2">
        <motion.span
          className="absolute inset-0 rounded-full bg-primary/30"
          animate={{ scale: [1, 2.5], opacity: [0.3, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
        />
        <span className="relative h-2 w-2 rounded-full bg-primary" />
      </span>
    </span>
  );
}
