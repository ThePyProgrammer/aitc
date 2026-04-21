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

const mockUserEvent: AgentEvent = {
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

function mkAssistant(
  id: number,
  streaming: boolean,
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id,
    agentId: 'claude-cc-001',
    sessionId: '0d836c4f',
    eventType: 'assistant_text',
    payloadJson: { content: 'OK', streaming },
    approvalRequestId: null,
    sequenceNumber: id,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}

function mkUser(
  id: number,
  deliveryStatus: AgentEvent['deliveryStatus'],
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id,
    agentId: 'claude-cc-001',
    sessionId: '0d836c4f',
    eventType: 'user_text',
    payloadJson: { content: 'hi' },
    approvalRequestId: null,
    sequenceNumber: id,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus,
    ...overrides,
  };
}

// Invoker to simulate the listen(() => handler) registration pattern.
// Returns a map of eventName → handler so tests can trigger them manually.
function installListenMock() {
  const handlers = new Map<
    string,
    // payload is loosely typed — each test will cast.
    (ev: { payload: unknown }) => void
  >();
  mockListen.mockImplementation(async (eventName, handler) => {
    handlers.set(eventName as string, handler as never);
    return () => {
      // noop unlisten
    };
  });
  return handlers;
}

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

  it('loadInitialEvents reverses backend newest-first into oldest-first', async () => {
    const newestFirst: AgentEvent[] = [
      mkUser(3, 'delivered'),
      mkUser(2, 'delivered'),
      mkUser(1, 'delivered'),
    ];
    mockInvoke.mockResolvedValueOnce(newestFirst);
    await useChatStore.getState().loadInitialEvents('claude-cc-001');
    const events = useChatStore.getState().eventsByAgent['claude-cc-001'] ?? [];
    expect(events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(mockInvoke).toHaveBeenCalledWith('list_agent_events', {
      agentId: 'claude-cc-001',
      beforeId: null,
      limit: 50,
    });
  });

  it('loadOlder prepends older events in oldest-first order', async () => {
    // Existing array is oldest→newest [10, 11].
    useChatStore.setState({
      eventsByAgent: {
        'claude-cc-001': [mkUser(10, 'delivered'), mkUser(11, 'delivered')],
      },
    });
    // Backend returns newest-first [9, 8, 7].
    mockInvoke.mockResolvedValueOnce([
      mkUser(9, 'delivered'),
      mkUser(8, 'delivered'),
      mkUser(7, 'delivered'),
    ]);
    await useChatStore.getState().loadOlder('claude-cc-001');
    const events = useChatStore.getState().eventsByAgent['claude-cc-001'] ?? [];
    expect(events.map((e) => e.id)).toEqual([7, 8, 9, 10, 11]);
    expect(mockInvoke).toHaveBeenCalledWith('list_agent_events', {
      agentId: 'claude-cc-001',
      beforeId: 10,
      limit: 50,
    });
  });

  it('loadOlder no-ops when current array is empty (no beforeId)', async () => {
    await useChatStore.getState().loadOlder('claude-cc-001');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('sendMessage optimistic-appends the returned event', async () => {
    mockInvoke.mockResolvedValueOnce(mockUserEvent);
    await useChatStore.getState().sendMessage('claude-cc-001', 'hello');
    expect(mockInvoke).toHaveBeenCalledWith('send_chat_message_to_agent', {
      agentId: 'claude-cc-001',
      content: 'hello',
    });
    const state = useChatStore.getState();
    expect(state.eventsByAgent['claude-cc-001']).toHaveLength(1);
    expect(state.eventsByAgent['claude-cc-001'][0].id).toBe(1);
  });

  it('sendMessage dedupes when the event-appended listener races first', async () => {
    // Pre-seed the array as if the listener fired first.
    useChatStore.setState({
      eventsByAgent: { 'claude-cc-001': [mockUserEvent] },
    });
    mockInvoke.mockResolvedValueOnce(mockUserEvent);
    await useChatStore.getState().sendMessage('claude-cc-001', 'hello');
    const events = useChatStore.getState().eventsByAgent['claude-cc-001'] ?? [];
    expect(events).toHaveLength(1);
  });

  it('clearThread empties the agent array', async () => {
    useChatStore.setState({
      eventsByAgent: { 'claude-cc-001': [mockUserEvent] },
    });
    mockInvoke.mockResolvedValueOnce(3);
    await useChatStore.getState().clearThread('claude-cc-001');
    expect(mockInvoke).toHaveBeenCalledWith('clear_agent_thread', {
      agentId: 'claude-cc-001',
    });
    expect(useChatStore.getState().eventsByAgent['claude-cc-001']).toEqual([]);
  });

  it('markRead resets unread to 0', async () => {
    useChatStore.setState({ unreadByAgent: { 'claude-cc-001': 7 } });
    mockInvoke.mockResolvedValueOnce(undefined);
    await useChatStore.getState().markRead('claude-cc-001');
    expect(useChatStore.getState().unreadByAgent['claude-cc-001']).toBe(0);
  });

  it('subscribeToChat wires all nine listeners', async () => {
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
        'agent-thread-cleared',
        'agent-events-marked-read',
        'agent-session-resumed',
      ]),
    );
    expect(calls.length).toBe(9);
  });

  it('agent-event-appended increments unread when agent is not selected', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    const handler = handlers.get('agent-event-appended')!;
    handler({ payload: mockUserEvent });
    expect(
      useChatStore.getState().unreadByAgent['claude-cc-001'],
    ).toBe(1);
  });

  it('agent-event-appended does NOT increment when agent is selected AND visible', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({ selectedAgentId: 'claude-cc-001' });
    const handler = handlers.get('agent-event-appended')!;
    handler({ payload: mockUserEvent });
    // jsdom defaults visibilityState to 'visible'.
    expect(
      useChatStore.getState().unreadByAgent['claude-cc-001'] ?? 0,
    ).toBe(0);
  });

  it('agent-event-appended dedupes by event id', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    const handler = handlers.get('agent-event-appended')!;
    handler({ payload: mockUserEvent });
    handler({ payload: mockUserEvent }); // duplicate
    const events = useChatStore.getState().eventsByAgent['claude-cc-001'] ?? [];
    expect(events).toHaveLength(1);
  });

  it('agent-turn-complete flips last streaming assistant_text to streaming:false', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      eventsByAgent: {
        'claude-cc-001': [
          mkAssistant(10, false),
          mkAssistant(11, true),
        ],
      },
    });
    const handler = handlers.get('agent-turn-complete')!;
    handler({
      payload: {
        agentId: 'claude-cc-001',
        sessionId: null,
        terminalReason: 'end_turn',
        isError: false,
      },
    });
    const events = useChatStore.getState().eventsByAgent['claude-cc-001'];
    const streamed = events.find((e) => e.id === 11)!;
    expect(
      (streamed.payloadJson as { streaming?: boolean }).streaming,
    ).toBe(false);
  });

  it('agent-turn-complete flips last delivered user_text to consumed', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      eventsByAgent: {
        'claude-cc-001': [
          mkUser(100, 'delivered'),
          mkUser(101, 'delivered'),
          mkAssistant(102, false),
        ],
      },
    });
    const handler = handlers.get('agent-turn-complete')!;
    handler({
      payload: {
        agentId: 'claude-cc-001',
        sessionId: null,
        terminalReason: 'end_turn',
        isError: false,
      },
    });
    const events = useChatStore.getState().eventsByAgent['claude-cc-001'];
    const consumed = events.find((e) => e.id === 101)!;
    expect(consumed.deliveryStatus).toBe('consumed');
    // The earlier one should remain delivered.
    const earlier = events.find((e) => e.id === 100)!;
    expect(earlier.deliveryStatus).toBe('delivered');
  });

  it('agent-delivery-updated propagates across all agents', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      eventsByAgent: {
        a: [mkUser(42, 'queued', { agentId: 'a' })],
        b: [mkUser(43, 'queued', { agentId: 'b' })],
      },
    });
    const handler = handlers.get('agent-delivery-updated')!;
    handler({ payload: { eventId: 42, status: 'delivered' } });
    const state = useChatStore.getState();
    expect(state.eventsByAgent['a'][0].deliveryStatus).toBe('delivered');
    expect(state.eventsByAgent['b'][0].deliveryStatus).toBe('queued');
  });

  it('agent-thread-cleared empties the target agent', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      eventsByAgent: { 'claude-cc-001': [mockUserEvent] },
    });
    const handler = handlers.get('agent-thread-cleared')!;
    handler({ payload: 'claude-cc-001' });
    expect(
      useChatStore.getState().eventsByAgent['claude-cc-001'] ?? [],
    ).toEqual([]);
  });

  it('agent-events-marked-read zeros unread for that agent', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({ unreadByAgent: { 'claude-cc-001': 5 } });
    const handler = handlers.get('agent-events-marked-read')!;
    handler({ payload: 'claude-cc-001' });
    expect(useChatStore.getState().unreadByAgent['claude-cc-001']).toBe(0);
  });

  it('agent-session-ended sets archived=true on matching channel', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({ channels: [mockChannel] });
    const handler = handlers.get('agent-session-ended')!;
    handler({
      payload: {
        agentId: 'claude-cc-001',
        sessionId: null,
        reason: 'completed',
        exitCode: 0,
      },
    });
    expect(useChatStore.getState().channels[0].archived).toBe(true);
  });

  it('agent-session-resumed sets archived=false on matching channel', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      channels: [{ ...mockChannel, archived: true }],
    });
    const handler = handlers.get('agent-session-resumed')!;
    handler({ payload: 'claude-cc-001' });
    expect(useChatStore.getState().channels[0].archived).toBe(false);
  });

  it('totalUnread sums unreadByAgent', () => {
    useChatStore.setState({ unreadByAgent: { a: 2, b: 5, c: 0 } });
    expect(useChatStore.getState().totalUnread()).toBe(7);
  });

  it('reset zeros everything', () => {
    useChatStore.setState({
      eventsByAgent: { a: [mockUserEvent] },
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

// ---------------------------------------------------------------------------
// Phase 19 Plan 04 — selectToolUseWithResult selector (D-02.2)
// ---------------------------------------------------------------------------
//
// `selectToolUseWithResult` does not exist yet in chatStore.ts — Plan 04
// will export it. This block scaffolds the test surface (factories +
// describe + 3 `.todo` placeholders keyed to V-19-08). Plan 04 flips
// `.todo` → real `it(…)` bodies and adds the `import` line. Keeping the
// factories here today means Plan 04 does NOT touch test infrastructure.

function mkToolUse(
  id: number,
  toolUseId: string,
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id,
    agentId: 'a',
    sessionId: 'sess-1',
    eventType: 'tool_use',
    payloadJson: { tool_use_id: toolUseId, tool_name: 'Edit', tool_input: {} },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-21T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}

function mkToolResult(
  id: number,
  toolUseId: string,
  isError: boolean,
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id,
    agentId: 'a',
    sessionId: 'sess-1',
    eventType: 'tool_result',
    payloadJson: { tool_use_id: toolUseId, is_error: isError, content: '' },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-21T12:00:01Z',
    deliveryStatus: null,
    ...overrides,
  };
}

describe('selectToolUseWithResult (Plan 04 target — D-02.2)', () => {
  // V-19-08: returns { toolUse, toolResult } when both exist;
  //          returns { toolUse, toolResult: null } when only tool_use present;
  //          ignores events with mismatched tool_use_id.
  it.todo('pairs tool_use and tool_result by tool_use_id');
  it.todo('returns toolResult: null when no paired tool_result exists');
  it.todo('ignores events with mismatched tool_use_id');
});

// Reference unused factories so TypeScript does not trip noUnusedLocals
// while the `.todo` placeholders have no bodies. Plan 04 consumes them.
void mkToolUse;
void mkToolResult;
