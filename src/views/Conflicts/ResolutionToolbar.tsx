/**
 * Top toolbar for the merge resolution view.
 *
 * Displays file path, conflict ID, resolution progress, and action buttons.
 * Phase 5 Plan 03 -- D-10 implementation.
 */
import { useState } from 'react';
import { Button } from '../../components/ui/Button';

interface ResolutionToolbarProps {
  filePath: string;
  conflictId: string;
  resolvedCount: number;
  totalConflicts: number;
  onApply: () => void;
  onDiscard: () => void;
  isCommitting: boolean;
}

export function ResolutionToolbar({
  filePath,
  conflictId,
  resolvedCount,
  totalConflicts,
  onApply,
  onDiscard,
  isCommitting,
}: ResolutionToolbarProps) {
  const [discardConfirm, setDiscardConfirm] = useState(false);

  const allResolved = resolvedCount >= totalConflicts && totalConflicts > 0;
  const applyDisabled = !allResolved || isCommitting;

  const handleDiscard = () => {
    if (discardConfirm) {
      onDiscard();
      setDiscardConfirm(false);
    } else {
      setDiscardConfirm(true);
      // Auto-reset confirm state after 3s
      setTimeout(() => setDiscardConfirm(false), 3000);
    }
  };

  return (
    <div className="h-14 bg-surface-container-low flex items-center px-4 gap-4 shrink-0">
      {/* Left: file path and conflict ID */}
      <div className="flex flex-col min-w-0 flex-shrink">
        <span className="font-mono text-xs text-on-surface truncate">{filePath}</span>
        <span className="font-mono text-[10px] text-on-surface-variant">{conflictId}</span>
      </div>

      {/* Center: resolution progress */}
      <div className="flex-1 flex justify-center">
        <span className="font-headline text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
          {resolvedCount}/{totalConflicts} HUNKS_RESOLVED
        </span>
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleDiscard}
          className="px-4 py-2 bg-error text-white font-headline text-xs font-bold uppercase tracking-widest hover:shadow-[0_0_10px_rgba(255,115,81,0.4)] transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-error"
        >
          {discardConfirm ? 'CONFIRM?' : 'DISCARD_ALL'}
        </button>
        <Button
          variant="primary"
          disabled={applyDisabled}
          onClick={onApply}
          tooltip={
            !allResolved
              ? 'Resolve all conflict hunks before applying'
              : isCommitting
                ? 'Applying resolution...'
                : undefined
          }
        >
          APPLY_RESOLUTION
        </Button>
      </div>
    </div>
  );
}
