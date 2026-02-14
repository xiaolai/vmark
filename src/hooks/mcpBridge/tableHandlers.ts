/**
 * MCP Bridge — Table Operation Handlers
 *
 * Purpose: Table CRUD operations via MCP — insert table, delete table,
 *   modify table structure (add/delete rows and columns, cell content).
 *
 * @module hooks/mcpBridge/tableHandlers
 */

import { respond, getEditor } from "./utils";

/**
 * Handle table.insert request.
 * Creates a new table with specified rows and columns.
 */
export async function handleTableInsert(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const rows = args.rows as number;
    const cols = args.cols as number;
    const withHeaderRow = (args.withHeaderRow as boolean) ?? true;

    if (rows < 1) throw new Error("rows must be at least 1");
    if (cols < 1) throw new Error("cols must be at least 1");

    editor.commands.insertTable({ rows, cols, withHeaderRow });

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle table.delete request.
 */
export async function handleTableDelete(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.deleteTable();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

