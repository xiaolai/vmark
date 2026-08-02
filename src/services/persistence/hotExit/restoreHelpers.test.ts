/**
 * restoreHelpers Tests
 *
 * Comprehensive tests for hot exit restore helper functions:
 *   - pullWindowStateWithRetry: retry logic, error handling
 *   - restoreUiState: sidebar, view modes, terminal
 *   - restoreTabs: tab creation, ordering, active tab, pinning
 *   - restoreDocumentState: content, flags, cursor, line endings
 *   - restoreUnifiedHistory: undo/redo checkpoint conversion
 *   - restoreWindowState: orchestration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WindowState, TabState, DocumentState, UiState } from './types';

// ---------------------------------------------------------------------------
// Mocks — must appear before imports of the module under test
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/utils/debug', () => ({
  hotExitLog: vi.fn(),
  hotExitWarn: (...args: unknown[]) => mockHotExitWarn(...args),
}));

// --- Store mocks ---

const mockToggleSidebar = vi.fn();
const mockSetSidebarWidth = vi.fn();
const mockSetSidebarViewMode = vi.fn();
const mockSetStatusBarVisible = vi.fn();
const mockToggleTerminal = vi.fn();
const mockSetTerminalHeight = vi.fn();

const mockToggleSourceMode = vi.fn();
const mockToggleFocusMode = vi.fn();
const mockToggleTypewriterMode = vi.fn();

// Per ADR-009: editor-view flags merged into uiStore. The legacy
// editorStore is gone; one combined uiStore mock covers both surfaces.
const uiStoreState = {
  sidebarVisible: true,
  terminalVisible: false,
  toggleSidebar: mockToggleSidebar,
  setSidebarWidth: mockSetSidebarWidth,
  setSidebarViewMode: mockSetSidebarViewMode,
  setStatusBarVisible: mockSetStatusBarVisible,
  toggleTerminal: mockToggleTerminal,
  setTerminalHeight: mockSetTerminalHeight,
  sourceMode: false,
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  toggleSourceMode: mockToggleSourceMode,
  toggleFocusMode: mockToggleFocusMode,
  toggleTypewriterMode: mockToggleTypewriterMode,
};

// Only the STORE is mocked; the width bounds come through real. Mirroring
// them here would reintroduce the exact defect this change fixes — two copies
// of one range, free to drift.
vi.mock('@/stores/uiStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/uiStore')>()),
  useUIStore: { getState: () => uiStoreState },
  // restoreUiState clamps restored terminal height to this ratio of the
  // viewport; mirror the real constant value (0.5) for the layout-max policy.
  TERMINAL_MAX_RATIO: 0.5,
}));

const mockCreateTab = vi.fn(() => 'new-tab-id');
const mockGetTabsByWindow = vi.fn(() => []);
const mockRemoveWindow = vi.fn();
const mockUpdateTabTitle = vi.fn();
const mockTogglePin = vi.fn();
const mockSetActiveTab = vi.fn();
// WI-1A.13 — hot-exit format-field restore setters
const mockSetTabFormatId = vi.fn();
const mockSetTabEditingEnabled = vi.fn();
const mockSetTabActiveSchemaId = vi.fn();

vi.mock('@/stores/tabStore', () => ({
  useTabStore: {
    getState: () => ({
      createTab: mockCreateTab,
      getTabsByWindow: mockGetTabsByWindow,
      removeWindow: mockRemoveWindow,
      updateTabTitle: mockUpdateTabTitle,
      togglePin: mockTogglePin,
      setActiveTab: mockSetActiveTab,
      setTabFormatId: mockSetTabFormatId,
      setTabEditingEnabled: mockSetTabEditingEnabled,
      setTabActiveSchemaId: mockSetTabActiveSchemaId,
    }),
  },
}));

// ONE store door for external ingresses: hot-exit restore now routes through
// ingestExternalContent instead of initDocument/loadContent/updateLastDiskContent.
const mockIngest = vi.fn();
const mockSetContent = vi.fn();
const mockMarkMissing = vi.fn();
const mockMarkDivergent = vi.fn();
const mockSetCursorInfo = vi.fn();
const mockRemoveDocument = vi.fn();

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      ingestExternalContent: mockIngest,
      setEditorContent: mockSetContent,
      markMissing: mockMarkMissing,
      markDivergent: mockMarkDivergent,
      setCursorInfo: mockSetCursorInfo,
      removeDocument: mockRemoveDocument,
      // Stubbed so tests that exercise the read-only branch don't crash;
      // production action is documented at stores/documentStore.ts:89.
      setReadOnly: vi.fn(),
    }),
  },
  useUnifiedHistoryStore: (() => {
    let storeState: Record<string, unknown> = { documents: {} };
    return {
      getState: () => ({
        clearDocument: mockClearDocument,
        documents: storeState.documents,
        restoreFromPayload: vi.fn(),
      }),
      setState: (updater: unknown) => {
        if (typeof updater === "function") {
          const result = (updater as (s: typeof storeState) => typeof storeState)(storeState);
          storeState = { ...storeState, ...result };
        } else {
          storeState = { ...storeState, ...(updater as Record<string, unknown>) };
        }
      },
      subscribe: () => () => {},
      _getInternalState: () => storeState,
      _resetInternalState: () => {
        storeState = { documents: {} };
      },
    };
  })(),
  useRevisionStore: { getState: () => ({ registerEdit: vi.fn() }) },
  useLintStore: { getState: () => ({ clearDiagnostics: vi.fn() }), subscribe: () => () => {} },
  useLargeFileSessionStore: { setState: vi.fn(), getState: () => ({ clearForcedSource: vi.fn(), markTabForcedSource: vi.fn() }), subscribe: () => () => {} },
  useFileLoadStore: { setState: vi.fn(), getState: () => ({ active: false, startLoad: vi.fn(), finishLoad: vi.fn() }) },
}));

// Format registry mock — `restoreHelpers` validates persisted `format_id`
// (and `active_schema_id`) against the live registry. The tests don't
// bootstrap the real registry, so we stub it to "known IDs only" with
// just enough shape to exercise the schema-renderer lookup.
//
// Tests covering tampered/stale session payloads override this
// implementation per-test (e.g., return undefined for unknown ids,
// or return a format with a known schemaRenderers map).
const mockGetFormatById = vi.fn((id: string) => {
  const known: Record<string, { schemaRenderers?: Record<string, unknown> }> = {
    markdown: {},
    json: { schemaRenderers: { "package-json": () => null } },
    code: {},
  };
  return known[id];
});

vi.mock('@/lib/formats/registry', () => ({
  getFormatById: (id: string) => mockGetFormatById(id),
}));

// Capture the named warning logger so tests can assert it was called
// with the expected message (rule-violation surface). We re-import the
// mocked `hotExitWarn` symbol below for direct .mock.calls inspection.
const { mockHotExitWarn } = vi.hoisted(() => ({
  mockHotExitWarn: vi.fn(),
}));

const mockClearDocument = vi.fn();

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import {
  pullWindowStateWithRetry,
  restoreWindowState,
  restoreUiState,
  restoreTabs,
  isValidWindowState,
} from './restoreHelpers';
// Document restoration split into restoreDocumentState.ts when this module hit
// 397 lines; its tests moved with it, to restoreDocumentState.test.ts.
import { useUnifiedHistoryStore } from '@/stores/documentStore';
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from '@/stores/uiStore';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    sidebar_visible: true,
    sidebar_width: 260,
    outline_visible: false,
    sidebar_view_mode: 'files',
    status_bar_visible: true,
    source_mode_enabled: false,
    focus_mode_enabled: false,
    typewriter_mode_enabled: false,
    ...overrides,
  };
}

function makeDocState(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    content: 'hello world',
    saved_content: 'hello world',
    is_dirty: false,
    is_missing: false,
    is_divergent: false,
    is_read_only: false,
    line_ending: '\n',
    cursor_info: null,
    last_modified_timestamp: null,
    is_untitled: false,
    untitled_number: null,
    undo_history: [],
    redo_history: [],
    ...overrides,
  };
}

function makeTabState(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    file_path: '/path/to/file.md',
    title: 'file.md',
    is_pinned: false,
    document: makeDocState(),
    // WI-1A.13 — v3 schema defaults: markdown tab with editing enabled and
    // no schema override. Individual tests override these as needed.
    format_id: 'markdown',
    editing_enabled: true,
    active_schema_id: null,
    ...overrides,
  };
}

function makeWindowState(overrides: Partial<WindowState> = {}): WindowState {
  return {
    window_label: 'main',
    is_main_window: true,
    active_tab_id: 'tab-1',
    tabs: [makeTabState()],
    ui_state: makeUiState(),
    geometry: null,
    ...overrides,
  };
}



// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('restoreHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset editor/ui store defaults
    uiStoreState.sourceMode = false;
    uiStoreState.focusModeEnabled = false;
    uiStoreState.typewriterModeEnabled = false;
    uiStoreState.sidebarVisible = true;
    uiStoreState.terminalVisible = false;
    // Reset unified history store internal state
    (useUnifiedHistoryStore as unknown as { _resetInternalState: () => void })._resetInternalState();
  });

  // =========================================================================
  // pullWindowStateWithRetry
  // =========================================================================

  describe('pullWindowStateWithRetry', () => {
    it('should return state on first successful invoke', async () => {
      const state = makeWindowState();
      mockInvoke.mockResolvedValueOnce(state);

      const result = await pullWindowStateWithRetry('main', 3);

      expect(result).toBe(state);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('hot_exit_get_window_state', { windowLabel: 'main' });
    });

    it('should retry when invoke returns null and succeed later', async () => {
      const state = makeWindowState();
      mockInvoke
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(state);

      const result = await pullWindowStateWithRetry('main', 3);

      expect(result).toBe(state);
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });

    it('should return null after all retries exhausted with null responses', async () => {
      mockInvoke.mockResolvedValue(null);

      const result = await pullWindowStateWithRetry('main', 2);

      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should retry on invoke error and succeed later', async () => {
      const state = makeWindowState();
      mockInvoke
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(state);

      const result = await pullWindowStateWithRetry('main', 3);

      expect(result).toBe(state);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should return null after all retries exhausted with errors', async () => {
      mockInvoke.mockRejectedValue(new Error('persistent error'));

      const result = await pullWindowStateWithRetry('main', 2);

      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should use default retries (5) when not specified', async () => {
      mockInvoke.mockResolvedValue(null);

      const result = await pullWindowStateWithRetry('main');

      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledTimes(5);
    });

    it('should handle single retry', async () => {
      mockInvoke.mockResolvedValueOnce(null);

      const result = await pullWindowStateWithRetry('main', 1);

      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('discards a structurally malformed payload immediately, no retry (T1/ADR-2)', async () => {
      // tabs is not an array — restoreWindowState would throw on `.tabs.filter`.
      // A bad shape won't fix itself across retries, so it returns null on the
      // first attempt rather than burning the retry budget.
      mockInvoke.mockResolvedValue({ window_label: 'main', tabs: 'nope', ui_state: {}, active_tab_id: null });

      const result = await pullWindowStateWithRetry('main', 5);

      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockHotExitWarn).toHaveBeenCalled();
    });
  });

  describe('isValidWindowState (T1/ADR-2 boundary guard)', () => {
    it('accepts a well-formed window state', () => {
      expect(isValidWindowState(makeWindowState())).toBe(true);
      expect(isValidWindowState(makeWindowState({ active_tab_id: null, tabs: [] }))).toBe(true);
    });

    it('rejects null / non-object payloads', () => {
      expect(isValidWindowState(null)).toBe(false);
      expect(isValidWindowState('x')).toBe(false);
      expect(isValidWindowState([])).toBe(false);
    });

    it('rejects missing/wrong-typed container fields', () => {
      expect(isValidWindowState(makeWindowState({ tabs: undefined as never }))).toBe(false);
      expect(isValidWindowState(makeWindowState({ ui_state: null as never }))).toBe(false);
      expect(isValidWindowState(makeWindowState({ ui_state: [] as never }))).toBe(false);
      expect(isValidWindowState(makeWindowState({ window_label: 5 as never }))).toBe(false);
      expect(isValidWindowState(makeWindowState({ active_tab_id: 7 as never }))).toBe(false);
    });

    it('rejects malformed tab entries that would crash early derefs', () => {
      // isEmptyUntitledTab(null) → null.file_path would throw.
      expect(isValidWindowState(makeWindowState({ tabs: [null] as never }))).toBe(false);
      // tab.document.content would throw when document is missing.
      expect(
        isValidWindowState(makeWindowState({ tabs: [{ id: 't', file_path: null }] as never }))
      ).toBe(false);
      // a well-formed tab (with an object document) still passes.
      expect(isValidWindowState(makeWindowState())).toBe(true);
    });
  });

  // =========================================================================
  // restoreUiState
  // =========================================================================

  describe('restoreUiState', () => {
    it('should restore sidebar visibility when it differs from current', () => {
      uiStoreState.sidebarVisible = true;
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_visible: false }),
      });

      restoreUiState(ws);

      expect(mockToggleSidebar).toHaveBeenCalledTimes(1);
    });

    it('should NOT toggle sidebar when visibility matches current', () => {
      uiStoreState.sidebarVisible = true;
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_visible: true }),
      });

      restoreUiState(ws);

      expect(mockToggleSidebar).not.toHaveBeenCalled();
    });

    it('should restore sidebar width within valid bounds', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_width: 300 }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarWidth).toHaveBeenCalledWith(300);
    });

    // Bounds are uiStore's (180-480) — the same range setSidebarWidth clamps
    // to. 150 and 500 were this file's own copy, and both are now REJECTED:
    // accepting a width the store would silently clamp is what the mismatch
    // did wrong.
    it.each([
      { width: 100, expected: SIDEBAR_DEFAULT_WIDTH, desc: 'below minimum' },
      { width: 150, expected: SIDEBAR_DEFAULT_WIDTH, desc: 'the old validator floor' },
      { width: 600, expected: SIDEBAR_DEFAULT_WIDTH, desc: 'above maximum' },
      { width: 500, expected: SIDEBAR_DEFAULT_WIDTH, desc: 'the old validator ceiling' },
      { width: NaN, expected: SIDEBAR_DEFAULT_WIDTH, desc: 'NaN' },
      { width: Infinity, expected: SIDEBAR_DEFAULT_WIDTH, desc: 'Infinity' },
      { width: -Infinity, expected: SIDEBAR_DEFAULT_WIDTH, desc: '-Infinity' },
    ])('should use default sidebar width when $desc', ({ width, expected }) => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_width: width }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarWidth).toHaveBeenCalledWith(expected);
    });

    it.each([SIDEBAR_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH])(
      'should accept valid sidebar width %d', (width) => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_width: width }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarWidth).toHaveBeenCalledWith(width);
    });

    it('should validate sidebar_view_mode to "files", "outline", or "history"', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_view_mode: 'outline' }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarViewMode).toHaveBeenCalledWith('outline');
    });

    it('should accept sidebar_view_mode "history"', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_view_mode: 'history' }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarViewMode).toHaveBeenCalledWith('history');
    });

    it('should default sidebar_view_mode to "files" for invalid values', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_view_mode: 'invalid_mode' }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarViewMode).toHaveBeenCalledWith('files');
    });

    it('should restore status bar visibility', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ status_bar_visible: false }),
      });

      restoreUiState(ws);

      expect(mockSetStatusBarVisible).toHaveBeenCalledWith(false);
    });

    it('should toggle source mode when saved differs from current', () => {
      uiStoreState.sourceMode = false;
      const ws = makeWindowState({
        ui_state: makeUiState({ source_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleSourceMode).toHaveBeenCalledTimes(1);
    });

    it('should NOT toggle source mode when values match', () => {
      uiStoreState.sourceMode = true;
      const ws = makeWindowState({
        ui_state: makeUiState({ source_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleSourceMode).not.toHaveBeenCalled();
    });

    it('should toggle focus mode when saved differs from current', () => {
      uiStoreState.focusModeEnabled = false;
      const ws = makeWindowState({
        ui_state: makeUiState({ focus_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleFocusMode).toHaveBeenCalledTimes(1);
    });

    it('should toggle typewriter mode when saved differs from current', () => {
      uiStoreState.typewriterModeEnabled = false;
      const ws = makeWindowState({
        ui_state: makeUiState({ typewriter_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleTypewriterMode).toHaveBeenCalledTimes(1);
    });

    it('should restore terminal visibility when saved differs from current', () => {
      uiStoreState.terminalVisible = false;
      const ws = makeWindowState({
        ui_state: makeUiState({ terminal_visible: true }),
      });

      restoreUiState(ws);

      expect(mockToggleTerminal).toHaveBeenCalledTimes(1);
    });

    it('should NOT toggle terminal when terminal_visible is undefined', () => {
      const uiState = makeUiState();
      delete uiState.terminal_visible;
      const ws = makeWindowState({ ui_state: uiState });

      restoreUiState(ws);

      expect(mockToggleTerminal).not.toHaveBeenCalled();
    });

    it('should restore terminal height when valid', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ terminal_height: 300 }),
      });

      restoreUiState(ws);

      expect(mockSetTerminalHeight).toHaveBeenCalledWith(300);
    });

    it('should NOT restore terminal height when NaN', () => {
      const ws = makeWindowState({
        ui_state: makeUiState({ terminal_height: NaN }),
      });

      restoreUiState(ws);

      expect(mockSetTerminalHeight).not.toHaveBeenCalled();
    });

    it('should NOT restore terminal height when undefined', () => {
      const uiState = makeUiState();
      delete uiState.terminal_height;
      const ws = makeWindowState({ ui_state: uiState });

      restoreUiState(ws);

      expect(mockSetTerminalHeight).not.toHaveBeenCalled();
    });

    it('should clamp a corrupt oversized terminal height to the layout max (50% of viewport)', () => {
      // jsdom default innerHeight is 768; the layout policy caps the terminal
      // at TERMINAL_MAX_RATIO (0.5) of the available dimension. A corrupt
      // persisted value (e.g. 100000) must not restore an unusable panel.
      const originalInnerHeight = window.innerHeight;
      Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
      try {
        const ws = makeWindowState({
          ui_state: makeUiState({ terminal_height: 100000 }),
        });

        restoreUiState(ws);

        // 1000 * 0.5 = 500
        expect(mockSetTerminalHeight).toHaveBeenCalledWith(500);
      } finally {
        Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
      }
    });

    it('should restore a terminal height within the max unchanged', () => {
      const originalInnerHeight = window.innerHeight;
      Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
      try {
        const ws = makeWindowState({
          ui_state: makeUiState({ terminal_height: 300 }),
        });

        restoreUiState(ws);

        expect(mockSetTerminalHeight).toHaveBeenCalledWith(300);
      } finally {
        Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
      }
    });
  });

  // =========================================================================
  // restoreDocumentState
  // =========================================================================

  describe('restoreTabs', () => {
    it('should clear existing tabs before restoring meaningful saved tabs', async () => {
      const existingTabs = [
        { id: 'old-tab-1' },
        { id: 'old-tab-2' },
      ];
      mockGetTabsByWindow.mockReturnValue(existingTabs);

      // Pass a meaningful saved tab so restoration actually proceeds.
      // Empty `tabs: []` would now early-return (preserving existing tabs)
      // — covered separately by the "preserves existing tabs..." test.
      const ws = makeWindowState({
        tabs: [makeTabState({ id: 'saved-1', file_path: '/a.md' })],
      });

      await restoreTabs('main', ws);

      expect(mockRemoveDocument).toHaveBeenCalledTimes(2);
      expect(mockRemoveDocument).toHaveBeenCalledWith('old-tab-1');
      expect(mockRemoveDocument).toHaveBeenCalledWith('old-tab-2');
      expect(mockClearDocument).toHaveBeenCalledTimes(2);
      expect(mockRemoveWindow).toHaveBeenCalledWith('main');
    });

    it('should NOT call removeWindow when no existing tabs', async () => {
      mockGetTabsByWindow.mockReturnValue([]);

      const ws = makeWindowState({
        tabs: [makeTabState({ id: 'saved-1', file_path: '/a.md' })],
      });

      await restoreTabs('main', ws);

      expect(mockRemoveWindow).not.toHaveBeenCalled();
    });

    it('should create tabs for each saved tab state', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValueOnce('new-1').mockReturnValueOnce('new-2');

      const ws = makeWindowState({
        tabs: [
          makeTabState({ id: 'saved-1', file_path: '/a.md', title: 'A' }),
          makeTabState({ id: 'saved-2', file_path: '/b.md', title: 'B' }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockCreateTab).toHaveBeenCalledTimes(2);
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/a.md');
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/b.md');
      expect(mockUpdateTabTitle).toHaveBeenCalledWith('new-1', 'A');
      expect(mockUpdateTabTitle).toHaveBeenCalledWith('new-2', 'B');
    });

    it('should toggle pin for pinned tabs', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValueOnce('new-1');

      const ws = makeWindowState({
        tabs: [
          makeTabState({ id: 'saved-1', is_pinned: true }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockTogglePin).toHaveBeenCalledWith('main', 'new-1');
    });

    it('should NOT toggle pin for unpinned tabs', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValueOnce('new-1');

      const ws = makeWindowState({
        tabs: [
          makeTabState({ id: 'saved-1', is_pinned: false }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockTogglePin).not.toHaveBeenCalled();
    });

    it('should set active tab using mapped ID', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab
        .mockReturnValueOnce('new-1')
        .mockReturnValueOnce('new-2');

      const ws = makeWindowState({
        active_tab_id: 'saved-2',
        tabs: [
          makeTabState({ id: 'saved-1', file_path: '/path/to/a.md' }),
          makeTabState({ id: 'saved-2', file_path: '/path/to/b.md' }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetActiveTab).toHaveBeenCalledWith('main', 'new-2');
    });

    it('should fall back to first tab when active_tab_id mapping not found', async () => {
      mockGetTabsByWindow
        .mockReturnValueOnce([]) // initial clear
        .mockReturnValueOnce([{ id: 'new-1' }]); // fallback lookup
      mockCreateTab.mockReturnValueOnce('new-1');

      const ws = makeWindowState({
        active_tab_id: 'nonexistent-tab',
        tabs: [makeTabState({ id: 'saved-1' })],
      });

      await restoreTabs('main', ws);

      expect(mockSetActiveTab).toHaveBeenCalledWith('main', 'new-1');
    });

    it('should handle null active_tab_id', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValueOnce('new-1');

      const ws = makeWindowState({
        active_tab_id: null,
        tabs: [makeTabState({ id: 'saved-1' })],
      });

      await restoreTabs('main', ws);

      expect(mockSetActiveTab).not.toHaveBeenCalled();
    });

    it('should handle empty tabs array', async () => {
      mockGetTabsByWindow.mockReturnValue([]);

      const ws = makeWindowState({ tabs: [], active_tab_id: null });

      await restoreTabs('main', ws);

      expect(mockCreateTab).not.toHaveBeenCalled();
    });

    it('should skip duplicate file_path tabs and only restore the first', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      let callCount = 0;
      mockCreateTab.mockImplementation(() => `new-tab-${++callCount}`);

      const ws = makeWindowState({
        active_tab_id: 'tab-1',
        tabs: [
          makeTabState({ id: 'tab-1', file_path: '/path/to/file.md', title: 'file.md' }),
          makeTabState({ id: 'tab-2', file_path: '/path/to/file.md', title: 'file.md (dup)' }),
          makeTabState({ id: 'tab-3', file_path: '/path/to/other.md', title: 'other.md' }),
        ],
      });

      await restoreTabs('main', ws);

      // Only 2 tabs created (duplicate skipped)
      expect(mockCreateTab).toHaveBeenCalledTimes(2);
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/path/to/file.md');
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/path/to/other.md');
    });

    it('treats normalization-equivalent paths as duplicates (matches tabStore createTab)', async () => {
      // tabStore.createTab deduplicates via normalizePath, so equivalent paths
      // (trailing slash, backslash separators) collide and the second createTab
      // returns the first tab's id — overwriting restored content. restoreTabs
      // must skip these duplicates using the SAME normalizePath comparison.
      mockGetTabsByWindow.mockReturnValue([]);
      let callCount = 0;
      mockCreateTab.mockImplementation(() => `new-tab-${++callCount}`);

      const ws = makeWindowState({
        active_tab_id: 'tab-1',
        tabs: [
          makeTabState({ id: 'tab-1', file_path: '/path/to/file.md', title: 'a' }),
          // Same file, trailing slash variant — normalizePath collapses it
          makeTabState({ id: 'tab-2', file_path: '/path/to/file.md/', title: 'a-dup' }),
        ],
      });

      await restoreTabs('main', ws);

      // Only the first restored; the normalization-equivalent duplicate skipped.
      expect(mockCreateTab).toHaveBeenCalledTimes(1);
    });

    it('maps a skipped duplicate active tab to the retained tab id', async () => {
      // If the persisted active tab is itself a skipped duplicate, restore must
      // activate the RETAINED duplicate's tab — not fall back to the first tab.
      mockGetTabsByWindow.mockReturnValue([]);
      let callCount = 0;
      mockCreateTab.mockImplementation(() => `new-tab-${++callCount}`);
      mockSetActiveTab.mockClear();

      const ws = makeWindowState({
        active_tab_id: 'tab-dup', // the duplicate that gets skipped
        tabs: [
          makeTabState({ id: 'tab-other', file_path: '/path/to/other.md', title: 'other' }),
          makeTabState({ id: 'tab-keep', file_path: '/path/to/file.md', title: 'keep' }),
          makeTabState({ id: 'tab-dup', file_path: '/path/to/file.md', title: 'dup' }),
        ],
      });

      await restoreTabs('main', ws);

      // tab-other → new-tab-1, tab-keep → new-tab-2; tab-dup is skipped but
      // maps to new-tab-2 (the retained duplicate). Active tab must be new-tab-2.
      expect(mockSetActiveTab).toHaveBeenLastCalledWith('main', 'new-tab-2');
    });

    it('treats case-different paths as distinct (no case folding)', async () => {
      // Regression: earlier code lowercased on non-Linux for dedup, which
      // incorrectly merged distinct files on case-sensitive APFS volumes.
      // Both paths must be restored.
      mockGetTabsByWindow.mockReturnValue([]);
      let callCount = 0;
      mockCreateTab.mockImplementation(() => `new-tab-${++callCount}`);

      const ws = makeWindowState({
        active_tab_id: 'tab-lower',
        tabs: [
          makeTabState({ id: 'tab-lower', file_path: '/docs/readme.md', title: 'readme.md' }),
          makeTabState({ id: 'tab-upper', file_path: '/docs/README.md', title: 'README.md' }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockCreateTab).toHaveBeenCalledTimes(2);
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/docs/readme.md');
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/docs/README.md');
    });

    it('should not deduplicate untitled tabs (null file_path)', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      let callCount = 0;
      mockCreateTab.mockImplementation(() => `new-tab-${++callCount}`);

      const ws = makeWindowState({
        active_tab_id: 'tab-1',
        tabs: [
          makeTabState({ id: 'tab-1', file_path: null, title: 'Untitled 1' }),
          makeTabState({ id: 'tab-2', file_path: null, title: 'Untitled 2' }),
        ],
      });

      await restoreTabs('main', ws);

      // Both untitled tabs should be created (default makeDocState content
      // is 'hello world' so neither is empty-untitled)
      expect(mockCreateTab).toHaveBeenCalledTimes(2);
    });

    it('should drop empty-untitled tabs from a mixed list', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      let callCount = 0;
      mockCreateTab.mockImplementation(() => `new-tab-${++callCount}`);

      const ws = makeWindowState({
        active_tab_id: 'tab-real',
        tabs: [
          // Empty untitled — should be skipped
          makeTabState({
            id: 'tab-blank',
            file_path: null,
            document: makeDocState({ content: '', saved_content: '' }),
          }),
          // File-backed with content — kept
          makeTabState({ id: 'tab-real', file_path: '/notes/a.md' }),
          // Untitled with unsaved content — kept (saved_content empty but
          // content isn't, meaning the user has typed something they
          // haven't saved yet)
          makeTabState({
            id: 'tab-draft',
            file_path: null,
            document: makeDocState({ content: 'in progress', saved_content: '' }),
          }),
          // File-backed but file is empty on disk — kept (the file is the
          // user's intentional artifact, blank is a valid initial state)
          makeTabState({
            id: 'tab-empty-file',
            file_path: '/notes/blank.md',
            document: makeDocState({ content: '', saved_content: '' }),
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockCreateTab).toHaveBeenCalledTimes(3);
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/notes/a.md');
      expect(mockCreateTab).toHaveBeenCalledWith('main', null);
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/notes/blank.md');
    });

    it('should fall back to first remaining tab when active_tab_id pointed to a filtered empty-untitled', async () => {
      // active_tab_id mapping skips filtered tabs, so the saved-state's
      // active id ('tab-blank') won't be in the tabIdMap. Restore must
      // gracefully fall back to the first surviving tab — without this
      // path being exercised, a regression that drops the fallback would
      // silently leave the window with no active tab.
      mockGetTabsByWindow
        .mockReturnValueOnce([]) // initial clear lookup
        .mockReturnValueOnce([{ id: 'new-real' }]); // fallback lookup
      mockCreateTab.mockReturnValueOnce('new-real');

      const ws = makeWindowState({
        active_tab_id: 'tab-blank',
        tabs: [
          // Filtered: was the active tab
          makeTabState({
            id: 'tab-blank',
            file_path: null,
            document: makeDocState({ content: '', saved_content: '' }),
          }),
          // Survives the filter
          makeTabState({ id: 'tab-real', file_path: '/notes/a.md' }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockCreateTab).toHaveBeenCalledTimes(1);
      expect(mockCreateTab).toHaveBeenCalledWith('main', '/notes/a.md');
      expect(mockSetActiveTab).toHaveBeenCalledWith('main', 'new-real');
    });

    it('should preserve existing tabs when saved state has only empty-untitled tabs', async () => {
      // Hot-exit captured a session that was effectively empty (one blank
      // untitled tab). Restoring it would just clear the WindowContext-
      // created blank tab and replace it with another blank — pointless
      // churn. The early-return preserves the fallback instead.
      const existingTabs = [{ id: 'fallback-tab' }];
      mockGetTabsByWindow.mockReturnValue(existingTabs);

      const ws = makeWindowState({
        active_tab_id: 'tab-blank',
        tabs: [
          makeTabState({
            id: 'tab-blank',
            file_path: null,
            document: makeDocState({ content: '', saved_content: '' }),
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockRemoveWindow).not.toHaveBeenCalled();
      expect(mockRemoveDocument).not.toHaveBeenCalled();
      expect(mockCreateTab).not.toHaveBeenCalled();
    });

    // ─── WI-1A.13 — multi-format field restore (rev 6) ────────────────────
    //
    // Untitled tabs cannot recover non-markdown formatId from path
    // (createTab → dispatchEditor(null) → markdown fallback). For these
    // tabs, restoreTabs must explicitly call setTabFormatId so the
    // restored tab matches what the user actually had open.

    it('restores explicit format_id for untitled non-markdown tabs', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-json-untitled',
        tabs: [
          makeTabState({
            id: 'tab-json-untitled',
            file_path: null,
            format_id: 'json',
            title: 'Untitled.json',
            document: makeDocState({
              is_dirty: true,
              content: '{"key": "value"}',
            }),
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockCreateTab).toHaveBeenCalledWith('main', null);
      expect(mockSetTabFormatId).toHaveBeenCalledWith('new-1', 'json');
    });

    it('does NOT call setTabFormatId for untitled markdown tabs (derivation matches)', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-md-untitled',
        tabs: [
          makeTabState({
            id: 'tab-md-untitled',
            file_path: null,
            format_id: 'markdown',
            document: makeDocState({ is_dirty: true, content: '# hi' }),
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabFormatId).not.toHaveBeenCalled();
    });

    // Security guard: a tampered or stale session file could carry a
    // format_id that no longer exists in the registry. Silently passing
    // it through to `setTabFormatId` would put the tab store in an
    // inconsistent state. The validator must skip the call AND emit a
    // warning so the bypass shows up in debug logs.
    it('skips setTabFormatId when persisted format_id is not in the registry', async () => {
      mockGetFormatById.mockImplementationOnce(() => undefined);
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-unknown',
        tabs: [
          makeTabState({
            id: 'tab-unknown',
            file_path: null,
            format_id: 'definitely-not-registered',
            document: makeDocState({ is_dirty: true, content: 'data' }),
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabFormatId).not.toHaveBeenCalled();
      // Warning must name the rejected id and tab so the bypass is
      // visible in logs — diagnoses both stale sessions and a future
      // bug that drops the validation entirely.
      const warnCall = mockHotExitWarn.mock.calls.find((c) =>
        String(c[0]).includes('definitely-not-registered'),
      );
      expect(warnCall).toBeDefined();
      expect(String(warnCall?.[0])).toContain('tab-unknown');
    });

    it('does NOT call setTabFormatId when file_path is set (derivation is authoritative)', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-with-path',
        tabs: [
          makeTabState({
            id: 'tab-with-path',
            file_path: '/data/payload.json',
            format_id: 'json',
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabFormatId).not.toHaveBeenCalled();
    });

    it('restores editing_enabled=false override', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-locked',
        tabs: [
          makeTabState({
            id: 'tab-locked',
            file_path: '/src/lib.rs',
            format_id: 'code',
            editing_enabled: false,
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabEditingEnabled).toHaveBeenCalledWith('new-1', false);
    });

    it('does NOT call setTabEditingEnabled when editing_enabled is true (default)', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-1',
        tabs: [
          makeTabState({ id: 'tab-1', file_path: '/x.md', editing_enabled: true }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabEditingEnabled).not.toHaveBeenCalled();
    });

    it('restores active_schema_id when present', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-schema',
        tabs: [
          makeTabState({
            id: 'tab-schema',
            file_path: '/package.json',
            format_id: 'json',
            active_schema_id: 'package-json',
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabActiveSchemaId).toHaveBeenCalledWith(
        'new-1',
        'package-json',
      );
    });

    it('does NOT call setTabActiveSchemaId when active_schema_id is null', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-1',
        tabs: [
          makeTabState({ id: 'tab-1', file_path: '/x.md', active_schema_id: null }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabActiveSchemaId).not.toHaveBeenCalled();
    });

    // Security guard: same shape as the format_id validator — a tampered
    // session can name a schema id that doesn't exist on the resolved
    // format. Skip the setter and warn so the inconsistency surfaces.
    it('skips setTabActiveSchemaId when the schema id is not registered on the format', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-bogus',
        tabs: [
          makeTabState({
            id: 'tab-bogus',
            file_path: '/package.json',
            format_id: 'json',
            // json format mock only declares "package-json"; anything else
            // must be rejected by the schema-renderer existence check.
            active_schema_id: 'definitely-not-a-real-schema',
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabActiveSchemaId).not.toHaveBeenCalled();
      const warnCall = mockHotExitWarn.mock.calls.find((c) =>
        String(c[0]).includes('definitely-not-a-real-schema'),
      );
      expect(warnCall).toBeDefined();
      expect(String(warnCall?.[0])).toContain('tab-bogus');
    });

    // Fallback: when the registry cannot resolve a format (empty/stub
    // registry, or the format was unregistered after save), validation
    // is impossible — we trust the persisted schema value rather than
    // silently drop it. Otherwise a missing bootstrap would erase user
    // state on restart.
    it('passes setTabActiveSchemaId through when the format cannot be resolved', async () => {
      mockGetFormatById.mockImplementationOnce(() => undefined);
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-1');

      const ws = makeWindowState({
        active_tab_id: 'tab-orphan',
        tabs: [
          makeTabState({
            id: 'tab-orphan',
            file_path: '/some.unknown',
            format_id: 'not-bootstrapped',
            active_schema_id: 'legacy-schema',
          }),
        ],
      });

      await restoreTabs('main', ws);

      expect(mockSetTabActiveSchemaId).toHaveBeenCalledWith(
        'new-1',
        'legacy-schema',
      );
    });
  });

  // =========================================================================
  // restoreWindowState (orchestration)
  // =========================================================================

  describe('restoreWindowState', () => {
    it('should call restoreUiState and restoreTabs in order', async () => {
      mockGetTabsByWindow.mockReturnValue([]);
      mockCreateTab.mockReturnValue('new-tab');

      const ws = makeWindowState({
        ui_state: makeUiState({ source_mode_enabled: true }),
        tabs: [makeTabState()],
      });

      // sourceMode starts false, so toggle should be called
      uiStoreState.sourceMode = false;

      await restoreWindowState('main', ws);

      // UI state was restored (source mode toggled)
      expect(mockToggleSourceMode).toHaveBeenCalled();
      // Tabs were restored
      expect(mockCreateTab).toHaveBeenCalled();
    });

    it('should handle window with no tabs gracefully', async () => {
      mockGetTabsByWindow.mockReturnValue([]);

      const ws = makeWindowState({ tabs: [], active_tab_id: null });

      await restoreWindowState('main', ws);

      // Should not throw
      expect(mockCreateTab).not.toHaveBeenCalled();
    });
  });
});
