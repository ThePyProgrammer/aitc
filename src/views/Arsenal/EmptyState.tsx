// Phase 9 ARSENAL — EmptyState (Plan 05 Wave 3).
//
// Reused by ResourceList + DetailPanel. Matches CommsView empty-state visual
// pattern: blink-cursor bar + headline + body copy. Headlines are frozen
// strings per 09-UI-SPEC §Copywriting Contract → Empty states.

import type { Scope } from '../../bindings';
import type { UiCategory } from './CategoryRail';

export type ScopeKey = Scope | 'combined';

export interface EmptyStateInput {
  category: UiCategory;
  scope: ScopeKey;
  allCategoriesEmpty?: boolean;
}

export interface EmptyStateCopy {
  headline: string;
  body: string;
}

function scopePathFor(scope: ScopeKey): string {
  switch (scope) {
    case 'global':
      return '~/.claude/';
    case 'project':
      return '<cwd>/.claude/';
    case 'combined':
      return '~/.claude/ and <cwd>/.claude/';
  }
}

export function emptyStateFor({
  category,
  scope,
}: EmptyStateInput): EmptyStateCopy {
  // NOTE: `ARSENAL_EMPTY` (combined scope, all categories empty) headline
  // is reserved per UI-SPEC copy inventory — currently the category-specific
  // headline wins so users always see a hint scoped to the category they
  // selected in the rail. Future refinement: surface ARSENAL_EMPTY as a
  // separate banner above the category rail rather than replacing the
  // per-category copy.
  const scopePath = scopePathFor(scope);
  switch (category) {
    case 'skill':
      return {
        headline: 'NO_SKILLS_INSTALLED',
        body: `No SKILL.md files found under ${scopePath}. Skills will appear here when Claude installs them.`,
      };
    case 'agent':
      return {
        headline: 'NO_AGENTS_REGISTERED',
        body: `No agent definitions found under ${scopePath}agents/.`,
      };
    case 'plugin':
      return {
        headline: 'NO_PLUGINS_INSTALLED',
        body: `installed_plugins.json is empty or absent at ${scopePath}.`,
      };
    case 'instructions':
      return {
        headline: 'NO_INSTRUCTION_FILES',
        body: `No CLAUDE.md files found. Create one to give Claude project-specific instructions.`,
      };
    case 'configuration':
      return {
        headline: 'NO_CONFIGURATION',
        body: `No hooks, commands, settings.json, or MCP servers detected in ${scopePath}.`,
      };
  }
}

export function EmptyState({ headline, body }: EmptyStateCopy) {
  return (
    <div
      data-testid="arsenal-empty-state"
      className="flex flex-col items-center justify-center py-16 px-6"
    >
      <div
        className="h-5 w-[2px] bg-secondary"
        style={{ animation: 'blink-cursor 1s step-end infinite' }}
      />
      <p className="mt-4 font-headline text-sm font-bold uppercase tracking-widest text-on-surface text-center">
        {headline}
      </p>
      <p className="mt-2 font-mono text-xs text-on-surface-variant/60 text-center max-w-[420px]">
        {body}
      </p>
    </div>
  );
}
