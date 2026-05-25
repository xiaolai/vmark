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
 * @module stores/uiStore
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listFormats } from "@/lib/formats/registry";

/* ────────────────────────────── ui slice ──────────────────────────────── */

export type SidebarViewMode = "files" | "outline" | "history";
export type EffectiveTerminalPosition = "bottom" | "right";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 260;

export const TERMINAL_MIN_HEIGHT = 100;
export const TERMINAL_MAX_HEIGHT = 600;
const TERMINAL_DEFAULT_HEIGHT = 250;

export const TERMINAL_MIN_WIDTH = 200;
export const TERMINAL_MAX_WIDTH = 800;
const TERMINAL_DEFAULT_WIDTH = 400;

/* ─────────────────────────── search slice ─────────────────────────────── */

interface SearchSlice {
  isOpen: boolean;
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  searchMarkdown: boolean;
  matchCount: number;
  currentIndex: number;
}

const initialSearch: SearchSlice = {
  isOpen: false,
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  searchMarkdown: false,
  matchCount: 0,
  currentIndex: -1,
};

/* ──────────────────────── content-search slice ────────────────────────── */

export interface MatchRange {
  start: number;
  end: number;
}

export interface LineMatch {
  lineNumber: number;
  lineContent: string;
  matchRanges: MatchRange[];
}

export interface FileSearchResult {
  path: string;
  relativePath: string;
  matches: LineMatch[];
}

interface ContentSearchSlice {
  isOpen: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  markdownOnly: boolean;
  results: FileSearchResult[];
  selectedIndex: number;
  isSearching: boolean;
  error: string | null;
  totalMatches: number;
  totalFiles: number;
}

const initialContentSearch: ContentSearchSlice = {
  isOpen: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  markdownOnly: true,
  results: [],
  selectedIndex: 0,
  isSearching: false,
  error: null,
  totalMatches: 0,
  totalFiles: 0,
};

let contentSearchRequestId = 0;

function countFlatMatches(results: FileSearchResult[]): number {
  return results.reduce((sum, file) => sum + file.matches.length, 0);
}

/* ──────────────────────────── terminal slice ──────────────────────────── */

export interface TerminalSession {
  id: string;
  label: string;
  isAlive: boolean;
}

const MAX_TERMINAL_SESSIONS = 5;

interface TerminalSlice {
  sessions: TerminalSession[];
  activeSessionId: string | null;
}

const initialTerminal: TerminalSlice = {
  sessions: [],
  activeSessionId: null,
};

let nextTerminalId = 1;

function generateTerminalId(): string {
  return `term-${nextTerminalId++}`;
}

function generateTerminalLabel(sessions: TerminalSession[]): string {
  const used = new Set(
    sessions
      .map((s) => {
        const m = s.label.match(/^Terminal (\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `Terminal ${n}`;
}

/* ──────────────────────────── ui slice shape ──────────────────────────── */

interface UIState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarViewMode: SidebarViewMode;
  activeHeadingLine: number | null;
  statusBarVisible: boolean;
  _savedStatusBarVisible: boolean | null;
  universalToolbarVisible: boolean;
  universalToolbarHasFocus: boolean;
  toolbarSessionFocusIndex: number;
  toolbarDropdownOpen: boolean;
  isDraggingFiles: boolean;
  terminalVisible: boolean;
  terminalHeight: number;
  terminalWidth: number;
  effectiveTerminalPosition: EffectiveTerminalPosition;
  fileExplorerOpenState: Record<string, boolean>;
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  sourceMode: boolean;
  wordWrap: boolean;
  showLineNumbers: boolean;
  diagramPreviewEnabled: boolean;

  // merged slices
  search: SearchSlice;
  contentSearch: ContentSearchSlice;
  terminal: TerminalSlice;
}

interface UIActions {
  toggleSidebar: () => void;
  toggleSidebarView: (mode: SidebarViewMode) => void;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  showSidebarWithView: (mode: SidebarViewMode) => void;
  setActiveHeadingLine: (line: number | null) => void;
  setSidebarWidth: (width: number) => void;
  setStatusBarVisible: (visible: boolean) => void;
  displaceStatusBar: () => void;
  restoreStatusBar: () => void;
  toggleUniversalToolbar: () => void;
  setUniversalToolbarVisible: (visible: boolean) => void;
  setUniversalToolbarHasFocus: (hasFocus: boolean) => void;
  setToolbarSessionFocusIndex: (index: number) => void;
  setToolbarDropdownOpen: (open: boolean) => void;
  clearToolbarSession: () => void;
  setDraggingFiles: (dragging: boolean) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
  setTerminalWidth: (width: number) => void;
  setEffectiveTerminalPosition: (pos: EffectiveTerminalPosition) => void;
  setFileExplorerNodeOpen: (id: string, open: boolean) => void;
  setFileExplorerOpenState: (next: Record<string, boolean>) => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  toggleSourceMode: () => void;
  setSourceMode: (enabled: boolean) => void;
  toggleWordWrap: () => void;
  toggleLineNumbers: () => void;
  toggleDiagramPreview: () => void;
  resetEditorFlags: () => void;

  // search slice
  searchOpen: () => void;
  searchClose: () => void;
  searchToggle: () => void;
  searchSetQuery: (query: string) => void;
  searchSetReplaceText: (text: string) => void;
  searchToggleCaseSensitive: () => void;
  searchToggleWholeWord: () => void;
  searchToggleRegex: () => void;
  searchToggleSearchMarkdown: () => void;
  searchSetMatches: (count: number, currentIndex: number) => void;
  searchFindNext: () => void;
  searchFindPrevious: () => void;
  searchReplaceCurrent: () => void;
  searchReplaceAll: () => void;

  // content-search slice
  contentSearchOpen: () => void;
  contentSearchClose: () => void;
  contentSearchSetQuery: (query: string) => void;
  contentSearchSetCaseSensitive: (value: boolean) => void;
  contentSearchSetWholeWord: (value: boolean) => void;
  contentSearchSetUseRegex: (value: boolean) => void;
  contentSearchSetMarkdownOnly: (value: boolean) => void;
  contentSearchRun: (rootPath: string, excludeFolders: string[]) => Promise<void>;
  contentSearchSelectNext: () => void;
  contentSearchSelectPrev: () => void;
  contentSearchClearResults: () => void;

  // terminal slice
  terminalCreateSession: () => TerminalSession | null;
  terminalRemoveSession: (id: string) => void;
  terminalSetActiveSession: (id: string) => void;
  terminalMarkSessionDead: (id: string) => void;
  terminalMarkSessionAlive: (id: string) => void;
  terminalRenameSession: (id: string, label: string) => void;
}

export type UIStore = UIState & UIActions;

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
  wordWrap: true,
  showLineNumbers: false,
  diagramPreviewEnabled: false,

  search: initialSearch,
  contentSearch: initialContentSearch,
  terminal: initialTerminal,

  toggleFocusMode: () =>
    set((state) => ({ focusModeEnabled: !state.focusModeEnabled })),
  toggleTypewriterMode: () =>
    set((state) => ({ typewriterModeEnabled: !state.typewriterModeEnabled })),
  toggleSourceMode: () =>
    set((state) => ({ sourceMode: !state.sourceMode })),
  setSourceMode: (enabled) => set({ sourceMode: enabled }),
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
  toggleLineNumbers: () =>
    set((state) => ({ showLineNumbers: !state.showLineNumbers })),
  toggleDiagramPreview: () =>
    set((state) => ({ diagramPreviewEnabled: !state.diagramPreviewEnabled })),
  resetEditorFlags: () =>
    set({
      focusModeEnabled: false,
      typewriterModeEnabled: false,
      sourceMode: false,
      wordWrap: true,
      showLineNumbers: false,
      diagramPreviewEnabled: false,
    }),

  toggleSidebar: () =>
    set((state) => ({ sidebarVisible: !state.sidebarVisible })),
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
  toggleTerminal: () =>
    set((state) => ({ terminalVisible: !state.terminalVisible })),
  setTerminalHeight: (h) =>
    set({
      terminalHeight: Math.min(
        TERMINAL_MAX_HEIGHT,
        Math.max(TERMINAL_MIN_HEIGHT, h),
      ),
    }),
  setTerminalWidth: (w) =>
    set({
      terminalWidth: Math.min(
        TERMINAL_MAX_WIDTH,
        Math.max(TERMINAL_MIN_WIDTH, w),
      ),
    }),
  setEffectiveTerminalPosition: (pos) =>
    set({ effectiveTerminalPosition: pos }),
  setFileExplorerNodeOpen: (id, open) => {
    const current = get().fileExplorerOpenState;
    if (current[id] === open) return;
    set({ fileExplorerOpenState: { ...current, [id]: open } });
  },
  setFileExplorerOpenState: (next) => set({ fileExplorerOpenState: next }),

  /* search slice actions */
  searchOpen: () =>
    set((s) => ({ search: { ...s.search, isOpen: true } })),
  searchClose: () =>
    set((s) => ({ search: { ...s.search, isOpen: false } })),
  searchToggle: () =>
    set((s) => ({ search: { ...s.search, isOpen: !s.search.isOpen } })),
  searchSetQuery: (query) =>
    set((s) => ({ search: { ...s.search, query, currentIndex: -1 } })),
  searchSetReplaceText: (replaceText) =>
    set((s) => ({ search: { ...s.search, replaceText } })),
  searchToggleCaseSensitive: () =>
    set((s) => ({
      search: {
        ...s.search,
        caseSensitive: !s.search.caseSensitive,
        currentIndex: -1,
      },
    })),
  searchToggleWholeWord: () =>
    set((s) => ({
      search: {
        ...s.search,
        wholeWord: !s.search.wholeWord,
        currentIndex: -1,
      },
    })),
  searchToggleRegex: () =>
    set((s) => ({
      search: {
        ...s.search,
        useRegex: !s.search.useRegex,
        currentIndex: -1,
      },
    })),
  searchToggleSearchMarkdown: () =>
    set((s) => ({
      search: {
        ...s.search,
        searchMarkdown: !s.search.searchMarkdown,
        currentIndex: -1,
      },
    })),
  searchSetMatches: (matchCount, currentIndex) =>
    set((s) => ({ search: { ...s.search, matchCount, currentIndex } })),
  searchFindNext: () => {
    const { matchCount, currentIndex } = get().search;
    if (matchCount === 0) return;
    const next = currentIndex + 1 >= matchCount ? 0 : currentIndex + 1;
    set((s) => ({ search: { ...s.search, currentIndex: next } }));
  },
  searchFindPrevious: () => {
    const { matchCount, currentIndex } = get().search;
    if (matchCount === 0) return;
    const prev = currentIndex - 1 < 0 ? matchCount - 1 : currentIndex - 1;
    set((s) => ({ search: { ...s.search, currentIndex: prev } }));
  },
  searchReplaceCurrent: () => {
    window.dispatchEvent(new CustomEvent("search:replace-current"));
  },
  searchReplaceAll: () => {
    window.dispatchEvent(new CustomEvent("search:replace-all"));
  },

  /* content-search slice actions */
  contentSearchOpen: () =>
    set((s) => ({
      contentSearch: {
        ...s.contentSearch,
        isOpen: true,
        selectedIndex: 0,
        error: null,
      },
    })),
  contentSearchClose: () => {
    ++contentSearchRequestId;
    set((s) => ({
      contentSearch: { ...s.contentSearch, isOpen: false, isSearching: false },
    }));
  },
  contentSearchSetQuery: (query) =>
    set((s) => ({
      contentSearch: {
        ...s.contentSearch,
        query,
        selectedIndex: 0,
        error: null,
      },
    })),
  contentSearchSetCaseSensitive: (value) =>
    set((s) => ({
      contentSearch: { ...s.contentSearch, caseSensitive: value },
    })),
  contentSearchSetWholeWord: (value) =>
    set((s) => ({
      contentSearch: { ...s.contentSearch, wholeWord: value },
    })),
  contentSearchSetUseRegex: (value) =>
    set((s) => ({
      contentSearch: { ...s.contentSearch, useRegex: value },
    })),
  contentSearchSetMarkdownOnly: (value) =>
    set((s) => ({
      contentSearch: { ...s.contentSearch, markdownOnly: value },
    })),
  contentSearchRun: async (rootPath, excludeFolders) => {
    const { query, caseSensitive, wholeWord, useRegex, markdownOnly } =
      get().contentSearch;

    if (query.trim().length < 3) {
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          results: [],
          totalMatches: 0,
          totalFiles: 0,
          error: null,
        },
      }));
      return;
    }

    const requestId = ++contentSearchRequestId;
    set((s) => ({
      contentSearch: { ...s.contentSearch, isSearching: true, error: null },
    }));

    try {
      const extensions = markdownOnly
        ? listFormats()
            .filter((f) => f.adapters.contentSearchIndexed === true)
            .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
        : [];

      const results = await invoke<FileSearchResult[]>(
        "search_workspace_content",
        {
          rootPath,
          query,
          caseSensitive,
          wholeWord,
          useRegex,
          markdownOnly,
          extensions,
          excludeFolders,
        },
      );

      if (requestId !== contentSearchRequestId) return;

      const totalMatches = results.reduce(
        (sum, f) =>
          sum + f.matches.reduce((ss, m) => ss + m.matchRanges.length, 0),
        0,
      );

      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          results,
          totalMatches,
          totalFiles: results.length,
          isSearching: false,
          selectedIndex: 0,
          error: null,
        },
      }));
    } catch (error) {
      if (requestId !== contentSearchRequestId) return;
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          results: [],
          totalMatches: 0,
          totalFiles: 0,
          isSearching: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  },
  contentSearchSelectNext: () => {
    const { results, selectedIndex } = get().contentSearch;
    const total = countFlatMatches(results);
    if (total === 0) return;
    set((s) => ({
      contentSearch: {
        ...s.contentSearch,
        selectedIndex: (selectedIndex + 1) % total,
      },
    }));
  },
  contentSearchSelectPrev: () => {
    const { results, selectedIndex } = get().contentSearch;
    const total = countFlatMatches(results);
    if (total === 0) return;
    set((s) => ({
      contentSearch: {
        ...s.contentSearch,
        selectedIndex: (selectedIndex - 1 + total) % total,
      },
    }));
  },
  contentSearchClearResults: () => {
    ++contentSearchRequestId;
    set((s) => ({
      contentSearch: {
        ...s.contentSearch,
        results: [],
        totalMatches: 0,
        totalFiles: 0,
        selectedIndex: 0,
        error: null,
        isSearching: false,
      },
    }));
  },

  /* terminal slice actions */
  terminalCreateSession: () => {
    const state = get().terminal;
    if (state.sessions.length >= MAX_TERMINAL_SESSIONS) return null;
    const session: TerminalSession = {
      id: generateTerminalId(),
      label: generateTerminalLabel(state.sessions),
      isAlive: true,
    };
    set((s) => ({
      terminal: {
        sessions: [...s.terminal.sessions, session],
        activeSessionId: session.id,
      },
    }));
    return session;
  },
  terminalRemoveSession: (id) => {
    const state = get().terminal;
    const remaining = state.sessions.filter((s) => s.id !== id);
    let activeId = state.activeSessionId;
    if (activeId === id) {
      activeId =
        remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }
    set((s) => ({
      terminal: {
        ...s.terminal,
        sessions: remaining,
        activeSessionId: activeId,
      },
    }));
  },
  terminalSetActiveSession: (id) => {
    const state = get().terminal;
    if (state.sessions.some((s) => s.id === id)) {
      set((s) => ({ terminal: { ...s.terminal, activeSessionId: id } }));
    }
  },
  terminalMarkSessionDead: (id) => {
    set((s) => ({
      terminal: {
        ...s.terminal,
        sessions: s.terminal.sessions.map((session) =>
          session.id === id ? { ...session, isAlive: false } : session,
        ),
      },
    }));
  },
  terminalMarkSessionAlive: (id) => {
    set((s) => ({
      terminal: {
        ...s.terminal,
        sessions: s.terminal.sessions.map((session) =>
          session.id === id ? { ...session, isAlive: true } : session,
        ),
      },
    }));
  },
  terminalRenameSession: (id, label) => {
    set((s) => ({
      terminal: {
        ...s.terminal,
        sessions: s.terminal.sessions.map((session) =>
          session.id === id ? { ...session, label } : session,
        ),
      },
    }));
  },
}));

/** Reset terminal slice + ID counter — for tests only. */
export function resetTerminalSessionStore(): void {
  nextTerminalId = 1;
  useUIStore.setState({ terminal: initialTerminal });
}
