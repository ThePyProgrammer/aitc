/**
 * Left sidebar listing conflict hunks with resolved/unresolved indicators.
 *
 * Clicking a hunk scrolls the unified diff to that hunk.
 * Phase 5 Plan 03 -- D-02 hunk navigation.
 */
import { Check } from 'lucide-react';
import type { MergeHunk } from '../../lib/merge';

interface HunkNavigatorProps {
  hunks: MergeHunk[];
  resolutions: Map<number, string>;
  activeHunkIndex: number;
  onHunkClick: (index: number) => void;
}

export function HunkNavigator({ hunks, resolutions, activeHunkIndex, onHunkClick }: HunkNavigatorProps) {
  const conflictHunks = hunks.filter((h) => h.type === 'conflict');

  return (
    <div className="w-[200px] bg-surface-container-low overflow-y-auto shrink-0 flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <span className="font-headline text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
          HUNK_NAVIGATOR
        </span>
      </div>

      {/* Hunk list */}
      <div className="flex flex-col gap-1 px-2 pb-4">
        {conflictHunks.map((hunk) => {
          const isResolved = resolutions.has(hunk.index);
          const isActive = hunk.index === activeHunkIndex;
          const paddedIndex = String(hunk.index + 1).padStart(2, '0');

          return (
            <button
              key={hunk.index}
              type="button"
              onClick={() => onHunkClick(hunk.index)}
              className={`flex items-center gap-2 px-4 py-2 text-left transition-colors duration-150
                border-l-2
                ${isResolved ? 'border-primary' : 'border-[#ffd16f]'}
                ${isActive ? 'bg-surface-container-high' : 'hover:bg-surface-container'}
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary
              `}
              aria-label={`Hunk ${paddedIndex}, ${isResolved ? 'resolved' : 'unresolved'}`}
            >
              <span className="font-mono text-xs text-on-surface">
                HUNK_{paddedIndex}
              </span>
              {isResolved && (
                <Check size={14} className="text-primary ml-auto" strokeWidth={1.5} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
