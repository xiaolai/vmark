/**
 * Workspace tool — file and window lifecycle.
 *
 * Covers everything that is NOT in-document mutation: creating /
 * opening / saving / closing files, switching tabs, focusing windows.
 * The pruned MCP surface depends on these because the AI cannot
 * derive them from text round-trip alone.
 *
 * Origin: the MCP pruning plan, whose decisions are recorded in
 * `.claude/adr/plans/20260504-mcp-pruning.md`.
 *
 * @coordinates-with tools/workspaceActions.ts — one handler per action
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import { optionalIdSchema, optionalPathSchema, readOptionalId } from './toolArgs.js';
import { WORKSPACE_ACTIONS, workspaceActionHandler } from './workspaceActions.js';

export { WORKSPACE_ACTIONS, isWorkspaceApprovalNeeded } from './workspaceActions.js';

export const WORKSPACE_TOOL = 'workspace' as const;

/**
 * The tab kinds `new` accepts — ONE list, read by the schema enum and by the
 * defensive guard below, so the two cannot disagree about what a kind is.
 */
export const WORKSPACE_TAB_KINDS = ['markdown', 'yaml-workflow'] as const;

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
        // prose it was never told to expect.
        '- open_workspace: Open a FOLDER as the active workspace (grants access to its file tree). Args: {folderPath}. NOTE: windowLabel is ignored here — the folder opens in the window the request arrives on, so the approval prompt and the open cannot land in different windows. REQUIRES USER APPROVAL: the first call FAILS with an error beginning "approval required to open workspace" and naming the folder; ask the user to approve it in VMark, then retry the SAME call to proceed. Do not retry before they have approved — a retry only re-raises the same request. A denied request keeps failing until re-approved.\n' +
        '- save: Save a tab to its existing path. Args: {tabId?}. Returns {filePath, revision, journaled}; journaled is "yes" | "pending" | "no" — whether VMark\'s agent edit journal recorded the saved text ("no" is still a saved file).\n' +
        '- save_as: Save a tab to a new path. Args: {tabId?, filePath}. Returns {revision, journaled}.\n' +
        '- close: Close a document tab. Args: {tabId, force?}. Without `force: true` it refuses a tab holding local content, returning {closed: false, reason: "DIRTY"} for unsaved changes or {closed: false, reason: "DIVERGENT"} for a clean document whose content the user kept over a change on disk — save first (save clears both) or pass force to discard. A pinned tab is never closed, force or not: {closed: false, reason: "PINNED"}; the user must unpin it. A browser tab is refused as INVALID_TAB — close it with the browser tool.\n' +
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
          .describe('`close` only — discard a dirty or divergent tab without saving.'),
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
      // rule `readOptionalRevision`/`readOptionalBoolean` already carry.
      if (args.kind !== undefined && !(WORKSPACE_TAB_KINDS as readonly unknown[]).includes(args.kind)) {
        return VMarkMcpServer.errorResult(
          `kind must be one of ${WORKSPACE_TAB_KINDS.join(', ')} when provided (got ${JSON.stringify(args.kind)}) — omit it for the default`,
        );
      }
      const kind = args.kind as string | undefined;

      const handler = workspaceActionHandler(action);
      if (!handler) return VMarkMcpServer.errorResult(`Invalid action: ${String(action)}`);
      return handler(server, args, { tabId, windowLabel, kind });
    },
  );
}
