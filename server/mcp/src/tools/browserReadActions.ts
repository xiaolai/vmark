/**
 * The `browser_read` tool's action table (audit row #177).
 *
 * Purpose: one small handler per read action, joined by a table that
 * `browserDispatch.ts` routes through. The schema + registration — and the
 * read-only argument (`readOnlyHint: true`) — stay in `browserRead.ts`; this
 * file is the part that has to KEEP that promise, so every handler here leaves
 * the page, the tab and VMark as it found them. `console` never forwards a
 * `clear`; the drain lives on `browser` as `console_clear`.
 *
 * Key decisions:
 *   - `BROWSER_READ_ACTIONS` is the table's key list — a verb without a
 *     handler, or a handler without a verb, fails to compile. The tool schema's
 *     `action` enum in `browserRead.ts` is a separate LITERAL on purpose —
 *     `scripts/check-mcp-docs.mjs` reads it by regex and a derived enum blinds
 *     that gate silently — so the two lists are pinned equal, in order, by
 *     `browserReadActions.test.ts` rather than by derivation.
 *   - Each handler validates in the order the old chain did (`wait`: ticket
 *     then timeout; `wait_for`: timeout, then mode count, then `name`), so a
 *     call with several bad arguments still gets the same first refusal.
 *
 * @coordinates-with tools/browserRead.ts — the registration; its `action` enum mirrors BROWSER_READ_ACTIONS
 * @coordinates-with tools/browserDispatch.ts — the lookup + error rendering
 * @coordinates-with tools/browserArgs.ts — readTimeout
 * @module tools/browserReadActions
 */
import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import { RECOVERY } from '../utils/toolOutput.js';
import type { ToolArgs } from './toolArgs.js';
import { readOptionalId } from './toolArgs.js';
import { readTimeout } from './browserArgs.js';
import {
  dispatchBrowserAction,
  type BrowserActionContext,
  type BrowserActionTable,
} from './browserDispatch.js';

/** Every `browser_read` action, in the order the tool schema advertises them (pinned equal by test). */
export const BROWSER_READ_ACTIONS = [
  'read',
  'screenshot',
  'query',
  'extract',
  'console',
  'wait',
  'wait_for',
  'workflow_status',
] as const;

export type BrowserReadActionName = (typeof BROWSER_READ_ACTIONS)[number];

/** `read`: the ARIA snapshot of the tab. */
async function readSnapshot({ server, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const data = await server.sendBridgeRequest({ type: 'vmark.browser.read', tabId });
  return VMarkMcpServer.successJsonResult(data, RECOVERY.browserRead);
}

/** `extract`: the page as reader-mode Markdown. */
async function readExtract({ server, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.extract',
    ...(tabId === undefined ? {} : { tabId }),
  });
  return VMarkMcpServer.successJsonResult(data, RECOVERY.browserExtract);
}

/** `workflow_status`: the state of one run. */
async function readWorkflowStatus({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  if (typeof args.runId !== 'string' || args.runId === '') {
    return VMarkMcpServer.errorResult('workflow_status requires a `runId`');
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.workflow_status',
    ...(tabId === undefined ? {} : { tabId }),
    runId: args.runId,
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `query`: structured DOM detection by CSS selector. */
async function readQuery({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const selector = typeof args.selector === 'string' && args.selector.trim() ? args.selector : '';
  if (!selector) {
    return VMarkMcpServer.errorResult('query requires a non-empty CSS `selector`');
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.query',
    ...(tabId === undefined ? {} : { tabId }),
    selector,
    ...(typeof args.fields === 'object' && args.fields !== null ? { fields: args.fields } : {}),
  });
  return VMarkMcpServer.successJsonResult(data, RECOVERY.browserQuery);
}

/** `console`: the captured console buffer — read only, never drained from here. */
async function readConsole({ server, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.console',
    ...(tabId === undefined ? {} : { tabId }),
  });
  return VMarkMcpServer.successJsonResult(data, RECOVERY.browserConsole);
}

/** `wait`: an existing navigation ticket, without starting a navigation. */
async function readWait({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const ticket = readOptionalId(args.navigationId, 'navigationId');
  if (!ticket.ok) return VMarkMcpServer.errorResult(ticket.error);
  const navigationId = ticket.value;
  const wait = readTimeout(args.timeoutMs);
  if (!wait.ok) return VMarkMcpServer.errorResult(wait.error);
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.wait',
    ...(tabId === undefined ? {} : { tabId }),
    ...(navigationId === undefined ? {} : { navigationId }),
    ...(wait.value === undefined ? {} : { timeoutMs: wait.value }),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `wait_for`: poll until exactly one condition holds or the bound elapses. */
async function readWaitFor({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const wait = readTimeout(args.timeoutMs);
  if (!wait.ok) return VMarkMcpServer.errorResult(wait.error);
  const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref : undefined;
  const role = typeof args.role === 'string' && args.role.trim() ? args.role : undefined;
  const text = typeof args.text === 'string' && args.text.length > 0 ? args.text : undefined;
  const urlContains =
    typeof args.urlContains === 'string' && args.urlContains.length > 0 ? args.urlContains : undefined;
  const modes = [ref, role, text, urlContains].filter((v) => v !== undefined).length;
  if (modes !== 1) {
    return VMarkMcpServer.errorResult(
      'wait_for needs exactly one of: ref, role (+optional name), text, or urlContains',
    );
  }
  const name = typeof args.name === 'string' ? args.name : undefined;
  if (name !== undefined && role === undefined) {
    // A name qualifies a role; with any other mode it was silently ignored,
    // so the caller waited for something other than what they asked for.
    return VMarkMcpServer.errorResult('wait_for: `name` is only valid together with `role`');
  }
  const condition =
    ref !== undefined
      ? { ref }
      : role !== undefined
        ? { role, ...(name !== undefined ? { name } : {}) }
        : text !== undefined
          ? { text }
          : { urlContains };
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.wait_for',
    ...(tabId === undefined ? {} : { tabId }),
    ...condition,
    ...(wait.value === undefined ? {} : { timeoutMs: wait.value }),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `screenshot`: a JPEG image block, with the page URL as text. */
async function readScreenshot({ server, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const data = await server.sendBridgeRequest<{ url?: unknown; image?: unknown }>({
    type: 'vmark.browser.screenshot',
    ...(tabId === undefined ? {} : { tabId }),
  });
  // The bridge returns { url, image } where image is a base64 JPEG. Guard
  // the shape: a missing image would otherwise become an image content
  // block with `data: undefined`, which the client renders as broken.
  if (typeof data?.image !== 'string' || data.image.length === 0) {
    return VMarkMcpServer.errorResult('screenshot returned no image data');
  }
  const url = typeof data.url === 'string' ? data.url : 'the current page';
  return {
    success: true,
    content: [
      { type: 'text', text: `Screenshot of ${url}` },
      { type: 'image', data: data.image, mimeType: 'image/jpeg' },
    ],
  };
}

const handlers: BrowserActionTable<BrowserReadActionName> = {
  read: readSnapshot,
  screenshot: readScreenshot,
  query: readQuery,
  extract: readExtract,
  console: readConsole,
  wait: readWait,
  wait_for: readWaitFor,
  workflow_status: readWorkflowStatus,
};

/** Action → handler. Exhaustive by construction (see the header). */
export const BROWSER_READ_ACTION_HANDLERS = Object.freeze(handlers);

/** Run one `browser_read` tool action against the bridge. */
export function runBrowserReadAction(
  server: VMarkMcpServer,
  args: ToolArgs,
  tabId: string | undefined,
): Promise<ToolCallResult> {
  return dispatchBrowserAction(BROWSER_READ_ACTION_HANDLERS, { server, args, tabId });
}
