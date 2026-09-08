/**
 * Source Unfence — the code-block TOGGLE's way out.
 *
 * Purpose: replace a fenced block with its literal contents. Split out of
 * `sourceInsertActions.ts` (audit 20260907, #444) so the list-item rule below
 * has room without pushing that file past the size gate.
 *
 * Key decisions:
 *   - A fence that OPENS a list item carries the markers on its opener line
 *     (`- ```, `- - ```). The opener goes with the fence, so they are restored
 *     onto the first body line — or the item vanished with the fence and the
 *     list broke (#444).
 *   - EVERY marker, read through `fenceDelimiter`'s own container walk rather
 *     than a local regex. A regex that matched one marker restored the outer
 *     item and flattened the inner one into spaces, which is the same
 *     destruction one level in (#444, round 3).
 *   - Only the item's CONTINUATION is stripped from that first body line: the
 *     opener's own indentation, its quote markers, and at most the content
 *     column each marker occupies. Whatever indentation the line carries past
 *     that is the code's own and stays (#444, round 2 — a `\s*` that consumed
 *     the whole leading run deleted it). Later body lines are untouched: their
 *     indentation is what continues the item.
 *
 * @coordinates-with sourceInsertActions.ts — insertCodeBlock, the only caller
 * @coordinates-with shared/fenceScanner.ts — enclosingFence, the fence being removed
 * @coordinates-with shared/fenceDelimiter.ts — containerPrefixParts, the opener's markers
 * @module plugins/toolbarActions/sourceUnfence
 */

import type { EditorView } from "@codemirror/view";
import type { EnclosingFence } from "@/plugins/shared/fenceScanner";
import { columnAfter, containerPrefixParts, type ContainerPart } from "@/plugins/shared/fenceDelimiter";

/**
 * The opener's container prefix when a LIST MARKER is in it, else nothing.
 *
 * Read through the fence grammar's own walk rather than a local regex: a local
 * one matched a single marker, so `- - ``` ` restored the outer item and turned
 * the inner one into spaces — the same destruction, one level in (#444, round 3).
 * A prefix of quotes alone needs no restoration: a quote marker repeats on every
 * line, so the body already carries it.
 */
function openerItemPrefix(openerLine: string): ContainerPart[] {
  const parts = containerPrefixParts(openerLine);
  return parts.some((p) => p.list) ? parts : [];
}

/** A quote run the body line may repeat, bounded by the opener's own depth. */
function quoteContinuation(part: ContainerPart): RegExp {
  return new RegExp(`^(?: {0,3}>[ \\t]?){0,${(part.text.match(/>/g) ?? []).length}}`);
}

/**
 * Drop up to `columns` COLUMNS of leading whitespace from `line`, which starts
 * at visual column `start`.
 *
 * Columns, not characters: a list marker's continuation is its own WIDTH, and
 * a tab is one character worth up to four columns. A ` {0,N}` pattern matched
 * nothing against a tab-indented body line, so unfencing `-` + TAB + fence
 * re-emitted the marker AND kept the tab — one whole tab stop of indentation
 * the code never had (audit R2, #878). A tab that STRADDLES the boundary is
 * re-expanded: the columns past it are the code's own and stay.
 */
function dropColumns(line: string, start: number, columns: number): { rest: string; column: number } {
  const target = start + columns;
  let column = start;
  let i = 0;
  while (i < line.length && column < target) {
    const ch = line[i];
    if (ch === " ") {
      column += 1;
      i += 1;
      continue;
    }
    if (ch !== "\t") break;
    const next = columnAfter("\t", column);
    i += 1;
    if (next <= target) {
      column = next;
      continue;
    }
    return { rest: " ".repeat(next - target) + line.slice(i), column: target };
  }
  return { rest: line.slice(i), column };
}

/**
 * The first body line with the item's continuation removed and the opener's
 * markers put back in front — see the header for what "continuation" means.
 *
 * A quote run repeats literally (optionally — a lazy continuation may drop
 * it); a list marker's continuation is its own width in columns. Every bound
 * comes from what the opener itself has, so nothing of the line's own
 * indentation is consumed.
 */
function restoreItemMarkers(prefix: readonly ContainerPart[], firstBodyLine: string): string {
  const markers = prefix.map((p) => p.text).join("");
  let rest = firstBodyLine;
  let column = 0;
  for (const part of prefix) {
    if (part.list) {
      ({ rest, column } = dropColumns(rest, column, columnAfter(part.text, column) - column));
      continue;
    }
    const matched = quoteContinuation(part).exec(rest)?.[0] ?? "";
    column = columnAfter(matched, column);
    rest = rest.slice(matched.length);
  }
  return `${markers}${rest}`;
}

/** Replace the fence `fence` (opener through closer) with its body lines. */
export function unfence(view: EditorView, all: string[], fence: EnclosingFence): boolean {
  const { doc } = view.state;
  const body = all.slice(fence.open + 1, fence.closed ? fence.close : fence.close + 1);
  const itemPrefix = openerItemPrefix(all[fence.open] ?? "");
  if (itemPrefix.length) body[0] = restoreItemMarkers(itemPrefix, body[0] ?? "");
  const from = doc.line(fence.open + 1).from;
  const to = doc.line(fence.close + 1).to;

  view.dispatch({
    changes: { from, to, insert: body.join("\n") },
    selection: { anchor: Math.min(from, doc.length) },
  });
  view.focus();
  return true;
}
