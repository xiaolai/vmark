/**
 * useViewShortcuts — pure function tests
 *
 * Tests the extractable logic from useViewShortcuts.ts:
 *   - shouldSkipKeyEvent: determines whether a keydown should be ignored
 *     (IME composition, input/textarea focus, etc.)
 *   - resolveViewAction: maps a keyboard event to an action identifier
 */

import { describe, it, expect, vi } from "vitest";
import { shouldSkipKeyEvent, resolveViewAction } from "./useViewShortcuts";

// ---------------------------------------------------------------------------
// shouldSkipKeyEvent
// ---------------------------------------------------------------------------
describe("shouldSkipKeyEvent", () => {
  it("returns true for IME events (isComposing)", () => {
    const event = { isComposing: true, target: document.createElement("div") } as unknown as KeyboardEvent;
    expect(shouldSkipKeyEvent(event)).toBe(true);
  });

  it("returns true for IME events (keyCode 229)", () => {
    const event = { isComposing: false, keyCode: 229, target: document.createElement("div") } as unknown as KeyboardEvent;
    expect(shouldSkipKeyEvent(event)).toBe(true);
  });

  it("returns false for input elements (handled per-shortcut)", () => {
    // shouldSkipKeyEvent only checks IME, not input/textarea
    // The input/textarea filtering is done in the dispatch logic
    const input = document.createElement("input");
    const event = { isComposing: false, keyCode: 0, target: input } as unknown as KeyboardEvent;
    expect(shouldSkipKeyEvent(event)).toBe(false);
  });

  it("returns false for normal events on div elements", () => {
    const div = document.createElement("div");
    const event = { isComposing: false, keyCode: 0, target: div } as unknown as KeyboardEvent;
    expect(shouldSkipKeyEvent(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveViewAction
// ---------------------------------------------------------------------------
describe("resolveViewAction", () => {
  // Mock shortcuts store
  const shortcuts: Record<string, string> = {
    toggleTerminal: "Mod-`",
    sourceMode: "Mod-/",
    focusMode: "F8",
    typewriterMode: "F9",
    wordWrap: "Alt-z",
    lineNumbers: "Alt-Mod-l",
    readOnly: "Alt-Mod-r",
    fitTables: "",
    validateMarkdown: "",
    lintNext: "",
    lintPrev: "",
    toggleOutline: "Alt-Mod-o",
    fileExplorer: "Alt-Mod-e",
    viewHistory: "Alt-Mod-h",
  };

  function createKeyEvent(key: string, opts: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    code?: string;
    target?: HTMLElement;
  } = {}): KeyboardEvent {
    const div = opts.target ?? document.createElement("div");
    return {
      key,
      code: opts.code ?? "",
      metaKey: opts.metaKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
      altKey: opts.altKey ?? false,
      shiftKey: opts.shiftKey ?? false,
      isComposing: false,
      keyCode: 0,
      target: div,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
  }

  it("returns 'toggleTerminal' for the terminal shortcut", () => {
    // On mac, Mod = metaKey
    const event = createKeyEvent("`", { metaKey: true, code: "Backquote" });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("toggleTerminal");
  });

  it("returns 'toggleTerminal' even when target is textarea", () => {
    const textarea = document.createElement("textarea");
    const event = createKeyEvent("`", { metaKey: true, code: "Backquote", target: textarea });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("toggleTerminal");
  });

  it("returns null for non-terminal shortcut when target is input", () => {
    const input = document.createElement("input");
    const event = createKeyEvent("/", { metaKey: true, target: input });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBeNull();
  });

  it("returns null for non-terminal shortcut when target is textarea", () => {
    const textarea = document.createElement("textarea");
    const event = createKeyEvent("F8", { target: textarea });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBeNull();
  });

  it("returns 'sourceMode' for the source mode shortcut", () => {
    const event = createKeyEvent("/", { metaKey: true });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("sourceMode");
  });

  it("returns 'focusMode' for F8", () => {
    const event = createKeyEvent("F8", {});
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("focusMode");
  });

  it("returns 'typewriterMode' for F9", () => {
    const event = createKeyEvent("F9", {});
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("typewriterMode");
  });

  it("returns 'toggleOutline' for outline shortcut", () => {
    const event = createKeyEvent("o", { altKey: true, metaKey: true });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("toggleOutline");
  });

  it("returns 'fileExplorer' for file explorer shortcut", () => {
    const event = createKeyEvent("e", { altKey: true, metaKey: true });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBe("fileExplorer");
  });

  it("returns null for unrecognized key events", () => {
    const event = createKeyEvent("x", {});
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBeNull();
  });

  it("returns null for empty shortcut binding", () => {
    // fitTables has empty string binding — should not match anything
    const event = createKeyEvent("f", { altKey: true, metaKey: true });
    const result = resolveViewAction(event, shortcuts, "mac");
    expect(result).toBeNull();
  });

  it("works with 'other' platform (Ctrl instead of Meta)", () => {
    const event = createKeyEvent("`", { ctrlKey: true, code: "Backquote" });
    const result = resolveViewAction(event, shortcuts, "other");
    expect(result).toBe("toggleTerminal");
  });
});
