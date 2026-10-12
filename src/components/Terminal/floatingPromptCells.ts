/**
 * floatingPromptCells — turn one xterm buffer line into styled text runs so
 * the floating prompt can mirror the input rows with their colours.
 *
 * Purpose: The floating prompt is plain DOM, not a second xterm, so it needs
 * the cell styles resolved to CSS colours. This pure helper reads cells
 * through the public IBufferLine/IBufferCell API and groups neighbours with
 * the same style into runs.
 *
 * Key decisions:
 *   - Output is DATA (text + resolved colours), never HTML: the caller sets
 *     `textContent`, so terminal output cannot inject markup.
 *   - Colour modes: default → theme foreground (background left null so the
 *     overlay's own surface shows), palette → the 256-slot table built from
 *     the live theme, RGB → `#rrggbb`. Inverse swaps the resolved pair.
 *   - Concealed (SGR 8) cells render as blanks, so hidden text never leaks.
 *   - A wide (CJK) glyph is emitted once; its zero-width continuation cell is
 *     skipped. Trailing default blanks are trimmed, except up to the cursor.
 *   - The cursor cell is its own run so the caller can draw it as a block.
 *
 * @coordinates-with setupFloatingPrompt.ts — sole caller
 * @module components/Terminal/floatingPromptCells
 */

import type { IBufferCell, IBufferLine, ITheme } from "@xterm/xterm";

/** One run of identically-styled text. `bg: null` means "default surface". */
export interface PromptRun {
  text: string;
  fg: string;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  cursor: boolean;
}

/** The resolved colours a line is rendered with. */
export interface PromptColors {
  foreground: string;
  background: string;
  palette: readonly string[];
}

/** xterm's own defaults, used only for an ANSI slot a theme leaves unset. */
const DEFAULT_ANSI = [
  "#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
  "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec",
];

/** The theme's 16 ANSI slots in index order (unset slots stay undefined). */
function themedAnsi(t: ITheme): Array<string | undefined> {
  return [
    t.black, t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan, t.white,
    t.brightBlack, t.brightRed, t.brightGreen, t.brightYellow,
    t.brightBlue, t.brightMagenta, t.brightCyan, t.brightWhite,
  ];
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The 256-colour table for a theme: 16 themed slots, the cube, the grey ramp. */
export function buildAnsiPalette(theme: ITheme): string[] {
  const palette = themedAnsi(theme).map((color, i) => color ?? DEFAULT_ANSI[i] ?? "#000000");
  for (let i = 0; i < 216; i++) {
    palette.push(hex(CUBE_LEVELS[Math.floor(i / 36)] ?? 0, CUBE_LEVELS[Math.floor(i / 6) % 6] ?? 0, CUBE_LEVELS[i % 6] ?? 0));
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push(hex(v, v, v));
  }
  (theme.extendedAnsi ?? []).forEach((color, i) => {
    if (16 + i < 256) palette[16 + i] = color;
  });
  return palette;
}

function rgb(value: number): string {
  return hex((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function fgOf(cell: IBufferCell, colors: PromptColors): string | null {
  if (cell.isFgRGB()) return rgb(cell.getFgColor());
  if (cell.isFgPalette()) return colors.palette[cell.getFgColor()] ?? null;
  return null;
}

function bgOf(cell: IBufferCell, colors: PromptColors): string | null {
  if (cell.isBgRGB()) return rgb(cell.getBgColor());
  if (cell.isBgPalette()) return colors.palette[cell.getBgColor()] ?? null;
  return null;
}

function styleOf(cell: IBufferCell, colors: PromptColors): Omit<PromptRun, "text" | "cursor"> {
  let fg = fgOf(cell, colors);
  let bg = bgOf(cell, colors);
  if (cell.isInverse()) [fg, bg] = [bg ?? colors.background, fg ?? colors.foreground];
  return {
    fg: fg ?? colors.foreground,
    bg,
    bold: cell.isBold() !== 0,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
    dim: cell.isDim() !== 0,
  };
}

function sameStyle(a: PromptRun, b: Omit<PromptRun, "text">): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.italic === b.italic &&
    a.underline === b.underline && a.dim === b.dim && a.cursor === b.cursor;
}

/** Last column holding visible content (text or a coloured background), or -1. */
function lastContentColumn(line: IBufferLine, colors: PromptColors): number {
  for (let x = line.length - 1; x >= 0; x--) {
    const cell = line.getCell(x);
    if (!cell) continue;
    if (cell.getChars().trim() !== "" || bgOf(cell, colors) !== null || cell.isInverse()) return x;
  }
  return -1;
}

/** Styled runs for one buffer line; `cursorX` marks the cursor cell. */
export function lineToRuns(
  line: IBufferLine,
  colors: PromptColors,
  options: { cursorX?: number } = {},
): PromptRun[] {
  const cursorX = options.cursorX;
  const last = Math.max(lastContentColumn(line, colors), cursorX ?? -1);
  const runs: PromptRun[] = [];
  for (let x = 0; x <= last; x++) {
    const cell = line.getCell(x);
    if (cell && cell.getWidth() === 0) continue;
    const isCursor = x === cursorX;
    const text = !cell || cell.isInvisible() ? " ".repeat(Math.max(1, cell?.getWidth() ?? 1)) : cell.getChars() || " ";
    const style = cell
      ? styleOf(cell, colors)
      : { fg: colors.foreground, bg: null, bold: false, italic: false, underline: false, dim: false };
    const next = { ...style, cursor: isCursor };
    const prev = runs[runs.length - 1];
    if (prev && sameStyle(prev, next)) prev.text += text;
    else runs.push({ text, ...next });
  }
  return runs;
}
