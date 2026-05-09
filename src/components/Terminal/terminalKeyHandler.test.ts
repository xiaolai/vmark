import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSessions, mockSetActiveSession } = vi.hoisted(() => ({
  mockSessions: vi.fn(() => [] as Array<{ id: string; name: string; isAlive: boolean }>),
  mockSetActiveSession: vi.fn(),
}));

vi.mock("@/stores/terminalSessionStore", () => ({
  useTerminalSessionStore: {
    getState: () => ({
      sessions: mockSessions(),
      setActiveSession: mockSetActiveSession,
    }),
  },
}));

import { createTerminalKeyHandler, type KeyHandlerCallbacks } from "./terminalKeyHandler";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";

vi.mock("@/lib/pty", () => ({ spawn: vi.fn() }));

function makeTerm(overrides: Partial<Terminal> = {}): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  } as unknown as Terminal;
}

function makeEvent(
  key: string,
  meta = true,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    type: "keydown",
    key,
    metaKey: meta,
    ctrlKey: false,
    isComposing: false,
    keyCode: 0,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("createTerminalKeyHandler", () => {
  let callbacks: KeyHandlerCallbacks;
  let mockIsComposing: ReturnType<typeof vi.fn<() => boolean>>;
  let ptyRef: React.RefObject<IPty | null>;
  let mockPty: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsComposing = vi.fn<() => boolean>(() => false);
    callbacks = { onSearch: vi.fn(), isComposing: mockIsComposing };
    mockPty = { write: vi.fn() };
    ptyRef = { current: mockPty as unknown as IPty };
  });

  it("copies selection on Cmd+C when selection exists", () => {
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "hello"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c"));

    expect(result).toBe(false);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(term.clearSelection).toHaveBeenCalled();
  });

  it("passes through Cmd+C for SIGINT when no selection", () => {
    const term = makeTerm({ hasSelection: vi.fn(() => false) });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c"));

    expect(result).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("pastes clipboard on Cmd+V", async () => {
    vi.mocked(readText).mockResolvedValue("pasted");
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("v"));

    expect(result).toBe(false);
    // Wait for async paste
    await vi.waitFor(() => {
      expect(mockPty.write).toHaveBeenCalledWith("pasted");
    });
  });

  it("clears terminal on Cmd+K", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("k"));

    expect(result).toBe(false);
    expect(term.clear).toHaveBeenCalled();
  });

  it("triggers search callback on Cmd+F", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("f"));

    expect(result).toBe(false);
    expect(callbacks.onSearch).toHaveBeenCalled();
  });

  it("passes through unhandled keys", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    expect(handler(makeEvent("a"))).toBe(true);
    expect(handler(makeEvent("z"))).toBe(true);
  });

  describe("Shift+Enter — WezTerm-impersonation parity", () => {
    it("writes the CSI-u sequence for codepoint 13 + Shift modifier", () => {
      // Real WezTerm under the kitty keyboard protocol sends "\x1b[13;2u"
      // for Shift+Enter (13 = Enter, 2 = Shift). Without this branch the
      // PTY would receive a plain "\r" and a tool keying off the WezTerm
      // env var (Claude Code, etc.) would not see the newline.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", false, { shiftKey: true });

      const result = handler(event);

      expect(result).toBe(false);
      expect(mockPty.write).toHaveBeenCalledWith("\x1b[13;2u");
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("does not crash when ptyRef.current is null", () => {
      // Race window between session teardown and a queued keystroke.
      // We still consume the event so xterm doesn't fall through and
      // emit a stray "\r".
      const term = makeTerm();
      const nullPtyRef = { current: null } as React.RefObject<IPty | null>;
      const handler = createTerminalKeyHandler(term, nullPtyRef, callbacks);

      const result = handler(makeEvent("Enter", false, { shiftKey: true }));

      expect(result).toBe(false);
      // No crash, no write attempt
    });

    it("plain Enter (no Shift) passes through to xterm's default", () => {
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", false, { shiftKey: false });

      expect(handler(event)).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalled();
    });

    it("Cmd+Shift+Enter falls through (not the CSI-u path)", () => {
      // CSI-u Shift+Enter is plain Shift+Enter only. Modifier combos with
      // Cmd are reserved for the host shortcut layer.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", true, { shiftKey: true });

      handler(event);

      expect(mockPty.write).not.toHaveBeenCalledWith("\x1b[13;2u");
    });

    it("Ctrl+Shift+Enter falls through (not the CSI-u path)", () => {
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", false, {
        ctrlKey: true,
        shiftKey: true,
      });

      handler(event);

      expect(mockPty.write).not.toHaveBeenCalledWith("\x1b[13;2u");
    });

    it("Alt+Shift+Enter falls through (different CSI-u modifier)", () => {
      // Alt+Shift+Enter would be "\x1b[13;4u" in kitty mode, but we're
      // scoping this fix to the user-facing Shift+Enter symptom only.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", false, {
        altKey: true,
        shiftKey: true,
      });

      handler(event);

      expect(mockPty.write).not.toHaveBeenCalledWith("\x1b[13;2u");
    });

    it("Shift+Enter during IME composition does not emit the sequence", () => {
      // CJK input must take precedence — emitting CSI-u during composition
      // could break the input method's commit flow.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", false, {
        shiftKey: true,
        isComposing: true,
      });

      const result = handler(event);

      expect(result).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalled();
    });

    it("Shift+Enter inside the post-compositionend grace window also defers", () => {
      // Browsers fire a follow-up keydown for the confirming key with
      // event.isComposing === false, but setupImeComposition keeps the
      // handle's `composing` flag true through the 80ms grace window.
      // Without callbacks.isComposing(), this Shift+Enter would leak past
      // the IME guard and write to the PTY mid-CJK-commit.
      mockIsComposing.mockReturnValue(true);
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Enter", false, {
        shiftKey: true,
        isComposing: false, // post-compositionend; browser flag has cleared
      });

      const result = handler(event);

      expect(result).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalled();
    });
  });

  describe("IME grace-window protection (post-compositionend)", () => {
    // Same vulnerability affected the pre-existing branches before this
    // fix — Cmd+C / Cmd+V / Cmd+K / Cmd+F could fire during a CJK commit
    // because their guard was only event.isComposing, which clears as
    // soon as compositionend fires. The handle's composing getter stays
    // true for ~80ms after compositionend so we cover that window.
    it("Cmd+V during grace window does not paste", () => {
      mockIsComposing.mockReturnValue(true);
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);

      const result = handler(makeEvent("v", true, { isComposing: false }));

      expect(result).toBe(true);
      expect(readText).not.toHaveBeenCalled();
    });

    it("Cmd+C during grace window does not copy", () => {
      mockIsComposing.mockReturnValue(true);
      const term = makeTerm({
        hasSelection: vi.fn(() => true),
        getSelection: vi.fn(() => "selected"),
      });
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);

      const result = handler(makeEvent("c", true, { isComposing: false }));

      expect(result).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
    });

    it("Cmd+K during grace window does not clear", () => {
      mockIsComposing.mockReturnValue(true);
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);

      const result = handler(makeEvent("k", true, { isComposing: false }));

      expect(result).toBe(true);
      expect(term.clear).not.toHaveBeenCalled();
    });
  });

  it("passes through IME composition events (isComposing)", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    // Cmd+V during IME composition should NOT trigger paste
    const result = handler(makeEvent("v", true, { isComposing: true }));
    expect(result).toBe(true);
    expect(readText).not.toHaveBeenCalled();
  });

  it("on macOS, Ctrl+C passes through for SIGINT even with selection", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "selected text"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c", false, { ctrlKey: true, metaKey: false }));
    expect(result).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("on Windows/Linux, Ctrl+C copies selection when selection exists", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "selected text"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c", false, { ctrlKey: true, metaKey: false }));
    expect(result).toBe(false);
    expect(writeText).toHaveBeenCalledWith("selected text");
    vi.unstubAllGlobals();
  });

  it("passes through IME keyCode 229 events", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("v", true, { keyCode: 229 }));
    expect(result).toBe(true);
    // Should not trigger paste
    expect(readText).not.toHaveBeenCalled();
  });

  it("passes through non-keydown events (keyup, keypress)", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const keyup = makeEvent("c", true, { type: "keyup" });
    expect(handler(keyup)).toBe(true);
  });

  it("passes through events without modifier keys", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const plain = makeEvent("c", false, { ctrlKey: false, metaKey: false });
    expect(handler(plain)).toBe(true);
  });

  it("Cmd+V with null ptyRef does not throw", async () => {
    vi.mocked(readText).mockResolvedValue("text");
    const term = makeTerm();
    const nullPtyRef = { current: null } as React.RefObject<IPty | null>;
    const handler = createTerminalKeyHandler(term, nullPtyRef, callbacks);
    const result = handler(makeEvent("v"));

    expect(result).toBe(false);
    // Should not throw, just resolve without writing
    await vi.waitFor(() => {
      expect(readText).toHaveBeenCalled();
    });
  });

  it("Cmd+V with empty clipboard does not write to pty", async () => {
    vi.mocked(readText).mockResolvedValue("");
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    handler(makeEvent("v"));

    await vi.waitFor(() => {
      expect(readText).toHaveBeenCalled();
    });
    expect(mockPty.write).not.toHaveBeenCalled();
  });

  it("Cmd+V prevents default to avoid double-paste", () => {
    vi.mocked(readText).mockResolvedValue("text");
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const event = makeEvent("v");
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("Cmd+C trims trailing whitespace from selection", () => {
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "hello   \n"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    handler(makeEvent("c"));
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  describe("Cmd+1-5 session switching", () => {
    it("switches to session by index when sessions exist", () => {
      mockSessions.mockReturnValue([
        { id: "s1", name: "Terminal 1", isAlive: true },
        { id: "s2", name: "Terminal 2", isAlive: true },
        { id: "s3", name: "Terminal 3", isAlive: true },
      ]);

      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);

      const event1 = makeEvent("1");
      const result = handler(event1);
      expect(result).toBe(false);
      expect(mockSetActiveSession).toHaveBeenCalledWith("s1");
      expect(event1.preventDefault).toHaveBeenCalled();

      mockSetActiveSession.mockClear();
      const event2 = makeEvent("2");
      handler(event2);
      expect(mockSetActiveSession).toHaveBeenCalledWith("s2");
    });

    it("does not switch when index exceeds session count", () => {
      mockSessions.mockReturnValue([
        { id: "s1", name: "Terminal 1", isAlive: true },
      ]);

      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      handler(makeEvent("3"));
      expect(mockSetActiveSession).not.toHaveBeenCalled();
    });

    it("handles Cmd+5 for the fifth session", () => {
      mockSessions.mockReturnValue([
        { id: "s1", name: "T1", isAlive: true },
        { id: "s2", name: "T2", isAlive: true },
        { id: "s3", name: "T3", isAlive: true },
        { id: "s4", name: "T4", isAlive: true },
        { id: "s5", name: "T5", isAlive: true },
      ]);

      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("5");
      const result = handler(event);
      expect(result).toBe(false);
      expect(mockSetActiveSession).toHaveBeenCalledWith("s5");
    });
  });

  it("on Windows/Linux, Ctrl+C passes through for SIGINT when no selection", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const term = makeTerm({ hasSelection: vi.fn(() => false) });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c", false, { ctrlKey: true, metaKey: false }));
    expect(result).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("handles clipboard read failure gracefully on Cmd+V", async () => {
    vi.mocked(readText).mockRejectedValueOnce(new Error("Clipboard denied"));
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("v"));
    expect(result).toBe(false);
    // Should not throw — error is caught internally
    await vi.waitFor(() => {
      expect(readText).toHaveBeenCalled();
    });
  });

  it("handles clipboard write failure gracefully on Cmd+C", () => {
    vi.mocked(writeText).mockRejectedValueOnce(new Error("Write denied"));
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "text"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    // Should not throw
    expect(() => handler(makeEvent("c"))).not.toThrow();
  });

  it("handles non-Error clipboard write failure on Cmd+C (String path, line 61)", async () => {
    // Exercises the `String(error)` branch (line 61) when the rejection value is not an Error
    vi.mocked(writeText).mockRejectedValueOnce("string rejection");
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "text"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    expect(() => handler(makeEvent("c"))).not.toThrow();
    // Allow the rejected promise to settle
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it("handles non-Error clipboard read failure on Cmd+V (String path, line 78)", async () => {
    // Exercises the `String(error)` branch (line 78) when the rejection value is not an Error
    vi.mocked(readText).mockRejectedValueOnce("read string rejection");
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("v"));
    expect(result).toBe(false);
    await vi.waitFor(() => {
      expect(readText).toHaveBeenCalled();
    });
  });
});
