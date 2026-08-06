// Split from tiptap.test.ts per the test-file size gate (WI-7).
// Mocks + the top-level RAF save/restore are replicated (vi.mock is per-module).
/**
 * Tests for compositionGuard tiptap extension — extension metadata,
 * plugin structure, filterTransaction, handleKeyDown, DOM event handlers,
 * and composition state management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock imeGuard before importing the extension
const mockFlushProseMirrorCompositionQueue = vi.fn();
const mockGetImeCleanupPrefixLength = vi.fn(() => 0);
const mockIsImeKeyEvent = vi.fn(() => false);
const mockIsProseMirrorInCompositionGrace = vi.fn(() => false);
const mockMarkProseMirrorCompositionEnd = vi.fn();

vi.mock("@/utils/imeGuard", () => ({
  flushProseMirrorCompositionQueue: (...args: unknown[]) => mockFlushProseMirrorCompositionQueue(...args),
  getImeCleanupPrefixLength: (...args: unknown[]) => mockGetImeCleanupPrefixLength(...args),
  HANGUL_RE: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/,
  IME_GRACE_PERIOD_MS: 50,
  isImeKeyEvent: (...args: unknown[]) => mockIsImeKeyEvent(...args),
  isProseMirrorInCompositionGrace: (...args: unknown[]) => mockIsProseMirrorInCompositionGrace(...args),
  markProseMirrorCompositionEnd: (...args: unknown[]) => mockMarkProseMirrorCompositionEnd(...args),
}));

// Mock splitBlockFix
const mockFixCompositionSplitBlock = vi.fn(() => null);
vi.mock("../splitBlockFix", () => ({
  fixCompositionSplitBlock: (...args: unknown[]) => mockFixCompositionSplitBlock(...args),
}));

// Mock splitBlock from ProseMirror commands (used for Korean deferred Enter)
const mockSplitBlock = vi.fn();
vi.mock("@tiptap/pm/commands", () => ({
  splitBlock: (...args: unknown[]) => mockSplitBlock(...args),
}));

import { compositionGuardExtension } from "../tiptap";

// Mock requestAnimationFrame to execute callbacks synchronously
const originalRAF = globalThis.requestAnimationFrame;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.requestAnimationFrame = originalRAF;
});

describe("compositionGuard filterTransaction — heading split rejection", () => {
  function getPluginSet() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
      spec: {
        filterTransaction: (tr: unknown) => boolean;
      };
    };
    return {
      events: plugin.props.handleDOMEvents,
      filterTransaction: plugin.spec.filterTransaction,
    };
  }

  it("rejects heading→paragraph split transaction during composing", () => {
    const { events, filterTransaction } = getPluginSet();
    const mockView = { state: { selection: { from: 5 } } };
    events.compositionstart(mockView);

    // Transaction that splits a heading into heading + paragraph
    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: {
        childCount: 1,
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "heading" } },
          after: () => 15,
        }),
      },
      doc: {
        childCount: 2, // More children than before → split detected
        content: { size: 30 },
        resolve: (_pos: number) => ({
          nodeAfter: { type: { name: "paragraph" } },
        }),
      },
    };

    expect(filterTransaction(tr)).toBe(false);
  });

  it("allows doc-changing transaction when no heading split detected", () => {
    const { events, filterTransaction } = getPluginSet();
    const mockView = { state: { selection: { from: 5 } } };
    events.compositionstart(mockView);

    // Same childCount — no split
    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: { childCount: 1 },
      doc: { childCount: 1, content: { size: 10 } },
    };

    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows doc-changing transaction when parent is not a heading", () => {
    const { events, filterTransaction } = getPluginSet();
    const mockView = { state: { selection: { from: 5 } } };
    events.compositionstart(mockView);

    // childCount increased but parent is paragraph, not heading
    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: {
        childCount: 1,
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "paragraph" } },
          after: () => 15,
        }),
      },
      doc: {
        childCount: 2,
        content: { size: 30 },
        resolve: () => ({
          nodeAfter: { type: { name: "paragraph" } },
        }),
      },
    };

    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows heading split when new sibling is not a paragraph", () => {
    const { events, filterTransaction } = getPluginSet();
    const mockView = { state: { selection: { from: 5 } } };
    events.compositionstart(mockView);

    // childCount increased, parent is heading, but sibling is blockquote not paragraph
    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: {
        childCount: 1,
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "heading" } },
          after: () => 15,
        }),
      },
      doc: {
        childCount: 2,
        content: { size: 30 },
        resolve: () => ({
          nodeAfter: { type: { name: "blockquote" } },
        }),
      },
    };

    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows heading split when afterPos >= doc.content.size", () => {
    const { events, filterTransaction } = getPluginSet();
    const mockView = { state: { selection: { from: 5 } } };
    events.compositionstart(mockView);

    // afterPos equals doc size → no room for a paragraph sibling
    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: {
        childCount: 1,
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "heading" } },
          after: () => 30, // equals doc.content.size
        }),
      },
      doc: {
        childCount: 2,
        content: { size: 30 },
        resolve: () => ({
          nodeAfter: { type: { name: "paragraph" } },
        }),
      },
    };

    expect(filterTransaction(tr)).toBe(true);
  });

  it("catches resolve errors gracefully during heading split check", () => {
    const { events, filterTransaction } = getPluginSet();
    const mockView = { state: { selection: { from: 5 } } };
    events.compositionstart(mockView);

    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: {
        childCount: 1,
        resolve: () => { throw new Error("stale position"); },
      },
      doc: {
        childCount: 2,
        content: { size: 30 },
      },
    };

    // Catch block falls through to return true (allow)
    expect(filterTransaction(tr)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// appendTransaction — split-block detection during composition
// ---------------------------------------------------------------------------

describe("compositionGuard appendTransaction — split-block detection", () => {
  function getPluginSet() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
      spec: {
        appendTransaction: (transactions: unknown[], oldState: unknown, newState: unknown) => unknown;
      };
    };
    return {
      events: plugin.props.handleDOMEvents,
      appendTransaction: plugin.spec.appendTransaction,
    };
  }

  it("detects heading split when doc childCount increases during composition", () => {
    const { events, appendTransaction } = getPluginSet();

    // Set up composition start
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
            end: () => 20,
          }),
          textBetween: () => "",
          content: { size: 30 },
        },
      },
      dispatch: vi.fn(),
    };
    events.compositionstart(mockView);

    // appendTransaction sees a doc-changing transaction with new heading split
    const newState = {
      selection: { from: 5 },
      doc: {
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "heading" } },
        }),
        childCount: 3,
        content: { size: 30 },
      },
    };

    const oldState = {
      doc: { childCount: 2 }, // fewer children → split detected
    };

    // No pendingHeaderCursorFix, so the result is null for the cursor fix part
    const result = appendTransaction([{ docChanged: true }], oldState, newState);
    expect(result).toBeNull();
    // splitDetected flag is set internally — we verify it indirectly via the rAF path later
  });

  it("appendTransaction catch handles stale position during split detection", () => {
    const { events, appendTransaction } = getPluginSet();

    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
            end: () => 20,
          }),
          textBetween: () => "",
          content: { size: 30 },
        },
      },
      dispatch: vi.fn(),
    };
    events.compositionstart(mockView);

    // newState.doc.resolve throws
    const newState = {
      selection: { from: 5 },
      doc: {
        resolve: () => { throw new RangeError("stale position"); },
        childCount: 3,
        content: { size: 30 },
      },
    };

    const oldState = {
      doc: { childCount: 2 },
    };

    // Should not throw — catch at line 135 swallows the error
    expect(() => {
      appendTransaction([{ docChanged: true }], oldState, newState);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// compositionend rAF — snapshotSplit branch (lines 275-292)
// ---------------------------------------------------------------------------

describe("compositionGuard compositionend rAF — snapshotSplit branch", () => {
  function getPluginSet() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
      spec: {
        appendTransaction: (transactions: unknown[], oldState: unknown, newState: unknown) => unknown;
      };
    };
    return {
      events: plugin.props.handleDOMEvents,
      appendTransaction: plugin.spec.appendTransaction,
    };
  }

  it("runs split-block fix via rAF when splitDetected is true and fix is available", () => {
    const mockTrFix = { fake: "splitFix" };
    mockFixCompositionSplitBlock.mockReturnValue(mockTrFix);

    // Capture rAF callback to control execution order
    let capturedRafCb: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      capturedRafCb = cb;
      return 0;
    };

    const { events, appendTransaction } = getPluginSet();

    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
            end: () => 20,
          }),
          textBetween: () => "",
          content: { size: 30 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
      domObserver: { flush: vi.fn() },
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "nihao" });

    // Trigger split detection via appendTransaction
    const oldState = { doc: { childCount: 1 } };
    const newState = {
      selection: { from: 5 },
      doc: {
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "heading" } },
        }),
        childCount: 2,
        content: { size: 30 },
      },
    };
    appendTransaction([{ docChanged: true }], oldState, newState);

    // Now compositionend fires — rAF callback is captured
    events.compositionend(mockView, { data: "你好" });

    expect(capturedRafCb).not.toBeNull();

    // Run the rAF callback — snapshotSplit is true, should call fixCompositionSplitBlock
    capturedRafCb!(0);

    expect(mockView.dispatch).toHaveBeenCalledWith(mockTrFix);
    expect(mockFlushProseMirrorCompositionQueue).toHaveBeenCalledWith(mockView);

    // Restore synchronous rAF
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  });

  it("falls through to scheduleImeCleanup when splitDetected is true but fix returns null", () => {
    mockFixCompositionSplitBlock.mockReturnValue(null);
    mockGetImeCleanupPrefixLength.mockReturnValue(0);

    // Capture rAF callback
    let capturedRafCb: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      capturedRafCb = cb;
      return 0;
    };

    const { events, appendTransaction } = getPluginSet();

    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
            end: () => 20,
          }),
          textBetween: () => "",
          content: { size: 30 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
      domObserver: { flush: vi.fn() },
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "nihao" });

    // Trigger split detection
    const oldState = { doc: { childCount: 1 } };
    const newState = {
      selection: { from: 5 },
      doc: {
        resolve: () => ({
          depth: 1,
          parent: { type: { name: "heading" } },
        }),
        childCount: 2,
        content: { size: 30 },
      },
    };
    appendTransaction([{ docChanged: true }], oldState, newState);

    events.compositionend(mockView, { data: "你好" });

    expect(capturedRafCb).not.toBeNull();
    capturedRafCb!(0);

    // fix returned null, so it falls through to scheduleImeCleanup
    // which also doesn't dispatch because getImeCleanupPrefixLength returns 0
    expect(mockFlushProseMirrorCompositionQueue).toHaveBeenCalledWith(mockView);

    // Restore synchronous rAF
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  });

  it("skips rAF callback when compositionStartPos changed (stale callback)", () => {
    mockFixCompositionSplitBlock.mockReturnValue(null);

    // Capture rAF callbacks
    const rafCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return 0;
    };

    const { events } = getPluginSet();

    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
            end: () => 20,
          }),
          textBetween: () => "",
          content: { size: 30 },
        },
      },
      dispatch: vi.fn(),
    };

    // First composition session
    events.compositionstart(mockView);
    events.compositionend(mockView, { data: "你" });

    // Second composition session starts before first rAF fires
    const mockView2 = {
      state: {
        selection: { from: 10 }, // different position!
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
            end: () => 25,
          }),
          textBetween: () => "",
          content: { size: 30 },
        },
      },
      dispatch: vi.fn(),
    };
    events.compositionstart(mockView2);

    // Run the first rAF callback — compositionStartPos changed, should be no-op
    expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
    rafCallbacks[0](0);

    // dispatch should NOT have been called (stale callback was skipped)
    expect(mockView.dispatch).not.toHaveBeenCalled();

    // Restore synchronous rAF
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  });
});
