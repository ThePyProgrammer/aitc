// Phase 9 ARSENAL — UndoToast (Plan 04 Wave 2).
//
// 10-second undo toast shown after each successful CLAUDE.md save (D-14).
// Motion-based entrance (150ms opacity + 4px y) per UI-SPEC. Clicking UNDO
// fires onUndo and dismisses the toast; the × glyph dismisses without undo;
// the countdown ticks once per second and auto-dismisses at 0.
//
// Guardrail: after the first UNDO click the toast disables further action so
// spam-clicks cannot double-fire onUndo before the parent unmounts us.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, X } from 'lucide-react';

export interface UndoToastProps {
  filename: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** Countdown seconds. Defaults to 10 per UI-SPEC. */
  durationSeconds?: number;
}

export function UndoToast({
  filename,
  onUndo,
  onDismiss,
  durationSeconds = 10,
}: UndoToastProps) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const consumed = useRef(false);

  useEffect(() => {
    if (remaining <= 0) {
      if (!consumed.current) {
        consumed.current = true;
        onDismiss();
      }
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onDismiss]);

  const handleUndo = () => {
    if (consumed.current) return;
    consumed.current = true;
    onUndo();
    onDismiss();
  };

  const handleDismiss = () => {
    if (consumed.current) return;
    consumed.current = true;
    onDismiss();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15 }}
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 bg-surface-container-high border-l-2 border-primary px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <span className="font-headline text-[11px] font-bold tracking-widest uppercase text-on-surface">
          SAVED — {filename}
        </span>
        <span className="font-mono text-[10px] tracking-widest uppercase text-on-surface-variant">
          Undo in {remaining}s
        </span>
      </div>
      <button
        type="button"
        onClick={handleUndo}
        aria-label="Undo save"
        className="font-headline text-[11px] font-bold tracking-widest uppercase text-primary inline-flex items-center gap-1 px-2 py-1"
      >
        <RotateCcw size={16} strokeWidth={1.5} />
        UNDO
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss toast"
        className="text-on-surface-variant px-1"
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </motion.div>
  );
}
