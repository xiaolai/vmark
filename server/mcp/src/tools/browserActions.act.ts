/**
 * `browser` action `act` — interact with the page (audit row #175, one slice).
 *
 * Purpose: validate ONE act — its operation, its targeting mode, and the
 * payload that operation needs — then send exactly one `vmark.browser.act`.
 * Four operations, three request shapes: `scroll` (a ref OR a pixel delta),
 * `key` (a key name, optional ref and modifiers), and the targeted pair
 * `click`/`type` (a ref OR role+name; `type` also carries its text).
 *
 * Every refusal here is the last line before a live page is touched, and each
 * refuses rather than guesses — a blank target would act on the FIRST matching
 * element, a missing `text` would clear a field (see the comments in place).
 *
 * @coordinates-with tools/browserActions.ts — the table this slots into
 * @coordinates-with src/services/mcpBridge/v2/browserAct.ts — the app-side handler
 * @module tools/browserActions.act
 */
import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import type { BrowserActionContext } from './browserDispatch.js';

const ACT_OPERATIONS = ['click', 'type', 'scroll', 'key'] as const;
type ActOperation = (typeof ACT_OPERATIONS)[number];

function isActOperation(value: unknown): value is ActOperation {
  return typeof value === 'string' && (ACT_OPERATIONS as readonly string[]).includes(value);
}

/** A string argument, or '' when absent or not a string; callers test presence with `.trim()`. */
function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `act`: refuse an operation the tool does not advertise, then hand off by operation. */
export async function runAct(ctx: BrowserActionContext): Promise<ToolCallResult> {
  const operation = ctx.args.operation;
  if (!isActOperation(operation)) {
    return VMarkMcpServer.errorResult("act operation must be 'click', 'type', 'scroll', or 'key'");
  }
  switch (operation) {
    case 'scroll':
      return actScroll(ctx);
    case 'key':
      return actKey(ctx);
    default:
      return actTargeted(ctx, operation);
  }
}

/** `scroll`: a ref (scroll it into view) OR a numeric delta — exactly one. */
async function actScroll({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const ref = stringArg(args.ref);
  const hasRef = ref.trim().length > 0;
  const dy = typeof args.dy === 'number' && Number.isFinite(args.dy) ? args.dy : undefined;
  if (hasRef === (dy !== undefined)) {
    return VMarkMcpServer.errorResult(
      'scroll requires exactly one of a `ref` (from read) or a numeric `dy` pixel delta',
    );
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.act',
    tabId,
    operation: 'scroll',
    ...(hasRef ? { ref } : { dy }),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `key`: a non-empty key name, optionally targeted by ref, optionally with modifiers. */
async function actKey({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const ref = stringArg(args.ref);
  const key = typeof args.key === 'string' && args.key.length > 0 ? args.key : '';
  if (!key) {
    return VMarkMcpServer.errorResult(
      "act operation 'key' requires a non-empty `key` name (e.g. \"Enter\")",
    );
  }
  const modifiers =
    typeof args.modifiers === 'object' && args.modifiers !== null ? args.modifiers : undefined;
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.act',
    tabId,
    operation: 'key',
    key,
    ...(ref.trim() ? { ref } : {}),
    ...(modifiers !== undefined ? { modifiers } : {}),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `click` / `type`: one targeting mode, and `type` must say what to type. */
async function actTargeted(
  { server, args, tabId }: BrowserActionContext,
  operation: 'click' | 'type',
): Promise<ToolCallResult> {
  const role = stringArg(args.role);
  const name = stringArg(args.name);
  const ref = stringArg(args.ref);
  // Exactly one targeting mode: a precise {ref} (already-granted ops) or a
  // {role, name} pair. A blank of either would target the first matching
  // element — an unintended click or edit. Refuse rather than guess.
  const hasRef = ref.trim().length > 0;
  const hasRoleName = role.trim().length > 0 || name.trim().length > 0;
  if (hasRef && hasRoleName) {
    return VMarkMcpServer.errorResult('act takes either `ref` or `role`+`name`, not both');
  }
  if (!hasRef && !(role.trim() && name.trim())) {
    return VMarkMcpServer.errorResult('act requires a `ref` (from read) or both `role` and `name`');
  }
  // `type` MUST carry a text string. Omitting it previously reached the
  // frontend as missing data, was coerced to "", and cleared the target
  // field — an incomplete call silently destroying user data. An explicit
  // "" is still allowed (intentional clear); undefined is not.
  if (operation === 'type' && typeof args.text !== 'string') {
    return VMarkMcpServer.errorResult(
      "act operation 'type' requires a 'text' string (pass \"\" to intentionally clear the field)",
    );
  }
  const text = typeof args.text === 'string' ? args.text : undefined;
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.act',
    tabId,
    operation,
    ...(hasRef ? { ref } : { role, name }),
    ...(text !== undefined ? { text } : {}),
  });
  return VMarkMcpServer.successJsonResult(data);
}
