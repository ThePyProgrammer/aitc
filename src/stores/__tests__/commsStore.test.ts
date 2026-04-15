import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCommsStore } from '../commsStore';
import type { ApprovalRequest, ChatMessage } from '../commsStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const mockRequest: ApprovalRequest = {
  id: 1,
  agentId: 'agent-001',
  requestType: 'file_edit',
  filePath: '/repo/src/main.rs',
  diffContent: '--- a/main.rs\n+++ b/main.rs\n@@ -1,3 +1,4 @@\n fn main() {\n+    println!("hello");\n }',
  status: 'pending',
  urgency: 'medium',
  responseNote: null,
  editedContent: null,
  createdAt: '2026-04-10T12:00:00Z',
  resolvedAt: null,
  toolName: null,
  toolInputJson: null,
  sessionId: null,
};

const mockRequest2: ApprovalRequest = {
  id: 2,
  agentId: 'agent-002',
  requestType: 'file_create',
  filePath: '/repo/src/lib.rs',
  diffContent: null,
  status: 'pending',
  urgency: 'high',
  responseNote: null,
  editedContent: null,
  createdAt: '2026-04-10T12:01:00Z',
  resolvedAt: null,
  toolName: null,
  toolInputJson: null,
  sessionId: null,
};

const mockMessage: ChatMessage = {
  id: 1,
  agentId: 'agent-001',
  direction: 'outbound',
  content: 'Why this change?',
  deliveryStatus: 'delivered',
  approvalRequestId: 1,
  createdAt: '2026-04-10T12:05:00Z',
};

describe('commsStore', () => {
  beforeEach(() => {
    useCommsStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchRequests populates requests array from invoke list_approval_requests', async () => {
    mockInvoke.mockResolvedValueOnce([mockRequest, mockRequest2]);

    await useCommsStore.getState().fetchRequests();

    expect(mockInvoke).toHaveBeenCalledWith('list_approval_requests');
    const state = useCommsStore.getState();
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0].id).toBe(1);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchRequests sets error on failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Network error'));

    await useCommsStore.getState().fetchRequests();

    const state = useCommsStore.getState();
    expect(state.error).toContain('Network error');
    expect(state.isLoading).toBe(false);
  });

  it('selectRequest sets selectedRequestId', () => {
    useCommsStore.getState().selectRequest(1);

    expect(useCommsStore.getState().selectedRequestId).toBe(1);
  });

  it('selectRequest with null deselects', () => {
    useCommsStore.setState({ selectedRequestId: 1 });

    useCommsStore.getState().selectRequest(null);

    expect(useCommsStore.getState().selectedRequestId).toBeNull();
  });

  it('approveRequest calls invoke and removes from pending list', async () => {
    useCommsStore.setState({ requests: [mockRequest, mockRequest2] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveRequest(1);

    expect(mockInvoke).toHaveBeenCalledWith('approve_request', { id: 1, alwaysAllowForSession: false });
    const requests = useCommsStore.getState().requests;
    expect(requests.find((r) => r.id === 1)?.status).toBe('approved');
  });

  it('denyRequest calls invoke and removes from pending list', async () => {
    useCommsStore.setState({ requests: [mockRequest, mockRequest2] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().denyRequest(1);

    expect(mockInvoke).toHaveBeenCalledWith('deny_request', { id: 1, reason: null });
    const requests = useCommsStore.getState().requests;
    expect(requests.find((r) => r.id === 1)?.status).toBe('denied');
  });

  it('askMoreInfo calls invoke and updates status to info_requested', async () => {
    useCommsStore.setState({ requests: [mockRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().askMoreInfo(1, 'Why this change?');

    expect(mockInvoke).toHaveBeenCalledWith('ask_more_info', { id: 1, question: 'Why this change?' });
    const request = useCommsStore.getState().requests.find((r) => r.id === 1);
    expect(request?.status).toBe('info_requested');
  });

  it('approveWithEdits calls invoke and updates status to approved', async () => {
    useCommsStore.setState({ requests: [mockRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveWithEdits(1, 'edited content here');

    expect(mockInvoke).toHaveBeenCalledWith('approve_with_edits', {
      id: 1,
      editedContent: 'edited content here',
      alwaysAllowForSession: false,
    });
    const request = useCommsStore.getState().requests.find((r) => r.id === 1);
    expect(request?.status).toBe('approved');
  });

  it('subscribeToApprovals listens to all 3 approval events and adds new requests', async () => {
    // WR-04: store subscribes to created/resolved/updated and returns a combined unlisten
    const callbacks: Record<string, (event: { payload: any }) => void> = {};
    const unlistenFns: Record<string, ReturnType<typeof vi.fn>> = {
      'approval-request-created': vi.fn(),
      'approval-resolved': vi.fn(),
      'approval-updated': vi.fn(),
    };
    mockListen.mockImplementation(async (event: string, callback: any) => {
      callbacks[event] = callback;
      return unlistenFns[event];
    });

    const unlisten = await useCommsStore.getState().subscribeToApprovals();

    expect(mockListen).toHaveBeenCalledWith('approval-request-created', expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith('approval-resolved', expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith('approval-updated', expect.any(Function));

    // Simulate incoming created event
    callbacks['approval-request-created']!({ payload: mockRequest });
    expect(useCommsStore.getState().requests).toHaveLength(1);
    expect(useCommsStore.getState().requests[0].id).toBe(1);

    // Combined unlisten should invoke all 3 individual unlisten fns
    unlisten();
    expect(unlistenFns['approval-request-created']).toHaveBeenCalledOnce();
    expect(unlistenFns['approval-resolved']).toHaveBeenCalledOnce();
    expect(unlistenFns['approval-updated']).toHaveBeenCalledOnce();
  });

  it('pendingCount returns count of requests with status pending', () => {
    useCommsStore.setState({
      requests: [
        { ...mockRequest, status: 'pending' },
        { ...mockRequest2, status: 'approved' },
      ],
    });

    expect(useCommsStore.getState().pendingCount()).toBe(1);
  });

  it('setEditing freezes the selected request from incoming updates', async () => {
    useCommsStore.setState({ requests: [mockRequest] });

    useCommsStore.getState().setEditing(1);
    expect(useCommsStore.getState().editingRequestId).toBe(1);

    // Simulate incoming event for same request -- should be skipped
    let capturedCallback: ((event: { payload: ApprovalRequest }) => void) | undefined;
    const mockUnlisten = vi.fn();
    mockListen.mockImplementationOnce(async (_event: string, callback: any) => {
      capturedCallback = callback;
      return mockUnlisten;
    });

    await useCommsStore.getState().subscribeToApprovals();

    // Update for the editing request should be ignored
    const updatedRequest = { ...mockRequest, status: 'approved' as const };
    capturedCallback!({ payload: updatedRequest });

    // The existing request should still be pending (frozen)
    const request = useCommsStore.getState().requests.find((r) => r.id === 1);
    expect(request?.status).toBe('pending');
  });

  it('sendMessage calls invoke send_chat_message and appends to messages', async () => {
    mockInvoke.mockResolvedValueOnce(mockMessage);

    await useCommsStore.getState().sendMessage('agent-001', 'Why this change?');

    expect(mockInvoke).toHaveBeenCalledWith('send_chat_message', {
      agentId: 'agent-001',
      content: 'Why this change?',
    });
    const messages = useCommsStore.getState().messages['agent-001'];
    expect(messages).toBeDefined();
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('fetchMessages calls invoke list_chat_messages and sets messages for agentId', async () => {
    mockInvoke.mockResolvedValueOnce([mockMessage]);

    await useCommsStore.getState().fetchMessages('agent-001');

    expect(mockInvoke).toHaveBeenCalledWith('list_chat_messages', { agentId: 'agent-001' });
    const messages = useCommsStore.getState().messages['agent-001'];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Why this change?');
  });

  it('selectedRequest returns the selected request object', () => {
    useCommsStore.setState({
      requests: [mockRequest, mockRequest2],
      selectedRequestId: 2,
    });

    const selected = useCommsStore.getState().selectedRequest();
    expect(selected?.id).toBe(2);
  });

  it('reset clears all state', () => {
    useCommsStore.setState({
      requests: [mockRequest],
      selectedRequestId: 1,
      editingRequestId: 1,
      messages: { 'agent-001': [mockMessage] },
      error: 'some error',
      isLoading: true,
    });

    useCommsStore.getState().reset();

    const state = useCommsStore.getState();
    expect(state.requests).toHaveLength(0);
    expect(state.selectedRequestId).toBeNull();
    expect(state.editingRequestId).toBeNull();
    expect(state.messages).toEqual({});
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});

describe('commsStore pretool_use extension', () => {
  beforeEach(() => {
    useCommsStore.getState().reset();
    vi.clearAllMocks();
  });

  it('initializes sessionAlwaysAllow as an empty Map', () => {
    const s = useCommsStore.getState();
    expect(s.sessionAlwaysAllow).toBeInstanceOf(Map);
    expect(s.sessionAlwaysAllow.size).toBe(0);
  });

  it('status union accepts abandoned', () => {
    // TypeScript compile-time + runtime smoke — if the narrowing below
    // type-checks, the union includes 'abandoned'.
    const r = { status: 'abandoned' } as Pick<ApprovalRequest, 'status'>;
    expect(r.status).toBe('abandoned');
  });

  it('clearAlwaysAllowForAgent removes the agent key', () => {
    useCommsStore.setState({
      sessionAlwaysAllow: new Map([['KAGENT-9', new Set(['Bash'])]]),
    });
    useCommsStore.getState().clearAlwaysAllowForAgent('KAGENT-9');
    expect(useCommsStore.getState().sessionAlwaysAllow.has('KAGENT-9')).toBe(false);
  });

  it('reset clears sessionAlwaysAllow', () => {
    useCommsStore.setState({
      sessionAlwaysAllow: new Map([['KAGENT-9', new Set(['Bash'])]]),
    });
    useCommsStore.getState().reset();
    expect(useCommsStore.getState().sessionAlwaysAllow.size).toBe(0);
  });
});

describe('commsStore Phase 8 Plan 05: alwaysAllowForSession plumbing', () => {
  const pretoolRequest: ApprovalRequest = {
    id: 42,
    agentId: 'KAGENT-9',
    requestType: 'pretool_use',
    filePath: '/repo/src/main.rs',
    diffContent: null,
    status: 'pending',
    urgency: 'medium',
    responseNote: null,
    editedContent: null,
    createdAt: '2026-04-15T12:00:00Z',
    resolvedAt: null,
    toolName: 'Bash',
    toolInputJson: { command: 'ls' },
    sessionId: 'session-abc',
  };

  beforeEach(() => {
    useCommsStore.getState().reset();
    vi.clearAllMocks();
  });

  it('approveRequest passes alwaysAllowForSession: true to invoke', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveRequest(42, { alwaysAllowForSession: true });

    expect(mockInvoke).toHaveBeenCalledWith('approve_request', {
      id: 42,
      alwaysAllowForSession: true,
    });
  });

  it('approveRequest defaults alwaysAllowForSession to false when opts omitted', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveRequest(42);

    expect(mockInvoke).toHaveBeenCalledWith('approve_request', {
      id: 42,
      alwaysAllowForSession: false,
    });
  });

  it('approveRequest with alwaysAllowForSession=true adds toolName to sessionAlwaysAllow map', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveRequest(42, { alwaysAllowForSession: true });

    const m = useCommsStore.getState().sessionAlwaysAllow;
    expect(m.get('KAGENT-9')?.has('Bash')).toBe(true);
  });

  it('approveRequest with alwaysAllowForSession=false does NOT mutate sessionAlwaysAllow map', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveRequest(42, { alwaysAllowForSession: false });

    expect(useCommsStore.getState().sessionAlwaysAllow.size).toBe(0);
  });

  it('approveWithEdits passes alwaysAllowForSession: true to invoke', async () => {
    useCommsStore.setState({ requests: [{ ...pretoolRequest, toolName: 'Edit' }] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().approveWithEdits(42, 'content', { alwaysAllowForSession: true });

    expect(mockInvoke).toHaveBeenCalledWith('approve_with_edits', {
      id: 42,
      editedContent: 'content',
      alwaysAllowForSession: true,
    });
    const m = useCommsStore.getState().sessionAlwaysAllow;
    expect(m.get('KAGENT-9')?.has('Edit')).toBe(true);
  });

  it('denyRequest passes null reason by default', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().denyRequest(42);

    expect(mockInvoke).toHaveBeenCalledWith('deny_request', { id: 42, reason: null });
  });

  it('denyRequest with reason passes reason to invoke', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().denyRequest(42, { reason: 'looks destructive' });

    expect(mockInvoke).toHaveBeenCalledWith('deny_request', {
      id: 42,
      reason: 'looks destructive',
    });
  });

  it('denyRequest does NOT mutate sessionAlwaysAllow map', async () => {
    useCommsStore.setState({ requests: [pretoolRequest] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useCommsStore.getState().denyRequest(42, { reason: 'no' });

    expect(useCommsStore.getState().sessionAlwaysAllow.size).toBe(0);
  });
});
