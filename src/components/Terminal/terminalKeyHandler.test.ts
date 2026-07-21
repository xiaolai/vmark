import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSessions, mockSetActiveSession } = vi.hoisted(() => ({
  mockSessions: vi.fn(() => [] as Array<{ id: string; name: string; isAlive: boolean }>),
  mockSetActiveSession: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      terminal: { sessions: mockSessions(), activeSessionId: null },
      terminalSetActiveSession: mockSetActiveSession,
    }),
  },
}));

const { mockTerminalFontSize, mockUpdateTerminalSetting, mockToggleBinding } = vi.hoisted(() => ({
  mockTerminalFontSize: { value: 13 },
  mockUpdateTerminalSetting: vi.fn(),
  mockToggleBinding: { value: "Ctrl-`" },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      terminal: { fontSize: mockTerminalFontSize.value },
      updateTerminalSetting: mockUpdateTerminalSetting,
    }),
  },
  useShortcutsStore: {
    getState: () => ({
      getShortcut: (id: string) => (id === "toggleTerminal" ? mockToggleBinding.value : ""),
    }),
  },
}));

import { createTerminalKeyHandler, type KeyHandlerCallbacks } from "./terminalKeyHandler";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";

vi.mock("@/lib/pty", () => ({ spawn: vi.fn() }));

const mockRequestToggleTerminal = vi.fn();
vi.mock("./terminalGate", () => ({
  requestToggleTerminal: () => mockRequestToggleTerminal(),
}));

function makeTerm(overrides: Partial<Terminal> = {}): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
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
    code: "",
    metaKey: meta,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
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
    mockTerminalFontSize.value = 13;
    mockToggleBinding.value = "Ctrl-`";
  });

  it("passes Ctrl-only keys through to the shell on macOS (readline) (audit-fix)", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const clear = vi.fn();
    const selectAll = vi.fn();
    const term = makeTerm({ hasSelection: vi.fn(() => false), clear, selectAll });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    // Ctrl+A (beginning-of-line), Ctrl+K (kill-line), Ctrl+W (kill-word), etc.
    // must reach the shell (return true), not be intercepted as host shortcuts.
    for (const key of ["a", "k", "w", "u", "e"]) {
      expect(handler(makeEvent(key, false, { ctrlKey: true }))).toBe(true);
    }
    expect(selectAll).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("still handles Cmd shortcuts on macOS (Cmd+K clears)", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const term = makeTerm({});
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    expect(handler(makeEvent("k", true))).toBe(false); // Cmd+K
    expect(term.clear).toHaveBeenCalled();
  });

  it("invokes onPromptNav('prev') on Cmd+ArrowUp (WI-3.3)", () => {
    const onPromptNav = vi.fn();
    const term = makeTerm({});
    const handler = createTerminalKeyHandler(term, ptyRef, { ...callbacks, onPromptNav });
    const result = handler(makeEvent("ArrowUp"));
    expect(result).toBe(false);
    expect(onPromptNav).toHaveBeenCalledWith("prev");
  });

  it("invokes onPromptNav('next') on Cmd+ArrowDown (WI-3.3)", () => {
    const onPromptNav = vi.fn();
    const term = makeTerm({});
    const handler = createTerminalKeyHandler(term, ptyRef, { ...callbacks, onPromptNav });
    expect(handler(makeEvent("ArrowDown"))).toBe(false);
    expect(onPromptNav).toHaveBeenCalledWith("next");
  });

  it("passes Cmd+Shift+ArrowUp through (not prompt nav)", () => {
    const onPromptNav = vi.fn();
    const term = makeTerm({});
    const handler = createTerminalKeyHandler(term, ptyRef, { ...callbacks, onPromptNav });
    handler(makeEvent("ArrowUp", true, { shiftKey: true }));
    expect(onPromptNav).not.toHaveBeenCalled();
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
    // Wait for async paste — routed through term.paste (bracketed-paste aware),
    // not a raw PTY write (G2).
    await vi.waitFor(() => {
      expect(term.paste).toHaveBeenCalledWith("pasted");
    });
    expect(mockPty.write).not.toHaveBeenCalledWith("pasted");
  });

  it("clears terminal on Cmd+K", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("k"));

    expect(result).toBe(false);
    expect(term.clear).toHaveBeenCalled();
  });

  it("triggers search callback on Cmd+F and consumes the event", () => {
    // preventDefault is load-bearing: Cmd+F is also the native Edit-menu
    // "Find" accelerator, which otherwise ALSO fires and opens the editor
    // FindBar — making the terminal search look "not wired". Suppressing the
    // native accelerator here is what makes terminal search the sole result.
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const event = makeEvent("f");
    const result = handler(event);

    expect(result).toBe(false);
    expect(callbacks.onSearch).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("Cmd+Shift+F falls through (Format CJK accelerator, not terminal search)", () => {
    // Terminal search is plain Cmd+F. Cmd+Shift+F is the "Format CJK Selection"
    // menu accelerator — the "f" case must NOT claim it, and must NOT
    // preventDefault, so the native accelerator can fire.
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const event = makeEvent("f", true, { shiftKey: true });

    expect(handler(event)).toBe(true);
    expect(callbacks.onSearch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("Alt+Cmd+F falls through (not terminal search)", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const event = makeEvent("f", true, { altKey: true });

    expect(handler(event)).toBe(true);
    expect(callbacks.onSearch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  describe("Ctrl+` — Toggle-Terminal from within the terminal", () => {
    it("toggles the terminal and fully consumes the event (no '·' to the shell)", () => {
      // A CJK IME reports Ctrl+` as keyCode 229 / key "·"; without owning it
      // here, xterm writes "·" to the PTY. Consume it: toggle, preventDefault,
      // stopPropagation (so the window handler doesn't double-toggle), return false.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("·", false, { ctrlKey: true, code: "Backquote", keyCode: 229 });

      expect(handler(event)).toBe(false);
      expect(mockRequestToggleTerminal).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(mockPty.write).not.toHaveBeenCalled();
    });

    it("does not treat Cmd+` or Ctrl+Shift+` as the terminal toggle", () => {
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      handler(makeEvent("`", true, { code: "Backquote" })); // Cmd+`
      handler(makeEvent("`", false, { ctrlKey: true, shiftKey: true, code: "Backquote" }));
      expect(mockRequestToggleTerminal).not.toHaveBeenCalled();
    });

    it("does NOT toggle during a real composition — pending IME text isn't stranded", () => {
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      // event.isComposing true → skip
      handler(makeEvent("·", false, { ctrlKey: true, code: "Backquote", isComposing: true }));
      // callbacks.isComposing() true (post-commit grace) → skip
      mockIsComposing.mockReturnValue(true);
      handler(makeEvent("·", false, { ctrlKey: true, code: "Backquote", keyCode: 229 }));
      expect(mockRequestToggleTerminal).not.toHaveBeenCalled();
    });

    it("honours a custom Toggle-Terminal binding (Ctrl+` no longer claims it)", () => {
      mockToggleBinding.value = "Ctrl-Shift-t"; // user remapped the toggle
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("·", false, { ctrlKey: true, code: "Backquote", keyCode: 229 });
      // Ctrl+` no longer matches the (remapped) toggle, so it isn't consumed here
      // and IME/other handling proceeds — it does not toggle.
      handler(event);
      expect(mockRequestToggleTerminal).not.toHaveBeenCalled();
    });
  });

  describe("Cmd+Left/Right — line start/end (3a)", () => {
    it("writes readline ^A on Cmd+Left and consumes the event", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("ArrowLeft");
      const result = handler(event);

      expect(result).toBe(false);
      expect(mockPty.write).toHaveBeenCalledWith("\x01");
      expect(event.preventDefault).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("writes readline ^E on Cmd+Right and consumes the event", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("ArrowRight");

      expect(handler(event)).toBe(false);
      expect(mockPty.write).toHaveBeenCalledWith("\x05");
      expect(event.preventDefault).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("writes readline ^U on Cmd+Backspace and consumes the event", () => {
      // macOS convention: Cmd+Backspace deletes the line. Without this the
      // event falls through to xterm, which ignores the Cmd modifier and sends
      // a bare DEL — deleting a single character instead.
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("Backspace");

      expect(handler(event)).toBe(false);
      expect(mockPty.write).toHaveBeenCalledWith("\x15");
      expect(event.preventDefault).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("passes Option+Backspace through (shell's own backward-kill-word)", () => {
      // zsh binds \e^? to backward-kill-word already — don't intercept it.
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);

      expect(handler(makeEvent("Backspace", false, { altKey: true }))).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("passes plain Backspace through (deletes one character)", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);

      expect(handler(makeEvent("Backspace", false))).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("passes Cmd+Shift+Left through (selection, not cursor move)", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      expect(handler(makeEvent("ArrowLeft", true, { shiftKey: true }))).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("writes readline Alt-b on Option+Left (word nav) and consumes the event", () => {
      // With macOptionIsMeta, xterm would emit "\x1b[1;3D" which zsh doesn't
      // bind (prints ";3D"); we emit Alt-b, bound by the default emacs keymap.
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("ArrowLeft", false, { altKey: true });

      expect(handler(event)).toBe(false);
      expect(mockPty.write).toHaveBeenCalledWith("\x1bb");
      expect(event.preventDefault).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("writes readline Alt-f on Option+Right (word nav)", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("ArrowRight", false, { altKey: true });

      expect(handler(event)).toBe(false);
      expect(mockPty.write).toHaveBeenCalledWith("\x1bf");
      vi.unstubAllGlobals();
    });

    it("passes Option+Shift+Left through (selection, not word nav)", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      // Shift held → not our word-nav path; let the shell/xterm decide.
      expect(handler(makeEvent("ArrowLeft", false, { altKey: true, shiftKey: true }))).toBe(true);
      expect(mockPty.write).not.toHaveBeenCalledWith("\x1bb");
      vi.unstubAllGlobals();
    });
  });

  describe("Cmd+=/-/0 — terminal font zoom (3b)", () => {
    it("zooms the terminal font in on Cmd+= without touching the editor", () => {
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("=");
      const result = handler(event);

      expect(result).toBe(false);
      expect(mockUpdateTerminalSetting).toHaveBeenCalledWith("fontSize", 15); // 13 + 2
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("zooms the terminal font out on Cmd+-", () => {
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("-");

      expect(handler(event)).toBe(false);
      expect(mockUpdateTerminalSetting).toHaveBeenCalledWith("fontSize", 11); // 13 - 2
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("resets the terminal font to the default on Cmd+0", () => {
      mockTerminalFontSize.value = 20;
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("0");

      expect(handler(event)).toBe(false);
      expect(mockUpdateTerminalSetting).toHaveBeenCalledWith("fontSize", 13); // default
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("does not zoom during the IME grace window", () => {
      mockIsComposing.mockReturnValue(true);
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      expect(handler(makeEvent("=", true, { isComposing: false }))).toBe(true);
      expect(mockUpdateTerminalSetting).not.toHaveBeenCalled();
    });

    it("Alt+Cmd+= falls through (subscript accelerator, not terminal zoom)", () => {
      // Alt+CmdOrCtrl+= is the "subscript" menu accelerator. The zoom branch
      // must reject Alt so the accelerator fires instead of zooming the font.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("=", true, { altKey: true });

      expect(handler(event)).toBe(true);
      expect(mockUpdateTerminalSetting).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("Alt+Cmd+- falls through (horizontal-line accelerator, not terminal zoom)", () => {
      // Alt+CmdOrCtrl+- is the "horizontal-line" accelerator — must not be
      // eaten as terminal zoom-out.
      const term = makeTerm();
      const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
      const event = makeEvent("-", true, { altKey: true });

      expect(handler(event)).toBe(true);
      expect(mockUpdateTerminalSetting).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  it("selects the terminal buffer on Cmd+A and consumes the event", () => {
    // Without this branch, Cmd+A inside the terminal falls through to the
    // browser's `document.execCommand("selectAll")` and the selection
    // highlight spills into the editor and sidebar.
    const selectAll = vi.fn();
    const term = makeTerm({ selectAll });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const event = makeEvent("a");
    const result = handler(event);

    expect(result).toBe(false);
    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("passes through unhandled keys", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    expect(handler(makeEvent("z"))).toBe(true);
    expect(handler(makeEvent("q"))).toBe(true);
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

  it("Cmd+V with null ptyRef still pastes via term (does not throw)", async () => {
    // Paste routes through term.paste now, so it works regardless of ptyRef.
    vi.mocked(readText).mockResolvedValue("text");
    const term = makeTerm();
    const nullPtyRef = { current: null } as React.RefObject<IPty | null>;
    const handler = createTerminalKeyHandler(term, nullPtyRef, callbacks);
    const result = handler(makeEvent("v"));

    expect(result).toBe(false);
    await vi.waitFor(() => {
      expect(term.paste).toHaveBeenCalledWith("text");
    });
  });

  it("Cmd+V with empty clipboard does not paste", async () => {
    vi.mocked(readText).mockResolvedValue("");
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    handler(makeEvent("v"));

    await vi.waitFor(() => {
      expect(readText).toHaveBeenCalled();
    });
    expect(term.paste).not.toHaveBeenCalled();
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
