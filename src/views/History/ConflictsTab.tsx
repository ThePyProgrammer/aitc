// Phase 5 Conflicts tab -- virtualized conflict resolution history table.
//
// HIST-02: Displays resolved conflict records with expandable details.
// Uses TanStack Virtual for efficient rendering.

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, motion } from 'motion/react';
import { useHistoryStore, type ConflictResolutionRecord } from '../../stores/historyStore';
import { StatusBadge } from '../../components/ui/StatusBadge';

type SortField = 'filePath' | 'resolutionType' | 'resolvedAt';
type SortDir = 'asc' | 'desc';

function resolutionVariant(type: string): 'primary' | 'secondary' | 'tertiary' | 'deployed' {
  switch (type) {
    case 'accept_a': return 'primary';
    case 'accept_b': return 'secondary';
    case 'manual': return 'tertiary';
    default: return 'deployed';
  }
}

export function ConflictsTab() {
  const conflictRecords = useHistoryStore((s) => s.conflictRecords);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>('resolvedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const parentRef = useRef<HTMLDivElement>(null);

  const toggleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return field;
    });
  }, []);

  const sortedRecords = useMemo(() => {
    const sorted = [...conflictRecords];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'filePath':
          cmp = a.filePath.localeCompare(b.filePath);
          break;
        case 'resolutionType':
          cmp = a.resolutionType.localeCompare(b.resolutionType);
          break;
        case 'resolvedAt':
          cmp = new Date(a.resolvedAt).getTime() - new Date(b.resolvedAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [conflictRecords, sortField, sortDir]);

  const expandedRowIdRef = useRef(expandedRowId);
  useEffect(() => { expandedRowIdRef.current = expandedRowId; }, [expandedRowId]);

  const rowVirtualizer = useVirtualizer({
    count: sortedRecords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const record = sortedRecords[index];
      return record && expandedRowIdRef.current === record.id ? 44 + 180 : 44;
    },
    overscan: 10,
  });

  const handleRowClick = useCallback((record: ConflictResolutionRecord) => {
    setExpandedRowId((prev) => {
      const next = prev === record.id ? null : record.id;
      setTimeout(() => rowVirtualizer.measure(), 0);
      return next;
    });
  }, [rowVirtualizer]);

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  function parseHunkResolutions(json: string): Array<{ hunkIndex: number; choice: string }> {
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="flex h-11 items-center border-b border-outline-variant/20 bg-surface-container-low px-4">
        <button onClick={() => toggleSort('filePath')} className="flex-1 text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          File{sortArrow('filePath')}
        </button>
        <div className="w-[200px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Agents
        </div>
        <button onClick={() => toggleSort('resolutionType')} className="w-[120px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Resolution{sortArrow('resolutionType')}
        </button>
        <button onClick={() => toggleSort('resolvedAt')} className="w-[160px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Resolved At{sortArrow('resolvedAt')}
        </button>
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const record = sortedRecords[virtualRow.index];
            if (!record) return null;
            const isExpanded = expandedRowId === record.id;
            const hunks = parseHunkResolutions(record.hunkResolutions);

            return (
              <div
                key={record.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <button
                  onClick={() => handleRowClick(record)}
                  className="flex h-11 w-full items-center px-4 text-left transition-colors duration-100 hover:bg-surface-container-high"
                  aria-expanded={isExpanded}
                >
                  <span className="flex-1 font-mono text-sm text-on-surface truncate">
                    {record.filePath}
                  </span>
                  <span className="w-[200px] font-mono text-sm text-on-surface-variant">
                    {record.agentAId} vs {record.agentBId}
                  </span>
                  <span className="w-[120px]">
                    <StatusBadge variant={resolutionVariant(record.resolutionType)}>
                      {record.resolutionType.toUpperCase()}
                    </StatusBadge>
                  </span>
                  <span className="w-[160px] font-mono text-sm text-on-surface-variant">
                    {record.resolvedAt}
                  </span>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="overflow-hidden bg-surface-container-low px-4"
                    >
                      <div className="py-3 space-y-3">
                        <div>
                          <span className="font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
                            Hunk Resolutions
                          </span>
                          {hunks.length === 0 ? (
                            <p className="mt-1 font-mono text-xs text-on-surface-variant">No hunk data available.</p>
                          ) : (
                            <div className="mt-1 space-y-1">
                              {hunks.map((h) => (
                                <div key={h.hunkIndex} className="flex items-center gap-3">
                                  <span className="font-mono text-xs text-on-surface">HUNK_{String(h.hunkIndex).padStart(2, '0')}</span>
                                  <StatusBadge variant={resolutionVariant(h.choice)}>
                                    {h.choice.toUpperCase()}
                                  </StatusBadge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
                            Notification
                          </span>
                          <p className="mt-1 font-mono text-xs text-on-surface-variant">{record.notificationStatus}</p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
