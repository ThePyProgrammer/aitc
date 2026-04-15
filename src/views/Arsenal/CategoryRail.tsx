// Phase 9 ARSENAL — CategoryRail (Plan 05 Wave 3).
//
// Left rail: 4 static categories with icon + label + count badge. Active item
// takes primary accent; hover only on inactive items (No accent on hover — per
// 09-UI-SPEC §Color "Forbidden"). The `categoryGroup` map is the
// source of truth for which backend Categories each UI bucket surfaces; per
// BLOCKER 4 REVISION, `'claudeMd'` is grouped under CONFIGURATION so the
// CLAUDE.md rows emitted by the Plan 02 parser are reachable in the UI.

import { Bot, Boxes, FileCode2, Settings2 } from 'lucide-react';
import type { Category } from '../../bindings';

export type UiCategory = 'skill' | 'agent' | 'plugin' | 'configuration';

export interface CategoryRailProps {
  active: UiCategory;
  onChange: (c: UiCategory) => void;
  counts: Record<UiCategory, number>;
}

const items: { key: UiCategory; label: string; icon: typeof FileCode2 }[] = [
  { key: 'skill', label: 'SKILLS', icon: FileCode2 },
  { key: 'agent', label: 'AGENTS', icon: Bot },
  { key: 'plugin', label: 'PLUGINS', icon: Boxes },
  { key: 'configuration', label: 'CONFIGURATION', icon: Settings2 },
];

export function CategoryRail({ active, onChange, counts }: CategoryRailProps) {
  return (
    <nav aria-label="Categories" className="flex flex-col py-4">
      <span className="px-6 pb-2 font-headline text-[10px] tracking-widest uppercase text-on-surface-variant">
        CATEGORIES
      </span>
      {items.map(({ key, label, icon: Icon }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-current={isActive}
            className={`flex items-center gap-3 h-11 px-6 text-left transition-colors duration-150 ${
              isActive
                ? 'text-primary bg-surface-container'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
            }`}
          >
            <Icon size={20} strokeWidth={1.5} />
            <span className="font-headline text-sm font-bold tracking-widest uppercase">
              {label}
            </span>
            <span className="ml-auto font-mono text-[10px] tracking-widest text-on-surface-variant">
              {counts[key]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Map a CategoryRail key to the Resource categories it represents.
 *
 * PER BLOCKER 4 REVISION: `'claudeMd'` is grouped under CONFIGURATION so that
 * Category::ClaudeMd rows (emitted by parse_claude_md in Plan 02) are
 * reachable from the UI. Without this, the category is unreachable and D-13's
 * editable CLAUDE.md files never surface in ARSENAL.
 */
export function categoryGroup(ui: UiCategory): Category[] {
  switch (ui) {
    case 'skill':
      return ['skill'];
    case 'agent':
      return ['agent'];
    case 'plugin':
      return ['plugin'];
    case 'configuration':
      return ['hook', 'command', 'settings', 'mcp', 'claudeMd'];
  }
}

export function uiCategoryLabel(c: UiCategory): string {
  switch (c) {
    case 'skill':
      return 'SKILLS';
    case 'agent':
      return 'AGENTS';
    case 'plugin':
      return 'PLUGINS';
    case 'configuration':
      return 'CONFIGURATION';
  }
}
