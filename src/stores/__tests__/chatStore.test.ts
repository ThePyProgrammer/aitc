import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChatStore, type AgentEvent, type ChatChannel } from '../chatStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const mockChannel: ChatChannel = {
  agentId: 'claude-cc-001',
  adapterType: 'claude_code',
  status: 'running',
  archived: false,
  chatDuplex: true,
  lastEvent: null,
  unreadCount: 0,
  currentSessionId: null,
};

const mockEvent: AgentEvent = {
  id: 1,
  agentId: 'claude-cc-001',
  sessionId: '0d836c4f',
  eventType: 'user_text',
  payloadJson: { content: 'hello' },
  approvalRequestId: null,
  sequenceNumber: 1,
  createdAt: '2026-04-17T12:00:00Z',
  deliveryStatus: 'queued',
};

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchChannels populates channels from list_chat_channels', async () => {
    mockInvoke.mockResolvedValueOnce([mockChannel]);
    await useChatStore.getState().fetchChannels();
    expect(mockInvoke).toHaveBeenCalledWith('list_chat_channels');
    const state = useChatStore.getState();
    expect(state.channels).toHaveLength(1);
    expect(state.channels[0].agentId).toBe('claude-cc-001');
    expect(state.isLoading).toBe(false);
  });

  it('sendMessage optimistic-appends the returned event', async () => {
    mockInvoke.mockResolvedValueOnce(mockEvent);
    await useChatStore.getState().sendMessage('claude-cc-001', 'hello');
    expect(mockInvoke).toHaveBeenCalledWith('send_chat_message_to_agent', {
      agentId: 'claude-cc-001',
      content: 'hello',
    });
    const state = useChatStore.getState();
    expect(state.eventsByAgent['claude-cc-001']).toHaveLength(1);
    expect(state.eventsByAgent['claude-cc-001'][0].id).toBe(1);
  });

  it('subscribeToChat wires all six listeners', async () => {
    mockListen.mockImplementation(async () => () => {});
    await useChatStore.getState().subscribeToChat();
    const calls = mockListen.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        'agent-event-appended',
        'agent-turn-started',
        'agent-turn-complete',
        'agent-session-started',
        'agent-session-ended',
        'agent-delivery-updated',
      ]),
    );
  });

  it('unread count increments only when agent not selected', async () => {
    let appendHandler:
      | ((payload: { payload: AgentEvent }) => void)
      | undefined;
    mockListen.mockImplementation(async (event, handler) => {
      if (event === 'agent-event-appended') {
        appendHandler = handler as never;
      }
      return () => {};
    });
    await useChatStore.getState().subscribeToChat();
    expect(appendHandler).toBeDefined();

    // Not selected: unread should increment.
    appendHandler!({ payload: mockEvent });
    expect(useChatStore.getState().unreadByAgent['claude-cc-001']).toBe(1);

    // Selected + visible: unread should NOT increment.
    useChatStore.setState({ selectedAgentId: 'claude-cc-001' });
    // document.visibilityState in jsdom defaults to 'visible'.
    appendHandler!({ payload: { ...mockEvent, id: 2 } });
    expect(useChatStore.getState().unreadByAgent['claude-cc-001']).toBe(1);
  });

  it('markRead resets unread to 0', async () => {
    useChatStore.setState({
      unreadByAgent: { 'claude-cc-001': 7 },
    });
    mockInvoke.mockResolvedValueOnce(undefined);
    await useChatStore.getState().markRead('claude-cc-001');
    expect(useChatStore.getState().unreadByAgent['claude-cc-001']).toBe(0);
  });

  it('totalUnread sums unreadByAgent', () => {
    useChatStore.setState({
      unreadByAgent: { a: 2, b: 5, c: 0 },
    });
    expect(useChatStore.getState().totalUnread()).toBe(7);
  });

  it('reset zeros everything', () => {
    useChatStore.setState({
      eventsByAgent: { a: [mockEvent] },
      channels: [mockChannel],
      selectedAgentId: 'a',
      unreadByAgent: { a: 3 },
      archivedCollapsed: false,
      isLoading: true,
      error: 'boom',
    });
    useChatStore.getState().reset();
    const s = useChatStore.getState();
    expect(s.eventsByAgent).toEqual({});
    expect(s.channels).toEqual([]);
    expect(s.selectedAgentId).toBeNull();
    expect(s.unreadByAgent).toEqual({});
    expect(s.archivedCollapsed).toBe(true);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });
});
