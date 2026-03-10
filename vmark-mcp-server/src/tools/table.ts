/**
 * Table composite tool — insert, delete, and batch modify tables.
 *
 * Merges former tables.ts + table part of batch-ops.ts.
 */

import {
  VMarkMcpServer,
  getWindowIdArg,
  validateNonNegativeInteger,
  requireStringArg,
} from '../server.js';
import type {
  BatchEditResult,
  OperationMode,
  TableTarget,
  TableOperation,
  BridgeRequest,
} from '../bridge/types.js';

export function registerTableTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'table',
      description:
        'Table operations.\n\n' +
        'Actions:\n' +
        '- insert: Insert new table (params: rows, cols, withHeaderRow?)\n' +
        '- delete: Delete table at cursor\n' +
        '- modify: Batch table operations (params: baseRevision, target, operations, mode?)',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['insert', 'delete', 'modify'],
          },
          rows: { type: 'number', description: 'Number of rows (for insert, >= 1).' },
          cols: { type: 'number', description: 'Number of columns (for insert, >= 1).' },
          withHeaderRow: {
            type: 'boolean',
            description: 'Include header row (for insert, default true).',
          },
          baseRevision: { type: 'string', description: 'Document revision (for modify).' },
          target: {
            type: 'object',
            properties: {
              tableId: { type: 'string', description: 'Match table by ID from AST' },
              afterHeading: { type: 'string', description: 'Match first table under this heading' },
              tableIndex: { type: 'number', description: 'Match by document order (0-based)' },
            },
            description: 'Table target (for modify).',
          },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['add_row', 'delete_row', 'add_column', 'delete_column', 'update_cell', 'set_header'],
                  description: 'Operation type.',
                },
              },
              required: ['action'],
            },
            description: 'Array of table operations (for modify). Max 100.',
          },
          mode: {
            type: 'string',
            enum: ['apply', 'suggest', 'dryRun'],
            description: 'Only "dryRun" has effect (preview without applying). "apply"/"suggest" accepted but ignored — controlled by user setting.',
          },
          windowId: { type: 'string', description: 'Optional window identifier.' },
        },
      },
    },
    async (args) => {
      const action = args.action as string;
      const windowId = getWindowIdArg(args);

      switch (action) {
        case 'insert':
          return handleInsert(server, windowId, args);
        case 'delete':
          return handleDelete(server, windowId);
        case 'modify':
          return handleModify(server, windowId, args);
        default:
          return VMarkMcpServer.errorResult(`Unknown table action: ${action}`);
      }
    }
  );
}

async function handleInsert(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const rows = args.rows as number;
  const cols = args.cols as number;
  const withHeaderRow = (args.withHeaderRow as boolean) ?? true;

  const rowsError = validateNonNegativeInteger(rows, 'rows');
  if (rowsError) return VMarkMcpServer.errorResult(rowsError);
  if (rows < 1) return VMarkMcpServer.errorResult('rows must be at least 1');

  const colsError = validateNonNegativeInteger(cols, 'cols');
  if (colsError) return VMarkMcpServer.errorResult(colsError);
  if (cols < 1) return VMarkMcpServer.errorResult('cols must be at least 1');

  try {
    await server.sendBridgeRequest<null>({
      type: 'table.insert',
      rows,
      cols,
      withHeaderRow,
      windowId,
    });
    return VMarkMcpServer.successResult(`Table inserted (${rows}x${cols})`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert table: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleDelete(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'table.delete', windowId });
    return VMarkMcpServer.successResult('Table deleted');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to delete table: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleModify(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const target = args.target as TableTarget;
    const operations = args.operations as TableOperation[];
    const mode = (args.mode as OperationMode) ?? 'apply';

    if (!target || (target.tableId === undefined && target.afterHeading === undefined && target.tableIndex === undefined)) {
      return VMarkMcpServer.errorResult('target must specify tableId, afterHeading, or tableIndex');
    }
    if (!Array.isArray(operations) || operations.length === 0) {
      return VMarkMcpServer.errorResult('operations must be a non-empty array');
    }
    if (operations.length > 100) {
      return VMarkMcpServer.errorResult('Maximum 100 operations per table modify');
    }

    const request: BridgeRequest = {
      type: 'table.batchModify',
      baseRevision,
      target,
      operations,
      mode,
      windowId,
    };
    const result = await server.sendBridgeRequest<BatchEditResult>(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to modify table: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
