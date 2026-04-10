import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useConflictStore } from '../conflictStore';
import type { ConflictAlert } from '../conflictStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const mockAlert: ConflictAlert = {
  id: 'CNFL-1000-abc',
  filePath: '/repo/src/main.rs',
  agentAId: 'agent-001',
  agentAPid: 100,
  agentBId: 'agent-002',
  agentBPid: 200,
  detectedAtMs: 3000,
  conflictWindowMs: 5000,
  hunkHintsA: null,
  hunkHintsB: null,
  dismissed: false,
};

const mockAlert2: ConflictAlert = {
  id: 'CNFL-2000-def',
  filePath: '/repo/src/lib.rs',
  agentAId: 'agent-003',
  agentAPid: 300,
  agentBId: 'agent-004',
  agentBPid: 400,
  detectedAtMs: 4000,
  conflictWindowMs: 5000,
  hunkHintsA: [0, 100],
  hunkHintsB: [50, 150],
  dismissed: false,
};

describe('conflictStore', () => {
  beforeEach(() => {
    useConflictStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchConflicts calls invoke list_conflicts and sets alerts', async () => {
    mockInvoke.mockResolvedValueOnce([mockAlert, mockAlert2]);

    await useConflictStore.getState().fetchConflicts();

    expect(mockInvoke).toHaveBeenCalledWith('list_conflicts');
    const state = useConflictStore.getState();
    expect(state.alerts).toHaveLength(2);
    expect(state.alerts[0].id).toBe('CNFL-1000-abc');
  });

  it('dismissConflict calls invoke and marks alert dismissed', async () => {
    useConflictStore.setState({ alerts: [mockAlert, mockAlert2] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useConflictStore.getState().dismissConflict('CNFL-1000-abc');

    expect(mockInvoke).toHaveBeenCalledWith('dismiss_conflict', { conflictId: 'CNFL-1000-abc' });
    const alerts = useConflictStore.getState().alerts;
    expect(alerts[0].dismissed).toBe(true);
    expect(alerts[1].dismissed).toBe(false);
  });

  it('subscribeToEvents calls listen with conflict-detected and returns unlisten', async () => {
    const mockUnlisten = vi.fn();
    mockListen.mockResolvedValueOnce(mockUnlisten);

    const unlisten = await useConflictStore.getState().subscribeToEvents();

    expect(mockListen).toHaveBeenCalledWith('conflict-detected', expect.any(Function));
    expect(unlisten).toBe(mockUnlisten);
  });

  it('listen callback appends ConflictAlert to alerts', async () => {
    let capturedCallback: ((event: { payload: ConflictAlert }) => void) | undefined;
    const mockUnlisten = vi.fn();
    mockListen.mockImplementationOnce(async (_event: string, callback: any) => {
      capturedCallback = callback;
      return mockUnlisten;
    });

    await useConflictStore.getState().subscribeToEvents();

    expect(capturedCallback).toBeDefined();

    // Simulate a real-time conflict event from Rust
    capturedCallback!({ payload: mockAlert });
    expect(useConflictStore.getState().alerts).toHaveLength(1);
    expect(useConflictStore.getState().alerts[0].id).toBe('CNFL-1000-abc');

    // Simulate another event
    capturedCallback!({ payload: mockAlert2 });
    expect(useConflictStore.getState().alerts).toHaveLength(2);
  });

  it('activeCount returns count of non-dismissed alerts', () => {
    useConflictStore.setState({
      alerts: [
        { ...mockAlert, dismissed: false },
        { ...mockAlert2, dismissed: true },
      ],
    });

    expect(useConflictStore.getState().activeCount()).toBe(1);
  });

  it('updateWindow calls invoke with windowMs and updates state', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await useConflictStore.getState().updateWindow(10000);

    expect(mockInvoke).toHaveBeenCalledWith('update_conflict_window', { windowMs: 10000 });
    expect(useConflictStore.getState().windowMs).toBe(10000);
  });

  it('fetchSettings calls invoke get_conflict_settings and sets windowMs', async () => {
    mockInvoke.mockResolvedValueOnce(15000);

    await useConflictStore.getState().fetchSettings();

    expect(mockInvoke).toHaveBeenCalledWith('get_conflict_settings');
    expect(useConflictStore.getState().windowMs).toBe(15000);
  });

  it('reset clears alerts and resets windowMs', () => {
    useConflictStore.setState({
      alerts: [mockAlert],
      windowMs: 10000,
    });

    useConflictStore.getState().reset();

    const state = useConflictStore.getState();
    expect(state.alerts).toHaveLength(0);
    expect(state.windowMs).toBe(5000);
  });
});
