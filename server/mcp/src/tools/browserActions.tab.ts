/**
 * `browser` tab verbs — everything that drives one tab (audit row #175, one slice).
 *
 * Purpose: the handlers that create a tab (`open`), move or close it
 * (`navigate`, `close`), change its page (`style`, `execute_js`), snapshot or
 * restore its session (`session_save`, `session_load`), and drain its console
 * (`console_clear`). Each validates its own arguments — in the order the old
 * chain did, so a call with several bad arguments still gets the same first
 * refusal — and sends exactly one request.
 *
 * `open` is the one verb that IGNORES the tool's tabId: it creates the tab the
 * id would name. `close` is the one that REQUIRES it: an omitted id must never
 * close whatever the user happens to be looking at.
 *
 * @coordinates-with tools/browserActions.ts — the table these slot into
 * @coordinates-with tools/browserArgs.ts — readTimeout, readProfile, the byte cap
 * @module tools/browserActions.tab
 */
import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import { MAX_SCRIPT_BYTES, readProfile, readTimeout, withinScriptBytes } from './browserArgs.js';
import type { BrowserActionContext, BrowserActionHandler } from './browserDispatch.js';

/** `open`: a new AI-owned tab at `url`, optionally bounded and against a named profile. */
export async function runOpen({ server, args }: BrowserActionContext): Promise<ToolCallResult> {
  if (typeof args.url !== 'string' || args.url.trim().length === 0) {
    return VMarkMcpServer.errorResult('url must be a non-empty string');
  }
  const wait = readTimeout(args.timeoutMs);
  if (!wait.ok) return VMarkMcpServer.errorResult(wait.error);
  // A supplied-but-invalid profile is refused, never dropped: silently
  // opening an anonymous tab loses the login the caller asked to reuse.
  const named = readProfile(args.profile);
  if (!named.ok) return VMarkMcpServer.errorResult(named.error);
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.open',
    url: args.url,
    ...(wait.value === undefined ? {} : { timeoutMs: wait.value }),
    ...(named.value === undefined ? {} : { profile: named.value }),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `navigate`: drive an AI-owned tab to `url`, optionally bounded. */
export async function runNavigate({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  if (typeof args.url !== 'string' || args.url.trim().length === 0) {
    return VMarkMcpServer.errorResult('url must be a non-empty string');
  }
  const wait = readTimeout(args.timeoutMs);
  if (!wait.ok) return VMarkMcpServer.errorResult(wait.error);
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.navigate',
    ...(tabId === undefined ? {} : { tabId }),
    url: args.url,
    ...(wait.value === undefined ? {} : { timeoutMs: wait.value }),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `close`: an AI-owned tab, named explicitly — never the focused one by default. */
export async function runClose({ server, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  if (tabId === undefined) {
    return VMarkMcpServer.errorResult('close requires the `tabId` of an AI-owned tab');
  }
  const data = await server.sendBridgeRequest({ type: 'vmark.browser.close', tabId });
  return VMarkMcpServer.successJsonResult(data);
}

/** `style`: at least one CSS operation, with injected CSS under the byte cap. */
export async function runStyle({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref : undefined;
  const selector = typeof args.selector === 'string' && args.selector.trim() ? args.selector : undefined;
  const passthrough: Record<string, unknown> = {};
  for (const k of ['set', 'addClasses', 'removeClasses', 'injectCss']) {
    if (args[k] !== undefined) passthrough[k] = args[k];
  }
  if (Object.keys(passthrough).length === 0) {
    return VMarkMcpServer.errorResult('style requires one of: set, addClasses, removeClasses, injectCss');
  }
  if (typeof passthrough.injectCss === 'string' && !withinScriptBytes(passthrough.injectCss)) {
    return VMarkMcpServer.errorResult(`style injectCss exceeds the ${MAX_SCRIPT_BYTES}-byte limit`);
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.style',
    ...(tabId === undefined ? {} : { tabId }),
    ...(ref !== undefined ? { ref } : {}),
    ...(selector !== undefined ? { selector } : {}),
    ...passthrough,
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `execute_js`: a non-empty script under the byte cap. */
export async function runExecuteJs({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const script = typeof args.script === 'string' && args.script.trim() ? args.script : '';
  if (!script) {
    return VMarkMcpServer.errorResult('execute_js requires a non-empty `script` string');
  }
  // Bound the payload before it crosses the bridge — the app retains an
  // approved script verbatim and renders it in the approval dialog.
  if (!withinScriptBytes(script)) {
    return VMarkMcpServer.errorResult(`execute_js script exceeds the ${MAX_SCRIPT_BYTES}-byte limit`);
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.execute_js',
    ...(tabId === undefined ? {} : { tabId }),
    script,
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** The two session verbs differ only in name and wire type. */
function sessionVerb(action: 'session_save' | 'session_load'): BrowserActionHandler {
  const type = action === 'session_save' ? 'vmark.browser.session.save' : 'vmark.browser.session.load';
  return async ({ server, args, tabId }) => {
    const handle = typeof args.handle === 'string' && args.handle.trim() ? args.handle.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(handle)) {
      return VMarkMcpServer.errorResult(`${action} requires a 'handle' matching [A-Za-z0-9._-] (1..128)`);
    }
    const data = await server.sendBridgeRequest({
      type,
      ...(tabId === undefined ? {} : { tabId }),
      handle,
    });
    return VMarkMcpServer.successJsonResult(data);
  };
}

/** `session_save`: snapshot the tab's session into the keychain under `handle`. */
export const runSessionSave = sessionVerb('session_save');

/** `session_load`: restore a saved session by `handle` into the tab. */
export const runSessionLoad = sessionVerb('session_load');

/** `console_clear`: read AND drain — `clear: true` unconditionally, so a caller cannot get a silent no-op read. */
export async function runConsoleClear({ server, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.console',
    ...(tabId === undefined ? {} : { tabId }),
    clear: true,
  });
  return VMarkMcpServer.successJsonResult(data);
}
