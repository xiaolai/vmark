import { create } from "zustand";

type SidebarViewMode = "files" | "outline" | "history";

interface UIState {
  settingsOpen: boolean;
  sidebarVisible: boolean;
  outlineVisible: boolean;
  sidebarViewMode: SidebarViewMode;
}

interface UIActions {
  openSettings: () => void;
  closeSettings: () => void;
  toggleSidebar: () => void;
  toggleOutline: () => void;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  showSidebarWithView: (mode: SidebarViewMode) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  settingsOpen: false,
  sidebarVisible: false,
  outlineVisible: false,
  sidebarViewMode: "outline",

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleOutline: () => set((state) => ({ outlineVisible: !state.outlineVisible })),
  setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
  showSidebarWithView: (mode) => set({ sidebarVisible: true, sidebarViewMode: mode }),
}));
