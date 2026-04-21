// Phase 9 ARSENAL — ArsenalView (Plan 05 Wave 3).
//
// View root for /arsenal. Mounts useClaudeResourcesChannel on activeRepo,
// owns local selection/filter state, computes D-03 shadow suppression in the
// combined scope, and composes ScopeTabs / CategoryRail / ResourceList /
// DetailPanel inside MasterDetailShell.
//
// Keyboard contract per 09-UI-SPEC §Interaction Contract:
//   /          focus the filter input (when nothing else is typing)
//   ↑ ↓        move selection in the resource list
//   Esc        clear filter / blur editor / trigger Discard
//   Ctrl/⌘+S   save CLAUDE.md
//
// BLOCKER 3 REVISION: `activeRepo` from RepoSessionProvider is threaded as the
// `cwd` prop through DetailPanel → ClaudeMdEditor, so the readClaudeMd /
// writeClaudeMd commands receive the same cwd the Rust is_editable check was
// computed with.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useClaudeResourcesChannel } from '../../hooks/useClaudeResourcesChannel';
import { useClaudeResourcesStore } from '../../stores/claudeResourcesStore';
import { useRepoStore } from '../../stores/repoStore';
import { MasterDetailShell } from '../../components/layout/MasterDetailShell';
import { ScopeTabs, type ScopeTab } from './ScopeTabs';
import { CategoryRail, categoryGroup, type UiCategory } from './CategoryRail';
import { ResourceList } from './ResourceList';
import { DetailPanel } from './DetailPanel';
import type { Resource } from '../../bindings';

/** D-03: suppress a GLOBAL resource if a PROJECT resource of the same
 * (category, name) exists. Used when activeScope === 'combined'. */
function shadowSuppress(
  r: Resource,
  all: Record<string, Resource>,
): boolean {
  if (r.scope === 'project') return true;
  for (const other of Object.values(all)) {
    if (
      other.scope === 'project' &&
      other.category === r.category &&
      other.name === r.name
    ) {
      return false;
    }
  }
  return true;
}

export function ArsenalView() {
  const { start, stop } = useClaudeResourcesChannel();
  const activeRepo = useRepoStore((s) => s.activeRepo);
  const resources = useClaudeResourcesStore((s) => s.resourcesById);

  const [activeCategory, setActiveCategory] = useState<UiCategory>('skill');
  const [activeScope, setActiveScope] = useState<ScopeTab>('combined');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filterInputRef = useRef<HTMLInputElement>(null);

  // Watcher lifecycle: start on mount/activeRepo change; stop on unmount.
  useEffect(() => {
    start(activeRepo).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[ArsenalView] startClaudeResourcesWatch failed:', err);
    });
    return () => {
      stop().catch(() => {
        /* best-effort cleanup */
      });
    };
  }, [activeRepo, start, stop]);

  // Global "/" shortcut: focus the filter input (only when ARSENAL is mounted
  // and nothing else is typing — i.e. activeElement is not a text input/textarea).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      filterInputRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const rows = useMemo(() => {
    const cats = categoryGroup(activeCategory);
    const f = filter.toLowerCase();
    return Object.values(resources)
      .filter((r) => cats.includes(r.category))
      .filter((r) =>
        activeScope === 'combined'
          ? shadowSuppress(r, resources)
          : r.scope === activeScope,
      )
      .filter((r) => {
        if (!f) return true;
        return (
          r.name.toLowerCase().includes(f) ||
          (r.description ?? '').toLowerCase().includes(f)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [resources, activeCategory, activeScope, filter]);

  // Rail counts ignore the filter + scope selector and respect D-03 shadow at
  // category level (combined count = union minus shadowed globals).
  const counts = useMemo<Record<UiCategory, number>>(() => {
    const uiKeys: UiCategory[] = ['skill', 'agent', 'plugin', 'instructions', 'configuration'];
    const result = Object.fromEntries(uiKeys.map((k) => [k, 0])) as Record<UiCategory, number>;
    const perCategoryList = Object.fromEntries(uiKeys.map((k) => [k, [] as Resource[]])) as Record<UiCategory, Resource[]>;
    for (const r of Object.values(resources)) {
      for (const ui of uiKeys) {
        if (categoryGroup(ui).includes(r.category)) {
          perCategoryList[ui].push(r);
          break;
        }
      }
    }
    for (const ui of uiKeys) {
      const list = perCategoryList[ui].filter((r) =>
        shadowSuppress(r, resources),
      );
      result[ui] = list.length;
    }
    return result;
  }, [resources]);

  const allCategoriesEmpty =
    counts.skill === 0 &&
    counts.agent === 0 &&
    counts.plugin === 0 &&
    counts.instructions === 0 &&
    counts.configuration === 0;

  return (
    <main
      className="text-on-surface h-[calc(100vh-56px)]"
      style={{ animation: 'phosphor-in 150ms ease' }}
    >
      <MasterDetailShell
        header={
          <h1 className="font-headline text-sm font-bold tracking-widest uppercase text-on-surface">
            ARSENAL
          </h1>
        }
        tabs={<ScopeTabs active={activeScope} onChange={setActiveScope} />}
        rail={
          <CategoryRail
            active={activeCategory}
            onChange={(c) => {
              setActiveCategory(c);
              setSelectedId(null);
            }}
            counts={counts}
          />
        }
        list={
          <ResourceList
            rows={rows}
            allResources={resources}
            cwd={activeRepo}
            filter={filter}
            onFilterChange={setFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
            activeCategory={activeCategory}
            activeScope={activeScope}
            allCategoriesEmpty={allCategoriesEmpty}
            filterInputRef={filterInputRef}
          />
        }
        detail={<DetailPanel resourceId={selectedId} cwd={activeRepo} />}
      />
    </main>
  );
}
