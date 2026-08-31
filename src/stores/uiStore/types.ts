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
  contentSearchRun: (rootPath: string, excludeFolders: string[], windowLabel?: string) => Promise<void>;
  contentSearchSelectNext: () => void;
  contentSearchSelectPrev: () => void;
  contentSearchClearResults: () => void;
}

/* ──────────────────────────── terminal slice ──────────────────────────── */

export interface TerminalSession {
  id: string;
  label: string;
  /**
   * Stable 1-based display number, allocated on create and reused when a
   * session closes. The tab's compact glyph comes from THIS, never from
   * parsing the label — the label is a display string that translation (or a
   * rename) is free to change, and parsing it made every tab show the same
   * character the moment it was not English.
   */
  ordinal: number;
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
  /** A directory the session was explicitly asked to start in ("Open Terminal
   *  Here", WI-4.2). Consumed once by the spawn path, which must prefer it
   *  over the sibling-cwd inheritance that otherwise wins. Cleared on spawn so
   *  a later restart does not silently re-anchor the shell. */
  requestedCwd?: string;
  /** Owning workspace instance (WI-TS1.1, D-T1/D-T2). Stamped at creation from
   *  the active scope (via resolveTerminalOwnerInstanceId), or later by
   *  adoption/rekey. ABSENT ⇒ window-scoped: visible in every scope and
   *  followable by the workspace-cd sync. Never a placeholder id, and never
   *  cleared once set — owner changes are monotone (invariant 3). */
  workspaceInstanceId?: string;
}

export interface TerminalSlice {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  /** Per-scope "last shown session" memory (WI-TS1.2, D-T2): workspace
   *  instance id → session id, or null when the scope was showing nothing.
   *  Written by terminalSwitchScope for the OUTGOING scope; slots are dropped
   *  with their instance (close/move) and merged target-wins on rekey. */
  lastActiveByScope: Record<string, string | null>;
}

export interface TerminalActions {
  /** Create a session. `requestedCwd` pins its starting directory (WI-4.2);
   *  without it the spawn path inherits a sibling's cwd or resolves the
   *  workspace/file default. `ownerInstanceId` stamps the session's owning
   *  workspace instance (WI-TS1.1) — callers resolve it via the ONE shared
   *  helper `resolveTerminalOwnerInstanceId(windowLabel)`; the slice never
   *  imports workspace stores. Returns null when the creation-time union
   *  (D-T5: same scope ∪ window-scoped; all sessions when unscoped) is at
   *  MAX_TERMINAL_SESSIONS. */
  terminalCreateSession: (options?: {
    requestedCwd?: string;
    ownerInstanceId?: string;
  }) => TerminalSession | null;
  /** Remove a session. When the removed session was active, the fallback
   *  active is picked from `opts.visibleIds` (the caller's visible population,
   *  D-T7/WI-TS1.2) when given, else from all remaining sessions (rail-off
   *  behavior, identical to before scoping). */
  terminalRemoveSession: (id: string, opts?: { visibleIds?: readonly string[] }) => void;
  terminalSetActiveSession: (id: string) => void;
  terminalMarkSessionDead: (id: string) => void;
  terminalMarkSessionAlive: (id: string) => void;
  terminalMarkActivity: (id: string) => void;
  terminalRenameSession: (id: string, label: string) => void;
  terminalSetProgramTitle: (id: string, title: string) => void;
  /** The explicit start directory for a session, without consuming it (WI-4.2). */
  terminalPeekRequestedCwd: (id: string) => string | undefined;
  /** Clear it — only after the spawn that used it actually succeeded, so a
   *  failed spawn can still be retried in the directory the user asked for. */
  terminalClearRequestedCwd: (id: string) => void;
}

/** Scope-transition actions (WI-TS1.2) — the kernel the rail coordinator and
 *  instance lifecycle call. Implementations in terminalScopeActions.ts. */
export interface TerminalScopeActions {
  /** Stamp every window-scoped session with `instanceId` (absent →
   *  instanceId), renumbering ordinals on in-scope collision. Labels are
   *  untouched; never kills; idempotent. Callers guarantee `instanceId` is
   *  never a placeholder (D-T1). */
  terminalAdoptUnscopedSessions: (instanceId: string) => void;
  /** Record the outgoing scope's shown session into lastActiveByScope, then
   *  activate the incoming scope's remembered-live ?? first-visible ?? null,
   *  clearing hasActivity on the session it activates (D-T11). */
  terminalSwitchScope: (outgoingId: string | null, incomingId: string) => void;
  /** Same activation as terminalSwitchScope WITHOUT writing any outgoing
   *  memory — hydrate/close/move have no outgoing context. Idempotent. */
  terminalHydrateScope: (instanceId: string) => void;
  /** Remove every session stamped `instanceId` (the reconcile disposes their
   *  xterm + PTY) and drop the scope's lastActiveByScope slot. Callers realign
   *  via terminalHydrateScope(successor) when the closed scope was active. */
  terminalRemoveScopeSessions: (instanceId: string) => void;
  /** Re-stamp every oldId session to newId (loose-instance identity rekey,
   *  D-T6), renumbering ordinals on in-scope collision; lastActiveByScope
   *  merges target-wins. */
  terminalRekeyScope: (oldId: string, newId: string) => void;
  /** Realign the active session to the caller's VISIBLE population (R2-15):
   *  keep the current active if it is in `visibleIds`, else activate the
   *  first visible session, else null. Covers the rail-MODE toggle, where the
   *  visible population changes with no scope switch. Idempotent. */
  terminalRealignActive: (visibleIds: readonly string[]) => void;
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

interface UIActions
  extends SearchActions,
    ContentSearchActions,
    TerminalActions,
    TerminalScopeActions {
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
