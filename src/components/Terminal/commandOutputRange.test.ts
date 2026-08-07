// @vitest-environment node
// WI-4.4 — "Copy Command Output" range arithmetic (F4 / D8).
//
// The OSC 133 `A` marks sit on PROMPT lines, so "the output of the command I
// right-clicked" is everything strictly between one mark and the next. Getting
// the boundaries wrong copies the prompt line into the paste (off-by-one at
// the start) or swallows the next command (off-by-one at the end).
import { describe, it, expect, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { commandOutputRange, readBufferRange, type CommandMark } from "./setupOsc";

/** CommandMarks at the given prompt lines. A negative line = disposed marker. */
function marksAt(...lines: number[]): CommandMark[] {
  return lines.map((line) => ({ marker: { line } }) as unknown as CommandMark);
}

describe("commandOutputRange (WI-4.4)", () => {
  it("returns null without shell integration (no marks at all)", () => {
    expect(commandOutputRange([], 5, 100)).toBeNull();
  });

  it("excludes the prompt line from the copied range", () => {
    // Prompt at 10, next prompt at 20 → output is 11..19.
    expect(commandOutputRange(marksAt(10, 20), 12, 100)).toEqual({
      startLine: 11,
      endLine: 19,
    });
  });

  it("stops at the next mark, not at the buffer end", () => {
    const range = commandOutputRange(marksAt(0, 5, 12), 2, 100)!;
    expect(range.endLine).toBe(4);
  });

  it("runs to the buffer end for the last (still open) command", () => {
    expect(commandOutputRange(marksAt(0, 5, 12), 30, 42)).toEqual({
      startLine: 13,
      endLine: 42,
    });
  });

  it("attributes a click ON a prompt line to that prompt's command", () => {
    expect(commandOutputRange(marksAt(10, 20), 10, 100)).toEqual({
      startLine: 11,
      endLine: 19,
    });
  });

  it("attributes a click on the LAST line of a command to that command", () => {
    expect(commandOutputRange(marksAt(10, 20), 19, 100)).toEqual({
      startLine: 11,
      endLine: 19,
    });
  });

  it("returns null for a click above the first prompt", () => {
    // Scrollback that predates shell integration being turned on.
    expect(commandOutputRange(marksAt(10, 20), 3, 100)).toBeNull();
  });

  it("returns null for a command that produced no output", () => {
    // Two prompts back to back: nothing between them.
    expect(commandOutputRange(marksAt(10, 11), 10, 100)).toBeNull();
  });

  it("returns null when the open command has produced no output yet", () => {
    expect(commandOutputRange(marksAt(0, 42), 42, 42)).toBeNull();
  });

  it("handles a single command with output", () => {
    expect(commandOutputRange(marksAt(0), 3, 9)).toEqual({ startLine: 1, endLine: 9 });
  });

  it("ignores disposed markers (negative line)", () => {
    // A marker whose line scrolled out of scrollback reports -1; including it
    // would make every click resolve to a command that no longer exists.
    expect(commandOutputRange(marksAt(-1, 10, 20), 12, 100)).toEqual({
      startLine: 11,
      endLine: 19,
    });
    expect(commandOutputRange(marksAt(-1), 5, 100)).toBeNull();
  });

  it("tolerates marks arriving out of order", () => {
    expect(commandOutputRange(marksAt(20, 10), 12, 100)).toEqual({
      startLine: 11,
      endLine: 19,
    });
  });
});

describe("readBufferRange (WI-4.4)", () => {
  /** A terminal whose buffer returns the given lines starting at index 0. */
  function makeTerm(lines: Array<string | null>): Terminal {
    return {
      buffer: {
        active: {
          getLine: vi.fn((y: number) =>
            lines[y] === null || lines[y] === undefined
              ? null
              : { translateToString: () => lines[y] as string },
          ),
        },
      },
    } as unknown as Terminal;
  }

  it("joins the inclusive span with newlines", () => {
    const term = makeTerm(["prompt$ ls", "a.txt", "b.txt", "prompt$ "]);
    expect(readBufferRange(term, { startLine: 1, endLine: 2 })).toBe("a.txt\nb.txt");
  });

  it("trims xterm's cell padding from each line", () => {
    const term = makeTerm(["p", "a.txt        ", "b.txt   "]);
    expect(readBufferRange(term, { startLine: 1, endLine: 2 })).toBe("a.txt\nb.txt");
  });

  it("drops trailing blank lines but keeps interior ones", () => {
    const term = makeTerm(["p", "one", "", "two", "", "   "]);
    expect(readBufferRange(term, { startLine: 1, endLine: 5 })).toBe("one\n\ntwo");
  });

  it("returns an empty string for an all-blank range", () => {
    const term = makeTerm(["p", "  ", ""]);
    expect(readBufferRange(term, { startLine: 1, endLine: 2 })).toBe("");
  });

  it("skips lines the buffer no longer has", () => {
    const term = makeTerm(["p", "one", null, "three"]);
    expect(readBufferRange(term, { startLine: 1, endLine: 3 })).toBe("one\nthree");
  });

  it("reads a single-line range", () => {
    const term = makeTerm(["p", "only"]);
    expect(readBufferRange(term, { startLine: 1, endLine: 1 })).toBe("only");
  });
});
