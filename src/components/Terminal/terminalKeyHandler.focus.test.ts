// @vitest-environment node
/**
 * The terminal's half of the editor⇄terminal focus chord.
 *
 * Without an owner here, `Ctrl+Shift+\`` pressed inside the terminal would
 * reach xterm, which would encode it and send bytes to the shell — the window
 * binding alone is not enough, because the terminal sees the key first. So the
 * handler claims it, exactly as it already claims Toggle Terminal, and the two
 * now share one table (`PANEL_CHORDS`).
 *
 * Split from `terminalKeyHandler.test.ts`, which is at its frozen size
 * baseline (862) and may only shrink.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequestToggleTerminal = vi.fn();
const mockToggleTerminalFocus = vi.fn();
vi.mock("@/services/terminal/terminalGate", () => ({
  requestToggleTerminal: () => mockRequestToggleTerminal(),
  toggleTerminalFocus: () => mockToggleTerminalFocus(),
}));

import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";
import { useShortcutsStore } from "@/stores/settingsStore";
import { createTerminalKeyHandler } from "./terminalKeyHandler";

function makeHandler() {
  const writes: string[] = [];
  const term = {
    hasSelection: () => false,
    getSelection: () => "",
    clearSelection: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
  } as unknown as Terminal;
  const ptyRef = { current: { write: (d: string) => writes.push(d) } as unknown as IPty };
  const handler = createTerminalKeyHandler(term, ptyRef, {
    onSearch: vi.fn(),
    isComposing: () => false,
  });
  return { handler, writes };
}

/** A keydown shaped like the real one, with the spies the handler consumes. */
function chord(over: Partial<KeyboardEvent> = {}) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = {
    type: "keydown",
    key: "`",
    code: "Backquote",
    ctrlKey: true,
    shiftKey: true,
    metaKey: false,
    altKey: false,
    isComposing: false,
    preventDefault,
    stopPropagation,
    ...over,
  } as unknown as KeyboardEvent;
  return { event, preventDefault, stopPropagation };
}

beforeEach(() => {
  vi.clearAllMocks();
  useShortcutsStore.setState({ customBindings: {} });
});

describe("createTerminalKeyHandler — Focus Terminal", () => {
  it("claims the chord: acts, and lets neither xterm nor the window see it", () => {
    const { handler, writes } = makeHandler();
    const { event, preventDefault, stopPropagation } = chord();
    expect(handler(event)).toBe(false);
    expect(mockToggleTerminalFocus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("does not confuse it with the bare Toggle Terminal chord", () => {
    const { handler } = makeHandler();
    handler(chord({ shiftKey: false }).event);
    expect(mockRequestToggleTerminal).toHaveBeenCalledOnce();
    expect(mockToggleTerminalFocus).not.toHaveBeenCalled();
  });

  // Under a CJK IME the backquote arrives as "·". The chord still resolves,
  // because matching is on the PHYSICAL key — that is the #1083 fix, and it is
  // why this chord works at all with Chinese punctuation on.
  it("resolves the physical key when an IME has remapped the character", () => {
    const { handler } = makeHandler();
    const { event } = chord({ key: "·" });
    expect(handler(event)).toBe(false);
    expect(mockToggleTerminalFocus).toHaveBeenCalledOnce();
  });

  it("swallows it during a real composition without moving focus", () => {
    const { handler, writes } = makeHandler();
    const { event, stopPropagation } = chord({ isComposing: true });
    expect(handler(event)).toBe(false);
    expect(mockToggleTerminalFocus).not.toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("honours a rebind", () => {
    useShortcutsStore.setState({ customBindings: { focusTerminal: "Ctrl-Shift-e" } });
    const { handler } = makeHandler();
    handler(chord().event); // the old default no longer owns anything
    expect(mockToggleTerminalFocus).not.toHaveBeenCalled();
    handler(chord({ key: "e", code: "KeyE" }).event);
    expect(mockToggleTerminalFocus).toHaveBeenCalledOnce();
  });

  it("leaves an unbound chord to the shell", () => {
    useShortcutsStore.setState({ customBindings: { focusTerminal: "" } });
    const { handler } = makeHandler();
    expect(handler(chord().event)).toBe(true);
    expect(mockToggleTerminalFocus).not.toHaveBeenCalled();
  });
});
