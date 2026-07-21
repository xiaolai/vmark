/**
 * Extended StarterKit nodes with sourceLine attribute.
 *
 * These extensions add the sourceLine attribute to built-in nodes
 * for cursor sync between Source and WYSIWYG modes.
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

// Top-level block nodes also carry `blankLinesBefore` (composed with sourceLine)
// so a captured inter-block blank-line run survives the round trip. TableRow is
// intentionally excluded — it is never a top-level block.

/** Heading extension with sourceLine + blankLinesBefore attributes and auto IDs. */
export const HeadingWithSourceLine = withHeadingId(withBlankLinesBefore(withSourceLine(Heading)));
/** Paragraph extension with sourceLine + blankLinesBefore attributes. */
export const ParagraphWithSourceLine = withBlankLinesBefore(withSourceLine(Paragraph));
/** Code block extension with sourceLine + blankLinesBefore + line numbers. */
export const CodeBlockWithSourceLine = withBlankLinesBefore(withSourceLine(CodeBlockWithLineNumbers));
/** Blockquote extension with sourceLine + blankLinesBefore attributes. */
export const BlockquoteWithSourceLine = withBlankLinesBefore(withSourceLine(Blockquote));
/** Bullet list extension with sourceLine + blankLinesBefore attributes. */
export const BulletListWithSourceLine = withBlankLinesBefore(withSourceLine(BulletList));
/** Ordered list extension with sourceLine + blankLinesBefore attributes. */
export const OrderedListWithSourceLine = withBlankLinesBefore(withSourceLine(OrderedList));
/** Horizontal rule extension with sourceLine + blankLinesBefore attributes. */
export const HorizontalRuleWithSourceLine = withBlankLinesBefore(withSourceLine(HorizontalRule));
/** Table row extension with sourceLine attribute for cursor sync. */
export const TableRowWithSourceLine = withSourceLine(TableRow);
