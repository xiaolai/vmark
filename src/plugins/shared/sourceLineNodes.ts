/**
 * Extended StarterKit nodes with sourceLine attribute.
 *
 * These extensions add the sourceLine attribute to built-in nodes
 * for cursor sync between Source and WYSIWYG modes. The bullet and ordered
 * lists also carry `spread` (a loose list: blank lines between its items) so
 * a document round-trips it; it is markdown-only, never rendered to HTML or
 * read from pasted HTML, and a new list starts tight.
 *
 * The stock block extensions also register their own command shortcuts
 * (Mod-Alt-0..6, Mod-Shift-7/8/b, Mod-Alt-c). They are stripped here: VMark
 * binds every one of those commands itself through `shortcutDefinitions.ts` and
 * `runEditorAction`, and the hidden copies went around both the user's bindings
 * and the code-fence guard. Cmd+Opt+2 inside a fenced code block turned the
 * whole block into a heading. Editing keys (the code block's Enter, Backspace
 * and ArrowDown) are kept.
 *
 * @module plugins/shared/sourceLineNodes
 */

import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Blockquote } from "@tiptap/extension-blockquote";
import { BulletList } from "@tiptap/extension-bullet-list";
import { OrderedList } from "@tiptap/extension-ordered-list";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { TableRow } from "@tiptap/extension-table-row";
import { withSourceLine, withBlankLinesBefore } from "./sourceLineAttr";
import { withHeadingId } from "./headingIdAttr";
import { CodeBlockWithLineNumbers } from "@/plugins/codeBlockLineNumbers";
import type { Node } from "@tiptap/core";

/** `node` without the named keyboard shortcuts its parent registers. */
function withoutShortcuts<O, S>(node: Node<O, S>, keys: readonly string[]): Node<O, S> {
  return node.extend({
    addKeyboardShortcuts() {
      const inherited = this.parent?.() ?? {};
      return Object.fromEntries(Object.entries(inherited).filter(([key]) => !keys.includes(key)));
    },
  });
}

const HEADING_SHORTCUTS = [1, 2, 3, 4, 5, 6].map((level) => `Mod-Alt-${level}`);

// Top-level block nodes also carry `blankLinesBefore` (composed with sourceLine)
// so a captured inter-block blank-line run survives the round trip. TableRow is
// intentionally excluded — it is never a top-level block.

/** Heading extension with sourceLine + blankLinesBefore attributes and auto IDs. */
export const HeadingWithSourceLine = withHeadingId(
  withBlankLinesBefore(withSourceLine(withoutShortcuts(Heading, HEADING_SHORTCUTS))),
);
/** Paragraph extension with sourceLine + blankLinesBefore attributes. */
export const ParagraphWithSourceLine = withBlankLinesBefore(
  withSourceLine(withoutShortcuts(Paragraph, ["Mod-Alt-0"])),
);
/** Code block extension with sourceLine + blankLinesBefore + line numbers. */
export const CodeBlockWithSourceLine = withBlankLinesBefore(
  withSourceLine(withoutShortcuts(CodeBlockWithLineNumbers, ["Mod-Alt-c"])),
);
/** Blockquote extension with sourceLine + blankLinesBefore attributes. */
export const BlockquoteWithSourceLine = withBlankLinesBefore(
  withSourceLine(withoutShortcuts(Blockquote, ["Mod-Shift-b"])),
);
/** Whether a list is loose (`spread`); markdown-only, and a new list is tight. */
const spreadAttr = {
  spread: { default: false, rendered: false, parseHTML: () => false },
} as const;

const LooseAwareBulletList = withoutShortcuts(BulletList, ["Mod-Shift-8"]).extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttr };
  },
});
const LooseAwareOrderedList = withoutShortcuts(OrderedList, ["Mod-Shift-7"]).extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttr };
  },
});

/** Bullet list extension with sourceLine + blankLinesBefore + spread attributes. */
export const BulletListWithSourceLine = withBlankLinesBefore(withSourceLine(LooseAwareBulletList));
/** Ordered list extension with sourceLine + blankLinesBefore + spread attributes. */
export const OrderedListWithSourceLine = withBlankLinesBefore(withSourceLine(LooseAwareOrderedList));
/** Horizontal rule extension with sourceLine + blankLinesBefore attributes. */
export const HorizontalRuleWithSourceLine = withBlankLinesBefore(withSourceLine(HorizontalRule));
/** Table row extension with sourceLine attribute for cursor sync. */
export const TableRowWithSourceLine = withSourceLine(TableRow);
