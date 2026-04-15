import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { PassiveHookConsentDialog } from '../PassiveHookConsentDialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

function captureListener<T = unknown>() {
  let cb: ((ev: { payload: T }) => void) | undefined;
  const unlisten = vi.fn();
  mockListen.mockImplementation(async (_name: string, handler: any) => {
    cb = handler;
    return unlisten;
  });
  return {
    fire: (payload: T) => {
      act(() => {
        cb?.({ payload });
      });
    },
    unlisten,
  };
}

describe('PassiveHookConsentDialog — Phase 8 Plan 05', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing until a passive-claude-detected event fires', () => {
    captureListener();
    const { container } = render(<PassiveHookConsentDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('subscribes to passive-claude-detected on mount', () => {
    captureListener();
    render(<PassiveHookConsentDialog />);
    expect(mockListen).toHaveBeenCalledWith('passive-claude-detected', expect.any(Function));
  });

  it('renders modal when event fires with cwd / agentId payload', async () => {
    const cap = captureListener<{ cwd: string; pid: number; agentId: string }>();
    render(<PassiveHookConsentDialog />);
    cap.fire({ cwd: '/repo/x', pid: 1234, agentId: 'KAGENT-9' });
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByText('/repo/x')).toBeTruthy();
      expect(screen.getByText(/KAGENT-9/)).toBeTruthy();
    });
  });

  it('Accept invokes accept_passive_hook_consent with the cwd', async () => {
    const cap = captureListener<{ cwd: string; pid: number; agentId: string }>();
    render(<PassiveHookConsentDialog />);
    cap.fire({ cwd: '/repo/x', pid: 1234, agentId: 'KAGENT-9' });
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByText('ACCEPT'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('accept_passive_hook_consent', { repoCwd: '/repo/x' });
    });
  });

  it('Decline invokes decline_passive_hook_consent with the cwd', async () => {
    const cap = captureListener<{ cwd: string; pid: number; agentId: string }>();
    render(<PassiveHookConsentDialog />);
    cap.fire({ cwd: '/repo/y', pid: 2, agentId: 'KAGENT-1' });
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByText('DECLINE'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('decline_passive_hook_consent', { repoCwd: '/repo/y' });
    });
  });

  it('dismisses modal after Accept', async () => {
    const cap = captureListener<{ cwd: string; pid: number; agentId: string }>();
    render(<PassiveHookConsentDialog />);
    cap.fire({ cwd: '/repo/z', pid: 3, agentId: 'KAGENT-2' });
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByText('ACCEPT'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('queues multiple events and shows them one-at-a-time', async () => {
    const cap = captureListener<{ cwd: string; pid: number; agentId: string }>();
    render(<PassiveHookConsentDialog />);

    cap.fire({ cwd: '/a', pid: 1, agentId: 'A' });
    cap.fire({ cwd: '/b', pid: 2, agentId: 'B' });
    cap.fire({ cwd: '/c', pid: 3, agentId: 'C' });

    await waitFor(() => expect(screen.getByText('/a')).toBeTruthy());
    fireEvent.click(screen.getByText('ACCEPT'));
    await waitFor(() => expect(screen.getByText('/b')).toBeTruthy());
    fireEvent.click(screen.getByText('DECLINE'));
    await waitFor(() => expect(screen.getByText('/c')).toBeTruthy());
  });
});
