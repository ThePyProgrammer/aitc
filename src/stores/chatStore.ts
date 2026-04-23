// Phase 10: chatStore — per-agent agent_events arrays + live subscription.
//
// Mirrors the commsStore / claudeResourcesStore pattern (store-per-domain
// Zustand, D-24). Subscribes to nine Tauri events emitted by the Phase 10
// backend (Plans 02 + 04):
//   agent-event-appended, agent-turn-started, agent-turn-complete,
//   agent-session-started, agent-session-ended, agent-delivery-updated,
//   agent-thread-cleared, agent-events-marked-read, agent-session-resumed.
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

export interface TurnCompletePayload {
  agentId: string;
  sessionId?: string | null;
  terminalReason: string;
  isError: boolean;
}

export interface SessionEndedPayload {
  agentId: string;
  sessionId: string | null;
  reason: string;
  exitCode: number | null;
}

export interface ChatStore {
  eventsByAgent: Record<string, AgentEvent[]>;
  // Phase 19 gap closure (D-01 follow-up) — progressive-reveal buffer.
  // The aggregator coalesces a turn into a single assistant_text DB row at
  // TurnComplete (D-01.2), so the UI loses per-delta visibility unless it
  // listens to the `agent-assistant-delta` Tauri emit. We accumulate the
  // per-agent streaming text here; ChatTranscript renders it as a synthetic
  // trailing row until the authoritative assistant_text event lands.
  streamingByAgent: Record<string, string>;
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
  streamingByAgent: {},
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
      // Backend returns newest-first; UI stores oldest→newest so the
      // ChatTranscript can render bottom-up with TanStack Virtual.
      const oldestFirst = [...events].reverse();
      set((s) => ({
        eventsByAgent: { ...s.eventsByAgent, [agentId]: oldestFirst },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadOlder: async (agentId) => {
    const current = get().eventsByAgent[agentId] ?? [];
    const beforeId = current.length > 0 ? current[0].id : null;
    if (beforeId == null) return;
    try {
      const older = await invoke<AgentEvent[]>('list_agent_events', {
        agentId,
        beforeId,
        limit: INITIAL_LIMIT,
      });
      if (older.length === 0) return;
      const oldestFirst = [...older].reverse();
      set((s) => ({
        eventsByAgent: {
          ...s.eventsByAgent,
          [agentId]: [...oldestFirst, ...(s.eventsByAgent[agentId] ?? [])],
        },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectAgent: (id) => {
    set({ selectedAgentId: id });
    if (id !== null) {
      // Fire-and-forget history fetch when this agent's events haven't been
      // loaded yet. Post-load the live subscription keeps the array fresh, so
      // re-selecting the same agent is a no-op on the DB. Latent bug from
      // Phase 10 Plan 06 — channels populated via list_chat_channels but
      // agent_events rows never pulled into the store on select.
      if (get().eventsByAgent[id] === undefined) {
        void get().loadInitialEvents(id);
      }
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
      set((s) => {
        const existing = s.eventsByAgent[agentId] ?? [];
        // Dedupe: the agent-event-appended listener can race ahead of the
        // invoke resolution and already have inserted this id.
        if (existing.some((e) => e.id === event.id)) return s;
        return {
          eventsByAgent: {
            ...s.eventsByAgent,
            [agentId]: [...existing, event],
          },
        };
      });
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
    const [
      un1,
      un2,
      un3,
      un4,
      un5,
      un6,
      un7,
      un8,
      un9,
      un10,
    ] = await Promise.all([
      // 1. agent-event-appended — append to agent array, dedupe by id,
      //    increment unread only when agent is NOT selected-and-visible.
      //    When an assistant_text row lands, also clear the streaming buffer
      //    (D-01 final row is authoritative; drop the synthetic stream).
      listen<AgentEvent>('agent-event-appended', (ev) => {
        const payload = ev.payload;
        const state = get();
        const existing = state.eventsByAgent[payload.agentId] ?? [];
        if (existing.some((e) => e.id === payload.id)) return;
        const focused =
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible';
        const active = state.selectedAgentId === payload.agentId && focused;
        const nextStreaming = { ...state.streamingByAgent };
        if (payload.eventType === 'assistant_text') {
          delete nextStreaming[payload.agentId];
        }
        set({
          eventsByAgent: {
            ...state.eventsByAgent,
            [payload.agentId]: [...existing, payload],
          },
          streamingByAgent: nextStreaming,
          unreadByAgent: active
            ? state.unreadByAgent
            : {
                ...state.unreadByAgent,
                [payload.agentId]:
                  (state.unreadByAgent[payload.agentId] ?? 0) + 1,
              },
        });
      }),

      // 2. agent-turn-started — Plan 05 no-op (the per-event streaming flag
      //    is carried on the assistant_text payload itself; Plan 02 aggregator
      //    emits agent-event-appended with streaming:true as needed).
      listen<{ agentId: string; sessionId?: string | null }>(
        'agent-turn-started',
        () => {
          /* no-op */
        },
      ),

      // 3. agent-turn-complete — iterate backwards to flip the last
      //    streaming assistant_text to streaming:false AND the last
      //    delivered user_text to deliveryStatus:'consumed'.
      listen<TurnCompletePayload>('agent-turn-complete', (ev) => {
        const agentId = ev.payload.agentId;
        // Safety net — clear any lingering streaming buffer for this agent
        // even on tool-only turns that never produce an assistant_text row
        // (the event-appended listener won't run for those).
        set((s) => {
          if (s.streamingByAgent[agentId] === undefined) return s;
          const next = { ...s.streamingByAgent };
          delete next[agentId];
          return { streamingByAgent: next };
        });
        set((s) => {
          const arr = s.eventsByAgent[agentId];
          if (!arr || arr.length === 0) return s;
          let flippedStreaming = false;
          let flippedConsumed = false;
          // Walk the array in reverse so we only flip the most recent
          // streaming assistant_text / delivered user_text.
          const next = arr.slice();
          for (let i = next.length - 1; i >= 0; i--) {
            const e = next[i];
            if (
              !flippedStreaming &&
              e.eventType === 'assistant_text' &&
              (e.payloadJson as { streaming?: boolean } | null)?.streaming ===
                true
            ) {
              next[i] = {
                ...e,
                payloadJson: {
                  ...((e.payloadJson as object) ?? {}),
                  streaming: false,
                },
              };
              flippedStreaming = true;
            }
            if (
              !flippedConsumed &&
              e.eventType === 'user_text' &&
              e.deliveryStatus === 'delivered'
            ) {
              next[i] = { ...next[i], deliveryStatus: 'consumed' as const };
              flippedConsumed = true;
            }
            if (flippedStreaming && flippedConsumed) break;
          }
          return {
            eventsByAgent: { ...s.eventsByAgent, [agentId]: next },
          };
        });
      }),

      // 4. agent-session-started — backend aggregator already inserts a
      //    session_boundary row via agent-event-appended. Re-fetch channels
      //    so the master list picks up currentSessionId.
      listen<{ agentId: string; sessionId: string }>(
        'agent-session-started',
        () => {
          void get().fetchChannels();
        },
      ),

      // 5. agent-session-ended — mark the matching channel archived.
      listen<SessionEndedPayload>('agent-session-ended', (ev) => {
        const agentId = ev.payload.agentId;
        set((s) => ({
          channels: s.channels.map((c) =>
            c.agentId === agentId ? { ...c, archived: true } : c,
          ),
        }));
      }),

      // 6. agent-delivery-updated — propagate across all agents (the eventId
      //    is globally unique in agent_events, but we don't track which
      //    agent owns it).
      listen<DeliveryUpdate>('agent-delivery-updated', (ev) => {
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
      }),

      // 7. agent-thread-cleared — clear local events for that agent
      //    (and drop any mid-stream buffer).
      listen<string>('agent-thread-cleared', (ev) => {
        const agentId = ev.payload;
        set((s) => {
          const nextStreaming = { ...s.streamingByAgent };
          delete nextStreaming[agentId];
          return {
            eventsByAgent: { ...s.eventsByAgent, [agentId]: [] },
            unreadByAgent: { ...s.unreadByAgent, [agentId]: 0 },
            streamingByAgent: nextStreaming,
          };
        });
      }),

      // 8. agent-events-marked-read — backend-initiated read reset
      //    (mirrors local markRead state for defensive convergence).
      listen<string>('agent-events-marked-read', (ev) => {
        const agentId = ev.payload;
        set((s) => ({
          unreadByAgent: { ...s.unreadByAgent, [agentId]: 0 },
        }));
      }),

      // 9. agent-session-resumed (D-04) — un-archive the channel.
      listen<string>('agent-session-resumed', (ev) => {
        const agentId = ev.payload;
        set((s) => ({
          channels: s.channels.map((c) =>
            c.agentId === agentId ? { ...c, archived: false } : c,
          ),
        }));
      }),

      // 10. agent-assistant-delta (Phase 19 gap) — append per-token delta
      //     into the per-agent streaming buffer so ChatTranscript can render
      //     a synthetic trailing row between turn start and TurnComplete.
      //     Cleared in listeners #1 (assistant_text row lands) and #3
      //     (TurnComplete safety net for tool-only turns).
      listen<{ agentId: string; delta: string }>(
        'agent-assistant-delta',
        (ev) => {
          const { agentId, delta } = ev.payload;
          if (!delta) return;
          set((s) => ({
            streamingByAgent: {
              ...s.streamingByAgent,
              [agentId]: (s.streamingByAgent[agentId] ?? '') + delta,
            },
          }));
        },
      ),
    ]);

    return () => {
      un1();
      un2();
      un3();
      un4();
      un5();
      un6();
      un7();
      un8();
      un9();
      un10();
    };
  },

  totalUnread: () => {
    const counts = Object.values(get().unreadByAgent);
    return counts.reduce((a, b) => a + b, 0);
  },

  reset: () =>
    set({
      eventsByAgent: {},
      streamingByAgent: {},
      channels: [],
      selectedAgentId: null,
      unreadByAgent: {},
      archivedCollapsed: true,
      isLoading: false,
      error: null,
    }),
}));

// Phase 19 D-02.2 — pair a tool_use event with its tool_result by
// tool_use_id. Linear scan; events array is paginated (50/page) so cost is
// bounded. Pure export (two inputs don't fit the totalUnread zero-arg shape).
// Consumers wire via `useChatStore((s) =>
//   selectToolUseWithResult(s.eventsByAgent[agentId] ?? [], toolUseId))`.
export function selectToolUseWithResult(
  events: AgentEvent[],
  toolUseId: string,
): { toolUse: AgentEvent | null; toolResult: AgentEvent | null } {
  let toolUse: AgentEvent | null = null;
  let toolResult: AgentEvent | null = null;
  for (const e of events) {
    const payload =
      (e.payloadJson as { tool_use_id?: string } | null) ?? {};
    if (payload.tool_use_id !== toolUseId) continue;
    if (e.eventType === 'tool_use') toolUse = e;
    else if (e.eventType === 'tool_result') toolResult = e;
  }
  return { toolUse, toolResult };
}
