/**
 * Tests for imeGuard.ts — IME composition guard utilities.
 *
 * Covers: isImeKeyEvent, composition state checks, grace period logic,
 * command guarding, action queuing/flushing, and cleanup prefix detection.
 */

import { describe, it, expect, vi } from "vitest";
import {
  isImeKeyEvent,
  HANGUL_RE,
  IME_GRACE_PERIOD_MS,
  isProseMirrorComposing,
  isCodeMirrorComposing,
  markProseMirrorCompositionEnd,
  markCodeMirrorCompositionEnd,
  isProseMirrorInCompositionGrace,
  isCodeMirrorInCompositionGrace,
  guardProseMirrorCommand,
  guardCodeMirrorKeyBinding,
  runOrQueueProseMirrorAction,
  flushProseMirrorCompositionQueue,
  runOrQueueCodeMirrorAction,
  flushCodeMirrorCompositionQueue,
  getImeCleanupPrefixLength,
} from "./imeGuard";

// ---- isImeKeyEvent ----

describe("isImeKeyEvent", () => {
  it("detects IME key events by isComposing", () => {
    expect(isImeKeyEvent({ isComposing: true, keyCode: 0 })).toBe(true);
  });

  it("detects IME key events by keyCode 229", () => {
    expect(isImeKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("returns false for normal key events", () => {
    expect(isImeKeyEvent({ isComposing: false, keyCode: 0 })).toBe(false);
    expect(isImeKeyEvent({ isComposing: false, keyCode: 65 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isImeKeyEvent(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isImeKeyEvent(undefined)).toBe(false);
  });

  it("handles event with only isComposing", () => {
    expect(isImeKeyEvent({ isComposing: true })).toBe(true);
    expect(isImeKeyEvent({ isComposing: false })).toBe(false);
  });

  it("handles event with only keyCode", () => {
    expect(isImeKeyEvent({ keyCode: 229 })).toBe(true);
    expect(isImeKeyEvent({ keyCode: 13 })).toBe(false);
  });

  it("handles empty object", () => {
    expect(isImeKeyEvent({})).toBe(false);
  });
});

// ---- IME_GRACE_PERIOD_MS ----

describe("IME_GRACE_PERIOD_MS", () => {
  it("is 50ms", () => {
    expect(IME_GRACE_PERIOD_MS).toBe(50);
  });
});

// ---- isProseMirrorComposing ----

describe("isProseMirrorComposing", () => {
  it("returns true when view.composing is true", () => {
    const view = { composing: true } as never;
    expect(isProseMirrorComposing(view)).toBe(true);
  });

  it("returns false when view.composing is false", () => {
    const view = { composing: false } as never;
    expect(isProseMirrorComposing(view)).toBe(false);
  });

  it("returns false for null view", () => {
    expect(isProseMirrorComposing(null)).toBe(false);
  });

  it("returns false for undefined view", () => {
    expect(isProseMirrorComposing(undefined)).toBe(false);
  });
});

// ---- isCodeMirrorComposing ----

describe("isCodeMirrorComposing", () => {
  it("returns true when view.composing is true", () => {
    const view = { composing: true, compositionStarted: false } as never;
    expect(isCodeMirrorComposing(view)).toBe(true);
  });

  it("returns true when view.compositionStarted is true", () => {
    const view = { composing: false, compositionStarted: true } as never;
    expect(isCodeMirrorComposing(view)).toBe(true);
  });

  it("returns false when both are false", () => {
    const view = { composing: false, compositionStarted: false } as never;
    expect(isCodeMirrorComposing(view)).toBe(false);
  });

  it("returns false for null view", () => {
    expect(isCodeMirrorComposing(null)).toBe(false);
  });

  it("returns false for undefined view", () => {
    expect(isCodeMirrorComposing(undefined)).toBe(false);
  });
});

// ---- Composition grace period ----

describe("ProseMirror composition grace period", () => {
  it("returns false when no compositionEnd has been marked", () => {
    const view = { composing: false } as never;
    expect(isProseMirrorInCompositionGrace(view)).toBe(false);
  });

  it("returns true immediately after marking compositionEnd", () => {
    const view = { composing: false } as never;
    markProseMirrorCompositionEnd(view);
    expect(isProseMirrorInCompositionGrace(view)).toBe(true);
  });

  it("returns false for null view", () => {
    expect(isProseMirrorInCompositionGrace(null)).toBe(false);
  });

  it("returns false for undefined view", () => {
    expect(isProseMirrorInCompositionGrace(undefined)).toBe(false);
  });
});

describe("CodeMirror composition grace period", () => {
  it("returns false when no compositionEnd has been marked", () => {
    const view = { composing: false, compositionStarted: false } as never;
    expect(isCodeMirrorInCompositionGrace(view)).toBe(false);
  });

  it("returns true immediately after marking compositionEnd", () => {
    const view = { composing: false, compositionStarted: false } as never;
    markCodeMirrorCompositionEnd(view);
    expect(isCodeMirrorInCompositionGrace(view)).toBe(true);
  });

  it("returns false for null view", () => {
    expect(isCodeMirrorInCompositionGrace(null)).toBe(false);
  });

  it("returns false for undefined view", () => {
    expect(isCodeMirrorInCompositionGrace(undefined)).toBe(false);
  });
});

// ---- guardProseMirrorCommand ----

describe("guardProseMirrorCommand", () => {
  it("blocks command when view is composing", () => {
    const inner = vi.fn(() => true);
    const guarded = guardProseMirrorCommand(inner);

    const view = { composing: true } as never;
    const result = guarded({} as never, undefined, view);

    expect(result).toBe(false);
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes through command when not composing", () => {
    const inner = vi.fn(() => true);
    const guarded = guardProseMirrorCommand(inner);

    const view = { composing: false } as never;
    const state = {} as never;
    const dispatch = vi.fn();
    guarded(state, dispatch, view);

    expect(inner).toHaveBeenCalledWith(state, dispatch, view);
  });

  it("blocks command during grace period", () => {
    const inner = vi.fn(() => true);
    const guarded = guardProseMirrorCommand(inner);

    const view = { composing: false } as never;
    markProseMirrorCompositionEnd(view);
    const result = guarded({} as never, undefined, view);

    expect(result).toBe(false);
    expect(inner).not.toHaveBeenCalled();
  });
});

// ---- guardCodeMirrorKeyBinding ----

describe("guardCodeMirrorKeyBinding", () => {
  it("blocks run handler when composing", () => {
    const run = vi.fn(() => true);
    const binding = { key: "Enter", run };
    const guarded = guardCodeMirrorKeyBinding(binding);

    const view = { composing: true, compositionStarted: false } as never;
    const result = guarded.run!(view);

    expect(result).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes through run handler when not composing", () => {
    const run = vi.fn(() => true);
    const binding = { key: "Enter", run };
    const guarded = guardCodeMirrorKeyBinding(binding);

    const view = { composing: false, compositionStarted: false } as never;
    guarded.run!(view);

    expect(run).toHaveBeenCalledWith(view);
  });

  it("guards shift handler too", () => {
    const shift = vi.fn(() => true);
    const binding = { key: "Tab", shift };
    const guarded = guardCodeMirrorKeyBinding(binding);

    const view = { composing: true, compositionStarted: false } as never;
    const result = guarded.shift!(view);

    expect(result).toBe(false);
    expect(shift).not.toHaveBeenCalled();
  });

  it("preserves binding properties", () => {
    const binding = { key: "Enter", run: vi.fn(), preventDefault: true };
    const guarded = guardCodeMirrorKeyBinding(binding);

    expect(guarded.key).toBe("Enter");
    expect(guarded.preventDefault).toBe(true);
  });

  it("handles binding without run or shift", () => {
    const binding = { key: "Enter" };
    const guarded = guardCodeMirrorKeyBinding(binding);

    expect(guarded.run).toBeUndefined();
    expect(guarded.shift).toBeUndefined();
  });
});

// ---- runOrQueueProseMirrorAction / flushProseMirrorCompositionQueue ----

describe("ProseMirror action queuing", () => {
  it("runs action immediately when not composing", () => {
    const view = { composing: false } as never;
    const action = vi.fn();
    runOrQueueProseMirrorAction(view, action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("queues action when composing", () => {
    const view = { composing: true } as never;
    const action = vi.fn();
    runOrQueueProseMirrorAction(view, action);
    expect(action).not.toHaveBeenCalled();
  });

  it("flushes queued actions", () => {
    const view = { composing: true } as never;
    const action1 = vi.fn();
    const action2 = vi.fn();
    runOrQueueProseMirrorAction(view, action1);
    runOrQueueProseMirrorAction(view, action2);

    flushProseMirrorCompositionQueue(view);

    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when queue is empty", () => {
    const view = { composing: false } as never;
    // Should not throw
    flushProseMirrorCompositionQueue(view);
  });

  it("clears queue after flush", () => {
    const view = { composing: true } as never;
    const action = vi.fn();
    runOrQueueProseMirrorAction(view, action);
    flushProseMirrorCompositionQueue(view);

    action.mockClear();
    flushProseMirrorCompositionQueue(view);
    expect(action).not.toHaveBeenCalled();
  });
});

// ---- runOrQueueCodeMirrorAction / flushCodeMirrorCompositionQueue ----

describe("CodeMirror action queuing", () => {
  it("runs action immediately when not composing", () => {
    const view = { composing: false, compositionStarted: false } as never;
    const action = vi.fn();
    runOrQueueCodeMirrorAction(view, action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("queues action when composing", () => {
    const view = { composing: true, compositionStarted: false } as never;
    const action = vi.fn();
    runOrQueueCodeMirrorAction(view, action);
    expect(action).not.toHaveBeenCalled();
  });

  it("flushes queued actions", () => {
    const view = { composing: true, compositionStarted: false } as never;
    const action1 = vi.fn();
    const action2 = vi.fn();
    runOrQueueCodeMirrorAction(view, action1);
    runOrQueueCodeMirrorAction(view, action2);

    flushCodeMirrorCompositionQueue(view);

    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when queue is empty", () => {
    const view = { composing: false, compositionStarted: false } as never;
    flushCodeMirrorCompositionQueue(view);
  });

  it("clears queue after flush", () => {
    const view = { composing: true, compositionStarted: false } as never;
    const action = vi.fn();
    runOrQueueCodeMirrorAction(view, action);
    flushCodeMirrorCompositionQueue(view);

    action.mockClear();
    flushCodeMirrorCompositionQueue(view);
    expect(action).not.toHaveBeenCalled();
  });
});

// ---- getImeCleanupPrefixLength ----

describe("getImeCleanupPrefixLength", () => {
  it("computes cleanup prefix for pinyin", () => {
    expect(getImeCleanupPrefixLength("wo\u6211", "\u6211")).toBe(2);
  });

  it("handles spaced pinyin prefixes", () => {
    expect(getImeCleanupPrefixLength("wo kj kj \u6211\u770b\u770b", "\u6211\u770b\u770b")).toBe(9);
  });

  it("handles pinyin prefixes across paragraph breaks", () => {
    expect(
      getImeCleanupPrefixLength("wokjkj \n\u6211\u770b\u770b", "\u6211\u770b\u770b", { allowNewlines: true }),
    ).toBe(8);
  });

  it("skips cleanup when composed text is not CJK", () => {
    expect(getImeCleanupPrefixLength("woa", "a")).toBeNull();
  });

  it("skips cleanup when prefix has no letters", () => {
    expect(getImeCleanupPrefixLength("   \u6211", "\u6211")).toBeNull();
  });

  it("skips cleanup when prefix includes non-pinyin chars", () => {
    expect(getImeCleanupPrefixLength("wo-\u6211", "\u6211")).toBeNull();
  });

  it("skips cleanup when text is exactly the composed text (block-start, #66)", () => {
    expect(getImeCleanupPrefixLength("\u4f60\u597d", "\u4f60\u597d")).toBeNull();
    expect(getImeCleanupPrefixLength("\u6211", "\u6211")).toBeNull();
  });

  it("returns null for empty composed string", () => {
    expect(getImeCleanupPrefixLength("hello", "")).toBeNull();
  });

  it("returns null when text does not end with composed string", () => {
    expect(getImeCleanupPrefixLength("hello\u4e16\u754cworld", "\u4e16\u754c")).toBeNull();
  });

  it("handles Korean composed text", () => {
    // Korean Hangul is in the range \uac00-\ud7af
    expect(getImeCleanupPrefixLength("abc\ud55c\uad6d\uc5b4", "\ud55c\uad6d\uc5b4")).toBe(3);
  });

  it("handles Japanese Hiragana composed text", () => {
    // Hiragana is in range \u3040-\u309f
    expect(getImeCleanupPrefixLength("abc\u3053\u3093\u306b\u3061\u306f", "\u3053\u3093\u306b\u3061\u306f")).toBe(3);
  });

  it("handles Japanese Katakana composed text", () => {
    // Katakana is in range \u30a0-\u30ff
    expect(getImeCleanupPrefixLength("test\u30c6\u30b9\u30c8", "\u30c6\u30b9\u30c8")).toBe(4);
  });

  it("handles numeric pinyin prefix", () => {
    // Some IMEs use numbers for tone selection
    expect(getImeCleanupPrefixLength("wo3\u6211", "\u6211")).toBe(3);
  });

  it("handles semicolon in pinyin prefix (some IME special keys)", () => {
    expect(getImeCleanupPrefixLength("wo;\u6211", "\u6211")).toBe(3);
  });

  it("handles apostrophe in pinyin prefix (syllable separator)", () => {
    expect(getImeCleanupPrefixLength("xi'an\u897f\u5b89", "\u897f\u5b89")).toBe(5);
  });

  it("default regex includes \\s which matches newlines (both regexes accept newlines)", () => {
    // PINYIN_PREFIX_RE uses \s which includes \n — both default and allowNewlines accept this
    expect(getImeCleanupPrefixLength("wo\n\u6211", "\u6211")).toBe(3);
    expect(getImeCleanupPrefixLength("wo\n\u6211", "\u6211", { allowNewlines: true })).toBe(3);
  });

  it("returns null when composed is purely ASCII", () => {
    expect(getImeCleanupPrefixLength("abc", "c")).toBeNull();
  });
});

// ---- HANGUL_RE ----

describe("HANGUL_RE", () => {
  it("matches Korean Hangul syllables", () => {
    expect(HANGUL_RE.test("한")).toBe(true);   // U+D55C
    expect(HANGUL_RE.test("글")).toBe(true);   // U+AE00
    expect(HANGUL_RE.test("한글")).toBe(true);
  });

  it("matches Korean Jamo (consonants/vowels)", () => {
    expect(HANGUL_RE.test("\u1100")).toBe(true);  // Hangul Jamo: ᄀ
    expect(HANGUL_RE.test("\u3131")).toBe(true);  // Compatibility Jamo: ㄱ
  });

  it("does not match Chinese characters", () => {
    expect(HANGUL_RE.test("你好")).toBe(false);
    expect(HANGUL_RE.test("世界")).toBe(false);
  });

  it("does not match Japanese characters", () => {
    expect(HANGUL_RE.test("こんにちは")).toBe(false);
    expect(HANGUL_RE.test("テスト")).toBe(false);
  });

  it("does not match ASCII", () => {
    expect(HANGUL_RE.test("hello")).toBe(false);
    expect(HANGUL_RE.test("123")).toBe(false);
  });
});
