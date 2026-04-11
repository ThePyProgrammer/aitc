// Phase 5 history Zustand store.
//
// HIST-04: Frontend store for session history, conflict resolutions,
// and approval records. Fetches data from Tauri backend via invoke().

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface SessionRecord {
  id: number;
  agentId: string;
  agentType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  fileCount: number;
}

export interface ConflictResolutionRecord {
  id: number;
  conflictEventId: number | null;
  filePath: string;
  agentAId: string;
  agentBId: string;
  resolutionType: string;
  hunkResolutions: string;
  notificationStatus: string;
  resolvedAt: string;
}

export interface ApprovalRecord {
  id: number;
  sessionId: number | null;
  requestType: string;
  filePath: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  agentId: string | null;
}

export interface HistoryFilters {
  dateRange: [string, string] | null;
  agentId: string | null;
  status: string | null;
}

interface HistoryStore {
  activeTab: 'sessions' | 'conflicts' | 'approvals';
  sessions: SessionRecord[];
  conflictRecords: ConflictResolutionRecord[];
  approvalRecords: ApprovalRecord[];
  filters: HistoryFilters;
  loading: boolean;

  setTab: (tab: 'sessions' | 'conflicts' | 'approvals') => void;
  fetchSessions: () => Promise<void>;
  fetchConflicts: () => Promise<void>;
  fetchApprovals: () => Promise<void>;
  setFilter: <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => void;
  reset: () => void;
}

const DEFAULT_FILTERS: HistoryFilters = {
  dateRange: null,
  agentId: null,
  status: null,
};

export const useHistoryStore = create<HistoryStore>((set) => ({
  activeTab: 'sessions',
  sessions: [],
  conflictRecords: [],
  approvalRecords: [],
  filters: { ...DEFAULT_FILTERS },
  loading: false,

  setTab: (tab) => set({ activeTab: tab }),

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const sessions = await invoke<SessionRecord[]>('list_sessions');
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchConflicts: async () => {
    set({ loading: true });
    try {
      const conflictRecords = await invoke<ConflictResolutionRecord[]>('list_conflict_resolutions');
      set({ conflictRecords, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchApprovals: async () => {
    set({ loading: true });
    try {
      const approvalRecords = await invoke<ApprovalRecord[]>('list_approval_history');
      set({ approvalRecords, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),

  reset: () =>
    set({
      activeTab: 'sessions',
      sessions: [],
      conflictRecords: [],
      approvalRecords: [],
      filters: { ...DEFAULT_FILTERS },
      loading: false,
    }),
}));
