import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import {
  mountDeepLink,
  pickMostRecentPendingPretoolId,
  FOCUS_MIN_INTERVAL_MS,
  __resetFocusRateLimit,
} from '../deepLinkNotification';
import { useCommsStore, type ApprovalRequest } from '../../stores/commsStore';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const setFocusSpy = vi.fn();
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setFocus: setFocusSpy }),
}));

const mockListen = vi.mocked(listen);

function captureMany() {
  const handlers: Record<string, (ev: { payload: unknown }) => void> = {};
  mockListen.mockImplementation(async (name: string, handler: any) => {
    handlers[name] = handler;
    return vi.fn();
  });
  return handlers;
}

function makeRequest(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: overrides.id ?? 1,
    agentId: 'KAGENT-9',
    requestType: 'pretool_use',
    filePath: null,
    diffContent: null,
    status: 'pending',
    urgency: 'medium',
    responseNote: null,
    editedContent: null,
    createdAt: '2026-04-15T12:00:00Z',
    resolvedAt: null,
    toolName: 'Bash',
    toolInputJson: null,
    sessionId: null,
    ...overrides,
  };
}

describe('deepLinkNotification — Phase 8 Plan 05', () => {
  beforeEach(() => {
    useCommsStore.getState().reset();
    vi.clearAllMocks();
    setFocusSpy.mockClear();
    __resetFocusRateLimit();
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = '';
    }
  });

  it('FOCUS_MIN_INTERVAL_MS is 1000ms (T-08-11)', () => {
    expect(FOCUS_MIN_INTERVAL_MS).toBe(1000);
  });

  it('approval-request-created for pretool_use with /comms open calls selectRequest', async () => {
    const handlers = captureMany();
    window.location.hash = '#/comms';
    useCommsStore.setState({ requests: [makeRequest({ id: 42 })] });

    await mountDeepLink();

    handlers['approval-request-created']({
      payload: makeRequest({ id: 99, requestType: 'pretool_use' }),
    });

    expect(useCommsStore.getState().selectedRequestId).toBe(99);
  });

  it('approval-request-created ignored for write_access rows', async () => {
    const handlers = captureMany();
    window.location.hash = '#/comms';
    await mountDeepLink();

    handlers['approval-request-created']({
      payload: makeRequest({ id: 99, requestType: 'write_access' }),
    });

    expect(useCommsStore.getState().selectedRequestId).toBeNull();
  });

  it('tray-icon-clicked selects most recent pending pretool_use row', async () => {
    const handlers = captureMany();
    useCommsStore.setState({
      requests: [
        makeRequest({ id: 1, requestType: 'pretool_use', createdAt: '2026-04-15T10:00:00Z' }),
        makeRequest({ id: 2, requestType: 'pretool_use', createdAt: '2026-04-15T11:00:00Z' }),
        makeRequest({ id: 3, requestType: 'pretool_use', createdAt: '2026-04-15T09:00:00Z' }),
      ],
    });

    await mountDeepLink();
    await handlers['tray-icon-clicked']({ payload: undefined });

    expect(useCommsStore.getState().selectedRequestId).toBe(2); // newest
  });

  it('tray-click with no pretool_use falls back to most recent pending write_access', async () => {
    const handlers = captureMany();
    useCommsStore.setState({
      requests: [
        makeRequest({
          id: 5,
          requestType: 'write_access',
          createdAt: '2026-04-15T10:00:00Z',
          toolName: null,
        }),
        makeRequest({
          id: 6,
          requestType: 'write_access',
          createdAt: '2026-04-15T11:00:00Z',
          toolName: null,
        }),
      ],
    });

    await mountDeepLink();
    await handlers['tray-icon-clicked']({ payload: undefined });

    expect(useCommsStore.getState().selectedRequestId).toBe(6);
  });

  it('tray-click with no pending rows leaves selection null', async () => {
    const handlers = captureMany();
    await mountDeepLink();
    await handlers['tray-icon-clicked']({ payload: undefined });
    expect(useCommsStore.getState().selectedRequestId).toBeNull();
  });

  it('focus rate-limit: two tray-clicks within 1000ms call setFocus at most once', async () => {
    const handlers = captureMany();
    useCommsStore.setState({ requests: [makeRequest({ id: 1 })] });
    await mountDeepLink();

    await handlers['tray-icon-clicked']({ payload: undefined });
    await handlers['tray-icon-clicked']({ payload: undefined });
    await handlers['tray-icon-clicked']({ payload: undefined });

    expect(setFocusSpy).toHaveBeenCalledTimes(1);
  });

  it('notification-clicked with requestId selects that row', async () => {
    const handlers = captureMany();
    useCommsStore.setState({ requests: [makeRequest({ id: 77 })] });
    await mountDeepLink();

    await handlers['notification-clicked']({ payload: { requestId: 77 } });

    expect(useCommsStore.getState().selectedRequestId).toBe(77);
  });

  it('pickMostRecentPendingPretoolId prefers pretool_use over write_access', () => {
    useCommsStore.setState({
      requests: [
        makeRequest({
          id: 1,
          requestType: 'write_access',
          createdAt: '2026-04-15T12:00:00Z',
        }),
        makeRequest({
          id: 2,
          requestType: 'pretool_use',
          createdAt: '2026-04-15T11:00:00Z',
        }),
      ],
    });
    expect(pickMostRecentPendingPretoolId()).toBe(2);
  });

  it('pickMostRecentPendingPretoolId returns null when no pending rows', () => {
    useCommsStore.setState({ requests: [] });
    expect(pickMostRecentPendingPretoolId()).toBeNull();
  });
});
