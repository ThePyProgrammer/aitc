/**
 * Main merge resolution UI layout.
 *
 * Composes ResolutionToolbar, HunkNavigator, UnifiedDiff, and IntentPanel
 * into the full conflict resolution interface. Phase 5 Plan 03 -- D-01/D-02/D-03.
 */
import { useRef, useState, useCallback, useMemo } from 'react';
import { useConflictStore } from '../../stores/conflictStore';
import { RadarPulse } from '../../components/ui/RadarPulse';
import { ResolutionToolbar } from './ResolutionToolbar';
import { HunkNavigator } from './HunkNavigator';
import { UnifiedDiff } from './UnifiedDiff';
import { IntentPanel } from './IntentPanel';

export function MergeView() {
  const activeMerge = useConflictStore((s) => s.activeMerge);
  const resolveHunk = useConflictStore((s) => s.resolveHunk);
  const applyResolution = useConflictStore((s) => s.applyResolution);
  const discardAll = useConflictStore((s) => s.discardAll);
  const resolvedCount = useConflictStore((s) => s.resolvedCount());
  // unresolvedCount available for future use (e.g., keyboard nav to next unresolved)
  const _unresolvedCount = useConflictStore((s) => s.unresolvedCount);
  void _unresolvedCount;

  const hunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [activeHunkIndex, setActiveHunkIndex] = useState(-1);

  const handleHunkClick = useCallback((index: number) => {
    setActiveHunkIndex(index);
    const el = hunkRefs.current?.get(index);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const totalConflicts = useMemo(() => {
    if (!activeMerge) return 0;
    return activeMerge.hunks.filter((h) => h.type === 'conflict').length;
  }, [activeMerge]);

  if (!activeMerge) return null;

  // Loading state
  if (activeMerge.status === 'loading') {
    return (
      <div
        className="flex flex-col h-[calc(100vh-56px)] bg-surface items-center justify-center"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        <RadarPulse size="sm" color="primary" />
        <span className="mt-4 font-mono text-xs text-on-surface-variant/60">
          Loading file versions...
        </span>
      </div>
    );
  }

  // Error state
  if (activeMerge.status === 'error') {
    return (
      <div
        className="flex flex-col h-[calc(100vh-56px)] bg-surface items-center justify-center"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        <h2 className="text-error font-headline text-sm font-bold uppercase tracking-widest">
          MERGE_LOAD_FAILED
        </h2>
        <p className="mt-2 text-on-surface-variant/60 font-mono text-xs max-w-md text-center">
          Unable to read file versions. Verify the file exists and the repository is accessible.
        </p>
        {activeMerge.error && (
          <p className="mt-2 text-error/60 font-mono text-[10px] max-w-md text-center">
            {activeMerge.error}
          </p>
        )}
        <button
          type="button"
          onClick={discardAll}
          className="mt-4 px-4 py-2 text-on-surface-variant font-headline text-xs font-bold uppercase tracking-widest hover:bg-surface-container transition-colors duration-150"
        >
          BACK_TO_LIST
        </button>
      </div>
    );
  }

  // Done state
  if (activeMerge.status === 'done') {
    return (
      <div
        className="flex flex-col h-[calc(100vh-56px)] bg-surface items-center justify-center"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        <h2 className="text-primary font-headline text-sm font-bold uppercase tracking-widest">
          RESOLUTION_APPLIED
        </h2>
        <p className="mt-2 text-on-surface-variant/60 font-mono text-xs">
          Merged file written to disk. Returning to conflict list...
        </p>
      </div>
    );
  }

  // Main merge UI (resolving or committing)
  return (
    <div
      className="flex flex-col h-[calc(100vh-56px)] bg-surface"
      style={{ animation: 'phosphor-in 150ms ease' }}
    >
      {/* Top toolbar */}
      <ResolutionToolbar
        filePath={activeMerge.filePath}
        conflictId={activeMerge.conflictId}
        resolvedCount={resolvedCount}
        totalConflicts={totalConflicts}
        onApply={applyResolution}
        onDiscard={discardAll}
        isCommitting={activeMerge.status === 'committing'}
      />

      {/* Middle: hunk nav + diff */}
      <div className="flex flex-1 min-h-0">
        <HunkNavigator
          hunks={activeMerge.hunks}
          resolutions={activeMerge.resolutions as Map<number, string>}
          activeHunkIndex={activeHunkIndex}
          onHunkClick={handleHunkClick}
        />
        <UnifiedDiff
          hunks={activeMerge.hunks}
          resolutions={activeMerge.resolutions}
          customEdits={activeMerge.customEdits}
          filePath={activeMerge.filePath}
          onResolveHunk={resolveHunk}
          hunkRefs={hunkRefs}
        />
      </div>

      {/* Bottom intent panel */}
      <IntentPanel
        agentAId={activeMerge.agentAId}
        agentBId={activeMerge.agentBId}
      />
    </div>
  );
}
