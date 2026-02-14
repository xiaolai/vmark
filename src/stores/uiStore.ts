import { create } from "zustand";

export type SidebarViewMode = "files" | "outline" | "history";

// Sidebar width constraints
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 260;

// Terminal height constraints
const TERMINAL_MIN_HEIGHT = 100;
const TERMINAL_MAX_HEIGHT = 600;
const TERMINAL_DEFAULT_HEIGHT = 250;

interface UIState {
  settingsOpen: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarViewMode: SidebarViewMode;
  activeHeadingLine: number | null; // Current heading line for outline highlight
  statusBarVisible: boolean; // Simple toggle for status bar visibility (Cmd+J)
  universalToolbarVisible: boolean; // Universal formatting toolbar (shortcut configurable)
  universalToolbarHasFocus: boolean; // Keyboard focus is inside the universal toolbar
  toolbarSessionFocusIndex: number; // Session-only focus index (cleared on toolbar close)
  toolbarDropdownOpen: boolean; // Whether a dropdown menu is currently open
  isDraggingFiles: boolean; // Files are being dragged over the window
  terminalVisible: boolean;
  terminalHeight: number;
}

interface UIActions {
  openSettings: () => void;
  closeSettings: () => void;
  toggleSidebar: () => void;
  /** Toggle a specific sidebar view: show if hidden/different, hide if already showing */
  toggleSidebarView: (mode: SidebarViewMode) => void;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  showSidebarWithView: (mode: SidebarViewMode) => void;
  setActiveHeadingLine: (line: number | null) => void;
  setSidebarWidth: (width: number) => void;
  setStatusBarVisible: (visible: boolean) => void;
  /** Focus toggle per spec Section 1.2 */
  toggleUniversalToolbar: () => void;
  setUniversalToolbarVisible: (visible: boolean) => void;
  setUniversalToolbarHasFocus: (hasFocus: boolean) => void;
  setToolbarSessionFocusIndex: (index: number) => void;
  setToolbarDropdownOpen: (open: boolean) => void;
  /** Clear session memory when toolbar closes */
  clearToolbarSession: () => void;
  setDraggingFiles: (dragging: boolean) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  settingsOpen: false,
  sidebarVisible: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  sidebarViewMode: "outline",
  activeHeadingLine: null,
  statusBarVisible: true, // Default to visible
  universalToolbarVisible: false,
  universalToolbarHasFocus: false,
  toolbarSessionFocusIndex: -1, // Session-only, -1 = use smart focus
  toolbarDropdownOpen: false,
  isDraggingFiles: false,
  terminalVisible: false,
  terminalHeight: TERMINAL_DEFAULT_HEIGHT,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleSidebarView: (mode) => set((state) => {
    if (state.sidebarVisible && state.sidebarViewMode === mode) {
      return { sidebarVisible: false };
    }
    return { sidebarVisible: true, sidebarViewMode: mode };
  }),
  setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
  showSidebarWithView: (mode) => set({ sidebarVisible: true, sidebarViewMode: mode }),
  setActiveHeadingLine: (line) => set({ activeHeadingLine: line }),
  setSidebarWidth: (width) => set({
    sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
  }),
  setStatusBarVisible: (visible) => set({ statusBarVisible: visible }),

  /**
   * Focus toggle per spec Section 1.2:
   * - Toolbar closed → Open + focus toolbar
   * - Toolbar open, editor focused → Focus toolbar (use session memory)
   * - Toolbar open, toolbar focused → Focus editor (toolbar stays open)
   */
  toggleUniversalToolbar: () =>
    set((state) => {
      if (!state.universalToolbarVisible) {
        // Closed → Open + focus
        return {
          universalToolbarVisible: true,
          universalToolbarHasFocus: true,
        };
      }
      // Open → Toggle focus location
      return {
        universalToolbarHasFocus: !state.universalToolbarHasFocus,
      };
    }),

  setUniversalToolbarVisible: (visible) =>
    set((state) => ({
      universalToolbarVisible: visible,
      universalToolbarHasFocus: visible ? state.universalToolbarHasFocus : false,
      // Clear session memory when closing
      toolbarSessionFocusIndex: visible ? state.toolbarSessionFocusIndex : -1,
    })),

  setUniversalToolbarHasFocus: (hasFocus) => set({ universalToolbarHasFocus: hasFocus }),
  setToolbarSessionFocusIndex: (index) => set({ toolbarSessionFocusIndex: index }),
  setToolbarDropdownOpen: (open) => set({ toolbarDropdownOpen: open }),

  clearToolbarSession: () => set({
    universalToolbarVisible: false,
    universalToolbarHasFocus: false,
    toolbarSessionFocusIndex: -1,
    toolbarDropdownOpen: false,
  }),

  setDraggingFiles: (dragging) => set({ isDraggingFiles: dragging }),

  toggleTerminal: () => set((state) => ({ terminalVisible: !state.terminalVisible })),
  setTerminalHeight: (h) => set({
    terminalHeight: Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, h)),
  }),
}));
