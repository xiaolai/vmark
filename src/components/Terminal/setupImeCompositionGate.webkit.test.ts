/**
 * Gate-path verification in REAL WebKit (plan WI-2.2/2.4). Drives input via
 * userEvent (real keyboard) — the only path that reproduces the WKWebView
 * listener/microtask semantics (see browserTier.smoke). Asserts the single-writer
 * guarantee: one keystroke → exactly one byte-run reaching the PTY.
 *
 * What userEvent CAN drive: ASCII, and direct non-ASCII insertion. What it
 * CANNOT: a real OS IME composition cycle (macOS Pinyin candidate window) — those
 * need recorded human traces (plan WI-0.3). This file covers the former.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import { Terminal } from "@xterm/xterm";
import { setupImeCompositionGate } from "./setupImeCompositionGate";

interface Harness {
  term: Terminal;
  container: HTMLElement;
  ptyWrites: string[];
  cleanup: () => void;
}

function makeGateTerminal(): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const term = new Terminal({ cols: 80, rows: 24 });
  term.open(container);
  const textarea = term.textarea!;

  const ptyWrites: string[] = [];
  const gate = setupImeCompositionGate({ container, textarea });
  // Single writer: commits go straight to the "PTY".
  gate.onCompositionCommit = (t) => ptyWrites.push(t);
  // xterm's own onData (ASCII via keydown) is the other legitimate producer —
  // and, as in the real wiring, every forwarded write is reported to the gate.
  term.onData((d) => {
    ptyWrites.push(d);
    gate.noteExternalWrite(d);
  });

  return {
    term,
    container,
    ptyWrites,
    cleanup: () => {
      gate.cleanup();
      term.dispose();
      container.remove();
    },
  };
}

describe("gate path (real WebKit) — single writer", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeGateTerminal();
    h.term.focus();
    h.term.textarea!.focus();
  });
  afterEach(() => h.cleanup());

  it("types ASCII exactly once (xterm keydown owns it; gate stops the redundant input)", async () => {
    await userEvent.keyboard("a");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ptyWrites.join("")).toBe("a");
  });

  it("types a word of ASCII with no duplication", async () => {
    await userEvent.keyboard("echo");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ptyWrites.join("")).toBe("echo");
  });

  it("a direct non-ASCII insert reaches the PTY exactly once", async () => {
    // Playwright inserts the literal char (insertText, no composition). This is
    // the shape of the WeChat/no-composition punctuation path.
    await userEvent.keyboard("。");
    await new Promise((r) => setTimeout(r, 20));
    // Record what actually happened, then assert single-occurrence.
    console.log("[GATE] direct non-ASCII writes:", JSON.stringify(h.ptyWrites));
    expect(h.ptyWrites.filter((w) => w.includes("。")).join("")).toBe("。");
    expect(h.ptyWrites.join("").match(/。/g)?.length ?? 0).toBe(1);
  });
});

// Ownership rule, verified against a REAL xterm in real WebKit (#1176 follow-up).
//
// The gate forwards an `insertText` unless a real non-IME keydown preceded it.
// That rule rests on a claim about xterm that is not safe to take from reading
// minified source: with T1 stopping the event, xterm's `_inputEvent` can never
// write a keyless insert, so the gate must. These tests pin both halves by
// counting what actually reaches the PTY.
describe("gate path (real WebKit) — who writes an insertText", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeGateTerminal();
    h.term.focus();
    h.term.textarea!.focus();
  });
  afterEach(() => h.cleanup());

  function fireInsert(data: string) {
    const ta = h.term.textarea!;
    ta.value = data;
    ta.dispatchEvent(
      new InputEvent("input", { data, inputType: "insertText", isComposing: false, bubbles: true }),
    );
  }

  it("a keyless insertText is carried by the gate, exactly once", async () => {
    // Nothing else can: xterm's keydown path never ran, and T1 already stopped
    // the event so `_inputEvent` cannot fire either.
    fireInsert("/");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ptyWrites.join("")).toBe("/");
  });

  it("carries it once in IME mode too", async () => {
    const ta = h.term.textarea!;
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "a", keyCode: 229, bubbles: true }));
    fireInsert("/");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ptyWrites.join("")).toBe("/");
  });

  it("an insertText after a real keydown is not written twice", async () => {
    // userEvent drives a genuine keydown, so xterm's keydown path owns it; the
    // redundant input event that follows must not add a second write.
    await userEvent.keyboard("x");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ptyWrites.join("")).toBe("x");
  });
});

// Does xterm write a keyCode-229 keydown at all? The #1176 fix hinged on this,
// and it cannot be answered from minified source. NO custom key handler is
// attached here — this is xterm's unaided behaviour.
describe("gate path (real WebKit) — xterm and keyCode 229", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeGateTerminal();
    h.term.focus();
    h.term.textarea!.focus();
  });
  afterEach(() => h.cleanup());

  it("writes a plain keydown for `/` (control)", async () => {
    const ta = h.term.textarea!;
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "/", keyCode: 191, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ptyWrites.join("")).toBe("/");
  });

  it("REFUSES a keyCode-229 keydown, even for a printable key", async () => {
    const ta = h.term.textarea!;
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "/", keyCode: 229, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    console.log("[229] writes:", JSON.stringify(h.ptyWrites));
    // If this is empty, xterm can never deliver these keystrokes and the gate
    // must write them itself — letting T2 "pass them through" achieves nothing.
    expect(h.ptyWrites.join("")).toBe("");
  });
});
