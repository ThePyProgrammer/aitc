// Phase 5 History view -- 5th sidebar view with tabbed tables.
//
// HIST-04: Main layout with Sessions, Conflicts, Approvals tabs.
// Fetches data on mount and tab switch via useHistoryStore.

import { useEffect } from 'react';
import { useHistoryStore } from '../stores/historyStore';
import { SessionsTab } from './History/SessionsTab';
import { ConflictsTab } from './History/ConflictsTab';
import { ApprovalsTab } from './History/ApprovalsTab';

const tabs = ['sessions', 'conflicts', 'approvals'] as const;
const tabLabels: Record<(typeof tabs)[number], string> = {
  sessions: 'SESSIONS',
  conflicts: 'CONFLICTS',
  approvals: 'APPROVALS',
};

export function HistoryView() {
  const activeTab = useHistoryStore((s) => s.activeTab);
  const setTab = useHistoryStore((s) => s.setTab);
  const fetchSessions = useHistoryStore((s) => s.fetchSessions);
  const fetchConflicts = useHistoryStore((s) => s.fetchConflicts);
  const fetchApprovals = useHistoryStore((s) => s.fetchApprovals);
  const loading = useHistoryStore((s) => s.loading);
  const sessions = useHistoryStore((s) => s.sessions);
  const conflictRecords = useHistoryStore((s) => s.conflictRecords);
  const approvalRecords = useHistoryStore((s) => s.approvalRecords);
  const filters = useHistoryStore((s) => s.filters);
  const setFilter = useHistoryStore((s) => s.setFilter);

  // Fetch data on mount and tab switch
  useEffect(() => {
    switch (activeTab) {
      case 'sessions':
        fetchSessions();
        break;
      case 'conflicts':
        fetchConflicts();
        break;
      case 'approvals':
        fetchApprovals();
        break;
    }
  }, [activeTab, fetchSessions, fetchConflicts, fetchApprovals]);

  const hasData =
    (activeTab === 'sessions' && sessions.length > 0) ||
    (activeTab === 'conflicts' && conflictRecords.length > 0) ||
    (activeTab === 'approvals' && approvalRecords.length > 0);

  // Collect unique agent IDs from current tab data
  const agentIds = (() => {
    const ids = new Set<string>();
    if (activeTab === 'sessions') {
      sessions.forEach((s) => ids.add(s.agentId));
    } else if (activeTab === 'conflicts') {
      conflictRecords.forEach((r) => { ids.add(r.agentAId); ids.add(r.agentBId); });
    } else {
      approvalRecords.forEach((r) => { if (r.agentId) ids.add(r.agentId); });
    }
    return [...ids].sort();
  })();

  return (
    <div
      className="flex flex-col h-[calc(100vh-56px)] bg-surface"
      style={{ animation: 'phosphor-in 150ms ease' }}
    >
      {/* Header */}
      <div className="px-6 pt-4 pb-0">
        <h1 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface">
          HISTORY
        </h1>
      </div>

      {/* Tab bar */}
      <div className="flex h-11 items-end gap-0 px-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`px-4 pb-2 font-headline text-[11px] uppercase tracking-widest transition-colors duration-150 ${
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'border-b-2 border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex h-12 items-center gap-3 px-6 bg-surface-container-low">
        {/* Agent filter */}
        <select
          value={filters.agentId ?? ''}
          onChange={(e) => setFilter('agentId', e.target.value || null)}
          className="h-8 bg-surface-container text-on-surface font-mono text-xs px-2 border border-outline-variant/20 focus:outline-none focus:border-primary"
        >
          <option value="">All Agents</option>
          {agentIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value || null)}
          className="h-8 bg-surface-container text-on-surface font-mono text-xs px-2 border border-outline-variant/20 focus:outline-none focus:border-primary"
        >
          <option value="">All Statuses</option>
          {activeTab === 'sessions' && (
            <>
              <option value="completed">Completed</option>
              <option value="terminated">Terminated</option>
              <option value="error">Error</option>
            </>
          )}
          {activeTab === 'conflicts' && (
            <>
              <option value="accept_a">Accept A</option>
              <option value="accept_b">Accept B</option>
              <option value="manual">Manual</option>
              <option value="mixed">Mixed</option>
            </>
          )}
          {activeTab === 'approvals' && (
            <>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="edited">Edited</option>
            </>
          )}
        </select>
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col min-h-0">
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <span className="font-mono text-xs text-on-surface-variant animate-pulse">Loading...</span>
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2">
            <span className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
              NO_RECORDS_FOUND
            </span>
            <p className="font-mono text-xs text-on-surface-variant max-w-md text-center">
              No session, conflict, or approval records match your filters. Adjust filters or wait for agent activity.
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'sessions' && <SessionsTab />}
            {activeTab === 'conflicts' && <ConflictsTab />}
            {activeTab === 'approvals' && <ApprovalsTab />}
          </>
        )}
      </div>
    </div>
  );
}
