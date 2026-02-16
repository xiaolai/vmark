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

    // Coerce to integer to guard against floating-point or string-ish values
    const intRows = Math.round(rows);
    const intCols = Math.round(cols);

    editor.commands.insertTable({ rows: intRows, cols: intCols, withHeaderRow });

    // Post-insertion validation: verify actual column count matches requested
    const warnings: string[] = [];
    const { selection } = editor.state;
    const $pos = selection.$from;
    // Walk up to find the table node we just inserted
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === "table" && node.firstChild) {
        const actualCols = node.firstChild.childCount;
        if (actualCols !== intCols) {
          warnings.push(
            `Column count mismatch: requested ${intCols}, got ${actualCols}. ` +
            `This may be a Tiptap bug — please report with reproduction steps.`
          );
        }
        break;
      }
    }

    await respond({
      id,
      success: true,
      data: {
        rows: intRows,
        cols: intCols,
        withHeaderRow,
        ...(warnings.length > 0 && { warnings }),
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

