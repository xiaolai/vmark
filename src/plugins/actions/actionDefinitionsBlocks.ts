/**
 * Block action definitions — tables and inserts.
 *
 * Category slice of ACTION_DEFINITIONS — merged back together in
 * `actionDefinitions.ts` (the single source of truth consumers import).
 *
 * @coordinates-with actionDefinitions.ts — merges this slice into ACTION_DEFINITIONS
 * @coordinates-with types.ts — defines ActionDefinition
 * @module plugins/actions/actionDefinitionsBlocks
 */

import type { ActionDefinition } from "./types";

export const BLOCK_ACTIONS = {
  // === Tables ===
  insertTable: {
    id: "insertTable",
    label: "Insert Table",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addRowAbove: {
    id: "addRowAbove",
    label: "Add Row Above",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addRowBelow: {
    id: "addRowBelow",
    label: "Add Row Below",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addColLeft: {
    id: "addColLeft",
    label: "Add Column Left",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addColRight: {
    id: "addColRight",
    label: "Add Column Right",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  deleteRow: {
    id: "deleteRow",
    label: "Delete Row",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  deleteCol: {
    id: "deleteCol",
    label: "Delete Column",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  deleteTable: {
    id: "deleteTable",
    label: "Delete Table",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignLeft: {
    id: "alignLeft",
    label: "Align Left",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignCenter: {
    id: "alignCenter",
    label: "Align Center",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignRight: {
    id: "alignRight",
    label: "Align Right",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignAllLeft: {
    id: "alignAllLeft",
    label: "Align All Left",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignAllCenter: {
    id: "alignAllCenter",
    label: "Align All Center",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignAllRight: {
    id: "alignAllRight",
    label: "Align All Right",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  formatTable: {
    id: "formatTable",
    label: "Format Table",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },

  // === Inserts ===
  insertImage: {
    id: "insertImage",
    label: "Insert Image",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertVideo: {
    id: "insertVideo",
    label: "Insert Video",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAudio: {
    id: "insertAudio",
    label: "Insert Audio",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertFootnote: {
    id: "insertFootnote",
    label: "Insert Footnote",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertMath: {
    id: "insertMath",
    label: "Insert Math Block",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertDiagram: {
    id: "insertDiagram",
    label: "Insert Diagram",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertMarkmap: {
    id: "insertMarkmap",
    label: "Insert Mindmap",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertInlineMath: {
    id: "insertInlineMath",
    label: "Insert Inline Math",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertDetails: {
    id: "insertDetails",
    label: "Insert Collapsible Block",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertNote: {
    id: "insertAlertNote",
    label: "Insert Note",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertTip: {
    id: "insertAlertTip",
    label: "Insert Tip",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertWarning: {
    id: "insertAlertWarning",
    label: "Insert Warning",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertImportant: {
    id: "insertAlertImportant",
    label: "Insert Important",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertCaution: {
    id: "insertAlertCaution",
    label: "Insert Caution",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  horizontalLine: {
    id: "horizontalLine",
    label: "Horizontal Line",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
} satisfies Record<string, ActionDefinition>;
