import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// Hoisted mock state.
const registerMock = vi.fn(() => Promise.resolve([]));
const unregisterMock = vi.fn(() => Promise.resolve());
vi.mock('../../hooks/usePipelineChannel', () => ({
  usePipelineChannel: () => ({ register: registerMock, unregister: unregisterMock }),
}));

const resolveSpy = vi.fn(() => Promise.resolve());
vi.mock('../../stores/repoStore', () => {
  const state: { activeRepo: string | null; isPaused: boolean; error: string | null } = {
    activeRepo: null,
    isPaused: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const store: any = {
    getState: () => ({
      ...state,
      resolveInitialRepo: resolveSpy,
      setError: (e: string | null) => { state.error = e; notify(); },
    }),
    setState: (patch: Partial<typeof state>) => { Object.assign(state, patch); notify(); },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
  };
  const useRepoStore = <T,>(sel: (s: any) => T) => sel(store.getState());
  (useRepoStore as any).getState = store.getState;
  (useRepoStore as any).setState = store.setState;
  (useRepoStore as any).subscribe = store.subscribe;
  return { useRepoStore };
});

import { RepoSessionProvider } from '../RepoSessionProvider';
import { useRepoStore } from '../../stores/repoStore';

beforeEach(() => {
  registerMock.mockClear();
  unregisterMock.mockClear();
  resolveSpy.mockClear();
  (useRepoStore as any).setState({ activeRepo: null, isPaused: false, error: null });
});

describe('RepoSessionProvider', () => {
  it('calls resolveInitialRepo exactly once on mount', () => {
    render(<RepoSessionProvider>child</RepoSessionProvider>);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('calls register(activeRepo) once a repo resolves and not paused', async () => {
    const { rerender } = render(<RepoSessionProvider>child</RepoSessionProvider>);
    await act(async () => {
      (useRepoStore as any).setState({ activeRepo: 'C:/repo' });
    });
    rerender(<RepoSessionProvider>child</RepoSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(registerMock).toHaveBeenCalledWith('C:/repo');
  });

  it('does NOT call register when isPaused is true', async () => {
    const { rerender } = render(<RepoSessionProvider>child</RepoSessionProvider>);
    await act(async () => {
      (useRepoStore as any).setState({ activeRepo: 'C:/repo', isPaused: true });
    });
    rerender(<RepoSessionProvider>child</RepoSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('calls unregister on unmount after a register', async () => {
    (useRepoStore as any).setState({ activeRepo: 'C:/repo' });
    const { unmount } = render(<RepoSessionProvider>child</RepoSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(unregisterMock).toHaveBeenCalled();
  });
});
