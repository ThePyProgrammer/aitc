import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const { installSpy, registerMock, unregisterMock } = vi.hoisted(() => ({
  installSpy: vi.fn(() => vi.fn()),
  registerMock: vi.fn(() => Promise.resolve([])),
  unregisterMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../stores/radarStore', async () => {
  const actual = await vi.importActual<any>('../../stores/radarStore');
  return { ...actual, installRadarPipelineBridge: installSpy };
});

vi.mock('../../hooks/usePipelineChannel', () => ({
  usePipelineChannel: () => ({ register: registerMock, unregister: unregisterMock }),
}));

vi.mock('../../stores/repoStore', () => {
  const useRepoStore: any = (sel: any) => sel({ activeRepo: null, isPaused: false, error: null });
  useRepoStore.getState = () => ({
    activeRepo: null,
    isPaused: false,
    error: null,
    resolveInitialRepo: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
  });
  return { useRepoStore };
});

import { RepoSessionProvider } from '../RepoSessionProvider';

describe('RepoSessionProvider integration', () => {
  it('installs bridge on mount and cleans up on unmount', () => {
    const unsub = vi.fn();
    installSpy.mockReturnValue(unsub);
    const { unmount } = render(<RepoSessionProvider>x</RepoSessionProvider>);
    expect(installSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
