/**
 * Zustand store for UI preferences
 */

import { create } from 'zustand';

interface UIStore {
  sidebarOpen: boolean;
  sidePanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidePanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  sidePanelOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidePanelOpen: (open) => set({ sidePanelOpen: open }),
}));
