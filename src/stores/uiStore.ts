import { create } from "zustand";

export type SidebarViewMode = "files" | "outline" | "history";

// Sidebar width constraints
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 260;

interface UIState {
  settingsOpen: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  outlineVisible: boolean;
  sidebarViewMode: SidebarViewMode;
  activeHeadingLine: number | null; // Current heading line for outline highlight
  statusBarPinned: boolean; // When true, status bar stays visible
  universalToolbarVisible: boolean; // Ctrl+E universal formatting toolbar
}

interface UIActions {
  openSettings: () => void;
  closeSettings: () => void;
  toggleSidebar: () => void;
  toggleOutline: () => void;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  showSidebarWithView: (mode: SidebarViewMode) => void;
  setActiveHeadingLine: (line: number | null) => void;
  setSidebarWidth: (width: number) => void;
  toggleStatusBar: () => void;
  setStatusBarPinned: (pinned: boolean) => void;
  toggleUniversalToolbar: () => void;
  setUniversalToolbarVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  settingsOpen: false,
  sidebarVisible: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  outlineVisible: false,
  sidebarViewMode: "outline",
  activeHeadingLine: null,
  statusBarPinned: false,
  universalToolbarVisible: false,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleOutline: () => set((state) => ({ outlineVisible: !state.outlineVisible })),
  setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
  showSidebarWithView: (mode) => set({ sidebarVisible: true, sidebarViewMode: mode }),
  setActiveHeadingLine: (line) => set({ activeHeadingLine: line }),
  setSidebarWidth: (width) => set({
    sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
  }),
  toggleStatusBar: () => set((state) => ({ statusBarPinned: !state.statusBarPinned })),
  setStatusBarPinned: (pinned) => set({ statusBarPinned: pinned }),
  toggleUniversalToolbar: () =>
    set((state) => ({ universalToolbarVisible: !state.universalToolbarVisible })),
  setUniversalToolbarVisible: (visible) => set({ universalToolbarVisible: visible }),
}));
