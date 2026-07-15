/**
 * uiStore shared types — slice shapes, action interfaces, the combined
 * store type, and slice-creator helpers.
 *
 * Purpose: single type module for the UI store. All slice state/action
 * interfaces live here so the dependency flow is one-directional
 * (slice files import from types.ts; types.ts imports nothing from the
 * slice files — keeps the depcruise no-circular rule green). Also
 * defines the `UISet`/`UIGet` aliases that slice action-creator files
 * use so every action closes over the same store factory `set`/`get`.
 *
 * @module stores/uiStore/types
 */

import type { StoreApi } from "zustand";

export type SidebarViewMode = "files" | "outline" | "history";

/**
 * The sidebar's views when a BROWSER tab is active (ADR-2, WI-S2.1).
 *
 * A separate type from `SidebarViewMode`, not an extension of it, and deliberately: the
 * document mode is persisted into the hot-exit snapshot as a bare string, and widening
 * that union would let a browser value be written into a v5 snapshot that has no idea
 * what it means. Keeping them apart means no schema bump and no migration.
 *
 * This one is SESSION-ONLY, which is also the coherent choice: the browser's history and
 * its site permissions both lapse when VMark quits, so remembering which of them you were
 * looking at would outlive the thing it pointed at.
 */
export type BrowserSidebarView = "browser-history" | "bookmarks" | "permissions";
export type EffectiveTerminalPosition = "top" | "bottom" | "left" | "right";

/* ─────────────────────────── search slice ─────────────────────────────── */

export interface SearchSlice {
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

export interface SearchActions {
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
}

/* ──────────────────────── content-search slice ────────────────────────── */

interface MatchRange {
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

export interface ContentSearchSlice {
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

export interface ContentSearchActions {
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
}

/* ──────────────────────────── terminal slice ──────────────────────────── */

export interface TerminalSession {
  id: string;
  label: string;
  isAlive: boolean;
  /** A bell rang while this session was in the background (WI-4.3). Cleared
   *  when the session becomes active. Drives the tab activity indicator. */
  hasActivity?: boolean;
  /** Program-reported title from xterm's onTitleChange (OSC 0/2) (G4/WI-3.2).
   *  Shown on the tab unless the user manually renamed the session. */
  programTitle?: string;
  /** True once the user manually renamed the session — program titles then
   *  no longer override the user-chosen label (G4/WI-3.2). */
  isUserRenamed?: boolean;
}

export interface TerminalSlice {
  sessions: TerminalSession[];
  activeSessionId: string | null;
}

export interface TerminalActions {
  terminalCreateSession: () => TerminalSession | null;
  terminalRemoveSession: (id: string) => void;
  terminalSetActiveSession: (id: string) => void;
  terminalMarkSessionDead: (id: string) => void;
  terminalMarkSessionAlive: (id: string) => void;
  terminalMarkActivity: (id: string) => void;
  terminalRenameSession: (id: string, label: string) => void;
  terminalSetProgramTitle: (id: string, title: string) => void;
}

/* ──────────────────────────── ui slice shape ──────────────────────────── */

interface UIState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarViewMode: SidebarViewMode;
  /** The sidebar view for a BROWSER tab. Session-only (see BrowserSidebarView). */
  sidebarBrowserViewMode: BrowserSidebarView;
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
  markdownSplitView: boolean;
  wordWrap: boolean;
  showLineNumbers: boolean;
  diagramPreviewEnabled: boolean;

  // merged slices
  search: SearchSlice;
  contentSearch: ContentSearchSlice;
  terminal: TerminalSlice;
}

interface UIActions extends SearchActions, ContentSearchActions, TerminalActions {
  toggleSidebar: () => void;
  toggleSidebarView: (mode: SidebarViewMode) => void;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  setSidebarBrowserViewMode: (mode: BrowserSidebarView) => void;
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
  toggleMarkdownSplitView: () => void;
  setMarkdownSplitView: (enabled: boolean) => void;
  toggleWordWrap: () => void;
  toggleLineNumbers: () => void;
  toggleDiagramPreview: () => void;
  resetEditorFlags: () => void;
}

export type UIStore = UIState & UIActions;

/** The store factory's `set`, passed into slice action creators. */
export type UISet = StoreApi<UIStore>["setState"];
/** The store factory's `get`, passed into slice action creators. */
export type UIGet = StoreApi<UIStore>["getState"];
