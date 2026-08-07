// @vitest-environment node
/**
 * Tests for restoreDocumentState — rebuilding ONE document from a hot-exit
 * snapshot: content, line metadata, flags, per-doc mode, cursor, and unified
 * history.
 *
 * Split out of restoreHelpers.test.ts to mirror the source split. That module
 * had reached 397 lines around two unrelated responsibilities — pull and
 * validate the window payload, and rebuild each document from it — and its
 * test file 1899. Only the document-store mocks come along; the tab, UI and
 * registry mocks stayed with the half that uses them.
 *
 * @coordinates-with services/persistence/hotExit/restoreDocumentState.ts
 * @module services/persistence/hotExit/restoreDocumentState.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TabState, DocumentState, CursorInfo } from './types';

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
const { mockHotExitWarn } = vi.hoisted(() => ({
  mockHotExitWarn: vi.fn(),
}));

const mockClearDocument = vi.fn();

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { restoreDocumentState, restoreUnifiedHistory } from './restoreDocumentState';
import { useUnifiedHistoryStore } from '@/stores/documentStore';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------


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


/**
 * restoreDocumentState takes the store as a parameter; this builds the
 * minimal mocked surface it touches. Pass extras (e.g. setMode) per test.
 */
function makeDocStore(extra: Record<string, unknown> = {}) {
  return {
    ingestExternalContent: mockIngest,
    setEditorContent: mockSetContent,
    markMissing: mockMarkMissing,
    markDivergent: mockMarkDivergent,
    setCursorInfo: mockSetCursorInfo,
    ...extra,
  } as unknown as ReturnType<typeof import('@/stores/documentStore').useDocumentStore.getState>;
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

describe('restoreDocumentState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No UI-store reset here — document restoration touches neither the UI nor
    // the tab store, which is why their mocks stayed in restoreHelpers.test.ts.
    // Reset unified history store internal state
    (useUnifiedHistoryStore as unknown as { _resetInternalState: () => void })._resetInternalState();
  });

  // =========================================================================
  // pullWindowStateWithRetry
  // =========================================================================

  describe('restoreDocumentState', () => {
    it('should ingest saved content once with path and persisted line ending', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        file_path: '/docs/readme.md',
        document: makeDocState({
          saved_content: 'saved text',
          content: 'saved text',
          line_ending: '\n',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      // Exact opts match: no last_disk_content persisted, so no deriveFrom
      // key may leak in (detection would otherwise run on the wrong text).
      expect(mockIngest).toHaveBeenCalledTimes(1);
      expect(mockIngest).toHaveBeenCalledWith('tab-1', 'saved text', 'hot-exit-restore', {
        filePath: '/docs/readme.md',
        persisted: { lineEnding: 'lf' },
      });
    });

    it('should apply dirty content when is_dirty is true', async () => {
      const docStore = makeDocStore();

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

    it('should NOT call setEditorContent when not dirty', async () => {
      const docStore = makeDocStore();

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
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({ line_ending: lineEnding }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockIngest).toHaveBeenCalledWith(
        'tab-1',
        expect.any(String),
        'hot-exit-restore',
        expect.objectContaining({ persisted: { lineEnding: expected } }),
      );
    });

    it('should default to "unknown" for invalid line ending', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({
          // Force an invalid value for testing
          line_ending: 'garbage' as unknown as '\n',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockIngest).toHaveBeenCalledWith(
        'tab-1',
        expect.any(String),
        'hot-exit-restore',
        expect.objectContaining({ persisted: { lineEnding: 'unknown' } }),
      );
    });

    it('should mark document as missing when is_missing is true', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({ is_missing: true }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockMarkMissing).toHaveBeenCalledWith('tab-1');
    });

    it('should mark document as divergent when is_divergent is true', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({ is_divergent: true }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockMarkDivergent).toHaveBeenCalledWith('tab-1');
    });

    it('should NOT mark missing or divergent when flags are false', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({ is_missing: false, is_divergent: false }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockMarkMissing).not.toHaveBeenCalled();
      expect(mockMarkDivergent).not.toHaveBeenCalled();
    });

    it('should restore valid cursor info', async () => {
      const docStore = makeDocStore();

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
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({ cursor_info: null }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with NaN source_line', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ source_line: NaN });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with Infinity offset_in_word', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ offset_in_word: Infinity });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with NaN percent_in_line', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ percent_in_line: NaN });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with negative source_line', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ source_line: -3 });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with zero source_line (1-indexed)', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ source_line: 0 });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with fractional source_line', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ source_line: 5.5 });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with negative offset_in_word', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ offset_in_word: -1 });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with percent_in_line below 0', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ percent_in_line: -0.1 });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should skip cursor info with percent_in_line above 1', async () => {
      const docStore = makeDocStore();

      const cursor = makeCursorInfo({ percent_in_line: 1.5 });
      const tab = makeTabState({
        document: makeDocState({ cursor_info: cursor }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetCursorInfo).not.toHaveBeenCalled();
    });

    it('should restore cursor info at percent_in_line boundaries (0 and 1)', async () => {
      const docStore = makeDocStore();

      const tabZero = makeTabState({
        document: makeDocState({ cursor_info: makeCursorInfo({ percent_in_line: 0, offset_in_word: 0 }) }),
      });
      await restoreDocumentState('tab-1', tabZero, docStore);
      expect(mockSetCursorInfo).toHaveBeenCalledWith('tab-1', expect.objectContaining({ percentInLine: 0 }));

      mockSetCursorInfo.mockClear();
      const tabOne = makeTabState({
        document: makeDocState({ cursor_info: makeCursorInfo({ percent_in_line: 1 }) }),
      });
      await restoreDocumentState('tab-1', tabOne, docStore);
      expect(mockSetCursorInfo).toHaveBeenCalledWith('tab-1', expect.objectContaining({ percentInLine: 1 }));
    });

    it('should use defaults for missing optional cursor fields', async () => {
      const docStore = makeDocStore();

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
      const docStore = makeDocStore();

      const tab = makeTabState({
        file_path: null,
        document: makeDocState({
          content: '',
          saved_content: '',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockIngest).toHaveBeenCalledWith(
        'tab-1',
        '',
        'hot-exit-restore',
        expect.objectContaining({ filePath: null }),
      );
    });

    // ------------------------------------------------------------------------
    // Regression tests for audit-fix patches (2026-05-25)
    // ------------------------------------------------------------------------

    it('restores per-tab mode when persisted (ADR-009)', async () => {
      const mockSetMode = vi.fn();
      const docStore = makeDocStore({ setMode: mockSetMode });

      const tab = makeTabState({
        document: makeDocState({ mode: 'source' }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetMode).toHaveBeenCalledWith('tab-1', 'source');
    });

    it('does not call setMode when mode field is absent (pre-mode sessions)', async () => {
      const mockSetMode = vi.fn();
      const docStore = makeDocStore({ setMode: mockSetMode });

      const tab = makeTabState({
        document: makeDocState({}),  // no mode field
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetMode).not.toHaveBeenCalled();
    });

    it('does not call setMode for an invalid mode value (e.g. "split-pane")', async () => {
      const mockSetMode = vi.fn();
      const docStore = makeDocStore({ setMode: mockSetMode });

      const tab = makeTabState({
        // @ts-expect-error — exercising untyped persisted payload defense
        document: makeDocState({ mode: 'split-pane' }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockSetMode).not.toHaveBeenCalled();
    });

    it('restores hardBreakStyle via ingest persisted meta when persisted', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({
          saved_content: 'x',
          hard_break_style: 'twoSpaces',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockIngest).toHaveBeenCalledWith(
        'tab-1',
        'x',
        'hot-exit-restore',
        expect.objectContaining({
          persisted: expect.objectContaining({ hardBreakStyle: 'twoSpaces' }),
        }),
      );
    });

    it('passes persisted lastDiskContent as deriveFrom (raw disk bytes drive detection)', async () => {
      const docStore = makeDocStore();

      const tab = makeTabState({
        document: makeDocState({
          saved_content: 'saved',
          last_disk_content: 'on-disk-normalized',
        }),
      });

      await restoreDocumentState('tab-1', tab, docStore);

      expect(mockIngest).toHaveBeenCalledWith(
        'tab-1',
        'saved',
        'hot-exit-restore',
        expect.objectContaining({ deriveFrom: 'on-disk-normalized' }),
      );
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

});
