// Phase 9 ARSENAL — keyboard contract tests (Plan 05 Wave 3, Task 2).
//
// Exercises the 09-UI-SPEC §Interaction Contract behaviors that are hard to
// validate visually in the human-verify checkpoint alone:
//   - `/` focuses the filter input.
//   - ↓ moves selection in the resource list.
//   - Esc in the filter input clears the value.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Resource } from '../../../bindings';

vi.mock('@tauri-apps/api/core', () => {
  const invoke = vi.fn().mockResolvedValue({
    content: '',
    editable: false,
    path: '',
  });
  class FakeChannel {}
  return { invoke, Channel: FakeChannel };
});

const startMock = vi.fn();
const stopMock = vi.fn();

vi.mock('../../../hooks/useClaudeResourcesChannel', () => ({
  useClaudeResourcesChannel: () => ({ start: startMock, stop: stopMock }),
}));

vi.mock('../../../stores/repoStore', () => ({
  useRepoStore: (selector: (s: { activeRepo: string | null }) => unknown) =>
    selector({ activeRepo: '/fake/proj' }),
}));

import { ArsenalView } from '../ArsenalView';
import { useClaudeResourcesStore } from '../../../stores/claudeResourcesStore';

function mkSkill(id: string, name: string): Resource {
  return {
    id,
    category: 'skill',
    scope: 'global',
    name,
    description: `desc-${name}`,
    path: `/home/x/.claude/skills/${name}/SKILL.md`,
    metadata: { kind: 'skill', tools: null, allowedTools: null },
  };
}

beforeEach(() => {
  startMock.mockReset().mockResolvedValue([]);
  stopMock.mockReset().mockResolvedValue(undefined);
  useClaudeResourcesStore.setState({
    resourcesById: {
      a: mkSkill('a', 'alpha'),
      b: mkSkill('b', 'bravo'),
    },
    loaded: true,
    droppedBatches: 0,
    externalEdits: {},
  });
  // jsdom returns 0 for offsetHeight/clientRect, which collapses the TanStack
  // virtualizer to render zero rows. Stub the layout primitives so the
  // virtualizer computes a viewport large enough to emit every row.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: 800,
  });
});

describe('ArsenalView keyboard contract', () => {
  it("pressing '/' focuses the filter input", () => {
    render(<ArsenalView />);
    // Switch to global scope so the skills show up.
    fireEvent.click(screen.getByRole('tab', { name: 'GLOBAL' }));
    const filter = screen.getByTestId('arsenal-filter-input');
    expect(document.activeElement).not.toBe(filter);
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(filter);
  });

  it('Arrow Down moves selection from first to second row', () => {
    render(<ArsenalView />);
    fireEvent.click(screen.getByRole('tab', { name: 'GLOBAL' }));

    const rows = screen.getAllByTestId('arsenal-resource-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Click first row to establish selection.
    fireEvent.click(rows[0]);
    const listbox = screen.getByTestId('arsenal-resource-listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    // After ArrowDown, second row should be aria-selected.
    const updatedRows = screen.getAllByTestId('arsenal-resource-row');
    expect(updatedRows[0].getAttribute('aria-selected')).toBe('false');
    expect(updatedRows[1].getAttribute('aria-selected')).toBe('true');
  });

  it('Esc in the filter input clears the value', () => {
    render(<ArsenalView />);
    fireEvent.click(screen.getByRole('tab', { name: 'GLOBAL' }));
    const filter = screen.getByTestId('arsenal-filter-input') as HTMLInputElement;
    fireEvent.change(filter, { target: { value: 'alp' } });
    expect(filter.value).toBe('alp');
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(filter.value).toBe('');
  });
});
