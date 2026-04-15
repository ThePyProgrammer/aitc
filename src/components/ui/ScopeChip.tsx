// Phase 9 ARSENAL — ScopeChip (Plan 04 Wave 2).
//
// GLOBAL / PROJECT chip per 09-UI-SPEC.md:
//   background: surface-container-high
//   GLOBAL text: tertiary (amber)   — scope reserved for "larger blast radius"
//   PROJECT text: primary (phosphor green) — active / local-to-repo scope
// Typography: Space Grotesk 11px font-bold tracking-widest uppercase.
// Renders a short uppercase label with an aria-label describing the scope.

import type { Scope } from '../../bindings';

export interface ScopeChipProps {
  scope: Scope;
  className?: string;
}

export function ScopeChip({ scope, className = '' }: ScopeChipProps) {
  const toneClass = scope === 'global' ? 'text-tertiary' : 'text-primary';
  const label = scope.toUpperCase(); // "GLOBAL" | "PROJECT"
  return (
    <span
      aria-label={`${label} scope`}
      className={`inline-flex items-center bg-surface-container-high font-headline text-[11px] font-bold tracking-widest uppercase px-2 py-1 ${toneClass} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
