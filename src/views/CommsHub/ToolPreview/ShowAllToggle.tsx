/**
 * Phase 8 Plan 05: ShowAllToggle — right-aligned expand/collapse link
 * below a code block that exceeds the 400px / 2KB truncation threshold
 * (D-16). Copy `SHOW_ALL` (collapsed) / `SHOW_LESS` (expanded).
 */

interface ShowAllToggleProps {
  expanded: boolean;
  onToggle: () => void;
  controlsId: string;
}

export function ShowAllToggle({ expanded, onToggle, controlsId }: ShowAllToggleProps) {
  return (
    <div className="mt-2 text-right">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={onToggle}
        className="font-headline text-[10px] font-bold uppercase tracking-widest text-primary hover:text-primary-container transition-colors duration-150"
      >
        {expanded ? 'SHOW_LESS' : 'SHOW_ALL'}
      </button>
    </div>
  );
}
