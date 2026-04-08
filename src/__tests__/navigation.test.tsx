import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarStore } from '../stores/sidebarStore';

describe('Navigation', () => {
  beforeEach(() => {
    useSidebarStore.setState({ expanded: false });
  });

  it('sidebar starts in collapsed state', () => {
    const state = useSidebarStore.getState();
    expect(state.expanded).toBe(false);
  });

  it('sidebar toggles expanded state', () => {
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState().expanded).toBe(true);
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState().expanded).toBe(false);
  });

  it.todo('renders four nav items: Radar, Tower, Comms, Conflicts');
  it.todo('highlights active nav item with primary color');
});
