/**
 * Inline per-hunk resolution controls: Accept A | Accept B | Edit Manual.
 *
 * Renders between Agent A and Agent B sections in a conflict hunk.
 * Phase 5 Plan 03 -- D-02 implementation.
 */

interface HunkResolutionControlsProps {
  hunkIndex: number;
  onResolve: (choice: 'a' | 'b' | 'custom', custom?: string) => void;
}

export function HunkResolutionControls({ hunkIndex, onResolve }: HunkResolutionControlsProps) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-1 bg-surface-container-high"
      role="toolbar"
      aria-label={`Resolution controls for hunk ${hunkIndex}`}
    >
      <button
        type="button"
        tabIndex={0}
        onClick={() => onResolve('a')}
        onKeyDown={(e) => { if (e.key === 'Enter') onResolve('a'); }}
        className="px-3 py-1 text-xs font-headline uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        ACCEPT_AGENT_A
      </button>
      <button
        type="button"
        tabIndex={0}
        onClick={() => onResolve('b')}
        onKeyDown={(e) => { if (e.key === 'Enter') onResolve('b'); }}
        className="px-3 py-1 text-xs font-headline uppercase tracking-widest text-[#00cffc] hover:bg-[#00cffc]/10 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00cffc]"
      >
        ACCEPT_AGENT_B
      </button>
      <button
        type="button"
        tabIndex={0}
        onClick={() => onResolve('custom', '')}
        onKeyDown={(e) => { if (e.key === 'Enter') onResolve('custom', ''); }}
        className="px-3 py-1 text-xs font-headline uppercase tracking-widest text-on-surface-variant hover:bg-surface-container transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-on-surface-variant"
      >
        EDIT_MANUAL
      </button>
    </div>
  );
}
