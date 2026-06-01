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
import { withSourceLine } from "./sourceLineAttr";
import { withHeadingId } from "./headingIdAttr";
import { CodeBlockWithLineNumbers } from "@/plugins/codeBlockLineNumbers";

/** Heading extension with sourceLine attribute and auto-generated heading IDs. */
export const HeadingWithSourceLine = withHeadingId(withSourceLine(Heading));
/** Paragraph extension with sourceLine attribute for cursor sync. */
export const ParagraphWithSourceLine = withSourceLine(Paragraph);
/** Code block extension with sourceLine attribute and line numbers support. */
export const CodeBlockWithSourceLine = withSourceLine(CodeBlockWithLineNumbers);
/** Blockquote extension with sourceLine attribute for cursor sync. */
export const BlockquoteWithSourceLine = withSourceLine(Blockquote);
/** Bullet list extension with sourceLine attribute for cursor sync. */
export const BulletListWithSourceLine = withSourceLine(BulletList);
/** Ordered list extension with sourceLine attribute for cursor sync. */
export const OrderedListWithSourceLine = withSourceLine(OrderedList);
/** Horizontal rule extension with sourceLine attribute for cursor sync. */
export const HorizontalRuleWithSourceLine = withSourceLine(HorizontalRule);
/** Table row extension with sourceLine attribute for cursor sync. */
export const TableRowWithSourceLine = withSourceLine(TableRow);
