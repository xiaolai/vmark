/**
 * macOS press-and-hold accents in the terminal (#1608).
 *
 * Holding `u` writes `u` to the PTY through xterm's keydown path, and the gate
 * clears the helper textarea. When the user then picks `ü`, AppKit asks WebKit
 * to REPLACE the character before the caret — but the textarea is empty, so
 * WebKit has nothing to select and delivers `ü` as a fresh insert (or as the
 * end of a composition over the empty textarea). The shell already holds `u`,
 * so the gate must erase it: it commits DEL + `ü`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupImeCompositionGate } from "./setupImeCompositionGate";

const DEL = "\x7f";

function makeHarness() {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  container.appendChild(textarea);
  document.body.appendChild(container);
  const handle = setupImeCompositionGate({ container, textarea });
  const commits: string[] = [];
  handle.onCompositionCommit = (t) => commits.push(t);
  return { textarea, handle, commits };
}

function keydown(ta: HTMLTextAreaElement, key: string, keyCode = 0) {
  ta.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, bubbles: true }));
}
function input(ta: HTMLTextAreaElement, data: string) {
  ta.value = data;
  ta.dispatchEvent(new InputEvent("input", { data, inputType: "insertText", isComposing: false, bubbles: true }));
}
function composition(ta: HTMLTextAreaElement, type: "compositionstart" | "compositionend", data = "") {
  ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
}

/** The keystroke xterm owns: keydown, xterm's write to the PTY, and the
 *  textarea insert the gate drops as xterm's echo. */
function typeViaXterm(h: ReturnType<typeof makeHarness>, ch: string) {
  keydown(h.textarea, ch);
  h.handle.noteExternalWrite(ch);
  input(h.textarea, ch);
  vi.runAllTimers();
}

describe("setupImeCompositionGate — press-and-hold accents (#1608)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("replaces the held letter when the accent arrives as a plain insert", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    input(h.textarea, "ü"); // picked with the mouse: no keydown at all
    expect(h.commits).toEqual([`${DEL}ü`]);
  });

  it("replaces the held letter when the accent arrives as a composition", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    composition(h.textarea, "compositionstart");
    h.textarea.value = "u";
    composition(h.textarea, "compositionend", "ü");
    expect(h.commits).toEqual([`${DEL}ü`]);
  });

  it("still replaces when the accent is picked with its number key", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    keydown(h.textarea, "2", 229);
    input(h.textarea, "ü");
    expect(h.commits).toEqual([`${DEL}ü`]);
  });

  it("still replaces after the picker is navigated with arrows and confirmed with Enter", () => {
    const h = makeHarness();
    typeViaXterm(h, "e");
    keydown(h.textarea, "ArrowRight", 229);
    keydown(h.textarea, "Enter", 229);
    input(h.textarea, "é");
    expect(h.commits).toEqual([`${DEL}é`]);
  });

  it("replaces a letter with a variant that has no decomposition (a → æ)", () => {
    const h = makeHarness();
    typeViaXterm(h, "a");
    input(h.textarea, "æ");
    expect(h.commits).toEqual([`${DEL}æ`]);
  });

  it("sends nothing when a press-and-hold composition is cancelled back to the letter", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    composition(h.textarea, "compositionstart");
    h.textarea.value = "u";
    keydown(h.textarea, "Escape", 229);
    composition(h.textarea, "compositionend", "u");
    expect(h.commits).toEqual([]); // the shell already has the one `u`
  });

  it("replaces only once — a second accent is an ordinary insert", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    input(h.textarea, "ü");
    vi.runAllTimers();
    input(h.textarea, "ú");
    expect(h.commits).toEqual([`${DEL}ü`, "ú"]);
  });

  it("does not erase anything for a dead-key accent (Option+U, then u)", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    keydown(h.textarea, "Dead", 229);
    composition(h.textarea, "compositionstart");
    h.textarea.value = "¨";
    keydown(h.textarea, "u", 229);
    composition(h.textarea, "compositionend", "ü");
    expect(h.commits).toEqual(["ü"]);
  });

  it("does not erase anything when the accent is not a variant of the last letter", () => {
    const h = makeHarness();
    typeViaXterm(h, "a");
    input(h.textarea, "ü");
    expect(h.commits).toEqual(["ü"]);
  });

  it("does not erase anything when another write happened in between", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    typeViaXterm(h, "x");
    input(h.textarea, "ü");
    expect(h.commits).toEqual(["ü"]);
  });

  it("does not erase anything after a Latin letter followed by a CJK composition", () => {
    const h = makeHarness();
    typeViaXterm(h, "a");
    keydown(h.textarea, "a", 229); // Pinyin owns the key
    composition(h.textarea, "compositionstart");
    h.textarea.value = "a";
    composition(h.textarea, "compositionend", "啊");
    expect(h.commits).toEqual(["啊"]);
  });

  it("does not erase anything when a non-picker key intervenes before the accent", () => {
    const h = makeHarness();
    typeViaXterm(h, "u");
    keydown(h.textarea, "Backspace", 8); // xterm sends DEL itself; nothing to write here
    input(h.textarea, "ü");
    expect(h.commits).toEqual(["ü"]);
  });

  it("does not erase anything when no letter was written first", () => {
    const h = makeHarness();
    input(h.textarea, "ü");
    expect(h.commits).toEqual(["ü"]);
  });
});
