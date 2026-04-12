import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri invoke + dialog BEFORE importing the store.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invokeMock(...args) }));
const openMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: any[]) => openMock(...args) }));

import { useRepoStore } from '../repoStore';

function resetStore() {
  useRepoStore.setState({ activeRepo: null, isPaused: false, error: null });
  invokeMock.mockReset();
  openMock.mockReset();
}

describe('repoStore.resolveInitialRepo', () => {
  beforeEach(resetStore);

  it('uses launch CWD when it is inside a git repo', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_launch_cwd') return Promise.resolve('C:/repos/aitc');
      if (cmd === 'detect_git_root') return Promise.resolve('C:/repos/aitc');
      if (cmd === 'persist_last_repo') return Promise.resolve();
      return Promise.resolve(null);
    });
    await useRepoStore.getState().resolveInitialRepo();
    expect(useRepoStore.getState().activeRepo).toBe('C:/repos/aitc');
    expect(invokeMock).toHaveBeenCalledWith('persist_last_repo', { path: 'C:/repos/aitc' });
  });

  it('falls back to persisted repo when CWD is not a git repo', async () => {
    invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_launch_cwd') return Promise.resolve('C:/not-a-repo');
      if (cmd === 'detect_git_root' && args?.path === 'C:/not-a-repo') return Promise.resolve(null);
      if (cmd === 'get_last_repo') return Promise.resolve('C:/repos/persisted');
      if (cmd === 'detect_git_root' && args?.path === 'C:/repos/persisted') return Promise.resolve('C:/repos/persisted');
      return Promise.resolve(null);
    });
    await useRepoStore.getState().resolveInitialRepo();
    expect(useRepoStore.getState().activeRepo).toBe('C:/repos/persisted');
  });

  it('opens the picker when neither CWD nor persisted repo is available', async () => {
    invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_launch_cwd') return Promise.resolve(null);
      if (cmd === 'get_last_repo') return Promise.resolve(null);
      if (cmd === 'detect_git_root') return Promise.resolve(args?.path === 'C:/picked' ? 'C:/picked' : null);
      if (cmd === 'persist_last_repo') return Promise.resolve();
      return Promise.resolve(null);
    });
    openMock.mockResolvedValue('C:/picked');
    await useRepoStore.getState().resolveInitialRepo();
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(useRepoStore.getState().activeRepo).toBe('C:/picked');
  });

  it('stays idle silently when the picker is cancelled', async () => {
    invokeMock.mockResolvedValue(null);
    openMock.mockResolvedValue(null);
    await useRepoStore.getState().resolveInitialRepo();
    expect(useRepoStore.getState().activeRepo).toBeNull();
    expect(useRepoStore.getState().error).toBeNull();
  });

  it('sets an error when the picked folder is not a git repo', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_launch_cwd') return Promise.resolve(null);
      if (cmd === 'get_last_repo') return Promise.resolve(null);
      if (cmd === 'detect_git_root') return Promise.resolve(null);
      return Promise.resolve(null);
    });
    openMock.mockResolvedValue('C:/no-git');
    await useRepoStore.getState().resolveInitialRepo();
    expect(useRepoStore.getState().activeRepo).toBeNull();
    expect(useRepoStore.getState().error).toMatch(/git repository/i);
  });
});

describe('repoStore.togglePause / changeRepo', () => {
  beforeEach(resetStore);

  it('togglePause flips isPaused', () => {
    expect(useRepoStore.getState().isPaused).toBe(false);
    useRepoStore.getState().togglePause();
    expect(useRepoStore.getState().isPaused).toBe(true);
    useRepoStore.getState().togglePause();
    expect(useRepoStore.getState().isPaused).toBe(false);
  });

  it('changeRepo leaves state unchanged when cancelled', async () => {
    useRepoStore.setState({ activeRepo: 'C:/old' });
    openMock.mockResolvedValue(null);
    await useRepoStore.getState().changeRepo();
    expect(useRepoStore.getState().activeRepo).toBe('C:/old');
  });

  it('changeRepo updates activeRepo and clears pause on success', async () => {
    useRepoStore.setState({ activeRepo: 'C:/old', isPaused: true });
    openMock.mockResolvedValue('C:/new');
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'detect_git_root') return Promise.resolve('C:/new');
      if (cmd === 'persist_last_repo') return Promise.resolve();
      return Promise.resolve(null);
    });
    await useRepoStore.getState().changeRepo();
    expect(useRepoStore.getState().activeRepo).toBe('C:/new');
    expect(useRepoStore.getState().isPaused).toBe(false);
  });
});
