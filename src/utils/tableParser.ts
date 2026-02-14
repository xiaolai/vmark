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
 * Parse a table row into cells, handling escaped pipes and code spans.
 * Trims leading/trailing pipes and whitespace from each cell.
 */
export function parseTableRow(line: string): string[] {
  let content = line.trim();

  // Trim leading pipe
  if (content.startsWith("|")) {
    content = content.slice(1);
  }

  // Trim trailing pipe (but not if escaped)
  if (content.endsWith("|") && !content.endsWith("\\|")) {
    content = content.slice(0, -1);
  }

  return splitTableCells(content).map((cell) => cell.trim());
}
