/**
 * Purpose: structural GFM table parsing for the doc joins — every table on a
 *   page as `{ heading, headers, rows: [{ cells, line }], line }`, with the
 *   inline markdown of a cell reducible to the text a reader sees.
 *
 * Structural means: split on unescaped `|`, trim, keep inline markdown in the
 * cells, remember the nearest heading above each table and the 1-based line of
 * every row. Nothing here knows what a Default column means; `defaultRows`
 * only selects the rows of tables whose header has one, because that is the
 * shape both settings pages share and the join asserts over.
 *
 * Why a parser and not a regex per row: the settings-defaults join has to see
 * a row that was REMOVED, which only works if the page is read as tables and
 * compared to a map, never as a list of expected lines (Codex objection #7).
 *
 * @coordinates-with scripts/lib/docJoins/settingsDefaults.mjs — the consumer
 * @module scripts/lib/docJoins/markdownTables
 */

const isTableLine = (line) => /^\s*\|/.test(line ?? "");
const isFence = (line) => /^\s*(```|~~~)/.test(line);

function isDelimiterLine(line) {
  if (!isTableLine(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Is the `|` at `end - 1` escaped? Only an ODD run of backslashes before it escapes it. */
function pipeIsEscaped(body, end) {
  let backslashes = 0;
  for (let i = end - 2; i >= 0 && body[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * Split one table line into trimmed cells; `\|` is a literal pipe, one leading
 * and one trailing pipe are structure.
 *
 * Backslashes are consumed in PAIRS, so a run of them has the right parity: a
 * backslash escapes exactly the character after it, which means `\\|` is a
 * literal backslash followed by a real DELIMITER, not an escaped pipe. The
 * single-character lookahead this replaced read every `\` before a `|` as an
 * escape, so an even run merged two cells into one — and the trailing-pipe
 * test had the same flaw (audit R2 #142).
 */
export function splitRow(line) {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !pipeIsEscaped(body, body.length)) body = body.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      // `\|` is the literal pipe; every other escape keeps both characters for
      // the inline parser (`stripMarkdown`) to resolve.
      cur += body[i + 1] === "|" ? "|" : `\\${body[i + 1]}`;
      i++;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * Every GFM table on a page: `{ heading, headers, rows: [{ cells, line }], line }`.
 * Cells keep their inline markdown; `heading` is the nearest markdown heading
 * above the table (what disambiguates two "Font Size" rows). Lines are 1-based.
 * Fenced code blocks are skipped; a pipe line without a delimiter row is prose.
 */
export function parseTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let heading = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      heading = stripMarkdown(h[1]);
      continue;
    }
    if (!isTableLine(line) || !isDelimiterLine(lines[i + 1])) continue;
    const rows = [];
    let j = i + 2;
    while (j < lines.length && isTableLine(lines[j])) {
      rows.push({ cells: splitRow(lines[j]), line: j + 1 });
      j++;
    }
    tables.push({ heading, headers: splitRow(line), rows, line: i + 1 });
    i = j - 1;
  }
  return tables;
}

/** Inline markdown → the text a reader sees: code spans, bold/italic, links and backslash escapes removed. */
export function stripMarkdown(cell) {
  return cell
    .replace(/(`+)(.+?)\1/g, "$2")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<![\w\\])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1")
    .replace(/(?<![\w\\])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The rows of every table that carries a `Default` column, with the Setting (first) and Default cells stripped. */
export function defaultRows(tables) {
  const rows = [];
  for (const table of tables) {
    const col = table.headers.findIndex((h) => stripMarkdown(h).toLowerCase() === "default");
    if (col < 0) continue;
    for (const r of table.rows) {
      rows.push({ row: stripMarkdown(r.cells[0] ?? ""), docDefault: stripMarkdown(r.cells[col] ?? ""), line: r.line, heading: table.heading });
    }
  }
  return rows;
}
