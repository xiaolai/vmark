/**
 * Line-hunk differ for the round-trip fidelity gate.
 *
 * Purpose: answer "what did the pipeline change about the author's text?" in
 * units a human can review and a rule can classify. Consecutive changed lines
 * are grouped into one hunk, so a reformatted table reads as a single deviation
 * rather than six independent ones.
 *
 * Why a local LCS instead of a diff dependency: the corpus documents are small
 * (tens of lines), the gate needs no rendering or fuzzy matching, and adding a
 * runtime dependency for ~40 lines of table walk is dependency debt the project
 * rules ask us to justify rather than incur.
 *
 * @coordinates-with roundtripFidelity.test.ts — the gate that consumes hunks
 * @coordinates-with normalizationRules.ts — classifies each hunk
 * @module utils/markdownPipeline/__tests__/fidelity/hunkDiff
 */

/** One contiguous divergence: the author's lines, and what came back. */
export interface Hunk {
  /** Lines as the author wrote them (empty for a pure insertion). */
  before: string[];
  /** Lines the pipeline produced (empty for a pure deletion). */
  after: string[];
}

/**
 * Longest-common-subsequence table over two line arrays.
 * `lcs[i][j]` = length of the LCS of `a[i..]` and `b[j..]`.
 */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Diff two documents by line, grouping consecutive changes into hunks.
 *
 * Returns `[]` when the documents are identical — the fidelity case.
 */
export function hunkDiff(before: string, after: string): Hunk[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = lcsTable(a, b);

  const hunks: Hunk[] = [];
  let pending: Hunk | null = null;
  const flush = (): void => {
    if (pending && (pending.before.length > 0 || pending.after.length > 0)) hunks.push(pending);
    pending = null;
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    pending ??= { before: [], after: [] };
    // Prefer the direction the LCS says preserves more shared lines. On a tie
    // consume from `before` first, so a replacement reads as before→after
    // rather than as an insertion followed by a deletion.
    if (table[i + 1][j] >= table[i][j + 1]) {
      pending.before.push(a[i]);
      i += 1;
    } else {
      pending.after.push(b[j]);
      j += 1;
    }
  }
  // Tail: whatever remains on either side is one trailing divergence.
  while (i < a.length) {
    pending ??= { before: [], after: [] };
    pending.before.push(a[i]);
    i += 1;
  }
  while (j < b.length) {
    pending ??= { before: [], after: [] };
    pending.after.push(b[j]);
    j += 1;
  }
  flush();

  return hunks;
}

/** Render hunks as a reviewable unified-style block for failure output. */
export function formatHunks(hunks: readonly Hunk[]): string {
  return hunks
    .map((h) => {
      const minus = h.before.map((l) => `      - ${JSON.stringify(l)}`);
      const plus = h.after.map((l) => `      + ${JSON.stringify(l)}`);
      return [...minus, ...plus].join("\n");
    })
    .join("\n      ~~~\n");
}
