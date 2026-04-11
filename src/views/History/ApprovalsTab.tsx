// Phase 5 Approvals tab -- virtualized approval audit log table.
//
// HIST-03: Displays approval/denial decisions with expandable details.
// Uses TanStack Virtual for efficient rendering.

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, motion } from 'motion/react';
import { useHistoryStore, type ApprovalRecord } from '../../stores/historyStore';
import { StatusBadge } from '../../components/ui/StatusBadge';

type SortField = 'agentId' | 'filePath' | 'status' | 'decidedAt';
type SortDir = 'asc' | 'desc';

function decisionVariant(status: string): 'success' | 'error' | 'tertiary' {
  if (status === 'approved') return 'success';
  if (status === 'denied') return 'error';
  return 'tertiary'; // edited
}

export function ApprovalsTab() {
  const approvalRecords = useHistoryStore((s) => s.approvalRecords);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>('decidedAt');
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
    const sorted = [...approvalRecords];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'agentId':
          cmp = (a.agentId ?? '').localeCompare(b.agentId ?? '');
          break;
        case 'filePath':
          cmp = (a.filePath ?? '').localeCompare(b.filePath ?? '');
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'decidedAt': {
          const aTime = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0;
          const bTime = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0;
          cmp = (isNaN(aTime) ? 0 : aTime) - (isNaN(bTime) ? 0 : bTime);
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [approvalRecords, sortField, sortDir]);

  const expandedRowIdRef = useRef(expandedRowId);
  useEffect(() => { expandedRowIdRef.current = expandedRowId; }, [expandedRowId]);

  const rowVirtualizer = useVirtualizer({
    count: sortedRecords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const record = sortedRecords[index];
      return record && expandedRowIdRef.current === record.id ? 44 + 140 : 44;
    },
    overscan: 10,
  });

  const handleRowClick = useCallback((record: ApprovalRecord) => {
    setExpandedRowId((prev) => {
      const next = prev === record.id ? null : record.id;
      setTimeout(() => rowVirtualizer.measure(), 0);
      return next;
    });
  }, [rowVirtualizer]);

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="flex h-11 items-center border-b border-outline-variant/20 bg-surface-container-low px-4">
        <button onClick={() => toggleSort('agentId')} className="w-[120px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Agent{sortArrow('agentId')}
        </button>
        <button onClick={() => toggleSort('filePath')} className="flex-1 text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          File{sortArrow('filePath')}
        </button>
        <button onClick={() => toggleSort('status')} className="w-[120px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Decision{sortArrow('status')}
        </button>
        <button onClick={() => toggleSort('decidedAt')} className="w-[160px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Decided At{sortArrow('decidedAt')}
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
                  <span className="w-[120px] font-mono text-sm text-on-surface truncate">
                    {record.agentId ?? '-'}
                  </span>
                  <span className="flex-1 font-mono text-sm text-on-surface truncate">
                    {record.filePath ?? '-'}
                  </span>
                  <span className="w-[120px]">
                    <StatusBadge variant={decisionVariant(record.status)}>
                      {record.status.toUpperCase()}
                    </StatusBadge>
                  </span>
                  <span className="w-[160px] font-mono text-sm text-on-surface-variant">
                    {record.resolvedAt ?? '-'}
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
                      <div className="py-3 space-y-2">
                        <div>
                          <span className="font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
                            Request Type
                          </span>
                          <p className="mt-1 font-mono text-xs text-on-surface">{record.requestType}</p>
                        </div>
                        <div>
                          <span className="font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
                            Created At
                          </span>
                          <p className="mt-1 font-mono text-xs text-on-surface-variant">{record.createdAt}</p>
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
