// Phase 10 — READ-ONLY_TRANSCRIPT pill for uncapable adapters
// (CODEX / OPENCODE / GENERIC). Matches ScopeChip's tertiary colorway.

export interface ReadOnlyBadgeProps {
  className?: string;
}

export function ReadOnlyBadge({ className = '' }: ReadOnlyBadgeProps) {
  return (
    <span
      data-testid="read-only-badge"
      aria-label="Read-only transcript"
      className={`inline-flex items-center bg-tertiary/10 text-tertiary border border-tertiary/20 font-headline text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 ${className}`.trim()}
    >
      READ-ONLY_TRANSCRIPT
    </span>
  );
}
