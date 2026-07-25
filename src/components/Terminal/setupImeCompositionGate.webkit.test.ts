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
  // xterm's own onData (ASCII via keydown) is the other legitimate producer.
  term.onData((d) => ptyWrites.push(d));

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
