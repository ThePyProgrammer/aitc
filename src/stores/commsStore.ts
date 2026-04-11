// Phase 4 Communications Hub Zustand store.
//
// COMM-01: Approval request queue management with real-time updates.
// COMM-02: Approve/deny/ask-more-info/approve-with-edits workflow.
// COMM-03: Chat messaging to agents.
// COMM-06: Edit-mode freeze prevents incoming updates for the request being edited (Pitfall 3).
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
  status: 'pending' | 'approved' | 'denied' | 'info_requested';
  urgency: 'low' | 'medium' | 'high';
  responseNote: string | null;
  editedContent: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ChatMessage {
  id: number;
  agentId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  deliveryStatus: 'delivered' | 'queued' | 'unsupported';
  approvalRequestId: number | null;
  createdAt: string;
}

interface CommsStore {
  requests: ApprovalRequest[];
  selectedRequestId: number | null;
  editingRequestId: number | null;
  messages: Record<string, ChatMessage[]>;
  isLoading: boolean;
  error: string | null;
  fetchRequests: () => Promise<void>;
  selectRequest: (id: number | null) => void;
  approveRequest: (id: number) => Promise<void>;
  denyRequest: (id: number) => Promise<void>;
  askMoreInfo: (id: number, question: string) => Promise<void>;
  approveWithEdits: (id: number, editedContent: string) => Promise<void>;
  setEditing: (id: number | null) => void;
  sendMessage: (agentId: string, content: string) => Promise<void>;
  fetchMessages: (agentId: string) => Promise<void>;
  subscribeToApprovals: () => Promise<UnlistenFn>;
  pendingCount: () => number;
  selectedRequest: () => ApprovalRequest | undefined;
  reset: () => void;
}

export const useCommsStore = create<CommsStore>((set, get) => ({
  requests: [],
  selectedRequestId: null,
  editingRequestId: null,
  messages: {},
  isLoading: false,
  error: null,

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

  approveRequest: async (id) => {
    try {
      await invoke('approve_request', { id });
      set((s) => ({
        requests: s.requests.map((r) =>
          r.id === id ? { ...r, status: 'approved' as const } : r
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  denyRequest: async (id) => {
    try {
      await invoke('deny_request', { id });
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

  approveWithEdits: async (id, editedContent) => {
    try {
      await invoke('approve_with_edits', { id, editedContent });
      set((s) => ({
        requests: s.requests.map((r) =>
          r.id === id ? { ...r, status: 'approved' as const, editedContent } : r
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setEditing: (id) => {
    set({ editingRequestId: id });
  },

  sendMessage: async (agentId, content) => {
    try {
      const message = await invoke<ChatMessage>('send_chat_message', { agentId, content });
      set((s) => ({
        messages: {
          ...s.messages,
          [agentId]: [...(s.messages[agentId] || []), message],
        },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchMessages: async (agentId) => {
    try {
      const messages = await invoke<ChatMessage[]>('list_chat_messages', { agentId });
      set((s) => ({
        messages: { ...s.messages, [agentId]: messages },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
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
      messages: {},
      isLoading: false,
      error: null,
    }),
}));
