import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  useChatStore,
  selectToolUseWithResult,
  selectTranscriptItems,
  type AgentEvent,
  type ChatChannel,
} from '../chatStore';

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

  // Phase 10 latent bug fix — selectAgent loads historical events on first
  // select when eventsByAgent[id] is undefined. Chat transcript was empty
  // after app restart despite rows existing in agent_events.
  it('selectAgent loads historical events on first select', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'list_agent_events') return [mkUser(1, 'delivered')];
      if (cmd === 'mark_agent_events_read') return undefined;
      return undefined;
    });
    useChatStore.getState().selectAgent('claude-cc-001');
    // Wait a tick for the fire-and-forget loadInitialEvents + markRead.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockInvoke).toHaveBeenCalledWith('list_agent_events', {
      agentId: 'claude-cc-001',
      beforeId: null,
      limit: 50,
    });
    expect(
      useChatStore.getState().eventsByAgent['claude-cc-001'] ?? [],
    ).toHaveLength(1);
  });

  it('selectAgent does NOT re-fetch when eventsByAgent[id] is already loaded', async () => {
    // Pre-populate so the guard triggers.
    useChatStore.setState({
      eventsByAgent: { 'claude-cc-001': [mkUser(1, 'delivered')] },
    });
    mockInvoke.mockImplementation(async () => undefined);
    useChatStore.getState().selectAgent('claude-cc-001');
    await new Promise((r) => setTimeout(r, 0));
    // Only mark_agent_events_read should be invoked — NOT list_agent_events.
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('list_agent_events');
    expect(calls).toContain('mark_agent_events_read');
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

  it('subscribeToChat wires all ten listeners', async () => {
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
        'agent-assistant-delta',
      ]),
    );
    expect(calls.length).toBe(10);
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

  // Phase 19 gap closure — live streaming via agent-assistant-delta.
  it('agent-assistant-delta appends to streamingByAgent', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    const handler = handlers.get('agent-assistant-delta')!;
    handler({ payload: { agentId: 'claude-cc-001', delta: 'Hel' } });
    handler({ payload: { agentId: 'claude-cc-001', delta: 'lo' } });
    handler({ payload: { agentId: 'claude-cc-001', delta: ' world' } });
    expect(
      useChatStore.getState().streamingByAgent['claude-cc-001'],
    ).toBe('Hello world');
  });

  it('agent-assistant-delta ignores empty delta payloads', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    const handler = handlers.get('agent-assistant-delta')!;
    handler({ payload: { agentId: 'claude-cc-001', delta: 'hi' } });
    handler({ payload: { agentId: 'claude-cc-001', delta: '' } });
    expect(
      useChatStore.getState().streamingByAgent['claude-cc-001'],
    ).toBe('hi');
  });

  it('agent-event-appended with eventType assistant_text clears streamingByAgent', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      streamingByAgent: { 'claude-cc-001': 'partial text' },
    });
    const appendHandler = handlers.get('agent-event-appended')!;
    appendHandler({ payload: mkAssistant(42, false) });
    expect(
      useChatStore.getState().streamingByAgent['claude-cc-001'],
    ).toBeUndefined();
  });

  it('agent-event-appended for non-assistant-text events does NOT clear streaming', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      streamingByAgent: { 'claude-cc-001': 'partial text' },
    });
    const appendHandler = handlers.get('agent-event-appended')!;
    appendHandler({ payload: { ...mockUserEvent, id: 99 } });
    expect(
      useChatStore.getState().streamingByAgent['claude-cc-001'],
    ).toBe('partial text');
  });

  it('agent-turn-complete clears streamingByAgent as a tool-only-turn safety net', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      streamingByAgent: { 'claude-cc-001': 'partial text' },
      eventsByAgent: {},
    });
    const handler = handlers.get('agent-turn-complete')!;
    handler({
      payload: {
        agentId: 'claude-cc-001',
        terminalReason: 'completed',
        isError: false,
      },
    });
    expect(
      useChatStore.getState().streamingByAgent['claude-cc-001'],
    ).toBeUndefined();
  });

  it('agent-thread-cleared also drops streamingByAgent for that agent', async () => {
    const handlers = installListenMock();
    await useChatStore.getState().subscribeToChat();
    useChatStore.setState({
      streamingByAgent: { 'claude-cc-001': 'partial text' },
    });
    const handler = handlers.get('agent-thread-cleared')!;
    handler({ payload: 'claude-cc-001' });
    expect(
      useChatStore.getState().streamingByAgent['claude-cc-001'],
    ).toBeUndefined();
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

describe('selectToolUseWithResult (D-02.2 — V-19-08)', () => {
  // V-19-08: returns { toolUse, toolResult } when both exist;
  //          returns { toolUse, toolResult: null } when only tool_use present;
  //          ignores events with mismatched tool_use_id.
  it('pairs tool_use and tool_result by tool_use_id', () => {
    const toolUse = mkToolUse(5, 'toolu_01');
    const toolResult = mkToolResult(6, 'toolu_01', false);
    useChatStore.setState({ eventsByAgent: { a: [toolUse, toolResult] } });
    const { toolUse: tu, toolResult: tr } = selectToolUseWithResult(
      useChatStore.getState().eventsByAgent['a'] ?? [],
      'toolu_01',
    );
    expect(tu?.id).toBe(5);
    expect(tr?.id).toBe(6);
    expect(tr?.eventType).toBe('tool_result');
  });

  it('returns toolResult: null when no paired tool_result exists', () => {
    const toolUse = mkToolUse(10, 'toolu_02');
    useChatStore.setState({ eventsByAgent: { a: [toolUse] } });
    const result = selectToolUseWithResult(
      useChatStore.getState().eventsByAgent['a'] ?? [],
      'toolu_02',
    );
    expect(result.toolUse?.id).toBe(10);
    expect(result.toolResult).toBeNull();
  });

  it('ignores events with mismatched tool_use_id', () => {
    const toolUseA = mkToolUse(20, 'toolu_a');
    const toolResultB = mkToolResult(21, 'toolu_b', false);
    useChatStore.setState({
      eventsByAgent: { a: [toolUseA, toolResultB] },
    });
    const result = selectToolUseWithResult(
      useChatStore.getState().eventsByAgent['a'] ?? [],
      'toolu_a',
    );
    expect(result.toolUse?.id).toBe(20);
    expect(result.toolResult).toBeNull();
  });
});

describe('selectTranscriptItems', () => {
  function mkSystemNote(
    id: number,
    subtype: string | undefined,
    taskId: string | undefined,
    extras: Record<string, unknown> = {},
  ): AgentEvent {
    const data =
      subtype === undefined
        ? undefined
        : { subtype, task_id: taskId, ...extras };
    return {
      id,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'system_note',
      payloadJson: {
        text: subtype ? `[system/${subtype}]` : '[system/other]',
        ...(data ? { data } : {}),
      },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }

  function mkAsst(id: number): AgentEvent {
    return {
      id,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'assistant_text',
      payloadJson: { content: `text-${id}` },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }

  it('groups task_started → task_progress* → task_notification by task_id', () => {
    const events: AgentEvent[] = [
      mkAsst(1),
      mkSystemNote(2, 'task_started', 'task-A', {
        description: 'Echo hello',
      }),
      mkSystemNote(3, 'task_progress', 'task-A'),
      mkSystemNote(4, 'task_progress', 'task-A'),
      mkSystemNote(5, 'task_notification', 'task-A', { status: 'completed' }),
      mkAsst(6),
    ];
    const items = selectTranscriptItems(events);
    expect(items.map((i) => i.kind)).toEqual(['event', 'taskGroup', 'event']);
    const group = items[1];
    if (group.kind !== 'taskGroup') throw new Error('expected taskGroup');
    expect(group.taskId).toBe('task-A');
    expect(group.header.id).toBe(2);
    expect(group.children.map((c) => c.id)).toEqual([3, 4]);
    expect(group.footer?.id).toBe(5);
  });

  it('routes overlapping tasks to their own groups by task_id', () => {
    const events: AgentEvent[] = [
      mkSystemNote(1, 'task_started', 'task-A'),
      mkSystemNote(2, 'task_started', 'task-B'),
      mkSystemNote(3, 'task_progress', 'task-A'),
      mkSystemNote(4, 'task_progress', 'task-B'),
      mkSystemNote(5, 'task_notification', 'task-A', { status: 'completed' }),
      mkSystemNote(6, 'task_progress', 'task-B'),
      mkSystemNote(7, 'task_notification', 'task-B', { status: 'completed' }),
    ];
    const items = selectTranscriptItems(events);
    expect(items).toHaveLength(2);
    const [gA, gB] = items;
    if (gA.kind !== 'taskGroup' || gB.kind !== 'taskGroup') {
      throw new Error('expected two taskGroups');
    }
    expect(gA.taskId).toBe('task-A');
    expect(gA.children.map((c) => c.id)).toEqual([3]);
    expect(gA.footer?.id).toBe(5);
    expect(gB.taskId).toBe('task-B');
    expect(gB.children.map((c) => c.id)).toEqual([4, 6]);
    expect(gB.footer?.id).toBe(7);
  });

  it('leaves an unclosed group with footer: null when task_notification is missing', () => {
    const events: AgentEvent[] = [
      mkSystemNote(1, 'task_started', 'task-A'),
      mkSystemNote(2, 'task_progress', 'task-A'),
    ];
    const items = selectTranscriptItems(events);
    expect(items).toHaveLength(1);
    const g = items[0];
    if (g.kind !== 'taskGroup') throw new Error('expected taskGroup');
    expect(g.footer).toBeNull();
    expect(g.children.map((c) => c.id)).toEqual([2]);
  });

  it('falls through orphan task_progress / task_notification as top-level events', () => {
    const events: AgentEvent[] = [
      mkSystemNote(1, 'task_progress', 'task-ghost'),
      mkSystemNote(2, 'task_notification', 'task-ghost'),
    ];
    const items = selectTranscriptItems(events);
    expect(items.map((i) => i.kind)).toEqual(['event', 'event']);
  });

  it('treats system_notes without structured data as ordinary events', () => {
    const hook = mkSystemNote(1, undefined, undefined);
    const items = selectTranscriptItems([hook]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('event');
  });

  // Phase 19.2 — sub-agent tool_use rows nest into the open task group.

  function mkToolUse(id: number, toolName: string, toolUseId: string): AgentEvent {
    return {
      id,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_use',
      payloadJson: { tool_name: toolName, tool_use_id: toolUseId, tool_input: {} },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }

  function mkToolResult(id: number, toolUseId: string): AgentEvent {
    return {
      id,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_result',
      payloadJson: { tool_use_id: toolUseId, content: 'out' },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }

  it('nests sub-agent tool_use events into the open task group, deduping the parent Agent row', () => {
    const events: AgentEvent[] = [
      mkToolUse(1, 'Agent', 'tu-parent'), // parent Agent dispatch — gets deduped
      mkSystemNote(2, 'task_started', 'task-A', { tool_use_id: 'tu-parent' }),
      mkToolUse(3, 'Bash', 'tu-sub-1'), // sub-agent's first tool call
      mkToolResult(4, 'tu-sub-1'),
      mkSystemNote(5, 'task_progress', 'task-A'),
      mkToolUse(6, 'Read', 'tu-sub-2'),
      mkSystemNote(7, 'task_notification', 'task-A', { status: 'completed' }),
      mkToolUse(8, 'Edit', 'tu-after'), // parent's next tool, after group closes
    ];
    const items = selectTranscriptItems(events);
    // Phase 19.3 — parent Agent tool_use (id 1) is removed because its
    // tool_use_id matches data.tool_use_id on task_started. Group becomes
    // the unified representation; only the post-group tool_use remains
    // top-level alongside it.
    expect(items.map((i) => i.kind)).toEqual(['taskGroup', 'event']);
    const group = items[0];
    if (group.kind !== 'taskGroup') throw new Error('expected taskGroup');
    expect(group.children.map((c) => c.id)).toEqual([3, 4, 5, 6]);
    expect(group.footer?.id).toBe(7);
    expect(items[1]).toMatchObject({ kind: 'event' });
  });

  it('keeps parent Agent tool_use at top-level when task_started has no tool_use_id (paginated)', () => {
    const events: AgentEvent[] = [
      mkToolUse(1, 'Agent', 'tu-parent'),
      mkSystemNote(2, 'task_started', 'task-A'), // no tool_use_id
      mkSystemNote(3, 'task_notification', 'task-A', { status: 'completed' }),
    ];
    const items = selectTranscriptItems(events);
    // Without a tool_use_id, dedupe can't run — parent stays standalone.
    expect(items.map((i) => i.kind)).toEqual(['event', 'taskGroup']);
  });

  it('keeps a non-matching Agent tool_use at top-level when tool_use_id differs', () => {
    const events: AgentEvent[] = [
      mkToolUse(1, 'Agent', 'tu-other'),
      mkSystemNote(2, 'task_started', 'task-A', { tool_use_id: 'tu-parent' }),
      mkSystemNote(3, 'task_notification', 'task-A', { status: 'completed' }),
    ];
    const items = selectTranscriptItems(events);
    expect(items.map((i) => i.kind)).toEqual(['event', 'taskGroup']);
  });

  it('routes nested tool_use to the innermost open group when tasks are nested', () => {
    const events: AgentEvent[] = [
      mkSystemNote(1, 'task_started', 'task-outer'),
      mkToolUse(2, 'Bash', 'tu-1'), // belongs to outer
      mkSystemNote(3, 'task_started', 'task-inner'),
      mkToolUse(4, 'Read', 'tu-2'), // belongs to inner (innermost wins)
      mkSystemNote(5, 'task_notification', 'task-inner', { status: 'completed' }),
      mkToolUse(6, 'Grep', 'tu-3'), // back to outer
      mkSystemNote(7, 'task_notification', 'task-outer', { status: 'completed' }),
    ];
    const items = selectTranscriptItems(events);
    // Outer group is opened first; inner is added as a child of outer (it's a
    // taskGroup item but routed via the items.push at task_started, while
    // tool_use rows inside it are in the inner's children).
    expect(items).toHaveLength(2);
    const outer = items[0];
    const inner = items[1];
    if (outer.kind !== 'taskGroup' || inner.kind !== 'taskGroup') {
      throw new Error('expected two taskGroups');
    }
    expect(outer.taskId).toBe('task-outer');
    expect(inner.taskId).toBe('task-inner');
    expect(outer.children.map((c) => c.id)).toEqual([2, 6]);
    expect(inner.children.map((c) => c.id)).toEqual([4]);
  });

  it('leaves a tool_use that arrives outside any open task at the top level', () => {
    const events: AgentEvent[] = [
      mkToolUse(1, 'Bash', 'tu-1'),
      mkSystemNote(2, 'task_started', 'task-A'),
      mkSystemNote(3, 'task_notification', 'task-A', { status: 'completed' }),
      mkToolUse(4, 'Bash', 'tu-2'),
    ];
    const items = selectTranscriptItems(events);
    expect(items.map((i) => i.kind)).toEqual(['event', 'taskGroup', 'event']);
    const group = items[1];
    if (group.kind !== 'taskGroup') throw new Error('expected taskGroup');
    expect(group.children).toHaveLength(0);
  });
});
