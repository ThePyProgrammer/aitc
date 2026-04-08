import { create } from 'zustand';

interface SidebarStore {
  expanded: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  expanded: false, // D-01: starts collapsed on every launch, no persistence
  toggle: () => set((s) => ({ expanded: !s.expanded })),
}));
