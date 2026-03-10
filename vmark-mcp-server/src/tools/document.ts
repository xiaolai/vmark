/**
 * Document composite tool — read/write content, mutations, paragraphs, and smart insert.
 *
 * Merges former document.ts + mutations.ts + paragraphs.ts + smart-insert.ts.
 */

import {
  VMarkMcpServer,
  getWindowIdArg,
  validateNonNegativeInteger,
  requireStringArg,
  requireStringArgAllowEmpty,
  getStringArg,
  getNumberArg,
  getBooleanArg,
  requireNumberArg,
} from '../server.js';
import type {
  SearchResult,
  ReplaceResult,
  EditResult,
  BatchEditResult,
  ApplyDiffResult,
  BlockQuery,
  OperationMode,
  MatchPolicy,
  TextAnchor,
  ParagraphTarget,
  ParagraphInfo,
  ParagraphOperation,
  WriteParagraphResult,
  SmartInsertDestination,
  SmartInsertResult,
  BridgeRequest,
} from '../bridge/types.js';

/** Validate a paragraph target. Returns error message or null if valid. */
function validateParagraphTarget(target: ParagraphTarget): string | null {
  if (!target || (target.index === undefined && !target.containing)) {
    return 'target must specify index or containing';
  }
  if (target.index !== undefined) {
    return validateNonNegativeInteger(target.index, 'target.index');
  }
  return null;
}

/** Parse destination string/object to SmartInsertDestination. */
function parseDestination(dest: unknown): SmartInsertDestination | null {
  if (typeof dest === 'string') {
    if (dest === 'end_of_document' || dest === 'start_of_document') return dest;
    return null;
  }
  if (typeof dest === 'object' && dest !== null) {
    const obj = dest as Record<string, unknown>;
    if ('after_paragraph' in obj && typeof obj.after_paragraph === 'number') {
      if (!Number.isFinite(obj.after_paragraph) || !Number.isInteger(obj.after_paragraph) || obj.after_paragraph < 0) return null;
      return { after_paragraph: obj.after_paragraph };
    }
    if ('after_paragraph_containing' in obj && typeof obj.after_paragraph_containing === 'string') {
      return { after_paragraph_containing: obj.after_paragraph_containing };
    }
    if ('after_section' in obj && typeof obj.after_section === 'string') {
      return { after_section: obj.after_section };
    }
  }
  return null;
}

export function registerDocumentTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'document',
      description:
        'Read, write, search, and transform document content.\n\n' +
        'Actions:\n' +
        '- get_content: Get full document as markdown\n' +
        '- set_content: Set full document (only on empty documents)\n' +
        '- insert_at_cursor: Insert text at cursor position\n' +
        '- insert_at_position: Insert text at character position\n' +
        '- search: Search for text (returns positions, line numbers)\n' +
        '- replace_in_source: Replace in raw markdown source\n' +
        '- batch_edit: Multiple operations in atomic transaction\n' +
        '- apply_diff: Smart find/replace with match policies\n' +
        '- replace_anchored: Drift-tolerant replacement using context anchors\n' +
        '- read_paragraph: Read paragraph by index or text match\n' +
        '- write_paragraph: Modify paragraph (replace/append/prepend/delete)\n' +
        '- smart_insert: Insert at common locations (start/end/after paragraph/after section)',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: [
              'get_content', 'set_content', 'insert_at_cursor', 'insert_at_position',
              'search', 'replace_in_source', 'batch_edit', 'apply_diff',
              'replace_anchored', 'read_paragraph', 'write_paragraph', 'smart_insert',
            ],
          },
          content: { type: 'string', description: 'Document/section content (for set_content, write_paragraph, smart_insert).' },
          text: { type: 'string', description: 'Text to insert (for insert_at_cursor, insert_at_position).' },
          position: { type: 'number', description: 'Character position (for insert_at_position).' },
          query: { type: 'string', description: 'Search text (for search).' },
          caseSensitive: { type: 'boolean', description: 'Case-sensitive search (for search, default false).' },
          search: { type: 'string', description: 'Text to find in markdown source (for replace_in_source).' },
          replace: { type: 'string', description: 'Replacement text (for replace_in_source).' },
          all: { type: 'boolean', description: 'Replace all occurrences (for replace_in_source).' },
          baseRevision: { type: 'string', description: 'Document revision (for mutations).' },
          requestId: { type: 'string', description: 'Idempotency key (for batch_edit).' },
          mode: { type: 'string', enum: ['apply', 'suggest', 'dryRun'], description: 'Only "dryRun" has effect (preview without applying). "apply"/"suggest" are accepted but ignored — apply-vs-suggest is controlled by user setting (autoApproveEdits).' },
          operations: { type: 'array', items: { type: 'object' }, description: 'Operation array (for batch_edit).' },
          scopeQuery: { type: 'object', description: 'Scope filter (for apply_diff).' },
          original: { type: 'string', description: 'Text to find (for apply_diff).' },
          replacement: { type: 'string', description: 'Replacement text (for apply_diff, replace_anchored).' },
          matchPolicy: {
            type: 'string',
            enum: ['first', 'all', 'nth', 'error_if_multiple'],
            description: 'Match handling (for apply_diff).',
          },
          nth: { type: 'number', description: 'Which occurrence (for apply_diff with nth policy).' },
          anchor: {
            type: 'object',
            description: 'Context anchor with text, beforeContext, afterContext, maxDistance (for replace_anchored).',
          },
          target: {
            type: 'object',
            description: 'Paragraph target: index or containing (for read/write_paragraph).',
          },
          includeContext: { type: 'boolean', description: 'Include surrounding paragraphs (for read_paragraph).' },
          operation: {
            type: 'string',
            enum: ['replace', 'append', 'prepend', 'delete'],
            description: 'Paragraph operation (for write_paragraph).',
          },
          destination: {
            description: 'Where to insert: "end_of_document", "start_of_document", or object (for smart_insert).',
          },
          windowId: { type: 'string', description: 'Optional window identifier.' },
        },
      },
    },
    async (args) => {
      const action = args.action as string;
      const windowId = getWindowIdArg(args);

      // dryRun is only supported by mutation actions
      const DRYRUN_ACTIONS = new Set([
        'batch_edit', 'apply_diff', 'replace_anchored', 'write_paragraph', 'smart_insert',
      ]);
      if (args.mode === 'dryRun' && !DRYRUN_ACTIONS.has(action)) {
        return VMarkMcpServer.errorResult(
          `dryRun mode is not supported for action "${action}". Supported: ${[...DRYRUN_ACTIONS].join(', ')}`
        );
      }

      switch (action) {
        case 'get_content':
          return handleGetContent(server, windowId);
        case 'set_content':
          return handleSetContent(server, windowId, args);
        case 'insert_at_cursor':
          return handleInsertAtCursor(server, windowId, args);
        case 'insert_at_position':
          return handleInsertAtPosition(server, windowId, args);
        case 'search':
          return handleSearch(server, windowId, args);
        case 'replace_in_source':
          return handleReplaceInSource(server, windowId, args);
        case 'batch_edit':
          return handleBatchEdit(server, windowId, args);
        case 'apply_diff':
          return handleApplyDiff(server, windowId, args);
        case 'replace_anchored':
          return handleReplaceAnchored(server, windowId, args);
        case 'read_paragraph':
          return handleReadParagraph(server, windowId, args);
        case 'write_paragraph':
          return handleWriteParagraph(server, windowId, args);
        case 'smart_insert':
          return handleSmartInsert(server, windowId, args);
        default:
          return VMarkMcpServer.errorResult(`Unknown document action: ${action}`);
      }
    }
  );
}

// --- Basic document operations ---

async function handleGetContent(server: VMarkMcpServer, windowId: string) {
  try {
    const content = await server.sendBridgeRequest<string>({
      type: 'document.getContent',
      windowId,
    });
    return VMarkMcpServer.successResult(content);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to get document content: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSetContent(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const content = requireStringArgAllowEmpty(args, 'content');
    const result = await server.sendBridgeRequest<{ message: string }>({
      type: 'document.setContent',
      content,
      windowId,
    });
    return VMarkMcpServer.successResult(result.message);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to set document content: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleInsertAtCursor(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const text = requireStringArgAllowEmpty(args, 'text');
    const result = await server.sendBridgeRequest<EditResult>({
      type: 'document.insertAtCursor',
      text,
      windowId,
    });
    return VMarkMcpServer.successJsonResult({
      message: result.message,
      position: result.position,
      suggestionId: result.suggestionId,
      applied: !result.suggestionId,
    });
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert at cursor: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleInsertAtPosition(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const text = requireStringArgAllowEmpty(args, 'text');
    const position = requireNumberArg(args, 'position');
    const positionError = validateNonNegativeInteger(position, 'position');
    if (positionError) return VMarkMcpServer.errorResult(positionError);

    const result = await server.sendBridgeRequest<EditResult>({
      type: 'document.insertAtPosition',
      text,
      position,
      windowId,
    });
    return VMarkMcpServer.successJsonResult({
      message: result.message,
      position: result.position,
      suggestionId: result.suggestionId,
      applied: !result.suggestionId,
    });
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert at position: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSearch(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const query = requireStringArg(args, 'query');
    const caseSensitive = getBooleanArg(args, 'caseSensitive') ?? false;
    const result = await server.sendBridgeRequest<SearchResult>({
      type: 'document.search',
      query,
      caseSensitive,
      windowId,
    });
    return VMarkMcpServer.successJsonResult(result);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to search document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleReplaceInSource(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const search = requireStringArg(args, 'search');
    const replace = requireStringArgAllowEmpty(args, 'replace');
    const all = getBooleanArg(args, 'all') ?? false;
    const result = await server.sendBridgeRequest<ReplaceResult>({
      type: 'document.replaceInSource',
      search,
      replace,
      all,
      windowId,
    });

    const message =
      result.message ??
      (result.count === 0
        ? 'No matches found'
        : `Replaced ${result.count} occurrence${result.count > 1 ? 's' : ''} in source`);
    return VMarkMcpServer.successJsonResult({
      count: result.count,
      message,
      suggestionIds: result.suggestionIds,
      applied: !result.suggestionIds || result.suggestionIds.length === 0,
    });
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to replace in source: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Mutation operations ---

async function handleBatchEdit(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const requestId = getStringArg(args, 'requestId');
    const mode = (args.mode as OperationMode) ?? 'apply';
    const operations = args.operations;

    if (!Array.isArray(operations) || operations.length === 0) {
      return VMarkMcpServer.errorResult('At least one operation is required');
    }
    if (operations.length > 100) {
      return VMarkMcpServer.errorResult('Maximum 100 operations per batch');
    }

    const result = await server.sendBridgeRequest<BatchEditResult>({
      type: 'mutation.batchEdit',
      baseRevision,
      requestId,
      mode,
      operations,
      windowId,
    });
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to execute batch edit: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleApplyDiff(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const scopeQuery = args.scopeQuery as BlockQuery | undefined;
    const original = requireStringArg(args, 'original');
    const replacement = requireStringArgAllowEmpty(args, 'replacement');
    const matchPolicy = (args.matchPolicy as MatchPolicy) ?? 'first';
    const nth = getNumberArg(args, 'nth');
    const mode = (args.mode as OperationMode) ?? 'apply';

    if (matchPolicy === 'nth' && nth === undefined) {
      return VMarkMcpServer.errorResult('nth parameter is required when matchPolicy is "nth"');
    }

    const result = await server.sendBridgeRequest<ApplyDiffResult>({
      type: 'mutation.applyDiff',
      baseRevision,
      scopeQuery,
      original,
      replacement,
      matchPolicy,
      nth,
      mode,
      windowId,
    });
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to apply diff: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleReplaceAnchored(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const anchor = args.anchor as TextAnchor;
    const replacement = requireStringArgAllowEmpty(args, 'replacement');
    const mode = (args.mode as OperationMode) ?? 'apply';

    if (!anchor || typeof anchor.text !== 'string' || !anchor.text) {
      return VMarkMcpServer.errorResult('anchor.text must be a non-empty string');
    }
    if (typeof anchor.beforeContext !== 'string' || typeof anchor.afterContext !== 'string') {
      return VMarkMcpServer.errorResult('anchor must include beforeContext and afterContext strings');
    }
    if (anchor.maxDistance !== undefined) {
      const distErr = validateNonNegativeInteger(anchor.maxDistance, 'anchor.maxDistance');
      if (distErr) return VMarkMcpServer.errorResult(distErr);
    }

    const result = await server.sendBridgeRequest<ApplyDiffResult>({
      type: 'mutation.replaceAnchored',
      baseRevision,
      anchor,
      replacement,
      mode,
      windowId,
    });
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to replace text: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Paragraph operations ---

async function handleReadParagraph(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const target = args.target as ParagraphTarget;
  const includeContext = getBooleanArg(args, 'includeContext') ?? false;

  const targetErr = validateParagraphTarget(target);
  if (targetErr) return VMarkMcpServer.errorResult(targetErr);

  try {
    const request: BridgeRequest = {
      type: 'paragraph.read',
      target,
      includeContext,
      windowId,
    };
    const result = await server.sendBridgeRequest<ParagraphInfo>(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to read paragraph: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleWriteParagraph(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const target = args.target as ParagraphTarget;
    const operation = args.operation as ParagraphOperation;
    const content = getStringArg(args, 'content');
    const mode = (args.mode as OperationMode) ?? 'apply';

    const VALID_OPERATIONS: ParagraphOperation[] = ['replace', 'append', 'prepend', 'delete'];
    if (!operation || !VALID_OPERATIONS.includes(operation)) {
      return VMarkMcpServer.errorResult(
        `Invalid operation: ${String(operation)}. Valid operations: ${VALID_OPERATIONS.join(', ')}`
      );
    }

    const targetErr = validateParagraphTarget(target);
    if (targetErr) return VMarkMcpServer.errorResult(targetErr);

    if (operation !== 'delete' && content === undefined) {
      return VMarkMcpServer.errorResult('content is required for non-delete operations');
    }

    const request: BridgeRequest = {
      type: 'paragraph.write',
      baseRevision,
      target,
      operation,
      content,
      mode,
      windowId,
    };
    const result = await server.sendBridgeRequest<WriteParagraphResult>(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to write paragraph: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Smart Insert ---

async function handleSmartInsert(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const content = requireStringArg(args, 'content');
    const mode = (args.mode as OperationMode) ?? 'apply';

    const destination = parseDestination(args.destination);
    if (!destination) {
      return VMarkMcpServer.errorResult(
        'Invalid destination. Use "end_of_document", "start_of_document", ' +
          '{ after_paragraph: <index> }, { after_paragraph_containing: "<text>" }, ' +
          'or { after_section: "<heading>" }'
      );
    }

    const request: BridgeRequest = {
      type: 'smartInsert',
      baseRevision,
      destination,
      content,
      mode,
      windowId,
    };
    const result = await server.sendBridgeRequest<SmartInsertResult>(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert content: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
