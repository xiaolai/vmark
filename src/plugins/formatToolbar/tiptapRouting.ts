/**
 * Tiptap Toolbar Routing
 *
 * Maps toolbar intents to store actions for WYSIWYG mode.
 * Pure function - no side effects, no store access.
 */

import type { ToolbarIntent } from "@/plugins/toolbarContext/types";

/**
 * Routing result - describes what action to take.
 */
export type RoutingResult =
  | { action: "openCodeToolbar"; payload: { language: string; from: number; to: number } }
  | { action: "openMathToolbar"; payload: { from: number; to: number } }
  | { action: "openMergedToolbar"; payload: MergedToolbarPayload }
  | { action: "openToolbar"; payload: ToolbarPayload }
  | { action: "openHeadingToolbar"; payload: { level: number; nodePos?: number } }
  | { action: "openLinkPopup"; payload: { href: string; from: number; to: number } }
  | { action: "openImagePopup"; payload: { src: string; from: number; to: number } }
  | { action: "openFootnotePopup"; payload: { label: string; from: number; to: number } }
  | { action: "skip"; payload?: undefined };

interface MergedToolbarPayload {
  type: "table" | "list" | "blockquote";
  // Table-specific
  row?: number;
  col?: number;
  totalRows?: number;
  totalCols?: number;
  // List-specific
  listType?: "bullet" | "ordered" | "task";
  depth?: number;
}

interface ToolbarPayload {
  contextMode: "format" | "insert" | "insert-block";
  autoSelected?: boolean;
  selection?: { from: number; to: number; text: string };
}

/**
 * Route a toolbar intent to the appropriate store action.
 *
 * @param intent - Toolbar intent from resolveToolbarIntent()
 * @returns Routing result describing what action to take
 */
export function routeToolbarIntent(intent: ToolbarIntent): RoutingResult {
  switch (intent.type) {
    case "code":
      return {
        action: "openCodeToolbar",
        payload: {
          language: intent.info.language ?? "",
          from: intent.info.from,
          to: intent.info.to,
        },
      };

    case "blockMath":
      return {
        action: "openMathToolbar",
        payload: intent.info,
      };

    case "table":
      return {
        action: "openMergedToolbar",
        payload: {
          type: "table",
          row: intent.info.row,
          col: intent.info.col,
          totalRows: intent.info.totalRows,
          totalCols: intent.info.totalCols,
        },
      };

    case "list":
      return {
        action: "openMergedToolbar",
        payload: {
          type: "list",
          listType: intent.info.listType,
          depth: intent.info.depth,
        },
      };

    case "blockquote":
      return {
        action: "openMergedToolbar",
        payload: {
          type: "blockquote",
          depth: intent.info.depth,
        },
      };

    case "format":
      return {
        action: "openToolbar",
        payload: {
          contextMode: "format",
          autoSelected: intent.autoSelected,
          selection: intent.selection,
        },
      };

    case "link":
      return {
        action: "openLinkPopup",
        payload: {
          href: intent.info.href,
          from: intent.info.from,
          to: intent.info.to,
        },
      };

    case "image":
      return {
        action: "openImagePopup",
        payload: {
          src: intent.info.src,
          from: intent.info.from,
          to: intent.info.to,
        },
      };

    case "inlineMath":
      // Inline math: auto-select and show format toolbar
      return {
        action: "openToolbar",
        payload: {
          contextMode: "format",
          autoSelected: true,
          selection: {
            from: intent.info.contentFrom,
            to: intent.info.contentTo,
            text: "",
          },
        },
      };

    case "footnote":
      return {
        action: "openFootnotePopup",
        payload: {
          label: intent.info.label,
          from: intent.info.from,
          to: intent.info.to,
        },
      };

    case "heading":
      return {
        action: "openHeadingToolbar",
        payload: {
          level: intent.info.level,
          nodePos: intent.info.nodePos,
        },
      };

    case "insert":
      return {
        action: "openToolbar",
        payload: {
          contextMode: intent.contextMode === "insert-block" ? "insert-block" : "insert",
        },
      };

    case "none":
      return { action: "skip" };

    default: {
      // Exhaustive check
      void (intent satisfies never);
      return { action: "skip" };
    }
  }
}
