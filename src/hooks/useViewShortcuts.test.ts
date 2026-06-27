/**
 * useViewShortcuts — pure function tests
 *
 * Tests the extractable logic from useViewShortcuts.ts:
 *   - shouldSkipKeyEvent: determines whether a keydown should be ignored
 *     (IME composition, input/textarea focus, etc.)
 *   - resolveViewAction: maps a keyboard event to an action identifier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { shouldSkipKeyEvent, resolveViewAction, useViewShortcuts } from "./useViewShortcuts";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/settingsStore";

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
    toggleSidebar: "Ctrl-Shift-0",
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

  it("returns 'toggleSidebar' for the sidebar shortcut (Ctrl-Shift-0, code-matched)", () => {
    // Shift+0 yields ")", so the matcher keys on event.code (Digit0). This is the
    // ONLY handler that owns toggleSidebar — the TipTap keymap deliberately does
    // not bind it (see editorPlugins.tiptap.test.ts) to avoid a double-toggle.
    const event = createKeyEvent(")", { ctrlKey: true, shiftKey: true, code: "Digit0" });
    const result = resolveViewAction(event, shortcuts, "other");
    expect(result).toBe("toggleSidebar");
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

// ---------------------------------------------------------------------------
// Hook integration — proves the window handler toggles the sidebar exactly
// once. Combined with editorPlugins.tiptap.test.ts asserting toggleSidebar is
// NOT in the TipTap keymap, this guarantees no double-toggle.
// ---------------------------------------------------------------------------

describe("useViewShortcuts — sidebar toggle integration", () => {
  beforeEach(() => {
    useShortcutsStore.setState({ customBindings: {} }); // default toggleSidebar = Ctrl-Shift-0
    useUIStore.setState({ sidebarVisible: false });
  });
  afterEach(() => {
    useUIStore.setState({ sidebarVisible: false });
  });

  it("Ctrl-Shift-0 toggles the sidebar exactly once via the window handler", () => {
    const before = useUIStore.getState().sidebarVisible;
    const { unmount } = renderHook(() => useViewShortcuts());

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ")",
        code: "Digit0",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );

    // Toggled once (true), not twice (which would land back on `before`).
    expect(useUIStore.getState().sidebarVisible).toBe(!before);
    unmount();
  });

  it("removes the window listener on unmount (no toggle after teardown)", () => {
    const { unmount } = renderHook(() => useViewShortcuts());
    unmount();
    const before = useUIStore.getState().sidebarVisible;
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ")", code: "Digit0", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(useUIStore.getState().sidebarVisible).toBe(before);
  });
});
