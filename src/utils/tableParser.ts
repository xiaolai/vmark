/**
 * Table Parser Utilities
 *
 * Purpose: Shared utilities for parsing markdown table rows in source mode,
 * correctly handling escaped pipes and pipes inside code spans.
 *
 * Key decisions:
 *   - Character-by-character parsing to handle inline code spans (`|` inside code)
 *   - Backslash-escaped pipes (\|) are preserved as literal pipe characters
 *   - Does NOT trim cells — caller handles trimming for flexibility
 *
 * @coordinates-with sourceContextDetection/tableDetection.ts — detects table context in source
 * @coordinates-with sourceContextDetection/tableActions.ts — table manipulation in source mode
 * @module utils/tableParser
 */

/**
 * Split table row content on pipes, respecting escapes and code spans.
 * Does NOT trim cells — caller should handle trimming.
 */
export function splitTableCells(content: string): string[] {
  const cells: string[] = [];
  let cellStart = 0;
  let escaped = false;
  let inCode = false;
  let codeFenceLen = 0;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "`") {
      // Count backticks in a run
      let runLen = 1;
      while (i + runLen < content.length && content[i + runLen] === "`") {
        runLen++;
      }

      if (!inCode) {
        inCode = true;
        codeFenceLen = runLen;
      } else if (runLen === codeFenceLen) {
        inCode = false;
        codeFenceLen = 0;
      }

      i += runLen - 1;
      continue;
    }

    if (ch === "|" && !inCode) {
      cells.push(content.slice(cellStart, i));
      cellStart = i + 1;
    }
  }

  cells.push(content.slice(cellStart));
  return cells;
}

/**
 * True if `content` ends with a real (non-escaped) table delimiter pipe.
 *
 * A naive `endsWith("\\|")` check cannot distinguish:
 *   - one backslash + `|` → cell content (escaped pipe, NOT a delimiter)
 *   - two backslashes + `|` → cell content ends with `\`, then a real delimiter
 *
 * Backslash parity tells them apart: count the run of `\` chars immediately
 * before the trailing `|`. Even count (including zero) ⇒ unescaped delimiter.
 */
export function endsWithDelimiterPipe(content: string): boolean {
  if (!content.endsWith("|")) return false;
  let backslashRun = 0;
  let i = content.length - 2; // skip the trailing `|`
  while (i >= 0 && content[i] === "\\") {
    backslashRun++;
    i--;
  }
  return backslashRun % 2 === 0;
}

/**
 * Parse a table row into cells, handling escaped pipes and code spans.
 * Trims leading/trailing pipes and whitespace from each cell.
 */
export function parseTableRow(line: string): string[] {
  let content = line.trim();

  // Trim leading pipe
  if (content.startsWith("|")) {
    content = content.slice(1);
  }

  // Trim trailing pipe (only when it's a real delimiter, not an escaped pipe)
  if (endsWithDelimiterPipe(content)) {
    content = content.slice(0, -1);
  }

  return splitTableCells(content).map((cell) => cell.trim());
}
