/**
 * Multi-Selection Context Detection
 *
 * Purpose: Detects whether multiple cursors/selections are active and what structural
 * context they span (all in same table? same list? mixed blocks?). This information
 * drives the enable rules — some actions are only safe when all cursors share context.
 *
 * @coordinates-with enableRules.ts — consumes MultiSelectionContext for button states
 * @coordinates-with multiSelectionPolicy.ts — per-action allow/deny based on context
 * @module plugins/toolbarActions/multiSelectionContext
 */
import type { EditorView as TiptapEditorView } from "@tiptap/pm/view";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import type { ResolvedPos } from "@tiptap/pm/model";
import { MultiSelection } from "@/plugins/multiCursor";
import type { CursorContext as WysiwygContext } from "@/plugins/toolbarContext/types";
import type { CursorContext as SourceContext } from "@/types/cursorContext";
import type { MultiSelectionContext } from "./types";

const TABLE_NODE_NAMES = new Set([
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "table_row",
  "table_cell",
  "table_header",
]);

const LIST_NODE_NAMES = new Set([
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
]);

const CODE_FENCE_PATTERN = /^(\s*)(```+)(\w*)?/;

function isInsideCodeFence(doc: CodeMirrorView["state"]["doc"], pos: number): boolean {
  const cursorLine = doc.lineAt(pos);
  let openingLine: { number: number; text: string } | null = null;
  let fenceLength = 0;

  for (let lineNum = cursorLine.number; lineNum >= 1; lineNum--) {
    const line = doc.line(lineNum);
    const match = line.text.match(CODE_FENCE_PATTERN);
    if (!match) continue;
    const fenceChars = match[2];
    if (!fenceChars) continue;
    openingLine = { number: lineNum, text: line.text };
    fenceLength = fenceChars.length;
    break;
  }

  if (!openingLine) return false;

  for (let lineNum = openingLine.number + 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const trimmed = line.text.trim();
    const fenceRegex = new RegExp("^`{" + fenceLength + ",}$");
    if (trimmed.match(fenceRegex)) {
      return cursorLine.number >= openingLine.number && cursorLine.number <= lineNum;
    }
  }

  return false;
}

function classifySourceLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("|") || trimmed.includes("|")) return "table";
  if (/^\s*>/.test(text)) return "blockquote";
  if (/^#{1,6}\s/.test(text)) return "heading";
  if (/^\s*(?:[-*+])\s*\[[ xX]\]\s/.test(text)) return "list";
  if (/^\s*(?:[-*+]|\d+\\.)\s/.test(text)) return "list";
  return "paragraph";
}

function getBlockParentName($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock) return node.type.name;
  }
  return null;
}

function getInlineAtomFlags(view: TiptapEditorView, from: number, to: number) {
  let inImage = false;
  let inInlineMath = false;
  let inFootnote = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "image" || node.type.name === "block_image") {
      inImage = true;
    }
    if (node.type.name === "math_inline") {
      inInlineMath = true;
    }
    if (node.type.name === "footnote_reference" || node.type.name === "footnote_definition") {
      inFootnote = true;
    }
    return !(inImage && inInlineMath && inFootnote);
  });
  return { inImage, inInlineMath, inFootnote };
}

function rangeHasLinkMark(view: TiptapEditorView, from: number, to: number): boolean {
  let found = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === "link")) {
      found = true;
      return false;
    }
    return !found;
  });
  if (found) return true;
  const $pos = view.state.doc.resolve(from);
  return $pos.marks().some((mark) => mark.type.name === "link");
}

function collectRangeFlags(view: TiptapEditorView, range: { $from: ResolvedPos; $to: ResolvedPos }) {
  const { $from, $to } = range;
  const flags = {
    inCodeBlock: false,
    inTable: false,
    inList: false,
    inBlockquote: false,
    inHeading: false,
  };

  for (let depth = $from.depth; depth >= 0; depth--) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === "codeBlock" || nodeName === "code_block") flags.inCodeBlock = true;
    if (TABLE_NODE_NAMES.has(nodeName)) flags.inTable = true;
    if (LIST_NODE_NAMES.has(nodeName)) flags.inList = true;
    if (nodeName === "blockquote") flags.inBlockquote = true;
    if (nodeName === "heading") flags.inHeading = true;
  }

  const inTextblock = Boolean($from.parent.isTextblock && $to.parent.isTextblock);
  const blockParentFrom = getBlockParentName($from);
  const blockParentTo = getBlockParentName($to);
  let blockParent = blockParentFrom && blockParentFrom === blockParentTo ? blockParentFrom : null;
  if (blockParent) {
    if (flags.inTable) blockParent = "table";
    else if (flags.inList) blockParent = "list";
    else if (flags.inBlockquote) blockParent = "blockquote";
    else if (flags.inHeading) blockParent = "heading";
  }
  const inLink = rangeHasLinkMark(view, $from.pos, $to.pos);
  const inlineFlags = getInlineAtomFlags(view, $from.pos, $to.pos);

  return {
    ...flags,
    inTextblock,
    blockParent,
    inLink,
    inImage: inlineFlags.inImage,
    inInlineMath: inlineFlags.inInlineMath,
    inFootnote: inlineFlags.inFootnote,
  };
}

function createEmptyMultiSelectionContext(): MultiSelectionContext {
  return {
    enabled: false,
    reason: "none",
    inCodeBlock: false,
    inTable: false,
    inList: false,
    inBlockquote: false,
    inHeading: false,
    inLink: false,
    inInlineMath: false,
    inFootnote: false,
    inImage: false,
    inTextblock: false,
    sameBlockParent: true,
    blockParentType: null,
  };
}

export function getWysiwygMultiSelectionContext(
  view: TiptapEditorView | null,
  _context?: WysiwygContext | null
): MultiSelectionContext {
  if (!view) return createEmptyMultiSelectionContext();
  const selection = view.state.selection;
  if (!(selection instanceof MultiSelection) || selection.ranges.length <= 1) {
    return createEmptyMultiSelectionContext();
  }

  const ranges = selection.ranges;
  const flags = ranges.map((range) => collectRangeFlags(view, range));
  const blockParentType = flags[0]?.blockParent ?? null;
  const sameBlockParent = flags.every((flag) => flag.blockParent === blockParentType);

  return {
    enabled: true,
    reason: "multi",
    inCodeBlock: flags.some((flag) => flag.inCodeBlock),
    inTable: flags.some((flag) => flag.inTable),
    inList: flags.some((flag) => flag.inList),
    inBlockquote: flags.some((flag) => flag.inBlockquote),
    inHeading: flags.some((flag) => flag.inHeading),
    inLink: flags.some((flag) => flag.inLink),
    inInlineMath: flags.some((flag) => flag.inInlineMath),
    inFootnote: flags.some((flag) => flag.inFootnote),
    inImage: flags.some((flag) => flag.inImage),
    inTextblock: flags.every((flag) => flag.inTextblock),
    sameBlockParent,
    blockParentType,
  };
}

export function getSourceMultiSelectionContext(
  view: CodeMirrorView | null,
  context: SourceContext | null
): MultiSelectionContext {
  if (!view || !context) return createEmptyMultiSelectionContext();
  if (view.state.selection.ranges.length <= 1) {
    return createEmptyMultiSelectionContext();
  }

  const ranges = view.state.selection.ranges;
  const doc = view.state.doc;
  const rangeTypes = ranges.map((range) => classifySourceLine(doc.lineAt(range.from).text));
  const blockParentType = rangeTypes[0] ?? null;
  const sameBlockParent = rangeTypes.every((type) => type === blockParentType);

  const inCodeBlock = ranges.some((range) => isInsideCodeFence(doc, range.from));
  const inTable = rangeTypes.some((type) => type === "table") || Boolean(context.inTable);
  const inList = rangeTypes.some((type) => type === "list") || Boolean(context.inList);
  const inBlockquote = rangeTypes.some((type) => type === "blockquote") || Boolean(context.inBlockquote);
  const inHeading = rangeTypes.some((type) => type === "heading") || Boolean(context.inHeading);
  const inLink = Boolean(context.inLink);
  const inInlineMath = Boolean(context.inInlineMath);
  const inFootnote = Boolean(context.inFootnote);
  const inImage = Boolean(context.inImage);
  const inTextblock = !inCodeBlock;

  return {
    enabled: true,
    reason: "multi",
    inCodeBlock,
    inTable,
    inList,
    inBlockquote,
    inHeading,
    inLink,
    inInlineMath,
    inFootnote,
    inImage,
    inTextblock,
    sameBlockParent,
    blockParentType,
  };
}
