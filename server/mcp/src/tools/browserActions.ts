/**
 * The `browser` tool's action table (WI-NB6.3; audit row #175).
 *
 * Purpose: map each advertised action to the one function that validates its
 * arguments and sends its bridge request. The schema + registration stay in
 * `browser.ts`; the handlers live in three slices by what they drive — the
 * page (`act`), the tab (`open` … `console_clear`), a workflow run — and this
 * file is the table that joins them.
 *
 * Key decisions:
 *   - `BROWSER_ACTIONS` is the table's key list: `BrowserActionTable<
 *     BrowserActionName>` fails to compile if a handler is missing or
 *     un-named. The tool schema's `action` enum in `browser.ts` is a separate
 *     LITERAL on purpose — `scripts/check-mcp-docs.mjs` reads it by regex and a
 *     derived enum blinds that gate silently — so the two lists are pinned
 *     equal, in order, by `browserActions.test.ts` rather than by derivation.
 *   - The table is frozen. Lookup, the prototype-key refusal and the failure
 *     rendering are `browserDispatch.ts`'s, shared with `browser_read`.
 *
 * @coordinates-with tools/browser.ts — the registration; its `action` enum mirrors BROWSER_ACTIONS
 * @coordinates-with tools/browserDispatch.ts — the lookup + error rendering
 * @coordinates-with tools/browserActions.act.ts, .tab.ts, .workflow.ts — the handlers
 * @module tools/browserActions
 */
import type { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import type { ToolArgs } from './toolArgs.js';
import { dispatchBrowserAction, type BrowserActionTable } from './browserDispatch.js';
import { runAct } from './browserActions.act.js';
import {
  runClose,
  runConsoleClear,
  runExecuteJs,
  runNavigate,
  runOpen,
  runSessionLoad,
  runSessionSave,
  runStyle,
} from './browserActions.tab.js';
import { runWorkflowCancel, runWorkflowRecord, runWorkflowRun } from './browserActions.workflow.js';

/** Every `browser` action, in the order the tool schema advertises them (pinned equal by test). */
export const BROWSER_ACTIONS = [
  'act',
  'open',
  'navigate',
  'close',
  'style',
  'execute_js',
  'session_save',
  'session_load',
  'console_clear',
  'workflow_run',
  'workflow_cancel',
  'workflow_record',
] as const;

export type BrowserActionName = (typeof BROWSER_ACTIONS)[number];

const handlers: BrowserActionTable<BrowserActionName> = {
  act: runAct,
  open: runOpen,
  navigate: runNavigate,
  close: runClose,
  style: runStyle,
  execute_js: runExecuteJs,
  session_save: runSessionSave,
  session_load: runSessionLoad,
  console_clear: runConsoleClear,
  workflow_run: runWorkflowRun,
  workflow_cancel: runWorkflowCancel,
  workflow_record: runWorkflowRecord,
};

/** Action → handler. Exhaustive by construction (see the header). */
export const BROWSER_ACTION_HANDLERS = Object.freeze(handlers);

/** Run one `browser` tool action against the bridge. */
export function runBrowserAction(
  server: VMarkMcpServer,
  args: ToolArgs,
  tabId: string | undefined,
): Promise<ToolCallResult> {
  return dispatchBrowserAction(BROWSER_ACTION_HANDLERS, { server, args, tabId });
}
