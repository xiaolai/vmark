/**
 * Text Cleanup — the whole-document Remove Trailing Spaces and Collapse Blank
 * Lines actions, applied to everything except fenced code.
 *
 * Purpose: a fenced block is code, so its trailing spaces and blank-line runs
 * are content (a diff, a heredoc, whitespace-sensitive output). These run the
 * line rules on the text between fences and copy every fence through
 * byte-for-byte, including an unclosed fence, which runs to the end of the
 * document as CommonMark says.
 *
 * Key decisions:
 *   - Only fenced code is protected. Indented code and inline code are not:
 *     inline code cannot hold a line ending, and an indented block cannot be
 *     told from list continuation without a parse.
 *   - A fence spans its opener's line start to the end of its closer's line,
 *     trailing spaces included, so every segment between fences starts and
 *     ends at a line boundary and the rules' default line-edge flags hold.
 *
 * @coordinates-with utils/markdownPipeline/fencedCodeBlocks.ts — the fence scan
 * @coordinates-with plugins/toolbarActions/sourceCjkActions.ts — Source-mode handlers
 * @coordinates-with plugins/toolbarActions/wysiwygAdapterCjk.ts — WYSIWYG handlers
 * @module lib/cjkFormatter/textCleanup
 */

import { findFencedCodeBlocks } from "@/utils/markdownPipeline/fencedCodeBlocks";
import { collapseNewlines, removeTrailingSpaces } from "./rules";
import type { FormatOptions } from "./types";

/** Apply `transform` to each run of text outside fenced code; copy the fences as they are. */
function outsideFencedCode(text: string, transform: (segment: string) => string): string {
  let out = "";
  let cursor = 0;
  for (const { start, end } of findFencedCodeBlocks(text)) {
    out += transform(text.slice(cursor, start)) + text.slice(start, end);
    cursor = end;
  }
  return out + transform(text.slice(cursor));
}

/** Remove trailing spaces from every line outside fenced code. */
export function cleanTrailingSpaces(
  text: string,
  options: Pick<FormatOptions, "preserveTwoSpaceHardBreaks"> = {},
): string {
  return outsideFencedCode(text, (segment) => removeTrailingSpaces(segment, options));
}

/** Collapse runs of three or more line feeds to two, outside fenced code. */
export function cleanBlankLines(text: string): string {
  return outsideFencedCode(text, collapseNewlines);
}
