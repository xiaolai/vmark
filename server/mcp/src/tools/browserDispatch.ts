/**
 * Shared action dispatch for the two embedded-browser tools.
 *
 * Purpose: `browser` and `browser_read` each multiplex their verbs behind an
 * `action` enum. Both used to resolve it with a chain of `if (args.action ===
 * …)` blocks that mixed routing, validation, request construction and error
 * handling in one long function (audit rows #175 / #177). Routing now lives
 * here, once: a table keyed by action name, looked up by OWN key, with the
 * shared failure rendering wrapped around whichever handler runs.
 *
 * Key decisions:
 *   - Own-key lookup (`Object.hasOwn`), never a bare `table[action]`. A record
 *     inherits `constructor`, `toString`, `__proto__` from Object.prototype, so
 *     a bare index would resolve those names to functions and CALL them. The
 *     SDK's enum rejects them before a handler runs, but `callTool` performs no
 *     schema validation, so the table refuses them itself.
 *   - A table is typed `Record<Name, Handler>` over the tool's advertised
 *     action list, so a verb without a handler — or a handler without a verb —
 *     is a compile error, not a runtime `unknown action`.
 *   - `tabId` arrives PRE-VALIDATED from the tool (`readOptionalId`): a blank id
 *     was refused before dispatch, so no handler re-reads `args.tabId`.
 *   - The whole dispatch sits inside the try, as the old chains did, so even a
 *     throwing `String(action)` on an exotic value renders as an error result.
 *
 * @coordinates-with tools/browserActions.ts — the `browser` table
 * @coordinates-with tools/browserReadActions.ts — the `browser_read` table
 * @coordinates-with tools/browserResult.ts — renders a thrown bridge failure
 * @module tools/browserDispatch
 */
import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import type { ToolArgs } from './toolArgs.js';
import { toErrorResult } from './browserResult.js';

/** What every browser action handler receives. */
export interface BrowserActionContext {
  readonly server: VMarkMcpServer;
  /** The raw argument bag; `action` has been resolved, everything else is for the handler to check. */
  readonly args: ToolArgs;
  /** Validated by the tool before dispatch: absent means the focused tab. */
  readonly tabId: string | undefined;
}

/** One action: validate its arguments, send its request, render the result. */
export type BrowserActionHandler = (ctx: BrowserActionContext) => Promise<ToolCallResult>;

/** A tool's complete action table — exhaustive over its advertised names. */
export type BrowserActionTable<Name extends string> = Readonly<Record<Name, BrowserActionHandler>>;

/** Resolve an action by OWN key; inherited names and non-strings resolve to nothing. */
function handlerFor<Name extends string>(
  table: BrowserActionTable<Name>,
  action: unknown,
): BrowserActionHandler | undefined {
  if (typeof action !== 'string' || !Object.hasOwn(table, action)) return undefined;
  return table[action as Name];
}

/** Run `ctx.args.action` through `table`, rendering any failure the way both tools do. */
export async function dispatchBrowserAction<Name extends string>(
  table: BrowserActionTable<Name>,
  ctx: BrowserActionContext,
): Promise<ToolCallResult> {
  try {
    const handler = handlerFor(table, ctx.args.action);
    if (handler === undefined) {
      return VMarkMcpServer.errorResult(`unknown action: ${String(ctx.args.action)}`);
    }
    return await handler(ctx);
  } catch (error) {
    return toErrorResult(error);
  }
}
