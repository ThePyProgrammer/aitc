// Phase 3 agent management Zustand store.
//
// AGNT-01: Frontend subscribes to agent registry state via this store.
// Uses periodic polling (2s) via startPolling() for agent list refresh.
// All mutations go through Tauri invoke for backend validation.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface AgentInfo {
  id: string;
  agentType: string;
  protocol: string;
  state: 'running' | 'idle' | 'waiting' | 'conflict' | 'error';
  pid: number | null;
  cwd: string | null;
  intent: string | null;
}

interface AgentStore {
  agents: AgentInfo[];
  isLoading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  launchAgent: (agentType: string, cwd: string, intent?: string) => Promise<AgentInfo>;
  terminateAgent: (agentId: string) => Promise<void>;
  updateIntent: (agentId: string, intent: string) => Promise<void>;
  /** Start polling agent list every 2s. Returns cleanup function. */
  startPolling: () => () => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  isLoading: false,
  error: null,

  fetchAgents: async () => {
    try {
      set({ isLoading: true, error: null });
      const agents = await invoke<AgentInfo[]>('list_agents');
      set({ agents, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  launchAgent: async (agentType, cwd, intent) => {
    const agent = await invoke<AgentInfo>('launch_agent', { agentType, cwd, intent });
    set((s) => ({ agents: [...s.agents, agent] }));
    return agent;
  },

  terminateAgent: async (agentId) => {
    try {
      await invoke('terminate_agent', { agentId });
      set((s) => ({ agents: s.agents.filter((a) => a.id !== agentId) }));
    } catch (e) {
      set({ error: String(e) });
      throw e; // re-throw so caller (AgentRow) can show feedback
    }
  },

  updateIntent: async (agentId, intent) => {
    await invoke('update_agent_intent', { agentId, intent });
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, intent } : a)),
    }));
  },

  startPolling: () => {
    const interval = setInterval(() => {
      get().fetchAgents();
    }, 2000);
    return () => clearInterval(interval);
  },

  reset: () => set({ agents: [], isLoading: false, error: null }),
}));
