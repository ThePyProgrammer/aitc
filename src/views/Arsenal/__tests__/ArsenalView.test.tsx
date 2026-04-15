// Phase 9 ARSENAL — ArsenalView mount + scaffold tests (Plan 05 Wave 3, Task 1).

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (hoisted) -------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => {
  const invoke = vi.fn();
  class FakeChannel {}
  return { invoke, Channel: FakeChannel };
});

const startMock = vi.fn();
const stopMock = vi.fn();

vi.mock('../../../hooks/useClaudeResourcesChannel', () => ({
  useClaudeResourcesChannel: () => ({
    start: startMock,
    stop: stopMock,
  }),
}));

// Mock useRepoStore selector form: store(s => s.activeRepo)
vi.mock('../../../stores/repoStore', () => ({
  useRepoStore: (selector: (s: { activeRepo: string | null }) => unknown) =>
    selector({ activeRepo: '/fake/proj' }),
}));

import { ArsenalView } from '../ArsenalView';
import { useClaudeResourcesStore } from '../../../stores/claudeResourcesStore';

beforeEach(() => {
  startMock.mockReset().mockResolvedValue([]);
  stopMock.mockReset().mockResolvedValue(undefined);
  useClaudeResourcesStore.setState({
    resourcesById: {},
    loaded: false,
    droppedBatches: 0,
    externalEdits: {},
  });
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('ArsenalView (scaffold)', () => {
  it('renders the ARSENAL page heading', () => {
    render(<ArsenalView />);
    expect(screen.getByRole('heading', { name: 'ARSENAL' })).toBeInTheDocument();
  });

  it('renders the three scope tabs with role="tab"', () => {
    render(<ArsenalView />);
    const tablist = screen.getByRole('tablist', { name: 'Scope' });
    const tabs = within(tablist).getAllByRole('tab');
    const labels = tabs.map((t) => t.textContent);
    expect(labels).toEqual(['GLOBAL', 'PROJECT', 'COMBINED']);
  });

  it('renders the four categories in the left rail', () => {
    render(<ArsenalView />);
    const rail = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(rail).getByText('SKILLS')).toBeInTheDocument();
    expect(within(rail).getByText('AGENTS')).toBeInTheDocument();
    expect(within(rail).getByText('PLUGINS')).toBeInTheDocument();
    expect(within(rail).getByText('CONFIGURATION')).toBeInTheDocument();
  });

  it('invokes start(activeRepo) once on mount', () => {
    render(<ArsenalView />);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('/fake/proj');
  });

  it('renders the NO_SKILLS_INSTALLED empty state when the store is empty (default skill + combined)', () => {
    render(<ArsenalView />);
    expect(screen.getByText('NO_SKILLS_INSTALLED')).toBeInTheDocument();
  });
});
