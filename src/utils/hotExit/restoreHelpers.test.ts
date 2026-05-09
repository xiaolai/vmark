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
import type {
  WindowState,
  TabState,
  DocumentState,
  CursorInfo,
  UiState,
} from './types';

// ---------------------------------------------------------------------------
// Mocks — must appear before imports of the module under test
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/utils/debug', () => ({
  hotExitLog: vi.fn(),
  hotExitWarn: vi.fn(),
}));

// --- Store mocks ---

const mockToggleSidebar = vi.fn();
const mockSetSidebarWidth = vi.fn();
const mockSetSidebarViewMode = vi.fn();
const mockSetStatusBarVisible = vi.fn();
const mockToggleTerminal = vi.fn();
const mockSetTerminalHeight = vi.fn();

const uiStoreState = {
  sidebarVisible: true,
  terminalVisible: false,
  toggleSidebar: mockToggleSidebar,
  setSidebarWidth: mockSetSidebarWidth,
  setSidebarViewMode: mockSetSidebarViewMode,
  setStatusBarVisible: mockSetStatusBarVisible,
  toggleTerminal: mockToggleTerminal,
  setTerminalHeight: mockSetTerminalHeight,
};

vi.mock('@/stores/uiStore', () => ({
  useUIStore: { getState: () => uiStoreState },
}));

const mockToggleSourceMode = vi.fn();
const mockToggleFocusMode = vi.fn();
const mockToggleTypewriterMode = vi.fn();

const editorStoreState = {
  sourceMode: false,
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  toggleSourceMode: mockToggleSourceMode,
  toggleFocusMode: mockToggleFocusMode,
  toggleTypewriterMode: mockToggleTypewriterMode,
};

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => editorStoreState },
}));

const mockCreateTab = vi.fn(() => 'new-tab-id');
const mockGetTabsByWindow = vi.fn(() => []);
const mockRemoveWindow = vi.fn();
const mockUpdateTabTitle = vi.fn();
const mockTogglePin = vi.fn();
const mockSetActiveTab = vi.fn();

vi.mock('@/stores/tabStore', () => ({
  useTabStore: {
    getState: () => ({
      createTab: mockCreateTab,
      getTabsByWindow: mockGetTabsByWindow,
      removeWindow: mockRemoveWindow,
      updateTabTitle: mockUpdateTabTitle,
      togglePin: mockTogglePin,
      setActiveTab: mockSetActiveTab,
    }),
  },
}));

const mockInitDocument = vi.fn();
const mockLoadContent = vi.fn();
const mockSetContent = vi.fn();
const mockMarkMissing = vi.fn();
const mockMarkDivergent = vi.fn();
const mockSetCursorInfo = vi.fn();
const mockRemoveDocument = vi.fn();

vi.mock('@/stores/documentStore', () => ({
  useDocumentStore: {
    getState: () => ({
      initDocument: mockInitDocument,
      loadContent: mockLoadContent,
      setContent: mockSetContent,
      markMissing: mockMarkMissing,
      markDivergent: mockMarkDivergent,
      setCursorInfo: mockSetCursorInfo,
      removeDocument: mockRemoveDocument,
    }),
  },
}));

const mockClearDocument = vi.fn();

vi.mock('@/stores/unifiedHistoryStore', () => {
  // Need real setState for restoreUnifiedHistory
  let storeState: Record<string, unknown> = { documents: {} };
  return {
    useUnifiedHistoryStore: {
      getState: () => ({
        clearDocument: mockClearDocument,
        documents: storeState.documents,
      }),
      setState: (updater: unknown) => {
        if (typeof updater === 'function') {
          const result = (updater as (s: typeof storeState) => typeof storeState)(storeState);
          storeState = { ...storeState, ...result };
        } else {
          storeState = { ...storeState, ...(updater as Record<string, unknown>) };
        }
      },
      // Expose for test assertions
      _getInternalState: () => storeState,
      _resetInternalState: () => { storeState = { documents: {} }; },
    },
  };
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import {
  pullWindowStateWithRetry,
  restoreWindowState,
  restoreUiState,
  restoreTabs,
  restoreDocumentState,
  restoreUnifiedHistory,
} from './restoreHelpers';
import { useUnifiedHistoryStore } from '@/stores/unifiedHistoryStore';

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

function makeCursorInfo(overrides: Partial<CursorInfo> = {}): CursorInfo {
  return {
    source_line: 5,
    word_at_cursor: 'hello',
    offset_in_word: 2,
    node_type: 'paragraph',
    percent_in_line: 0.5,
    context_before: 'say ',
    context_after: ' world',
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
    editorStoreState.sourceMode = false;
    editorStoreState.focusModeEnabled = false;
    editorStoreState.typewriterModeEnabled = false;
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

    it.each([
      { width: 100, expected: 260, desc: 'below minimum (150)' },
      { width: 600, expected: 260, desc: 'above maximum (500)' },
      { width: NaN, expected: 260, desc: 'NaN' },
      { width: Infinity, expected: 260, desc: 'Infinity' },
      { width: -Infinity, expected: 260, desc: '-Infinity' },
    ])('should use default sidebar width when $desc', ({ width, expected }) => {
      const ws = makeWindowState({
        ui_state: makeUiState({ sidebar_width: width }),
      });

      restoreUiState(ws);

      expect(mockSetSidebarWidth).toHaveBeenCalledWith(expected);
    });

    it.each([150, 260, 500])('should accept valid sidebar width %d', (width) => {
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
      editorStoreState.sourceMode = false;
      const ws = makeWindowState({
        ui_state: makeUiState({ source_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleSourceMode).toHaveBeenCalledTimes(1);
    });

    it('should NOT toggle source mode when values match', () => {
      editorStoreState.sourceMode = true;
      const ws = makeWindowState({
        ui_state: makeUiState({ source_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleSourceMode).not.toHaveBeenCalled();
    });

    it('should toggle focus mode when saved differs from current', () => {
      editorStoreState.focusModeEnabled = false;
      const ws = makeWindowState({
        ui_state: makeUiState({ focus_mode_enabled: true }),
      });

      restoreUiState(ws);

      expect(mockToggleFocusMode).toHaveBeenCalledTimes(1);
    });

    it('should toggle typewriter mode when saved differs from current', () => {
      editorStoreState.typewriterModeEnabled = false;
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
  });

  // =========================================================================
  // restoreDocumentState
  // =========================================================================

  describe('restoreDocumentState', () => {
    it('should initialize and load document with saved content', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        file_path: '/docs/readme.md',
        document: makeDocState({
          saved_content: 'saved text',
          content: 'saved text',
          line_ending: '\n',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockInitDocument).toHaveBeenCalledWith('tab-1', 'saved text', '/docs/readme.md');
      expect(mockLoadContent).toHaveBeenCalledWith('tab-1', 'saved text', '/docs/readme.md', {
        lineEnding: 'lf',
      });
    });

    it('should apply dirty content when is_dirty is true', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({
          saved_content: 'saved',
          content: 'modified',
          is_dirty: true,
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetContent).toHaveBeenCalledWith('tab-1', 'modified');
    });

    it('should NOT call setContent when not dirty', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({ is_dirty: false }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetContent).not.toHaveBeenCalled();
    });

    it.each([
      { lineEnding: '\n' as const, expected: 'lf' },
      { lineEnding: '\r\n' as const, expected: 'crlf' },
      { lineEnding: 'unknown' as const, expected: 'unknown' },
    ])('should convert line ending "$lineEnding" to "$expected"', async ({ lineEnding, expected }) => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({ line_ending: lineEnding }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockLoadContent).toHaveBeenCalledWith(
        'tab-1',
        expect.any(String),
        expect.anything(),
        { lineEnding: expected },
      );
    });

    it('should default to "unknown" for invalid line ending', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({
          // Force an invalid value for testing
          line_ending: 'garbage' as unknown as '\n',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockLoadContent).toHaveBeenCalledWith(
        'tab-1',
        expect.any(String),
        expect.anything(),
        { lineEnding: 'unknown' },
      );
    });

    it('should mark document as missing when is_missing is true', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({ is_missing: true }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockMarkMissing).toHaveBeenCalledWith('tab-1');
    });

    it('should mark document as divergent when is_divergent is true', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({ is_divergent: true }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockMarkDivergent).toHaveBeenCalledWith('tab-1');
    });

    it('should NOT mark missing or divergent when flags are false', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({ is_missing: false, is_divergent: false }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockMarkMissing).not.toHaveBeenCalled();
      expect(mockMarkDivergent).not.toHaveBeenCalled();
    });

    it('should restore valid cursor info', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const cursor = makeCursorInfo();
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).toHaveBeenCalledWith('tab-1', {
        sourceLine: 5,
        wordAtCursor: 'hello',
        offsetInWord: 2,
        nodeType: 'paragraph',
        percentInLine: 0.5,
        contextBefore: 'say ',
        contextAfter: ' world',
        blockAnchor: undefined,
      });
    });

    it('should NOT set cursor info when cursor_info is null', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        document: makeDocState({ cursor_info: null }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with NaN source_line', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const cursor = makeCursorInfo({ source_line: NaN });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with Infinity offset_in_word', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const cursor = makeCursorInfo({ offset_in_word: Infinity });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with NaN percent_in_line', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const cursor = makeCursorInfo({ percent_in_line: NaN });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should use defaults for missing optional cursor fields', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      // Cursor with null/undefined optional fields
      const cursor: CursorInfo = {
        source_line: 1,
        word_at_cursor: undefined as unknown as string,
        offset_in_word: 0,
        node_type: undefined as unknown as string,
        percent_in_line: 0,
        context_before: undefined as unknown as string,
        context_after: undefined as unknown as string,
      };
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).toHaveBeenCalledWith('tab-1', expect.objectContaining({
        wordAtCursor: '',
        nodeType: 'paragraph',
        contextBefore: '',
        contextAfter: '',
      }));
    });

    it('should handle document with empty content', async () => {
      const docStore = {
        initDocument: mockInitDocument,
        loadContent: mockLoadContent,
        setContent: mockSetContent,
        markMissing: mockMarkMissing,
        markDivergent: mockMarkDivergent,
        setCursorInfo: mockSetCursorInfo,
      } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;

      const tab = makeTabState({
        file_path: null,
        document: makeDocState({
          content: '',
          saved_content: '',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockInitDocument).toHaveBeenCalledWith('tab-1', '', null);
      expect(mockLoadContent).toHaveBeenCalledWith('tab-1', '', null, expect.any(Object));
    });
  });

  // =========================================================================
  // restoreUnifiedHistory
  // =========================================================================

  describe('restoreUnifiedHistory', () => {
    it('should skip restore when both undo and redo are empty', () => {
      const docState = makeDocState({
        undo_history: [],
        redo_history: [],
      });

      restoreUnifiedHistory('tab-1', docState);

      const state = (useUnifiedHistoryStore as unknown as { _getInternalState: () => Record<string, unknown> })._getInternalState();
      expect(state.documents).toEqual({});
    });

    it('should restore undo history checkpoints', () => {
      const docState = makeDocState({
        undo_history: [
          {
            markdown: '# Heading',
            mode: 'wysiwyg',
            cursor_info: null,
            timestamp: 1000,
          },
          {
            markdown: '# Updated',
            mode: 'source',
            cursor_info: null,
            timestamp: 2000,
          },
        ],
        redo_history: [],
      });

      restoreUnifiedHistory('tab-1', docState);

      const state = (useUnifiedHistoryStore as unknown as { _getInternalState: () => { documents: Record<string, { undoStack: unknown[]; redoStack: unknown[] }> } })._getInternalState();
      expect(state.documents['tab-1']).toBeDefined();
      expect(state.documents['tab-1'].undoStack).toHaveLength(2);
      expect(state.documents['tab-1'].undoStack[0]).toEqual({
        markdown: '# Heading',
        mode: 'wysiwyg',
        cursorInfo: null,
        timestamp: 1000,
      });
      expect(state.documents['tab-1'].undoStack[1]).toEqual({
        markdown: '# Updated',
        mode: 'source',
        cursorInfo: null,
        timestamp: 2000,
      });
    });

    it('should restore redo history checkpoints', () => {
      const docState = makeDocState({
        undo_history: [],
        redo_history: [
          {
            markdown: 'redo content',
            mode: 'wysiwyg',
            cursor_info: null,
            timestamp: 3000,
          },
        ],
      });

      restoreUnifiedHistory('tab-1', docState);

      const state = (useUnifiedHistoryStore as unknown as { _getInternalState: () => { documents: Record<string, { undoStack: unknown[]; redoStack: unknown[] }> } })._getInternalState();
      expect(state.documents['tab-1'].redoStack).toHaveLength(1);
      expect(state.documents['tab-1'].redoStack[0]).toEqual({
        markdown: 'redo content',
        mode: 'wysiwyg',
        cursorInfo: null,
        timestamp: 3000,
      });
    });

    it('should convert checkpoint cursor_info to store format', () => {
      const docState = makeDocState({
        undo_history: [
          {
            markdown: 'text',
            mode: 'source',
            cursor_info: makeCursorInfo({
              source_line: 10,
              word_at_cursor: 'test',
              offset_in_word: 1,
              node_type: 'heading',
              percent_in_line: 0.3,
              context_before: 'ab',
              context_after: 'cd',
            }),
            timestamp: 5000,
          },
        ],
        redo_history: [],
      });

      restoreUnifiedHistory('tab-1', docState);

      const state = (useUnifiedHistoryStore as unknown as { _getInternalState: () => { documents: Record<string, { undoStack: Array<{ cursorInfo: unknown }> }> } })._getInternalState();
      expect(state.documents['tab-1'].undoStack[0].cursorInfo).toEqual({
        sourceLine: 10,
        wordAtCursor: 'test',
        offsetInWord: 1,
        nodeType: 'heading',
        percentInLine: 0.3,
        contextBefore: 'ab',
        contextAfter: 'cd',
        blockAnchor: undefined,
      });
    });

    it('should default invalid checkpoint mode to "wysiwyg"', () => {
      const docState = makeDocState({
        undo_history: [
          {
            markdown: 'text',
            mode: 'bogus' as 'wysiwyg',
            cursor_info: null,
            timestamp: 1000,
          },
        ],
        redo_history: [],
      });

      restoreUnifiedHistory('tab-1', docState);

      const state = (useUnifiedHistoryStore as unknown as { _getInternalState: () => { documents: Record<string, { undoStack: Array<{ mode: string }> }> } })._getInternalState();
      expect(state.documents['tab-1'].undoStack[0].mode).toBe('wysiwyg');
    });

    it('should handle undefined undo_history and redo_history gracefully', () => {
      const docState = makeDocState();
      // Simulate missing fields (possible in corrupt data)
      (docState as Record<string, unknown>).undo_history = undefined;
      (docState as Record<string, unknown>).redo_history = undefined;

      restoreUnifiedHistory('tab-1', docState);

      // Should not throw, and should not set any state
      const state = (useUnifiedHistoryStore as unknown as { _getInternalState: () => Record<string, unknown> })._getInternalState();
      expect(state.documents).toEqual({});
    });
  });

  // =========================================================================
  // restoreTabs
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
      editorStoreState.sourceMode = false;

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
