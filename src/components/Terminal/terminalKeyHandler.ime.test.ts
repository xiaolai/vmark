/**
 * #1176 — keys a Chinese IME merely PASSES THROUGH.
 *
 * Root-caused from a live macOS Shuangpin trace: every keydown carries keyCode
 * 229 while the IME owns the keyboard, but `/`, the digits and their shifted
 * punctuation produce NO input event and leave the helper textarea empty. T2
 * consuming those keydowns deleted the keystrokes, and xterm cannot rescue them
 * either — its CompositionHelper refuses every keyCode-229 keydown (pinned in
 * setupImeCompositionGate.webkit.test.ts against a real xterm). So the handler
 * writes them itself.
 *
 * Split from terminalKeyHandler.test.ts, which is at its frozen size baseline.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      terminal: { sessions: [], activeSessionId: null },
      terminalSetActiveSession: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ terminal: { fontSize: 13 }, updateTerminalSetting: vi.fn() }),
    subscribe: vi.fn(() => () => {}),
  },
  useShortcutsStore: {
    getState: () => ({ getShortcut: (id: string) => (id === "toggleTerminal" ? "Ctrl-`" : "") }),
  },
}));

vi.mock("@/services/terminal/terminalGate", () => ({ requestToggleTerminal: vi.fn() }));

import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";
import { createTerminalKeyHandler } from "./terminalKeyHandler";

function makeTerm(): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
  } as unknown as Terminal;
}

// #1176, root-caused from a live macOS Shuangpin trace: every keydown carries
// keyCode 229 while the IME owns the keyboard, but `/` and the digits produce
// NO input event and leave the helper textarea empty. T2 consuming those
// keydowns was what deleted the keystrokes — the gate never had anything to
// forward.
describe("createTerminalKeyHandler — keys the IME passed through (#1176)", () => {
  function makeHandler(isComposing: () => boolean = () => false) {
    const write = vi.fn();
    const ptyRef = { current: { write } as unknown as IPty };
    const handler = createTerminalKeyHandler(makeTerm(), ptyRef, {
      onSearch: vi.fn(),
      isComposing,
    });
    return Object.assign(handler, { write });
  }

  function imeKeydown(key: string, over: Partial<KeyboardEvent> = {}) {
    return {
      type: "keydown",
      key,
      keyCode: 229,
      code: "",
      isComposing: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...over,
    } as unknown as KeyboardEvent;
  }

  // xterm's CompositionHelper refuses EVERY keyCode-229 keydown (verified
  // against a real xterm in the WebKit tier), so the handler must write these
  // itself — returning true would deliver nothing at all.
  it.each(["/", "1", "2", "3", "4", "-", "=", ".", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "0", "9"])(
    "writes %s to the PTY itself",
    (key) => {
      const handler = makeHandler();
      const ev = imeKeydown(key);
      expect(handler(ev)).toBe(false);
      expect(handler.write).toHaveBeenCalledWith(key);
      expect(ev.preventDefault).toHaveBeenCalled();
    },
  );

  it("writes each key of a typed run exactly once", () => {
    const handler = makeHandler();
    for (const k of ["1", "2", "3", "4"]) handler(imeKeydown(k));
    expect(handler.write.mock.calls.map((c) => c[0])).toEqual(["1", "2", "3", "4"]);
  });

  it("does not write when the PTY is gone", () => {
    const handler = createTerminalKeyHandler(makeTerm(), { current: null }, {
      onSearch: vi.fn(),
      isComposing: () => false,
    });
    expect(() => handler(imeKeydown("/"))).not.toThrow();
  });

  it.each(["a", "n", "z"])("consumes the letter %s WITHOUT writing (it starts a composition)", (key) => {
    const handler = makeHandler();
    expect(handler(imeKeydown(key))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("consumes a digit WITHOUT writing while composing (candidate selection)", () => {
    const handler = makeHandler(() => true); // isComposing
    expect(handler(imeKeydown("2"))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("consumes a digit whose event reports isComposing, without writing", () => {
    const handler = makeHandler();
    expect(handler(imeKeydown("2", { isComposing: true }))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("consumes a named IME key without writing", () => {
    const handler = makeHandler();
    expect(handler(imeKeydown("Process"))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
  ])("%s+1 is a host chord, not shell input", (_label, mods) => {
    const handler = makeHandler();
    expect(handler(imeKeydown("1", mods))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("Shift+1 still reaches the shell as !", () => {
    const handler = makeHandler();
    handler(imeKeydown("!", { shiftKey: true }));
    expect(handler.write).toHaveBeenCalledWith("!");
  });
});
