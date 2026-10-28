/**
 * The workspace tool's actions — one handler each, keyed by action name.
 *
 * Key decisions:
 *   - The table is typed `Record<WorkspaceAction, …>`, so adding an action to
 *     `WORKSPACE_ACTIONS` without a handler fails the type check instead of
 *     falling through to "Invalid action".
 *   - A handler reads only its own arguments; the arguments every action
 *     shares (`tabId`, `windowLabel`, `kind`) are validated once by the
 *     registration callback and arrive as `common`.
 *   - Each action's request shape and refusal text are the ones the tool
 *     answered before the split; `workspace.test.ts` pins them.
 *
 * @coordinates-with tools/workspace.ts — registration, shared validation, dispatch
 */

import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import { readOptionalBoolean, readRequiredId, readRequiredPath } from './toolArgs.js';

/** The `open_workspace` approval envelope, attached to a bridge failure's
 *  `data`. Distinct from the browser envelope (no operation/url): opening a
 *  folder needs a one-shot human approval, surfaced so the AI asks and retries. */
export interface WorkspaceApprovalNeeded {
  needsApproval: true;
  folderPath: string;
}

/** Is `data` the open_workspace approval envelope? */
export function isWorkspaceApprovalNeeded(data: unknown): data is WorkspaceApprovalNeeded {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { needsApproval?: unknown; folderPath?: unknown };
  return d.needsApproval === true && typeof d.folderPath === 'string' && d.folderPath.length > 0;
}

export const WORKSPACE_ACTIONS = [
  'new',
  'open',
  'open_workspace',
  'save',
  'save_as',
  'close',
  'switch_tab',
  'focus_window',
] as const;

type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

/** The arguments every action shares, already validated. */
interface WorkspaceCommon {
  tabId: string | undefined;
  windowLabel: string | undefined;
  kind: string | undefined;
}

type ActionHandler = (
  server: VMarkMcpServer,
  args: Record<string, unknown>,
  common: WorkspaceCommon,
) => Promise<ToolCallResult>;

/** Send `request` and answer with its data. */
async function forward(server: VMarkMcpServer, request: Parameters<VMarkMcpServer['sendBridgeRequest']>[0]) {
  return VMarkMcpServer.successJsonResult(await server.sendBridgeRequest(request));
}

async function openWorkspace(server: VMarkMcpServer, args: Record<string, unknown>): Promise<ToolCallResult> {
  const folder = readRequiredPath(args.folderPath, 'folderPath');
  if (!folder.ok) return VMarkMcpServer.errorResult(folder.error);
  try {
    // windowLabel is deliberately NOT forwarded: the handler binds to the
    // window the request arrives on, because a client-supplied label could
    // show the approval prompt in one window while mutating another. Sending
    // it anyway advertised a parameter that silently did nothing.
    return await forward(server, { type: 'vmark.workspace.open_workspace', folderPath: folder.value });
  } catch (error) {
    // A refusal is a request for consent, not an ordinary error: the
    // approval envelope rides on error.data. Render it so the AI asks the
    // user and retries the SAME call, instead of surfacing a bare error it
    // cannot act on (Codex M11).
    const data = (error as { data?: unknown })?.data;
    if (isWorkspaceApprovalNeeded(data)) {
      return VMarkMcpServer.errorResult(
        `approval required to open workspace '${data.folderPath}'. ` +
          'Ask the user to approve opening this folder in VMark, then retry the SAME call. ' +
          'Do not retry until they have approved — a retry only re-raises the same request.',
      );
    }
    return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
  }
}

const WORKSPACE_ACTION_HANDLERS: Readonly<Record<WorkspaceAction, ActionHandler>> = {
  new: (server, _args, { kind, windowLabel }) => forward(server, { type: 'vmark.workspace.new', kind, windowLabel }),

  open: async (server, args, { windowLabel }) => {
    const path = readRequiredPath(args.filePath, 'filePath');
    if (!path.ok) return VMarkMcpServer.errorResult(path.error);
    return forward(server, { type: 'vmark.workspace.open', filePath: path.value, windowLabel });
  },

  open_workspace: (server, args) => openWorkspace(server, args),

  save: (server, _args, { tabId }) => forward(server, { type: 'vmark.workspace.save', tabId }),

  save_as: async (server, args, { tabId }) => {
    const target = readRequiredPath(args.filePath, 'filePath');
    if (!target.ok) return VMarkMcpServer.errorResult(target.error);
    return forward(server, { type: 'vmark.workspace.save_as', tabId, filePath: target.value });
  },

  close: async (server, args) => {
    const target = readRequiredId(args.tabId, 'tabId');
    if (!target.ok) return VMarkMcpServer.errorResult(target.error);
    // `force` discards unsaved work: a supplied non-boolean is refused, never read as false.
    const force = readOptionalBoolean(args.force, 'force');
    if (!force.ok) return VMarkMcpServer.errorResult(force.error);
    return forward(server, { type: 'vmark.workspace.close', tabId: target.value, force: force.value === true });
  },

  switch_tab: async (server, args) => {
    const target = readRequiredId(args.tabId, 'tabId');
    if (!target.ok) return VMarkMcpServer.errorResult(target.error);
    return forward(server, { type: 'vmark.workspace.switch_tab', tabId: target.value });
  },

  focus_window: async (server, args) => {
    const target = readRequiredId(args.windowLabel, 'windowLabel');
    if (!target.ok) return VMarkMcpServer.errorResult(target.error);
    return forward(server, { type: 'vmark.workspace.focus_window', windowLabel: target.value });
  },
};

/** The handler for `action`, or `undefined` for a name that is not one. */
export function workspaceActionHandler(action: unknown): ActionHandler | undefined {
  return typeof action === 'string' && Object.hasOwn(WORKSPACE_ACTION_HANDLERS, action)
    ? WORKSPACE_ACTION_HANDLERS[action as WorkspaceAction]
    : undefined;
}
