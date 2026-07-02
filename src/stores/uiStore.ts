/**
 * UI Store — T09 consolidation.
 *
 * Owns transient UI state for the document window. Three legacy stores
 * (searchStore, contentSearchStore, terminalSessionStore) are merged in
 * as namespaced slices (s.search / s.contentSearch / s.terminal). The
 * original UI fields stay at root for consumer-side compatibility.
 *
 * Action names that would have collided across the source stores
 * (open/close/setQuery between search and contentSearch) are domain-
 * prefixed: searchOpen, contentSearchOpen, terminalCreateSession, …
 *
 * All type declarations live in `./uiStore/types.ts` (the leaf of the
 * import graph — no cycles); initial values and action implementations
 * live in the slice files (searchSlice.ts, contentSearchSlice.ts,
 * terminalSlice.ts) so this composition root stays under the ~300 LOC
 * guideline. Slice action creators receive this factory's `set`/`get`,
 * so subscribe/update semantics are identical to the single-file version.
 * Public types are re-exported here — consumers keep importing from
 * "@/stores/uiStore".
 *
 * @module stores/uiStore
 */

import { create } from "zustand";
import type { UIStore } from "./uiStore/types";
import { createSearchActions, initialSearch } from "./uiStore/searchSlice";
import {
  createContentSearchActions,
  initialContentSearch,
} from "./uiStore/contentSearchSlice";
import {
  createTerminalActions,
  initialTerminal,
  resetTerminalIdCounter,
} from "./uiStore/terminalSlice";

export type {
  SidebarViewMode,
  EffectiveTerminalPosition,
  UIStore,
  MatchRange,
  LineMatch,
  FileSearchResult,
  TerminalSession,
} from "./uiStore/types";
export { MAX_TERMINAL_SESSIONS } from "./uiStore/terminalSlice";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 260;

export const TERMINAL_MIN_HEIGHT = 100;
const TERMINAL_DEFAULT_HEIGHT = 250;

export const TERMINAL_MIN_WIDTH = 200;
const TERMINAL_DEFAULT_WIDTH = 400;

/**
 * Maximum share of the available dimension the terminal panel may occupy.
 * There is no fixed pixel ceiling — the cap is proportional (50% of the
 * window's available width/height). This is enforced by the viewport-aware
 * layers (useTerminalPosition for layout, useTerminalResize for drag), since
 * the store itself does not know the window size. The store setters below
 * only enforce the absolute pixel floor.
 */
export const TERMINAL_MAX_RATIO = 0.5;

/* ──────────────────────────── store factory ───────────────────────────── */

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarVisible: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  sidebarViewMode: "outline",
  activeHeadingLine: null,
  statusBarVisible: true,
  _savedStatusBarVisible: null,
  universalToolbarVisible: false,
  universalToolbarHasFocus: false,
  toolbarSessionFocusIndex: -1,
  toolbarDropdownOpen: false,
  isDraggingFiles: false,
  terminalVisible: false,
  terminalHeight: TERMINAL_DEFAULT_HEIGHT,
  terminalWidth: TERMINAL_DEFAULT_WIDTH,
  effectiveTerminalPosition: "bottom",
  fileExplorerOpenState: {},
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  sourceMode: false,
  markdownSplitView: false,
  wordWrap: true,
  showLineNumbers: false,
  diagramPreviewEnabled: false,

  search: initialSearch,
  contentSearch: initialContentSearch,
  terminal: initialTerminal,

  toggleFocusMode: () => set((s) => ({ focusModeEnabled: !s.focusModeEnabled })),
  toggleTypewriterMode: () => set((s) => ({ typewriterModeEnabled: !s.typewriterModeEnabled })),
  // WYSIWYG / Source / Split are mutually exclusive — enabling one clears the other.
  toggleSourceMode: () => set((s) => ({ sourceMode: !s.sourceMode, markdownSplitView: false })),
  setSourceMode: (enabled) => set(enabled ? { sourceMode: true, markdownSplitView: false } : { sourceMode: false }),
  toggleMarkdownSplitView: () => set((s) => ({ markdownSplitView: !s.markdownSplitView, sourceMode: false })),
  setMarkdownSplitView: (enabled) => set(enabled ? { markdownSplitView: true, sourceMode: false } : { markdownSplitView: false }),
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
  toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
  toggleDiagramPreview: () => set((s) => ({ diagramPreviewEnabled: !s.diagramPreviewEnabled })),
  resetEditorFlags: () =>
    set({
      focusModeEnabled: false,
      typewriterModeEnabled: false,
      sourceMode: false,
      markdownSplitView: false,
      wordWrap: true,
      showLineNumbers: false,
      diagramPreviewEnabled: false,
    }),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleSidebarView: (mode) =>
    set((state) => {
      if (state.sidebarVisible && state.sidebarViewMode === mode) {
        return { sidebarVisible: false };
      }
      return { sidebarVisible: true, sidebarViewMode: mode };
    }),
  setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
  showSidebarWithView: (mode) =>
    set({ sidebarVisible: true, sidebarViewMode: mode }),
  setActiveHeadingLine: (line) => set({ activeHeadingLine: line }),
  setSidebarWidth: (width) =>
    set({
      sidebarWidth: Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, width),
      ),
    }),
  setStatusBarVisible: (visible) =>
    set({ statusBarVisible: visible, _savedStatusBarVisible: null }),
  displaceStatusBar: () =>
    set((state) => ({
      statusBarVisible: false,
      _savedStatusBarVisible:
        state._savedStatusBarVisible ?? state.statusBarVisible,
    })),
  restoreStatusBar: () =>
    set((state) => {
      if (state._savedStatusBarVisible === null) return {};
      return {
        statusBarVisible: state._savedStatusBarVisible,
        _savedStatusBarVisible: null,
      };
    }),
  toggleUniversalToolbar: () =>
    set((state) => {
      if (!state.universalToolbarVisible) {
        return {
          universalToolbarVisible: true,
          universalToolbarHasFocus: true,
        };
      }
      return {
        universalToolbarHasFocus: !state.universalToolbarHasFocus,
      };
    }),
  setUniversalToolbarVisible: (visible) =>
    set((state) => ({
      universalToolbarVisible: visible,
      universalToolbarHasFocus: visible
        ? state.universalToolbarHasFocus
        : false,
      toolbarSessionFocusIndex: visible ? state.toolbarSessionFocusIndex : -1,
    })),
  setUniversalToolbarHasFocus: (hasFocus) =>
    set({ universalToolbarHasFocus: hasFocus }),
  setToolbarSessionFocusIndex: (index) =>
    set({ toolbarSessionFocusIndex: index }),
  setToolbarDropdownOpen: (open) => set({ toolbarDropdownOpen: open }),
  clearToolbarSession: () =>
    set({
      universalToolbarVisible: false,
      universalToolbarHasFocus: false,
      toolbarSessionFocusIndex: -1,
      toolbarDropdownOpen: false,
    }),
  setDraggingFiles: (dragging) => set({ isDraggingFiles: dragging }),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  // Only the absolute pixel floor is enforced here; the proportional 50% cap
  // (TERMINAL_MAX_RATIO) is applied by the viewport-aware callers that know the
  // window size — useTerminalPosition (layout) and useTerminalResize (drag).
  setTerminalHeight: (h) =>
    set({ terminalHeight: Math.max(TERMINAL_MIN_HEIGHT, h) }),
  setTerminalWidth: (w) =>
    set({ terminalWidth: Math.max(TERMINAL_MIN_WIDTH, w) }),
  setEffectiveTerminalPosition: (pos) =>
    set({ effectiveTerminalPosition: pos }),
  setFileExplorerNodeOpen: (id, open) => {
    const current = get().fileExplorerOpenState;
    if (current[id] === open) return;
    set({ fileExplorerOpenState: { ...current, [id]: open } });
  },
  setFileExplorerOpenState: (next) => set({ fileExplorerOpenState: next }),

  ...createSearchActions(set, get),
  ...createContentSearchActions(set, get),
  ...createTerminalActions(set, get),
}));

/** Reset terminal slice + ID counter — for tests only. */
export function resetTerminalSessionStore(): void {
  resetTerminalIdCounter();
  useUIStore.setState({ terminal: initialTerminal });
}
