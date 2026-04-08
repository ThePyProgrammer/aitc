import { create } from 'zustand';

interface PaletteStore {
  open: boolean;
  query: string;
  recentActions: string[]; // paths like '/radar', '/tower'
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  addRecentAction: (path: string) => void;
}

export const usePaletteStore = create<PaletteStore>((set) => ({
  open: false,
  query: '',
  recentActions: [],
  setOpen: (open) => set({ open, query: '' }),
  setQuery: (query) => set({ query }),
  addRecentAction: (path) =>
    set((s) => ({
      recentActions: [path, ...s.recentActions.filter((p) => p !== path)].slice(0, 5),
    })),
}));
