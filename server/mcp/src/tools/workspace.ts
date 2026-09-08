/**
 * Workspace tool — file and window lifecycle.
 *
 * Covers everything that is NOT in-document mutation: creating /
 * opening / saving / closing files, switching tabs, focusing windows.
 * The pruned MCP surface depends on these because the AI cannot
 * derive them from text round-trip alone.
 *
 * Origin: MCP pruning plan (2026-05-04, retired) WI-1.2.
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import {
  optionalIdSchema,
  optionalPathSchema,
  readOptionalId,
  readRequiredId,
  readRequiredPath,
} from './toolArgs.js';

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

export const WORKSPACE_TOOL = 'workspace' as const;

/**
 * The tab kinds `new` accepts — ONE list, read by the schema enum and by the
 * defensive guard below, so the two cannot disagree about what a kind is.
 */
export const WORKSPACE_TAB_KINDS = ['markdown', 'yaml-workflow'] as const;
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

export function registerWorkspaceTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: WORKSPACE_TOOL,
      title: 'VMark Workspace and Files',
      // `close` with force:true discards unsaved work and `save_as` writes to a
      // caller-chosen path, so this is the most dangerous non-browser tool in
      // the surface. Open-world because `open` / `open_workspace` / `save_as`
      // reach arbitrary local filesystem paths, not just buffers VMark owns.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      description:
        'File and window lifecycle. Use these for everything that is not in-document mutation: creating, opening, saving, closing files; switching tabs; focusing windows.\n\n' +
        'Actions:\n' +
        '- new: Create a new untitled tab. Args: {kind?, windowLabel?}. Returns {tabId}.\n' +
        '- open: Open a FILE from disk into a BACKGROUND tab — the user\'s visible tab and workspace do not change. Args: {filePath, windowLabel?}. Returns {tabId, workspaceInstanceId, activationChanged, workspaceSwitched}. Chain the returned tabId into document/selection calls; use switch_tab only when the user should SEE the tab.\n' +
        // The advertised result must be the result a client SEES. This said the
        // first call "returns {needsApproval: true}", which is the shape the
        // bridge answers with internally; the tool renders it as an ERROR whose
        // text asks for approval (deliberately — Codex M11), so a client
        // branching on the documented field found nothing and had to parse
        // prose it was never told to expect (audit R3 #241).
        '- open_workspace: Open a FOLDER as the active workspace (grants access to its file tree). Args: {folderPath}. NOTE: windowLabel is ignored here — the folder opens in the window the request arrives on, so the approval prompt and the open cannot land in different windows. REQUIRES USER APPROVAL: the first call FAILS with an error beginning "approval required to open workspace" and naming the folder; ask the user to approve it in VMark, then retry the SAME call to proceed. Do not retry before they have approved — a retry only re-raises the same request. A denied request keeps failing until re-approved.\n' +
        '- save: Save a tab to its existing path. Args: {tabId?}. Returns {filePath, revision}.\n' +
        '- save_as: Save a tab to a new path. Args: {tabId?, filePath}. Returns {revision}.\n' +
        '- close: Close a tab. Args: {tabId, force?}. Refuses to close a dirty tab unless `force: true`; returns {closed: false, reason: "DIRTY"} in that case.\n' +
        '- switch_tab: Activate a tab and make it VISIBLE — this may switch the user\'s active workspace context (disclosed via workspaceSwitched: true in the result; tell the user when it happens). Args: {tabId}. Returns {activated, workspaceSwitched, workspaceInstanceId, activeTabId}.\n' +
        '- focus_window: Focus a specific window. Args: {windowLabel}.',
      inputSchema: {
        action: z.enum(WORKSPACE_ACTIONS).describe('The action to perform'),
        tabId: optionalIdSchema('Target tab id (from session.get_state).'),
        // Paths are validated non-blank but NEVER trimmed: a trailing space is
        // a legal character in a POSIX filename, so trimming would retarget
        // the write — the same class of bug as a blank tabId.
        filePath: optionalPathSchema('`open` / `save_as` only — the file path to open or write.'),
        folderPath: optionalPathSchema(
          '`open_workspace` only — the folder to open as a workspace.',
        ),
        windowLabel: optionalIdSchema(
          'Target window (from session.get_state). Omit for the focused window.',
        ),
        kind: z
          .enum(WORKSPACE_TAB_KINDS)
          .optional()
          .describe('Hint for `new` (default: markdown).'),
        force: z
          .boolean()
          .optional()
          .describe('`close` only — discard a dirty tab without saving.'),
      },
    },
    async (args) => {
      const action = args.action;
      // Blank ids are falsy in the app's resolvers, where that reads as "the
      // focused tab/window" — `close` or `save_as` against a blank id acted on
      // whatever the user had in front of them, not on the named target.
      const tab = readOptionalId(args.tabId, 'tabId');
      if (!tab.ok) return VMarkMcpServer.errorResult(tab.error);
      const win = readOptionalId(args.windowLabel, 'windowLabel');
      if (!win.ok) return VMarkMcpServer.errorResult(win.error);
      const tabId = tab.value;
      const windowLabel = win.value;
      // A SUPPLIED but invalid `kind` is refused, never normalised away. The
      // `typeof === 'string' ? … : undefined` form converted a caller's mistake
      // — a number, a null, or the string "md" — into exactly the value that
      // means "use the default", so `new` silently created a Markdown tab for a
      // caller who asked for something else. `VMarkMcpServer.callTool` runs no
      // schema validation, so the guard, not the enum, is what holds — the same
      // rule `readOptionalRevision`/`readOptionalBoolean` already carry
      // (audit R2 #226/#227, R3 #240).
      if (args.kind !== undefined && !(WORKSPACE_TAB_KINDS as readonly unknown[]).includes(args.kind)) {
        return VMarkMcpServer.errorResult(
          `kind must be one of ${WORKSPACE_TAB_KINDS.join(', ')} when provided (got ${JSON.stringify(args.kind)}) — omit it for the default`,
        );
      }
      const kind = args.kind as string | undefined;

      switch (action) {
        case 'new': {
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.new',
            kind,
            windowLabel,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'open': {
          const path = readRequiredPath(args.filePath, 'filePath');
          if (!path.ok) return VMarkMcpServer.errorResult(path.error);
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.open',
            filePath: path.value,
            windowLabel,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'open_workspace': {
          const folder = readRequiredPath(args.folderPath, 'folderPath');
          if (!folder.ok) return VMarkMcpServer.errorResult(folder.error);
          try {
            // windowLabel is deliberately NOT forwarded: the handler binds to
            // the window the request arrives on, because a client-supplied
            // label could show the approval prompt in one window while
            // mutating another. Sending it anyway advertised a parameter that
            // silently did nothing.
            const data = await server.sendBridgeRequest({
              type: 'vmark.workspace.open_workspace',
              folderPath: folder.value,
            });
            return VMarkMcpServer.successJsonResult(data);
          } catch (error) {
            // A refusal is a request for consent, not an ordinary error: the
            // approval envelope rides on error.data. Render it so the AI asks
            // the user and retries the SAME call, instead of surfacing a bare
            // error it cannot act on (Codex M11).
            const data = (error as { data?: unknown })?.data;
            if (isWorkspaceApprovalNeeded(data)) {
              return VMarkMcpServer.errorResult(
                `approval required to open workspace '${data.folderPath}'. ` +
                  'Ask the user to approve opening this folder in VMark, then retry the SAME call. ' +
                  'Do not retry until they have approved — a retry only re-raises the same request.',
              );
            }
            return VMarkMcpServer.errorResult(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        case 'save': {
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.save',
            tabId,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'save_as': {
          const target = readRequiredPath(args.filePath, 'filePath');
          if (!target.ok) return VMarkMcpServer.errorResult(target.error);
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.save_as',
            tabId,
            filePath: target.value,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'close': {
          const target = readRequiredId(args.tabId, 'tabId');
          if (!target.ok) return VMarkMcpServer.errorResult(target.error);
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.close',
            tabId: target.value,
            force: args.force === true,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'switch_tab': {
          const target = readRequiredId(args.tabId, 'tabId');
          if (!target.ok) return VMarkMcpServer.errorResult(target.error);
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.switch_tab',
            tabId: target.value,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'focus_window': {
          const target = readRequiredId(args.windowLabel, 'windowLabel');
          if (!target.ok) return VMarkMcpServer.errorResult(target.error);
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.focus_window',
            windowLabel: target.value,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        default:
          return VMarkMcpServer.errorResult(
            `Invalid action: ${String(action)}`,
          );
      }
    },
  );
}
