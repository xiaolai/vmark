/**
 * The #1176 contract, tested across BOTH halves that own it.
 *
 * The bug was not inside either module — it was in the seam. terminalKeyHandler
 * (T2) consumes every keyCode-229 keydown so xterm writes nothing, and the gate
 * (T4) decides whether the follow-up `input` still needs forwarding. Each half
 * is individually defensible and the combination silently dropped the keystroke.
 *
 * These tests wire the REAL key handler to the REAL gate and assert the property
 * that actually matters: one keystroke reaches the PTY exactly once, whichever
 * half claims it. A change to T2's consume rule breaks this file, not production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    // documentStore/lint.ts subscribes at import time (reached via terminalGate).
    subscribe: vi.fn(() => () => {}),
  },
  useShortcutsStore: {
    getState: () => ({ getShortcut: (id: string) => (id === "toggleTerminal" ? "Ctrl-`" : "") }),
  },
}));

import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";
import { createTerminalKeyHandler } from "./terminalKeyHandler";
import { setupImeCompositionGate } from "./setupImeCompositionGate";

/**
 * Stand-in for xterm's keydown path. xterm consults the custom handler first
 * and returns immediately when it answers false; only otherwise does it write
 * the character. That branch IS the seam under test.
 */
function makeWiring() {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  container.appendChild(textarea);
  document.body.appendChild(container);

  const ptyWrites: string[] = [];
  const term = {
    hasSelection: () => false,
    getSelection: () => "",
    clearSelection: vi.fn(),
    clear: vi.fn(),
    selectAll: vi.fn(),
  } as unknown as Terminal;
  const ptyRef = { current: { write: (d: string) => ptyWrites.push(d) } as unknown as IPty };

  const gate = setupImeCompositionGate({ container, textarea });
  gate.onCompositionCommit = (text) => ptyWrites.push(text);

  const keyHandler = createTerminalKeyHandler(term, ptyRef, {
    onSearch: vi.fn(),
    isComposing: () => gate.composing,
  });

  // xterm's own keydown listener, in the position xterm installs it.
  textarea.addEventListener("keydown", (e) => {
    if (!keyHandler(e)) return; // handler consumed it — xterm writes nothing
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      ptyWrites.push(e.key);
    }
  });

  return { container, textarea, ptyWrites, cleanup: () => { gate.cleanup(); container.remove(); } };
}

/**
 * One keystroke under a Chinese IME, in the order a live macOS Shuangpin trace
 * recorded: the `input` event arrives BEFORE its own keydown. Any scheme that
 * pairs an insert with "the last keydown" therefore reads the PREVIOUS
 * keystroke's answer — which is what doubled `@ % & +` (#1176).
 */
function typeWithIme(textarea: HTMLTextAreaElement, char: string) {
  textarea.value = char;
  textarea.dispatchEvent(
    new InputEvent("input", { data: char, inputType: "insertText", isComposing: false, bubbles: true }),
  );
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: char, keyCode: 229, bubbles: true }));
  textarea.dispatchEvent(new KeyboardEvent("keyup", { key: char, keyCode: 229, bubbles: true }));
}

/** Enter IME mode: the gate learns it from any keyCode-229 keydown. */
function enterImeMode(textarea: HTMLTextAreaElement) {
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", keyCode: 229, bubbles: true }));
}

function typeWithoutIme(textarea: HTMLTextAreaElement, char: string, keyCode: number) {
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: char, keyCode, bubbles: true }));
  textarea.value = char;
  textarea.dispatchEvent(
    new InputEvent("input", { data: char, inputType: "insertText", isComposing: false, bubbles: true }),
  );
  textarea.dispatchEvent(new KeyboardEvent("keyup", { key: char, keyCode, bubbles: true }));
}

describe("terminal ASCII reaches the PTY exactly once (#1176)", () => {
  let w: ReturnType<typeof makeWiring>;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    w = makeWiring();
  });
  afterEach(() => {
    w.cleanup();
    vi.useRealTimers();
  });

  it.each([
    ["/", 191],
    ["1", 49],
    ["2", 50],
    ["3", 51],
    ["4", 52],
    ["-", 189],
    [".", 190],
  ])("delivers %s once with an English keyboard", (char, keyCode) => {
    typeWithoutIme(w.textarea, char, keyCode);
    expect(w.ptyWrites.join("")).toBe(char);
  });

  it.each(["/", "1", "2", "3", "4", "-", "."])(
    "delivers %s once when a Chinese IME claims the keydown",
    (char) => {
      enterImeMode(w.textarea);
      typeWithIme(w.textarea, char);
      // Before the fix this was "" — T2 ate the keydown and, for these keys, a
      // live Shuangpin trace shows no input event follows at all. Now xterm's
      // keydown path writes it. The trailing input event in this harness is the
      // belt-and-braces case: some IME might emit one, and it must not double.
      expect(w.ptyWrites.join("")).toBe(char);
    },
  );

  // The exact sequence that doubled: a key the IME REWROTE (（, non-ASCII)
  // followed by one it left alone (+). Pairing by "last keydown" made the gate
  // commit `+` while the key handler wrote it too.
  it("does not double an ASCII key that follows an IME-rewritten one", () => {
    enterImeMode(w.textarea);
    typeWithIme(w.textarea, "（");
    vi.advanceTimersByTime(1);
    typeWithIme(w.textarea, "+");
    expect(w.ptyWrites.join("")).toBe("（+");
  });

  // The FIRST keystroke of an IME run has no keydown behind it yet — imeMode is
  // still false when its insert arrives. Ordering alone identifies it.
  it.each(["1", "/", "@"])("delivers the very first %s of an IME run", (char) => {
    typeWithIme(w.textarea, char); // no prior IME keydown at all
    expect(w.ptyWrites.join("")).toBe(char);
  });

  it("delivers a whole first-run string with nothing lost or doubled", () => {
    for (const c of "1234567890") {
      typeWithIme(w.textarea, c);
      vi.advanceTimersByTime(1);
    }
    expect(w.ptyWrites.join("")).toBe("1234567890");
  });

  it("delivers a run of shifted punctuation exactly once each", () => {
    for (const c of "@%&+") {
      typeWithIme(w.textarea, c);
      vi.advanceTimersByTime(1);
    }
    expect(w.ptyWrites.join("")).toBe("@%&+");
  });

  it("drops the insert again once the IME is out of the way", () => {
    // A real keyCode means xterm's keydown path owns it; forwarding would double.
    typeWithoutIme(w.textarea, "x", 88);
    expect(w.ptyWrites.join("")).toBe("x");
  });

  it("delivers a whole path typed under the IME", () => {
    enterImeMode(w.textarea);
    for (const c of "cd /tmp/1234") {
      typeWithIme(w.textarea, c);
      vi.advanceTimersByTime(1); // each keystroke is its own task
    }
    expect(w.ptyWrites.join("")).toBe("cd /tmp/1234");
  });

  it("delivers a real CJK composition once, and nothing extra", () => {
    const ta = w.textarea;
    ta.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 229, bubbles: true }));
    ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    ta.value = "你好";
    ta.dispatchEvent(new CompositionEvent("compositionend", { data: "你好", bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 229, bubbles: true }));
    expect(w.ptyWrites.join("")).toBe("你好");
  });
});

// A non-inserting keydown (Enter, Backspace, an arrow, a Cmd chord) writes
// nothing, so the insert that follows it is still the gate's to deliver.
// Treating "any keydown" as proof that xterm wrote lost exactly one character
// after every Enter — i.e. the first character of every command.
describe("a keydown that writes nothing does not steal the next insert", () => {
  let w: ReturnType<typeof makeWiring>;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    w = makeWiring();
  });
  afterEach(() => {
    w.cleanup();
    vi.useRealTimers();
  });

  const press = (key: string, keyCode: number, mods: Partial<KeyboardEventInit> = {}) =>
    w.textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key, keyCode, bubbles: true, ...mods }),
    );

  it.each([
    ["Enter", "Enter", 13, {}],
    ["Backspace", "Backspace", 8, {}],
    ["ArrowUp", "ArrowUp", 38, {}],
    ["ArrowLeft", "ArrowLeft", 37, {}],
    ["Escape", "Escape", 27, {}],
    ["Tab", "Tab", 9, {}],
    ["bare Shift", "Shift", 16, {}],
    ["Cmd+K", "k", 75, { metaKey: true }],
    ["Ctrl+A", "a", 65, { ctrlKey: true }],
  ])("delivers the IME character typed right after %s", (_label, key, keyCode, mods) => {
    press(key, keyCode, mods);
    w.ptyWrites.length = 0; // ignore whatever that key itself sent
    typeWithIme(w.textarea, "1");
    expect(w.ptyWrites.join("")).toBe("1");
  });

  it("delivers the first character of every command in a session", () => {
    // The shape of real use: type, Enter, type again.
    for (const c of "ls") { typeWithIme(w.textarea, c); vi.advanceTimersByTime(1); }
    press("Enter", 13);
    vi.advanceTimersByTime(1);
    for (const c of "1a") { typeWithIme(w.textarea, c); vi.advanceTimersByTime(1); }
    expect(w.ptyWrites.join("")).toContain("1a");
  });

  it("still drops the insert that a printable keydown DID write", () => {
    typeWithoutIme(w.textarea, "z", 90);
    expect(w.ptyWrites.join("")).toBe("z"); // once, not twice
  });

  // The reset is what makes one keydown answer for one insert. Without it a
  // single plain keydown would suppress every later keyless insert.
  it("spends the keydown on one insert only", () => {
    typeWithoutIme(w.textarea, "z", 90); // keydown + input, xterm wrote it
    w.ptyWrites.length = 0;
    typeWithIme(w.textarea, "1"); // a later insert must not inherit that keydown
    expect(w.ptyWrites.join("")).toBe("1");
  });
});
