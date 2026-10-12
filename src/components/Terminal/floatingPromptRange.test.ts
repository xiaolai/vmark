// @vitest-environment node
/**
 * Tests for resolveFloatingPromptRange — which buffer rows the floating
 * prompt mirrors while the viewport is scrolled back. Driven by a REAL
 * (unopened) xterm so wrapping, scrollback and the alternate screen behave
 * exactly as they do in the panel.
 */
import { describe, it, expect } from "vitest";
import { createRealTerminal, writeParsed } from "./realXterm.testUtils";
import { resolveFloatingPromptRange } from "./floatingPromptRange";

/** `count` numbered output lines, then a prompt with no trailing newline. */
function outputThenPrompt(count: number, prompt = "$ ls -la"): string {
  const lines = Array.from({ length: count }, (_, i) => `line ${i}`);
  return `${lines.join("\r\n")}\r\n${prompt}`;
}

describe("resolveFloatingPromptRange", () => {
  it("returns null while the viewport is at the bottom", async () => {
    const term = createRealTerminal({ rows: 10 });
    await writeParsed(term, outputThenPrompt(40));
    expect(resolveFloatingPromptRange(term)).toBeNull();
  });

  it("returns null when nothing has scrolled into scrollback", async () => {
    const term = createRealTerminal({ rows: 10 });
    await writeParsed(term, outputThenPrompt(3));
    term.scrollLines(-5);
    expect(resolveFloatingPromptRange(term)).toBeNull();
  });

  it("mirrors the prompt row plus one row of context once scrolled back", async () => {
    const term = createRealTerminal({ rows: 10 });
    await writeParsed(term, outputThenPrompt(40));
    term.scrollLines(-20);
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    expect(resolveFloatingPromptRange(term)).toEqual({
      start: cursorRow - 1,
      end: cursorRow,
      cursorRow,
    });
  });

  it("returns null when the cursor row is still inside the scrolled viewport", async () => {
    const term = createRealTerminal({ rows: 10 });
    // `clear`: scrollback stays, the cursor homes to the screen's top row.
    await writeParsed(term, `${outputThenPrompt(40)}\x1b[H\x1b[2J$ `);
    term.scrollLines(-3);
    expect(term.buffer.active.viewportY).toBeLessThan(term.buffer.active.baseY);
    expect(resolveFloatingPromptRange(term)).toBeNull();
    // One row past the cursor and it is off-screen again.
    term.scrollLines(-8);
    expect(resolveFloatingPromptRange(term)).not.toBeNull();
  });

  it("includes every wrapped row of a long input line", async () => {
    const term = createRealTerminal({ cols: 20, rows: 10 });
    await writeParsed(term, outputThenPrompt(40, `$ ${"x".repeat(45)}`));
    term.scrollLines(-20);
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    // 47 cells over 20 columns → three rows; the first is not wrapped.
    expect(resolveFloatingPromptRange(term)).toEqual({
      start: cursorRow - 3,
      end: cursorRow,
      cursorRow,
    });
  });

  it("extends below the cursor to the last non-blank row (TUI input boxes)", async () => {
    const term = createRealTerminal({ rows: 10 });
    // A Claude-Code-like box: border, input row, border, footer — then the
    // cursor is moved back up into the input row.
    await writeParsed(
      term,
      `${outputThenPrompt(40, "╭────╮")}\r\n│ > hi │\r\n╰────╯\r\n  ? for shortcuts\x1b[2A\x1b[6G`,
    );
    term.scrollLines(-20);
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    expect(resolveFloatingPromptRange(term)).toEqual({
      start: cursorRow - 1,
      end: cursorRow + 2,
      cursorRow,
    });
  });

  it("caps the range at maxRows, keeping the cursor row", async () => {
    const term = createRealTerminal({ cols: 10, rows: 12 });
    await writeParsed(term, outputThenPrompt(40, `$ ${"y".repeat(78)}`));
    term.scrollLines(-20);
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    const range = resolveFloatingPromptRange(term, { maxRows: 3 });
    expect(range).toEqual({ start: cursorRow - 2, end: cursorRow, cursorRow });
  });

  it("trims rows below the cursor when the cap leaves no room above", async () => {
    const term = createRealTerminal({ rows: 10 });
    await writeParsed(term, `${outputThenPrompt(40, "> a")}\r\nb\r\nc\r\nd\x1b[3A`);
    term.scrollLines(-20);
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    expect(resolveFloatingPromptRange(term, { maxRows: 1 })).toEqual({
      start: cursorRow,
      end: cursorRow,
      cursorRow,
    });
  });

  it("returns null on the alternate screen (no scrollback to read)", async () => {
    const term = createRealTerminal({ rows: 10 });
    await writeParsed(term, outputThenPrompt(40));
    term.scrollLines(-20);
    await writeParsed(term, "\x1b[?1049h");
    expect(resolveFloatingPromptRange(term)).toBeNull();
  });
});
