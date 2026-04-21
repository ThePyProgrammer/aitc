import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../agentStore';
import type { AgentInfo } from '../agentStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const mockAgent: AgentInfo = {
  id: 'agent-001',
  agentType: 'claude-code',
  protocol: 'hooks',
  state: 'running',
  pid: 1234,
  cwd: '/tmp/project',
  intent: 'refactor auth module',
};

const mockAgent2: AgentInfo = {
  id: 'agent-002',
  agentType: 'codex',
  protocol: 'cli',
  state: 'idle',
  pid: 5678,
  cwd: '/tmp/project',
  intent: null,
};

describe('agentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchAgents calls invoke list_agents and sets agents array', async () => {
    mockInvoke.mockResolvedValueOnce([mockAgent, mockAgent2]);

    await useAgentStore.getState().fetchAgents();

    expect(mockInvoke).toHaveBeenCalledWith('list_agents');
    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0].id).toBe('agent-001');
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchAgents sets error on invoke failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Connection refused'));

    await useAgentStore.getState().fetchAgents();

    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(0);
    expect(state.isLoading).toBe(false);
    expect(state.error).toContain('Connection refused');
  });

  it('launchAgent calls invoke launch_agent and appends to agents', async () => {
    // launchAgent's backend call, then the Phase-10 fix's chatStore.fetchChannels()
    // call. Both must be mocked.
    mockInvoke
      .mockResolvedValueOnce(mockAgent) // launch_agent
      .mockResolvedValueOnce([]); // list_chat_channels (fired by chatStore.fetchChannels)

    const result = await useAgentStore.getState().launchAgent('claude-code', '/tmp/project', 'test intent');

    expect(mockInvoke).toHaveBeenCalledWith('launch_agent', {
      agentType: 'claude-code',
      cwd: '/tmp/project',
      intent: 'test intent',
      options: null,
    });
    expect(result.id).toBe('agent-001');
    expect(useAgentStore.getState().agents).toHaveLength(1);
  });

  it('terminateAgent calls invoke terminate_agent and removes from agents', async () => {
    // Pre-populate store
    useAgentStore.setState({ agents: [mockAgent, mockAgent2] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useAgentStore.getState().terminateAgent('agent-001');

    expect(mockInvoke).toHaveBeenCalledWith('terminate_agent', { agentId: 'agent-001' });
    const agents = useAgentStore.getState().agents;
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('agent-002');
  });

  it('updateIntent calls invoke and updates matching agent intent', async () => {
    useAgentStore.setState({ agents: [mockAgent] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useAgentStore.getState().updateIntent('agent-001', 'new intent');

    expect(mockInvoke).toHaveBeenCalledWith('update_agent_intent', {
      agentId: 'agent-001',
      intent: 'new intent',
    });
    expect(useAgentStore.getState().agents[0].intent).toBe('new intent');
  });

  it('startPolling returns cleanup function that clears interval', () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue([]);

    const cleanup = useAgentStore.getState().startPolling();

    // Advance 2s -- should trigger one poll
    vi.advanceTimersByTime(2000);
    expect(mockInvoke).toHaveBeenCalledWith('list_agents');

    // Clean up
    cleanup();

    // Advance another 2s -- should NOT trigger another poll
    mockInvoke.mockClear();
    vi.advanceTimersByTime(2000);
    expect(mockInvoke).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('reset clears agents and error', () => {
    useAgentStore.setState({
      agents: [mockAgent],
      error: 'some error',
      isLoading: true,
    });

    useAgentStore.getState().reset();

    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(0);
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});
