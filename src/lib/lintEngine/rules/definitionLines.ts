/**
 * Which lines hold a link DEFINITION rather than a use of one.
 *
 * Both reference rules have to answer this, and both got it wrong in the same
 * way before: a line regex only recognises a definition that starts its own
 * line, so one inside a blockquote (`> [ref]: url`) and a title carried onto a
 * continuation line each read as a `[ref]` USAGE. A definition that counts
 * itself used is never reported, and a title's bracket text is reported as an
 * undefined reference.
 *
 * The parser's positions are the answer; the regex is kept beside them because
 * remark does not produce a `definition` node for a malformed one
 * (`[a]: ` with no destination), and scanning that line as prose would report
 * its own label.
 *
 * @module lib/lintEngine/rules/definitionLines
 */

import { visit } from "unist-util-visit";
import type { Definition, Root } from "mdast";

/** `[label]: destination` as the line reads, container prefixes aside. */
const DEFINITION_LINE_RE = /^ {0,3}\[[^\]]+\]:[ \t]/;

/** Every 1-based line a parsed definition occupies, continuation lines and all. */
export function definitionLines(mdast: Root): Set<number> {
  const lines = new Set<number>();
  visit(mdast, "definition", (node: Definition) => {
    const position = node.position;
    if (!position) return;
    for (let line = position.start.line; line <= position.end.line; line++) lines.add(line);
  });
  return lines;
}

/** Whether `line` reads as a definition even if the parser made no node of it. */
export function isDefinitionLine(line: string): boolean {
  return DEFINITION_LINE_RE.test(line.replace(/\r$/, ""));
}
