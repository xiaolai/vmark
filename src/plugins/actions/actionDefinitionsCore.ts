/**
 * Core action definitions — edit, formatting, links, headings, blockquote, code block, lists.
 *
 * Category slice of ACTION_DEFINITIONS — merged back together in
 * `actionDefinitions.ts` (the single source of truth consumers import).
 *
 * @coordinates-with actionDefinitions.ts — merges this slice into ACTION_DEFINITIONS
 * @coordinates-with types.ts — defines ActionDefinition
 * @module plugins/actions/actionDefinitionsCore
 */

import type { ActionDefinition } from "./types";

export const CORE_ACTIONS = {
  // === Edit ===
  undo: {
    id: "undo",
    label: "Undo",
    category: "edit",
    supports: { wysiwyg: true, source: true },
  },
  redo: {
    id: "redo",
    label: "Redo",
    category: "edit",
    supports: { wysiwyg: true, source: true },
  },

  // === Inline Formatting ===
  bold: {
    id: "bold",
    label: "Bold",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  italic: {
    id: "italic",
    label: "Italic",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  code: {
    id: "code",
    label: "Inline Code",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  strikethrough: {
    id: "strikethrough",
    label: "Strikethrough",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  underline: {
    id: "underline",
    label: "Underline",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  highlight: {
    id: "highlight",
    label: "Highlight",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  subscript: {
    id: "subscript",
    label: "Subscript",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  superscript: {
    id: "superscript",
    label: "Superscript",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  clearFormatting: {
    id: "clearFormatting",
    label: "Clear Formatting",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },

  // === Links ===
  link: {
    id: "link",
    label: "Link",
    category: "links",
    supports: { wysiwyg: true, source: true },
  },
  wikiLink: {
    id: "wikiLink",
    label: "Wiki Link",
    category: "links",
    supports: { wysiwyg: true, source: true },
  },
  bookmark: {
    id: "bookmark",
    label: "Bookmark",
    category: "links",
    supports: { wysiwyg: true, source: true },
  },

  // === Headings ===
  setHeading: {
    id: "setHeading",
    label: "Set Heading",
    category: "headings",
    supports: { wysiwyg: true, source: true },
    defaultParams: { level: 1 },
  },
  paragraph: {
    id: "paragraph",
    label: "Paragraph",
    category: "headings",
    supports: { wysiwyg: true, source: true },
  },
  increaseHeading: {
    id: "increaseHeading",
    label: "Increase Heading Level",
    category: "headings",
    supports: { wysiwyg: true, source: true },
  },
  decreaseHeading: {
    id: "decreaseHeading",
    label: "Decrease Heading Level",
    category: "headings",
    supports: { wysiwyg: true, source: true },
  },

  // === Blockquote ===
  blockquote: {
    id: "blockquote",
    label: "Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  nestBlockquote: {
    id: "nestBlockquote",
    label: "Nest Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  unnestBlockquote: {
    id: "unnestBlockquote",
    label: "Unnest Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  removeBlockquote: {
    id: "removeBlockquote",
    label: "Remove Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },

  // === Code Block ===
  codeBlock: {
    id: "codeBlock",
    label: "Code Block",
    category: "codeBlock",
    supports: { wysiwyg: true, source: true },
  },

  // === Lists ===
  bulletList: {
    id: "bulletList",
    label: "Bullet List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  orderedList: {
    id: "orderedList",
    label: "Ordered List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  taskList: {
    id: "taskList",
    label: "Task List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  indent: {
    id: "indent",
    label: "Indent",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  outdent: {
    id: "outdent",
    label: "Outdent",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  removeList: {
    id: "removeList",
    label: "Remove List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
} satisfies Record<string, ActionDefinition>;
