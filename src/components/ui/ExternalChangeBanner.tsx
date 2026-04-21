// Phase 9 ARSENAL — ExternalChangeBanner (Plan 04 Wave 2).
//
// Non-blocking banner shown above the CLAUDE.md editor when the watcher reports
// an external write to the currently-edited file (D-15). Three actions:
//   RELOAD     — single-click when buffer is clean; two-click confirm when dirty.
//   KEEP MINE  — always two-click (destructive: overwrites external edit on save).
//   VIEW DIFF  — single-click; opens 2-pane diff (wired in Plan 05+).
// A pending confirmation lapses after 3 seconds and the label reverts.

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

export interface ExternalChangeBannerProps {
  hasUnsavedEdits: boolean;
  onReload: () => void;
  onKeepMine: () => void;
  onViewDiff: () => void;
}

type PendingAction = null | 'reload' | 'keepMine';

export function ExternalChangeBanner({
  hasUnsavedEdits,
  onReload,
  onKeepMine,
  onViewDiff,
}: ExternalChangeBannerProps) {
  const [pending, setPending] = useState<PendingAction>(null);

  useEffect(() => {
    if (pending === null) return;
    const id = setTimeout(() => setPending(null), 3000);
    return () => clearTimeout(id);
  }, [pending]);

  const handleReload = () => {
    if (!hasUnsavedEdits) {
      onReload();
      return;
    }
    if (pending === 'reload') {
      onReload();
      setPending(null);
      return;
    }
    setPending('reload');
  };

  const handleKeepMine = () => {
    if (pending === 'keepMine') {
      onKeepMine();
      setPending(null);
      return;
    }
    setPending('keepMine');
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-3 bg-surface-container-high border-l-2 border-secondary px-4 py-3"
    >
      <AlertCircle
        size={16}
        strokeWidth={1.5}
        className="text-secondary shrink-0"
        aria-hidden="true"
      />
      <span className="font-mono text-xs text-on-surface">
        This file changed on disk while you were editing.
      </span>
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={handleReload}
          aria-label="Reload from disk"
          className="font-headline text-[11px] font-bold tracking-widest uppercase text-secondary"
        >
          {pending === 'reload' ? 'CONFIRM RELOAD' : 'RELOAD'}
        </button>
        <span className="text-on-surface-variant">·</span>
        <button
          type="button"
          onClick={handleKeepMine}
          aria-label="Keep my unsaved edits and overwrite on next save"
          className="font-headline text-[11px] font-bold tracking-widest uppercase text-error"
        >
          {pending === 'keepMine' ? 'CONFIRM OVERWRITE' : 'KEEP MINE'}
        </button>
        <span className="text-on-surface-variant">·</span>
        <button
          type="button"
          onClick={onViewDiff}
          aria-label="View diff between buffer and disk"
          className="font-headline text-[11px] font-bold tracking-widest uppercase text-on-surface-variant"
        >
          VIEW DIFF
        </button>
      </div>
    </div>
  );
}
