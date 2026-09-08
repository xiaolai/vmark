/**
 * E02 — tableColumnCount
 *
 * Purpose: Flag table body rows whose cell count differs from the header row.
 * The first tableRow is treated as the header and defines the expected count.
 */

import { visit } from "unist-util-visit";
import type { Root, Table, TableRow } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { ruleEmission } from "../ruleMeta";
import { startOffset } from "./positionOffset";

/** The E02 diagnostic for one row whose cell count disagrees with the header's. */
function rowMismatch(
  row: TableRow & { position: NonNullable<TableRow["position"]> },
  expected: number,
  lineOffsets: readonly number[],
): LintDiagnostic {
  const { line, column } = row.position.start;
  return createDiagnostic({
    ...ruleEmission("E02"),
    messageKey: "lint.E02",
    messageParams: {
      expected: String(expected),
      found: String(row.children.length),
    },
    line,
    column,
    offset: startOffset(row.position.start, lineOffsets),
    endOffset: row.position.end.offset,
    uiHint: "block",
  });
}

export function tableColumnCount(
  _source: string,
  mdast: Root,
  { lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  visit(mdast, "table", (node: Table) => {
    const rows = node.children as TableRow[];
    if (rows.length < 2) return; // No body rows to check
    const expected = rows[0].children.length;

    for (const row of rows.slice(1)) {
      if (row.children.length === expected || !row.position) continue;
      diagnostics.push(
        rowMismatch(row as TableRow & { position: NonNullable<TableRow["position"]> }, expected, lineOffsets),
      );
    }
  });

  return diagnostics;
}
