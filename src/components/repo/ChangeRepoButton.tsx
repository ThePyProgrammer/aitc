import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useRepoStore } from '../../stores/repoStore';

/**
 * UI-SPEC: top-bar trigger opens a centered modal (mirrors DeployDialog visual
 * language) so the sticky top bar never expands vertically during the confirm
 * flow. Modal dismisses via backdrop click, X, or "Keep current repo".
 * The primary action delegates to `useRepoStore.changeRepo()` which opens the
 * native folder picker.
 */
export function ChangeRepoButton() {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const changeRepo = useRepoStore((s) => s.changeRepo);
  const activeRepo = useRepoStore((s) => s.activeRepo);

  const handleSwitch = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      // Close the modal before invoking the native picker so the user sees
      // the top bar while the OS dialog is front-most.
      setOpen(false);
      await changeRepo();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Change repo"
        title="Change repo"
        onClick={() => setOpen(true)}
        className="h-8 px-3 inline-flex items-center gap-1 text-xs font-sans uppercase tracking-[0.08em] text-[var(--color-on-surface)] hover:bg-[var(--color-surface-container-high)]"
      >
        <RefreshCw size={14} strokeWidth={1.5} />
        <span>Change repo</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[480px] bg-surface/80 backdrop-blur-xl border border-outline/10"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Change monitored repository"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-outline/10">
                <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface">
                  CHANGE_REPO
                </h3>
                <button
                  onClick={() => setOpen(false)}
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                  aria-label="Close change repo dialog"
                >
                  <X size={18} strokeWidth={1.5} />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-4">
                {activeRepo && (
                  <>
                    <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                      MONITORED_REPO
                    </label>
                    <div
                      className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface-variant truncate mb-4"
                      title={activeRepo}
                    >
                      {activeRepo}
                    </div>
                  </>
                )}
                <p className="font-mono text-xs text-on-surface leading-relaxed">
                  Switching repositories will stop the current watch. Unsaved
                  agent session data is preserved.
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline/10">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  KEEP_CURRENT
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSwitch}
                  disabled={switching}
                >
                  {switching ? 'OPENING...' : 'SWITCH_REPO'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
