// Phase 5 Sessions tab -- virtualized session history table.
//
// HIST-01: Displays past agent sessions with expandable row details.
// Uses TanStack Virtual for efficient rendering of large session lists.

import { useState, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { useHistoryStore, type SessionRecord } from '../../stores/historyStore';
import { StatusBadge } from '../../components/ui/StatusBadge';

interface SessionFile {
  path: string;
  writeCount: number;
}

type SortField = 'agentId' | 'startedAt' | 'duration' | 'fileCount';
type SortDir = 'asc' | 'desc';

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'Active';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getDurationMs(s: SessionRecord): number {
  if (!s.endedAt) return Date.now() - new Date(s.startedAt).getTime();
  return new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
}

function outcomeVariant(status: string): 'completed' | 'warning' | 'error' {
  if (status === 'completed') return 'completed';
  if (status === 'terminated') return 'warning';
  return 'error';
}

export function SessionsTab() {
  const sessions = useHistoryStore((s) => s.sessions);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<SessionFile[]>([]);
  const [sortField, setSortField] = useState<SortField>('startedAt');
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

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'agentId':
          cmp = a.agentId.localeCompare(b.agentId);
          break;
        case 'startedAt':
          cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
          break;
        case 'duration':
          cmp = getDurationMs(a) - getDurationMs(b);
          break;
        case 'fileCount':
          cmp = a.fileCount - b.fileCount;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [sessions, sortField, sortDir]);

  const rowVirtualizer = useVirtualizer({
    count: sortedSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const session = sortedSessions[index];
      return session && expandedRowId === session.id ? 44 + 220 : 44;
    },
    overscan: 10,
  });

  const handleRowClick = useCallback(async (session: SessionRecord) => {
    if (expandedRowId === session.id) {
      setExpandedRowId(null);
      setExpandedFiles([]);
      return;
    }
    setExpandedRowId(session.id);
    try {
      const files = await invoke<SessionFile[]>('list_session_files', { sessionId: session.id });
      setExpandedFiles(files.slice(0, 10));
    } catch {
      setExpandedFiles([]);
    }
  }, [expandedRowId]);

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="flex h-11 items-center border-b border-outline-variant/20 bg-surface-container-low px-4">
        <button onClick={() => toggleSort('agentId')} className="w-[120px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Agent{sortArrow('agentId')}
        </button>
        <button onClick={() => toggleSort('startedAt')} className="w-[160px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Started{sortArrow('startedAt')}
        </button>
        <button onClick={() => toggleSort('duration')} className="w-[100px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Duration{sortArrow('duration')}
        </button>
        <button onClick={() => toggleSort('fileCount')} className="w-[80px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
          Files{sortArrow('fileCount')}
        </button>
        <div className="w-[120px] text-left font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Outcome
        </div>
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const session = sortedSessions[virtualRow.index];
            if (!session) return null;
            const isExpanded = expandedRowId === session.id;

            return (
              <div
                key={session.id}
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
                  onClick={() => handleRowClick(session)}
                  className="flex h-11 w-full items-center px-4 text-left transition-colors duration-100 hover:bg-surface-container-high"
                  aria-expanded={isExpanded}
                >
                  <span className="w-[120px] font-mono text-sm text-on-surface truncate">
                    {session.agentId}
                  </span>
                  <span className="w-[160px] font-mono text-sm text-on-surface-variant">
                    {session.startedAt}
                  </span>
                  <span className="w-[100px] font-mono text-sm text-on-surface-variant">
                    {formatDuration(session.startedAt, session.endedAt)}
                  </span>
                  <span className="w-[80px] font-mono text-sm text-on-surface-variant">
                    {session.fileCount}
                  </span>
                  <span className="w-[120px]">
                    <StatusBadge variant={outcomeVariant(session.status)}>
                      {session.status.toUpperCase()}
                    </StatusBadge>
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
                      <div className="py-3">
                        <span className="font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
                          Top Files
                        </span>
                        {expandedFiles.length === 0 ? (
                          <p className="mt-2 font-mono text-xs text-on-surface-variant">No file data available.</p>
                        ) : (
                          <div className="mt-2 space-y-1">
                            {expandedFiles.map((f) => (
                              <div key={f.path} className="flex items-center gap-3">
                                <span className="font-mono text-xs text-on-surface truncate flex-1">{f.path}</span>
                                <span className="font-mono text-xs text-on-surface-variant">{f.writeCount} writes</span>
                              </div>
                            ))}
                          </div>
                        )}
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
