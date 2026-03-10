/**
 * Format composite tool — text formatting, block types, lists, and list batch ops.
 *
 * Merges former formatting.ts + blocks.ts + lists.ts + list part of batch-ops.ts.
 */

import {
  VMarkMcpServer,
  getWindowIdArg,
  validateNonNegativeInteger,
  requireStringArg,
  getStringArg,
} from '../server.js';
import type {
  BatchEditResult,
  OperationMode,
  ListTarget,
  ListOperation,
  BridgeRequest,
} from '../bridge/types.js';

const VALID_MARKS = ['bold', 'italic', 'code', 'strike', 'underline', 'highlight'] as const;
type MarkType = (typeof VALID_MARKS)[number];
function isValidMark(mark: string): mark is MarkType {
  return VALID_MARKS.includes(mark as MarkType);
}

const VALID_BLOCK_TYPES = ['paragraph', 'heading', 'codeBlock', 'blockquote'] as const;
type BlockType = (typeof VALID_BLOCK_TYPES)[number];
function isValidBlockType(type: string): type is BlockType {
  return VALID_BLOCK_TYPES.includes(type as BlockType);
}

const VALID_LIST_TYPES = ['bullet', 'ordered', 'task'] as const;
type ListType = (typeof VALID_LIST_TYPES)[number];
function isValidListType(type: string): type is ListType {
  return VALID_LIST_TYPES.includes(type as ListType);
}

export function registerFormatTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'format',
      description:
        'Text formatting, block types, lists, and list batch operations.\n\n' +
        'Actions:\n' +
        '- toggle: Toggle a mark on selection (param: mark)\n' +
        '- set_link: Set hyperlink on selection (params: href, title?)\n' +
        '- remove_link: Remove link at cursor\n' +
        '- clear: Clear all formatting from selection\n' +
        '- set_block_type: Set block type (params: blockType, level?, language?)\n' +
        '- insert_hr: Insert horizontal rule\n' +
        '- toggle_list: Toggle list type (param: listType)\n' +
        '- indent_list: Increase list item indentation\n' +
        '- outdent_list: Decrease list item indentation\n' +
        '- list_modify: Batch list operations (params: baseRevision, target, operations, mode?)',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: [
              'toggle', 'set_link', 'remove_link', 'clear',
              'set_block_type', 'insert_hr',
              'toggle_list', 'indent_list', 'outdent_list', 'list_modify',
            ],
          },
          mark: {
            type: 'string',
            enum: [...VALID_MARKS],
            description: 'Mark type (for toggle): bold, italic, code, strike, underline, highlight.',
          },
          href: { type: 'string', description: 'Link URL (for set_link).' },
          title: { type: 'string', description: 'Link title (for set_link).' },
          blockType: {
            type: 'string',
            enum: [...VALID_BLOCK_TYPES],
            description: 'Block type (for set_block_type).',
          },
          level: { type: 'number', description: 'Heading level 1-6 (for set_block_type with heading).' },
          language: { type: 'string', description: 'Code language (for set_block_type with codeBlock).' },
          listType: {
            type: 'string',
            enum: [...VALID_LIST_TYPES],
            description: 'List type (for toggle_list): bullet, ordered, task.',
          },
          baseRevision: { type: 'string', description: 'Document revision (for list_modify).' },
          target: {
            type: 'object',
            properties: {
              listId: { type: 'string', description: 'Match list by ID from AST' },
              selector: { type: 'string', description: 'CSS-like selector' },
              listIndex: { type: 'number', description: 'Match by document order (0-based)' },
            },
            description: 'List target (for list_modify).',
          },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['add_item', 'delete_item', 'update_item', 'toggle_check', 'reorder', 'set_indent'],
                  description: 'Operation type.',
                },
              },
              required: ['action'],
            },
            description: 'Array of list operations (for list_modify). Max 100.',
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
        case 'toggle':
          return handleToggle(server, windowId, args);
        case 'set_link':
          return handleSetLink(server, windowId, args);
        case 'remove_link':
          return handleRemoveLink(server, windowId);
        case 'clear':
          return handleClear(server, windowId);
        case 'set_block_type':
          return handleSetBlockType(server, windowId, args);
        case 'insert_hr':
          return handleInsertHr(server, windowId);
        case 'toggle_list':
          return handleToggleList(server, windowId, args);
        case 'indent_list':
          return handleIndentList(server, windowId);
        case 'outdent_list':
          return handleOutdentList(server, windowId);
        case 'list_modify':
          return handleListModify(server, windowId, args);
        default:
          return VMarkMcpServer.errorResult(`Unknown format action: ${action}`);
      }
    }
  );
}

// --- Inline Marks ---

async function handleToggle(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const mark = args.mark as string;
  if (!isValidMark(mark)) {
    return VMarkMcpServer.errorResult(
      `Invalid mark type: ${mark}. Valid marks: ${VALID_MARKS.join(', ')}`
    );
  }

  try {
    await server.sendBridgeRequest<null>({ type: 'format.toggle', mark, windowId });
    return VMarkMcpServer.successResult(`Toggled ${mark} formatting`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to toggle format: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSetLink(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const href = requireStringArg(args, 'href');
    const title = getStringArg(args, 'title');

    // Validate URL scheme to prevent javascript: and data: injection
    const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
    try {
      const url = new URL(href);
      if (!ALLOWED_SCHEMES.includes(url.protocol)) {
        return VMarkMcpServer.errorResult(
          `Unsupported URL scheme: ${url.protocol}. Allowed: ${ALLOWED_SCHEMES.join(', ')}`
        );
      }
    } catch {
      // Not a valid absolute URL — allow relative URLs and anchors (e.g. "#section", "./file.md")
    }

    await server.sendBridgeRequest<null>({ type: 'format.setLink', href, title, windowId });
    return VMarkMcpServer.successResult(`Link set: ${href}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to set link: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleRemoveLink(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'format.removeLink', windowId });
    return VMarkMcpServer.successResult('Link removed');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to remove link: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleClear(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'format.clear', windowId });
    return VMarkMcpServer.successResult('Formatting cleared');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to clear formatting: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Block Types ---

async function handleSetBlockType(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const blockType = args.blockType as string;
  const level = args.level as number | undefined;
  const language = args.language as string | undefined;

  if (!isValidBlockType(blockType)) {
    return VMarkMcpServer.errorResult(
      `Invalid block type: ${blockType}. Valid types: ${VALID_BLOCK_TYPES.join(', ')}`
    );
  }

  if (blockType === 'heading') {
    if (level === undefined) {
      return VMarkMcpServer.errorResult('level is required for heading type');
    }
    const levelError = validateNonNegativeInteger(level, 'level');
    if (levelError) return VMarkMcpServer.errorResult(levelError);
    if (level < 1 || level > 6) {
      return VMarkMcpServer.errorResult('level must be between 1 and 6');
    }
  }

  try {
    await server.sendBridgeRequest<null>({
      type: 'block.setType',
      blockType,
      level,
      language,
      windowId,
    });

    const description =
      blockType === 'heading'
        ? `heading level ${level}`
        : blockType === 'codeBlock' && language
          ? `code block (${language})`
          : blockType;
    return VMarkMcpServer.successResult(`Block type set to ${description}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to set block type: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleInsertHr(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'block.insertHorizontalRule', windowId });
    return VMarkMcpServer.successResult('Horizontal rule inserted');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert horizontal rule: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Lists ---

async function handleToggleList(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const listType = args.listType as string;
  if (!isValidListType(listType)) {
    return VMarkMcpServer.errorResult(
      `Invalid list type: ${listType}. Valid types: ${VALID_LIST_TYPES.join(', ')}`
    );
  }

  try {
    await server.sendBridgeRequest<null>({ type: 'list.toggle', listType, windowId });
    return VMarkMcpServer.successResult(`Toggled ${listType} list`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to toggle list: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleIndentList(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'list.increaseIndent', windowId });
    return VMarkMcpServer.successResult('List item indented');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to indent list item: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleOutdentList(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'list.decreaseIndent', windowId });
    return VMarkMcpServer.successResult('List item outdented');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to outdent list item: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- List Batch ---

async function handleListModify(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const baseRevision = requireStringArg(args, 'baseRevision');
    const target = args.target as ListTarget;
    const operations = args.operations as ListOperation[];
    const mode = (args.mode as OperationMode) ?? 'apply';

    if (!target || (target.listId === undefined && target.selector === undefined && target.listIndex === undefined)) {
      return VMarkMcpServer.errorResult('target must specify listId, selector, or listIndex');
    }
    if (!Array.isArray(operations) || operations.length === 0) {
      return VMarkMcpServer.errorResult('operations must be a non-empty array');
    }
    if (operations.length > 100) {
      return VMarkMcpServer.errorResult('Maximum 100 operations per list_modify');
    }

    const request: BridgeRequest = {
      type: 'list.batchModify',
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
      `Failed to modify list: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
