// Phase 9 ARSENAL — ScopeTabs (Plan 05 Wave 3).
//
// Stateless tab bar for GLOBAL / PROJECT / COMBINED scopes. Parent owns
// active state. Matches History tab visual pattern (h-11, primary underline
// on active, 11px bold tracking-widest uppercase).

import type { Scope } from '../../bindings';

export type ScopeTab = Scope | 'combined';

export interface ScopeTabsProps {
  active: ScopeTab;
  onChange: (s: ScopeTab) => void;
}

const tabs: { key: ScopeTab; label: string }[] = [
  { key: 'global', label: 'GLOBAL' },
  { key: 'project', label: 'PROJECT' },
  { key: 'combined', label: 'COMBINED' },
];

export function ScopeTabs({ active, onChange }: ScopeTabsProps) {
  return (
    <div role="tablist" aria-label="Scope" className="flex gap-6 h-11 items-end">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`font-headline text-[11px] font-bold tracking-widest uppercase pb-2 border-b-2 transition-colors duration-150 ${
            active === t.key
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-primary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
