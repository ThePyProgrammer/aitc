// Phase 10: chatStore — per-agent agent_events arrays + live subscription.
//
// Mirrors the commsStore / claudeResourcesStore pattern (store-per-domain
// Zustand, D-24). Wave 0 (Plan 01) provides the interface + skeleton bodies
// so downstream plans can import it; Plan 05 fleshes out the UI bindings.
//
// All mutations ultimately route through Rust commands (WR-03 —
// backend-authoritative writes). The Tauri event subscription fan-out is
// modelled verbatim on commsStore.subscribeToApprovals.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface AgentEvent {
  id: number;
  agentId: string;
  sessionId: string | null;
  eventType: string;
  payloadJson: unknown;
  approvalRequestId: number | null;
  sequenceNumber: number | null;
  createdAt: string;
  deliveryStatus: 'queued' | 'delivered' | 'consumed' | 'unsupported' | null;
}

export interface ChatChannel {
  agentId: string;
  adapterType: string;
  status: string;
  archived: boolean;
  chatDuplex: boolean;
  lastEvent: AgentEvent | null;
  unreadCount: number;
  currentSessionId: string | null;
}

export interface DeliveryUpdate {
  eventId: number;
  status: 'queued' | 'delivered' | 'consumed' | 'unsupported';
}

export interface ChatStore {
  eventsByAgent: Record<string, AgentEvent[]>;
  channels: ChatChannel[];
  selectedAgentId: string | null;
  unreadByAgent: Record<string, number>;
  archivedCollapsed: boolean;
  isLoading: boolean;
  error: string | null;
  fetchChannels: () => Promise<void>;
  loadInitialEvents: (agentId: string) => Promise<void>;
  loadOlder: (agentId: string) => Promise<void>;
  selectAgent: (id: string | null) => void;
  sendMessage: (agentId: string, content: string) => Promise<void>;
  clearThread: (agentId: string) => Promise<void>;
  markRead: (agentId: string) => Promise<void>;
  setArchivedCollapsed: (collapsed: boolean) => void;
  subscribeToChat: () => Promise<UnlistenFn>;
  totalUnread: () => number;
  reset: () => void;
}

const INITIAL_LIMIT = 50;

export const useChatStore = create<ChatStore>((set, get) => ({
  eventsByAgent: {},
  channels: [],
  selectedAgentId: null,
  unreadByAgent: {},
  archivedCollapsed: true,
  isLoading: false,
  error: null,

  fetchChannels: async () => {
    try {
      set({ isLoading: true, error: null });
      const channels = await invoke<ChatChannel[]>('list_chat_channels');
      set({ channels, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false, channels: [] });
    }
  },

  loadInitialEvents: async (agentId) => {
    try {
      const events = await invoke<AgentEvent[]>('list_agent_events', {
        agentId,
        beforeId: null,
        limit: INITIAL_LIMIT,
      });
      set((s) => ({
        eventsByAgent: { ...s.eventsByAgent, [agentId]: events },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadOlder: async (agentId) => {
    try {
      const existing = get().eventsByAgent[agentId] ?? [];
      const earliestId = existing.length > 0 ? existing[0].id : null;
      const older = await invoke<AgentEvent[]>('list_agent_events', {
        agentId,
        beforeId: earliestId,
        limit: INITIAL_LIMIT,
      });
      if (older.length === 0) return;
      set((s) => ({
        eventsByAgent: {
          ...s.eventsByAgent,
          [agentId]: [...older, ...(s.eventsByAgent[agentId] ?? [])],
        },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectAgent: (id) => {
    set({ selectedAgentId: id });
    if (id !== null) {
      // Fire-and-forget markRead side-effect.
      void get().markRead(id);
    }
  },

  sendMessage: async (agentId, content) => {
    try {
      const event = await invoke<AgentEvent>('send_chat_message_to_agent', {
        agentId,
        content,
      });
      set((s) => ({
        eventsByAgent: {
          ...s.eventsByAgent,
          [agentId]: [...(s.eventsByAgent[agentId] ?? []), event],
        },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearThread: async (agentId) => {
    try {
      await invoke('clear_agent_thread', { agentId });
      set((s) => ({
        eventsByAgent: { ...s.eventsByAgent, [agentId]: [] },
        unreadByAgent: { ...s.unreadByAgent, [agentId]: 0 },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  markRead: async (agentId) => {
    try {
      await invoke('mark_agent_events_read', { agentId });
      set((s) => ({
        unreadByAgent: { ...s.unreadByAgent, [agentId]: 0 },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setArchivedCollapsed: (collapsed) => {
    set({ archivedCollapsed: collapsed });
  },

  subscribeToChat: async () => {
    const unlisteners: UnlistenFn[] = [];

    const un1 = await listen<AgentEvent>('agent-event-appended', (ev) => {
      const { agentId } = ev.payload;
      const state = get();
      const focused =
        typeof document !== 'undefined' && document.visibilityState === 'visible';
      const selected = state.selectedAgentId === agentId && focused;
      set((s) => ({
        eventsByAgent: {
          ...s.eventsByAgent,
          [agentId]: [...(s.eventsByAgent[agentId] ?? []), ev.payload],
        },
        unreadByAgent: selected
          ? s.unreadByAgent
          : { ...s.unreadByAgent, [agentId]: (s.unreadByAgent[agentId] ?? 0) + 1 },
      }));
    });
    unlisteners.push(un1);

    const un2 = await listen<{ agentId: string }>('agent-turn-started', () => {
      // Plan 05 will flip a per-agent "streaming" UI flag. Wave 0 no-op.
    });
    unlisteners.push(un2);

    const un3 = await listen<{ agentId: string }>('agent-turn-complete', () => {
      // Plan 05 clears the streaming flag. Wave 0 no-op.
    });
    unlisteners.push(un3);

    const un4 = await listen<{ agentId: string; sessionId: string }>(
      'agent-session-started',
      () => {
        void get().fetchChannels();
      },
    );
    unlisteners.push(un4);

    const un5 = await listen<{ agentId: string; reason: string }>(
      'agent-session-ended',
      () => {
        void get().fetchChannels();
      },
    );
    unlisteners.push(un5);

    const un6 = await listen<DeliveryUpdate>('agent-delivery-updated', (ev) => {
      const { eventId, status } = ev.payload;
      set((s) => {
        const next: Record<string, AgentEvent[]> = { ...s.eventsByAgent };
        for (const agentId of Object.keys(next)) {
          const events = next[agentId];
          const idx = events.findIndex((e) => e.id === eventId);
          if (idx !== -1) {
            const copy = events.slice();
            copy[idx] = { ...copy[idx], deliveryStatus: status };
            next[agentId] = copy;
          }
        }
        return { eventsByAgent: next };
      });
    });
    unlisteners.push(un6);

    return () => {
      for (const un of unlisteners) un();
    };
  },

  totalUnread: () => {
    const counts = Object.values(get().unreadByAgent);
    return counts.reduce((a, b) => a + b, 0);
  },

  reset: () =>
    set({
      eventsByAgent: {},
      channels: [],
      selectedAgentId: null,
      unreadByAgent: {},
      archivedCollapsed: true,
      isLoading: false,
      error: null,
    }),
}));
