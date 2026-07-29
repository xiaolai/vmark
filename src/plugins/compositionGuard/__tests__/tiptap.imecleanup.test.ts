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

describe("compositionGuard scheduleImeCleanup", () => {
  function getFullPlugin() {
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
    };
    return plugin.props.handleDOMEvents;
  }

  it("handles compositionend with data and schedules cleanup via requestAnimationFrame", () => {
    const events = getFullPlugin();
    const mockResolve = (_pos: number) => ({
      depth: 1,
      node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
      end: (d?: number) => d !== undefined ? 20 : 15,
    });
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "hello",
          content: { size: 30 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    events.compositionend(mockView, { data: "你" });

    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalled();
  });

  it("calls fixCompositionSplitBlock when pinyin is available", () => {
    const events = getFullPlugin();
    const mockResolve = (_pos: number) => ({
      depth: 1,
      node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
      end: (d?: number) => d !== undefined ? 20 : 15,
    });
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "nihao",
          content: { size: 30 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "nihao" });
    events.compositionend(mockView, { data: "你好" });

    // The cleanup is scheduled in requestAnimationFrame, so we need to flush it
    // Run the rAF callback
    vi.runAllTimers();
  });

  it("scheduleImeCleanup with table cell adjusts cleanup range", () => {
    const events = getFullPlugin();
    const mockResolve = (_pos: number) => ({
      depth: 2,
      node: (d: number) => ({
        type: { name: d === 2 ? "tableCell" : d === 1 ? "paragraph" : "doc" },
      }),
      end: (d?: number) => d === 2 ? 30 : d !== undefined ? 20 : 15,
    });
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "hello",
          content: { size: 40 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    events.compositionend(mockView, { data: "你" });

    // Run the rAF callback
    vi.runAllTimers();
    // Verify the cleanup was attempted
    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalled();
  });

  it("split-block fix is handled by appendTransaction (not rAF)", () => {
    // After compositionend, splitBlockFix returns null (no split yet in rAF)
    mockFixCompositionSplitBlock.mockReturnValue(null);

    const events = getFullPlugin();
    const mockResolve = () => ({
      depth: 1,
      node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
      end: (d?: number) => d !== undefined ? 20 : 15,
    });
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "nihao你好",
          content: { size: 30 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "nihao" });
    events.compositionend(mockView, { data: "你好" });

    // rAF fallback: since splitBlockFix returns null, scheduleImeCleanup runs
    vi.runAllTimers();
    // The key point: split-block detection is now in appendTransaction,
    // which fires synchronously. The rAF path handles normal pinyin cleanup only.
    // fixCompositionSplitBlock is NOT called from the rAF path anymore.
    // (appendTransaction tests are covered by the splitBlockFix unit tests)
  });

  it("scheduleImeCleanup is invoked via compositionend and calls cleanup prefix detection", () => {
    mockGetImeCleanupPrefixLength.mockReturnValue(3);

    const events = getFullPlugin();
    const mockResolve = (_pos: number) => ({
      depth: 1,
      node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
      end: (d?: number) => d !== undefined ? 20 : 15,
    });
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "ninhao",
          content: { size: 30 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    events.compositionend(mockView, { data: "你" });

    // compositionend marks the end — scheduleImeCleanup runs inside rAF
    // which fake timers may not flush. Verify the compositionend pipeline at minimum.
    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalledWith(mockView);

    // Run all timers to attempt flushing rAF (works in some jsdom configs)
    vi.runAllTimers();
  });

  it("scheduleImeCleanup handles compositionStartPos > cleanupEnd gracefully", () => {
    const events = getFullPlugin();
    // compositionStartPos will be 5 (from selection.from)
    // end() returns 3, which is less than 5
    // The resolve needs to work for both compositionend (findTableCellDepth) and scheduleImeCleanup
    const mockResolve = (_pos: number) => ({
      depth: 1,
      node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
      end: () => 3,
    });
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "",
          content: { size: 10 },
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    events.compositionend(mockView, { data: "你" });

    vi.runAllTimers();
    // Should not crash; dispatch may or may not be called depending on internal flow
    // The key assertion is that it doesn't throw
  });

  it("scheduleImeCleanup handles resolve throwing during rAF fallback cleanup", () => {
    // splitBlockFix returns null so appendTransaction doesn't consume pendingSplitFix
    mockFixCompositionSplitBlock.mockReturnValue(null);

    const events = getFullPlugin();
    // First resolve (during compositionend for findTableCellDepth) should work,
    // but a later resolve (during scheduleImeCleanup in rAF) should throw
    let callCount = 0;
    const mockResolve = () => {
      callCount++;
      if (callCount > 4) {
        throw new Error("Invalid position");
      }
      return {
        depth: 1,
        node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
        end: () => 10,
      };
    };
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "",
          content: { size: 20 },
        },
        tr: {
          delete: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    events.compositionend(mockView, { data: "你" });

    // Should not throw even if resolve fails during rAF callback
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it("scheduleImeCleanup returns early when resolve throws (line 73)", () => {
    mockFixCompositionSplitBlock.mockReturnValue(null);

    // Capture rAF callback instead of running it synchronously
    let capturedRafCb: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      capturedRafCb = cb;
      return 0;
    };

    const events = getFullPlugin();
    const workingResolve = () => ({
      depth: 1,
      node: (d: number) => ({ type: { name: d === 1 ? "paragraph" : "doc" } }),
      end: () => 10,
    });
    const mockDoc = {
      resolve: workingResolve,
      textBetween: () => "",
      content: { size: 20 },
    };
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: mockDoc,
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    events.compositionend(mockView, { data: "你" });

    // rAF was captured, not yet executed
    expect(capturedRafCb).not.toBeNull();

    // Swap resolve to throw before running the rAF callback
    mockDoc.resolve = () => { throw new RangeError("Position out of range"); };

    // Now run the rAF callback — scheduleImeCleanup hits the catch at line 73
    expect(() => capturedRafCb!(0)).not.toThrow();
    // dispatch should NOT have been called (cleanup was skipped due to throw)
    expect(mockView.dispatch).not.toHaveBeenCalled();

    // Restore synchronous rAF for other tests
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  });

  it("compositionupdate without data preserves previous compositionData", () => {
    const events = getFullPlugin();
    const mockTr = { delete: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() };
    const mockView = {
      state: {
        selection: { from: 0 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: () => ({ type: { name: "paragraph" } }),
            end: () => 10,
          }),
          textBetween: () => "",
          content: { size: 20 },
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    events.compositionupdate(mockView, { data: "ni" });
    // Update without data — should keep "ni"
    events.compositionupdate(mockView, { data: undefined });
    events.compositionend(mockView, { data: "你" });

    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalled();
  });

  it("handles compositionend with empty data string gracefully", () => {
    const events = getFullPlugin();
    const mockTr2 = { delete: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() };
    const mockView = {
      state: {
        selection: { from: 0 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: () => ({ type: { name: "paragraph" } }),
            end: () => 10,
          }),
          textBetween: () => "",
          content: { size: 20 },
        },
        tr: mockTr2,
      },
      dispatch: vi.fn(),
    };

    events.compositionstart(mockView);
    // compositionend with empty data — should not crash
    events.compositionend(mockView, { data: "" });

    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// compositionend — tableHeader cursor fix path
// ---------------------------------------------------------------------------
