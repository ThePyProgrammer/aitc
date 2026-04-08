import { describe, it, expect, beforeEach } from 'vitest';
import { usePaletteStore } from '../stores/paletteStore';

describe('Command Palette', () => {
  beforeEach(() => {
    // Reset store between tests
    usePaletteStore.setState({ open: false, query: '', recentActions: [] });
  });

  it('starts closed', () => {
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('opens and clears query', () => {
    usePaletteStore.getState().setQuery('test');
    usePaletteStore.getState().setOpen(true);
    expect(usePaletteStore.getState().open).toBe(true);
    expect(usePaletteStore.getState().query).toBe('');
  });

  it('tracks recent actions without duplicates', () => {
    const store = usePaletteStore.getState();
    store.addRecentAction('/radar');
    store.addRecentAction('/tower');
    store.addRecentAction('/radar');
    const recent = usePaletteStore.getState().recentActions;
    expect(recent[0]).toBe('/radar');
    expect(recent[1]).toBe('/tower');
    expect(recent.length).toBe(2);
  });

  it('limits recent actions to 5', () => {
    const store = usePaletteStore.getState();
    store.addRecentAction('/a');
    store.addRecentAction('/b');
    store.addRecentAction('/c');
    store.addRecentAction('/d');
    store.addRecentAction('/e');
    store.addRecentAction('/f');
    expect(usePaletteStore.getState().recentActions.length).toBe(5);
    expect(usePaletteStore.getState().recentActions[0]).toBe('/f');
  });

  it.todo('opens when Ctrl+Shift+P is pressed');
  it.todo('filters view names with fuzzy matching');
});
