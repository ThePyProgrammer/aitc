// Phase 9 ARSENAL — ResourceList (Plan 05 Wave 3).
//
// Center column of the master/detail: filter input + virtualized rows (TanStack
// Virtual, estimateSize 56 per 09-UI-SPEC). Owns ↑/↓ keyboard navigation within
// the listbox; the parent owns the `/` global shortcut to focus the filter.

import { useEffect, useRef, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Resource } from '../../bindings';
import { ResourceRow } from './ResourceRow';
import {
  EmptyState,
  emptyStateFor,
  type ScopeKey,
} from './EmptyState';
import { uiCategoryLabel, type UiCategory } from './CategoryRail';
import { CreateClaudeMdPrompt } from './CreateClaudeMdPrompt';

export interface ResourceListProps {
  rows: Resource[];
  allResources: Record<string, Resource>;
  cwd: string | null;
  filter: string;
  onFilterChange: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  activeCategory: UiCategory;
  activeScope: ScopeKey;
  allCategoriesEmpty: boolean;
  filterInputRef?: RefObject<HTMLInputElement | null>;
}

export function ResourceList({
  rows,
  allResources,
  cwd,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  activeCategory,
  activeScope,
  allCategoriesEmpty,
  filterInputRef,
}: ResourceListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 6,
  });

  const placeholder = `Filter ${uiCategoryLabel(activeCategory).toLowerCase()}…`;

  // ↑/↓ keyboard nav on the list container.
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
    let nextIdx: number;
    if (e.key === 'ArrowDown') {
      nextIdx = idx < 0 ? 0 : (idx + 1) % rows.length;
    } else {
      nextIdx = idx <= 0 ? rows.length - 1 : idx - 1;
    }
    onSelect(rows[nextIdx].id);
  };

  // Esc in filter clears filter and restores focus to the list.
  const handleFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onFilterChange('');
      (e.currentTarget as HTMLInputElement).blur();
    }
  };

  // If the currently-selected row disappears from the filtered view, drop
  // selection so the detail panel does not reference a hidden row.
  useEffect(() => {
    if (!selectedId) return;
    if (!rows.some((r) => r.id === selectedId)) {
      onSelect(null);
    }
  }, [rows, selectedId, onSelect]);

  return (
    <>
      <div className="h-12 px-6 flex items-center bg-surface">
        <input
          ref={filterInputRef}
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          onKeyDown={handleFilterKeyDown}
          placeholder={placeholder}
          aria-label="Filter resources"
          data-testid="arsenal-filter-input"
          className="w-full bg-transparent font-mono text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none"
        />
      </div>
      {/* 1px divider below filter row, per No-Line rule use a bg div, not border */}
      <div className="h-px bg-outline-variant/20" />
      {rows.length === 0 ? (
        <div className="flex-1 overflow-auto">
          <EmptyState
            {...emptyStateFor({
              category: activeCategory,
              scope: activeScope,
              allCategoriesEmpty,
            })}
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="listbox"
          aria-label="Resource list"
          aria-activedescendant={selectedId ?? undefined}
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          data-testid="arsenal-resource-listbox"
          className="flex-1 overflow-auto focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={row.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vi.size}px`,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ResourceRow
                    resource={row}
                    selected={row.id === selectedId}
                    onClick={() => onSelect(row.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {activeCategory === 'instructions' && (
        <CreateClaudeMdPrompt
          cwd={cwd}
          resources={Object.values(allResources)}
        />
      )}
    </>
  );
}
