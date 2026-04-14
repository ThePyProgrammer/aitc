import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { useConflictStore } from '../../stores/conflictStore';

const MAX_VISIBLE = 3;

export function ConflictBanner() {
  const allAlerts = useConflictStore((s) => s.alerts);
  const dismissConflict = useConflictStore((s) => s.dismissConflict);
  const alerts = allAlerts.filter((a) => !a.dismissed);

  if (alerts.length === 0) return null;

  const visible = alerts.slice(0, MAX_VISIBLE);
  const overflowCount = alerts.length - MAX_VISIBLE;

  return (
    <div className="flex flex-col gap-1" aria-live="assertive" role="alert">
      <AnimatePresence>
        {visible.map((alert) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.15 }}
            className="flex h-11 items-center px-4 bg-error/10 border-l-2 border-error gap-2"
          >
            <AlertTriangle size={16} strokeWidth={1.5} className="text-error shrink-0" />
            <span className="font-mono text-xs text-error truncate flex-1">
              CONFLICT_DETECTED: {alert.filePath} -- {alert.agentAId} x {alert.agentBId}
            </span>
            <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
              {new Date(alert.detectedAtMs).toLocaleTimeString()}
            </span>
            <button
              onClick={() => dismissConflict(alert.id)}
              className="text-on-surface-variant hover:text-error transition-colors shrink-0"
              aria-label={`Dismiss conflict ${alert.id}`}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {overflowCount > 0 && (
        <div className="px-4 py-1">
          <span className="font-mono text-[10px] text-error/70">
            +{overflowCount} more conflict{overflowCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
