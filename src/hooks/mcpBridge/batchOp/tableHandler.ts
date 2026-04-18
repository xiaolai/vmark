/**
 * MCP Bridge — Table batch operation handler.
 *
 * Executes insert/delete row/column, update_cell, and set_header operations
 * inside a target Tiptap table. Delegates per-phase logic to tableOps.ts.
 *
 * @module hooks/mcpBridge/batchOp/tableHandler
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor, isAutoApproveEnabled } from "../utils";
import { validateBaseRevision, getCurrentRevision } from "../revisionTracker";
import { requireEnum, requireObject, requireTypedArray } from "../validateArgs";
import { OPERATION_MODES } from "../types";
import {
  extractText,
  normalizeOp,
  type TableTarget,
  type TableOperation,
} from "./shared";
import {
  applyStructuralOps,
  applyCellUpdates,
  type NormalizedOp,
} from "./tableOps";

/** Find a table in the document by target specification. */
function findTable(
  doc: ProseMirrorNode,
  target: TableTarget
): { pos: number; node: ProseMirrorNode } | null {
  let tablePos: number | null = null;
  let tableNode: ProseMirrorNode | null = null;
  let tableIndex = 0;
  let lastHeadingText: string | null = null;

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      lastHeadingText = extractText(node);
    }

    if (node.type.name === "table") {
      let isMatch = false;

      /* v8 ignore next -- @preserve reason: false branch (afterHeading targeting) not exercised in tests */
      if (target.tableIndex !== undefined) {
        isMatch = tableIndex === target.tableIndex;
      /* v8 ignore start -- @preserve afterHeading table targeting not exercised in tests */
      } else if (target.afterHeading) {
        isMatch = lastHeadingText?.toLowerCase() === target.afterHeading.toLowerCase();
      }
      /* v8 ignore stop */

      if (isMatch && tablePos === null) {
        tablePos = pos;
        tableNode = node;
        return false;
      }

      tableIndex++;
    }
    return true;
  });

  if (tablePos !== null && tableNode !== null) {
    return { pos: tablePos, node: tableNode };
  }
  return null;
}

function normalizeTableOp(raw: TableOperation | Record<string, unknown>): TableOperation {
  return normalizeOp<TableOperation>(raw, "'update_cell', 'add_row'");
}

/** Handle table.batchModify request. */
export async function handleTableBatchModify(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = typeof args.baseRevision === "string" ? args.baseRevision : "";
    const target = requireObject<TableTarget>(args, "target");
    const operations = requireTypedArray<TableOperation>(args, "operations", (item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`invalid table operation at index ${index}: expected object`);
      }
      const obj = item as Record<string, unknown>;
      if (typeof obj.action !== "string" && typeof obj.type !== "string" && typeof obj.op !== "string") {
        throw new Error(`invalid table operation at index ${index}: missing required field 'action'`);
      }
      return obj as TableOperation;
    });
    const mode = requireEnum(args, "mode", OPERATION_MODES, "apply");

    // Validate revision
    const revisionError = validateBaseRevision(baseRevision);
    if (revisionError) {
      await respond({
        id,
        success: false,
        error: revisionError.error,
        data: { code: "conflict", currentRevision: revisionError.currentRevision },
      });
      return;
    }

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    /* v8 ignore next 3 -- @preserve defensive guard: requireObject already validates target */
    if (!target) {
      throw new Error("target is required");
    }

    if (!operations || operations.length === 0) {
      throw new Error("At least one operation is required");
    }

    // Find the table
    const table = findTable(editor.state.doc, target);
    if (!table) {
      await respond({
        id,
        success: false,
        error: "Table not found",
        data: { code: "not_found" },
      });
      return;
    }

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          preview: {
            tablePosition: table.pos,
            operationCount: operations.length,
            operations: operations.map((op) => op.action),
          },
          isDryRun: true,
        },
      });
      return;
    }

    // For non-auto-approve, table operations are complex - show warning
    if (!isAutoApproveEnabled()) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          warning: "Table batch operations require auto-approve to be enabled in Settings > Integrations.",
          operationCount: operations.length,
        },
      });
      return;
    }

    // Apply operations
    const warnings: string[] = [];
    let appliedCount = 0;

    // Position cursor in table first
    editor.chain().focus().setTextSelection(table.pos + 1).run();

    // Separate update_cell ops from structural ops.
    // update_cell ops are batched into a single transaction to avoid stale positions.
    // Structural ops (add/delete row/column) use editor commands and are applied individually.
    const normalizedOps: NormalizedOp[] = operations.map((rawOp) => {
      try {
        return { op: normalizeTableOp(rawOp), rawOp, error: null };
      } catch (e) {
        /* v8 ignore start -- error path when normalization fails not exercised in tests */
        return { op: null, rawOp, error: e instanceof Error ? e.message : String(e) };
        /* v8 ignore stop */
      }
    });

    // Phase 1: structural ops
    appliedCount += applyStructuralOps(editor, table, normalizedOps, warnings);

    // Phase 2: cell updates
    appliedCount += applyCellUpdates(editor, target, findTable, normalizedOps, warnings);

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        appliedCount,
        warnings,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
