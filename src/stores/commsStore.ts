// Phase 4 Communications Hub Zustand store.
//
// COMM-01: Approval request queue management with real-time updates.
// COMM-02: Approve/deny/ask-more-info/approve-with-edits workflow.
// COMM-06: Edit-mode freeze prevents incoming updates for the request being edited (Pitfall 3).
//
// Phase 10 Plan 06 (D-21): Chat messaging moved to chatStore (Plan 05).
// The Phase 4 messages map / sendMessage / fetchMessages / ChatMessage type
// were removed from this store — all chat goes through `src/stores/chatStore.ts`.
//
// All mutations go through Tauri invoke for backend validation.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ApprovalRequest {
  id: number;
  agentId: string;
  requestType: string;
  filePath: string | null;
  diffContent: string | null;
  status: 'pending' | 'approved' | 'denied' | 'info_requested' | 'abandoned';
  urgency: 'low' | 'medium' | 'high';
  responseNote: string | null;
  editedContent: string | null;
  createdAt: string;
  resolvedAt: string | null;
  // Phase 8: PreToolUse hook context. Existing non-hook rows leave these null.
  toolName: string | null;
  toolInputJson: unknown | null;
  sessionId: string | null;
}

interface CommsStore {
  requests: ApprovalRequest[];
  selectedRequestId: number | null;
  editingRequestId: number | null;
  isLoading: boolean;
  error: string | null;
  // Phase 8: session-scoped always-allow decisions keyed by agent_id -> set of tool_names.
  // Populated when the user ticks "remember for this session" in the approve modal.
  // Plan 05 wires this through to the backend; Plan 02 reads it in /hook.
  sessionAlwaysAllow: Map<string, Set<string>>;
  fetchRequests: () => Promise<void>;
  selectRequest: (id: number | null) => void;
  approveRequest: (id: number, opts?: { alwaysAllowForSession?: boolean }) => Promise<void>;
  denyRequest: (id: number, opts?: { reason?: string }) => Promise<void>;
  askMoreInfo: (id: number, question: string) => Promise<void>;
  approveWithEdits: (
    id: number,
    editedContent: string,
    opts?: { alwaysAllowForSession?: boolean }
  ) => Promise<void>;
  setEditing: (id: number | null) => void;
  subscribeToApprovals: () => Promise<UnlistenFn>;
  pendingCount: () => number;
  selectedRequest: () => ApprovalRequest | undefined;
  clearAlwaysAllowForAgent: (agentId: string) => void;
  reset: () => void;
}

export const useCommsStore = create<CommsStore>((set, get) => ({
  requests: [],
  selectedRequestId: null,
  editingRequestId: null,
  isLoading: false,
  error: null,
  sessionAlwaysAllow: new Map<string, Set<string>>(),

  fetchRequests: async () => {
    try {
      set({ isLoading: true, error: null });
      const requests = await invoke<ApprovalRequest[]>('list_approval_requests');
      set({ requests, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  selectRequest: (id) => {
    set({ selectedRequestId: id });
  },

  approveRequest: async (id, opts) => {
    // Phase 8 Plan 05: wire `alwaysAllowForSession` through to Plan 02 backend
    // command signature. Backend is source of truth (waiter-registry HashSet);
    // the frontend sessionAlwaysAllow Map is an optimistic mirror for UX.
    try {
      await invoke('approve_request', {
        id,
        alwaysAllowForSession: opts?.alwaysAllowForSession ?? false,
      });
      set((s) => {
        const nextRequests = s.requests.map((r) =>
          r.id === id ? { ...r, status: 'approved' as const } : r
        );
        if (opts?.alwaysAllowForSession) {
          const req = s.requests.find((r) => r.id === id);
          if (req && req.toolName) {
            const m = new Map(s.sessionAlwaysAllow);
            const existing = m.get(req.agentId);
            const tools = new Set(existing ?? []);
            tools.add(req.toolName);
            m.set(req.agentId, tools);
            return { requests: nextRequests, sessionAlwaysAllow: m };
          }
        }
        return { requests: nextRequests };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  denyRequest: async (id, opts) => {
    try {
      await invoke('deny_request', { id, reason: opts?.reason ?? null });
      set((s) => ({
        requests: s.requests.map((r) =>
          r.id === id ? { ...r, status: 'denied' as const } : r
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  askMoreInfo: async (id, question) => {
    try {
      await invoke('ask_more_info', { id, question });
      set((s) => ({
        requests: s.requests.map((r) =>
          r.id === id ? { ...r, status: 'info_requested' as const } : r
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  approveWithEdits: async (id, editedContent, opts) => {
    try {
      await invoke('approve_with_edits', {
        id,
        editedContent,
        alwaysAllowForSession: opts?.alwaysAllowForSession ?? false,
      });
      set((s) => {
        const nextRequests = s.requests.map((r) =>
          r.id === id ? { ...r, status: 'approved' as const, editedContent } : r
        );
        if (opts?.alwaysAllowForSession) {
          const req = s.requests.find((r) => r.id === id);
          if (req && req.toolName) {
            const m = new Map(s.sessionAlwaysAllow);
            const existing = m.get(req.agentId);
            const tools = new Set(existing ?? []);
            tools.add(req.toolName);
            m.set(req.agentId, tools);
            return { requests: nextRequests, sessionAlwaysAllow: m };
          }
        }
        return { requests: nextRequests };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearAlwaysAllowForAgent: (agentId) =>
    set((s) => {
      const m = new Map(s.sessionAlwaysAllow);
      m.delete(agentId);
      return { sessionAlwaysAllow: m };
    }),

  setEditing: (id) => {
    set({ editingRequestId: id });
  },

  subscribeToApprovals: async () => {
    // WR-04: Listen to all three approval events for real-time state sync.
    // Previously only listened to 'approval-request-created', missing
    // approve/deny/info updates from the backend.
    const [unCreated, unResolved, unUpdated] = await Promise.all([
      listen<ApprovalRequest>('approval-request-created', (event) => {
        const { editingRequestId, requests } = get();
        // If the incoming request matches the one being edited, skip the update (freeze)
        if (editingRequestId !== null && event.payload.id === editingRequestId) {
          return;
        }
        // Check if request already exists (update) or is new (add)
        const existing = requests.find((r) => r.id === event.payload.id);
        if (existing) {
          set((s) => ({
            requests: s.requests.map((r) =>
              r.id === event.payload.id ? event.payload : r
            ),
          }));
        } else {
          set((s) => ({
            requests: [...s.requests, event.payload],
          }));
        }
      }),
      listen<number>('approval-resolved', () => {
        get().fetchRequests();
      }),
      listen<number>('approval-updated', () => {
        get().fetchRequests();
      }),
    ]);
    return () => { unCreated(); unResolved(); unUpdated(); };
  },

  pendingCount: () => get().requests.filter((r) => r.status === 'pending').length,

  selectedRequest: () => {
    const { requests, selectedRequestId } = get();
    return requests.find((r) => r.id === selectedRequestId);
  },

  reset: () =>
    set({
      requests: [],
      selectedRequestId: null,
      editingRequestId: null,
      isLoading: false,
      error: null,
      sessionAlwaysAllow: new Map<string, Set<string>>(),
    }),
}));
