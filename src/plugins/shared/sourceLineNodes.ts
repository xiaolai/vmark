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
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { withSourceLine } from "./sourceLineAttr";
import { withHeadingId } from "./headingIdAttr";
import { CodeBlockWithLineNumbers } from "@/plugins/codeBlockLineNumbers";

export const HeadingWithSourceLine = withHeadingId(withSourceLine(Heading));
export const ParagraphWithSourceLine = withSourceLine(Paragraph);
export const CodeBlockWithSourceLine = withSourceLine(CodeBlockWithLineNumbers);
export const BlockquoteWithSourceLine = withSourceLine(Blockquote);
export const BulletListWithSourceLine = withSourceLine(BulletList);
export const OrderedListWithSourceLine = withSourceLine(OrderedList);
export const HorizontalRuleWithSourceLine = withSourceLine(HorizontalRule);
export const TableWithSourceLine = withSourceLine(Table);
export const TableRowWithSourceLine = withSourceLine(TableRow);
