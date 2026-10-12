// @vitest-environment node
/**
 * Tests for floatingPromptCells — turning a real xterm buffer line into
 * styled text runs for the floating prompt: colour modes (default, 16, 256,
 * truecolor), inverse, wide CJK cells, trailing blanks and the cursor cell.
 */
import { describe, it, expect } from "vitest";
import { createRealTerminal, writeParsed } from "./realXterm.testUtils";
import { buildAnsiPalette, lineToRuns, type PromptColors } from "./floatingPromptCells";

const COLORS: PromptColors = {
  foreground: "#111111",
  background: "#eeeeee",
  palette: buildAnsiPalette({ red: "#cc0000", brightBlue: "#5555ff" }),
};

async function firstLine(data: string) {
  const term = createRealTerminal({ cols: 40, rows: 5 });
  await writeParsed(term, data);
  const line = term.buffer.active.getLine(0);
  if (!line) throw new Error("no line");
  return line;
}

describe("buildAnsiPalette", () => {
  it("uses theme colours for the 16 ANSI slots and falls back for missing ones", () => {
    const palette = buildAnsiPalette({ red: "#cc0000" });
    expect(palette).toHaveLength(256);
    expect(palette[1]).toBe("#cc0000");
    expect(palette[0]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("computes the 6×6×6 cube and the grey ramp", () => {
    const palette = buildAnsiPalette({});
    expect(palette[16]).toBe("#000000");
    expect(palette[231]).toBe("#ffffff");
    expect(palette[196]).toBe("#ff0000");
    expect(palette[232]).toBe("#080808");
    expect(palette[255]).toBe("#eeeeee");
  });

  it("lets extendedAnsi override slots from 16 up", () => {
    expect(buildAnsiPalette({ extendedAnsi: ["#123456"] })[16]).toBe("#123456");
  });
});

describe("lineToRuns", () => {
  it("returns no runs for a blank line without the cursor", async () => {
    const line = await firstLine("");
    expect(lineToRuns(line, COLORS)).toEqual([]);
  });

  it("groups default-styled text into one run and trims trailing blanks", async () => {
    const line = await firstLine("$ ls -la   ");
    expect(lineToRuns(line, COLORS)).toEqual([
      { text: "$ ls -la", fg: "#111111", bg: null, bold: false, italic: false, underline: false, dim: false, cursor: false },
    ]);
  });

  it("resolves 16-colour, 256-colour and truecolor foregrounds", async () => {
    const line = await firstLine("\x1b[31mA\x1b[94mB\x1b[38;5;196mC\x1b[38;2;1;2;3mD\x1b[0m");
    expect(lineToRuns(line, COLORS).map((r) => [r.text, r.fg])).toEqual([
      ["A", "#cc0000"],
      ["B", "#5555ff"],
      ["C", "#ff0000"],
      ["D", "#010203"],
    ]);
  });

  it("swaps foreground and background for inverse cells", async () => {
    const line = await firstLine("\x1b[7mX\x1b[0m");
    expect(lineToRuns(line, COLORS)[0]).toMatchObject({ text: "X", fg: "#eeeeee", bg: "#111111" });
  });

  it("keeps bold / italic / underline / dim flags", async () => {
    const line = await firstLine("\x1b[1;3;4;2mS\x1b[0m");
    expect(lineToRuns(line, COLORS)[0]).toMatchObject({ bold: true, italic: true, underline: true, dim: true });
  });

  it("emits a wide CJK character once, skipping its continuation cell", async () => {
    const line = await firstLine("中文ok");
    expect(lineToRuns(line, COLORS).map((r) => r.text).join("")).toBe("中文ok");
  });

  it("marks the cursor cell as its own run", async () => {
    const line = await firstLine("abc");
    const runs = lineToRuns(line, COLORS, { cursorX: 1 });
    expect(runs.map((r) => [r.text, r.cursor])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
  });

  it("pads to a cursor that sits past the end of the text", async () => {
    const line = await firstLine("$ ");
    const runs = lineToRuns(line, COLORS, { cursorX: 2 });
    expect(runs.map((r) => [r.text, r.cursor])).toEqual([
      ["$ ", false],
      [" ", true],
    ]);
  });

  it("renders invisible cells as blanks so concealed text never leaks", async () => {
    const line = await firstLine("a\x1b[8msecret\x1b[0mb");
    expect(lineToRuns(line, COLORS).map((r) => r.text).join("")).toBe("a      b");
  });
});
