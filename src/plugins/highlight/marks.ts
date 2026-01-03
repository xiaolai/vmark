/**
 * Highlight Mark Schema
 *
 * Defines ProseMirror mark for ==highlight== syntax.
 */

import { $markSchema } from "@milkdown/kit/utils";

/**
 * Highlight mark schema
 * Syntax: ==text== renders as <mark>text</mark>
 */
export const highlightSchema = $markSchema("highlight", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", { class: "md-highlight" }, 0] as const,
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => {
      state.withMark(mark, "highlight");
    },
  },
}));
