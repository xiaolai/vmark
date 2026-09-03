/**
 * Browser tool action dispatch (WI-NB6.3) — split from `browser.ts` for the
 * file-size gate. The `browser` tool's schema + registration stay there; the
 * per-action branch table lives here. Same behaviour, one function.
 *
 * @coordinates-with server/mcp/src/tools/browser.ts — the registration
 * @module tools/browserActions
 */
import { VMarkMcpServer } from '../server.js';
import type { ToolArgs } from './toolArgs.js';
import {
  MAX_SCRIPT_BYTES,
  MAX_WAIT_MS,
  boundedTimeout,
  readProfile,
  withinScriptBytes,
} from './browserArgs.js';
import { toErrorResult } from './browserResult.js';

/** Run one `browser` tool action against the bridge. */
export async function runBrowserAction(
  server: VMarkMcpServer,
  args: ToolArgs,
  tabId: string | undefined,
): Promise<ReturnType<typeof VMarkMcpServer.successJsonResult>> {
    try {
      if (args.action === 'act') {
        const operation = typeof args.operation === 'string' ? args.operation : '';
        const role = typeof args.role === 'string' ? args.role : '';
        const name = typeof args.name === 'string' ? args.name : '';
        const ref = typeof args.ref === 'string' ? args.ref : '';
        if (!['click', 'type', 'scroll', 'key'].includes(operation)) {
          return VMarkMcpServer.errorResult("act operation must be 'click', 'type', 'scroll', or 'key'");
        }
        if (operation === 'scroll') {
          const hasRef = ref.trim().length > 0;
          const dy = typeof args.dy === 'number' && Number.isFinite(args.dy) ? args.dy : undefined;
          if (hasRef === (dy !== undefined)) {
            return VMarkMcpServer.errorResult('scroll requires exactly one of a `ref` (from read) or a numeric `dy` pixel delta');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.act',
            tabId,
            operation: 'scroll',
            ...(hasRef ? { ref } : { dy }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (operation === 'key') {
          const key = typeof args.key === 'string' && args.key.length > 0 ? args.key : '';
          if (!key) {
            return VMarkMcpServer.errorResult("act operation 'key' requires a non-empty `key` name (e.g. \"Enter\")");
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
      if (args.action === 'open') {
        if (typeof args.url !== 'string' || args.url.trim().length === 0) {
          return VMarkMcpServer.errorResult('url must be a non-empty string');
        }
        const wait = boundedTimeout(args.timeoutMs);
        if (args.timeoutMs !== undefined && wait === undefined) {
          return VMarkMcpServer.errorResult(`timeoutMs must be an integer from 1 to ${MAX_WAIT_MS}`);
        }
        // A supplied-but-invalid profile is refused, never dropped: silently
        // opening an anonymous tab loses the login the caller asked to reuse.
        const named = readProfile(args.profile);
        if (!named.ok) return VMarkMcpServer.errorResult(named.error);
        const profile = named.value;
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.open',
          url: args.url,
          ...(wait === undefined ? {} : { timeoutMs: wait }),
          ...(profile === undefined ? {} : { profile }),
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'navigate') {
        if (typeof args.url !== 'string' || args.url.trim().length === 0) {
          return VMarkMcpServer.errorResult('url must be a non-empty string');
        }
        const wait = boundedTimeout(args.timeoutMs);
        if (args.timeoutMs !== undefined && wait === undefined) {
          return VMarkMcpServer.errorResult(`timeoutMs must be an integer from 1 to ${MAX_WAIT_MS}`);
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.navigate',
          ...(tabId === undefined ? {} : { tabId }),
          url: args.url,
          ...(wait === undefined ? {} : { timeoutMs: wait }),
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'close') {
        if (tabId === undefined) {
          return VMarkMcpServer.errorResult('close requires the `tabId` of an AI-owned tab');
        }
        const data = await server.sendBridgeRequest({ type: 'vmark.browser.close', tabId });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'style') {
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
      if (args.action === 'execute_js') {
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
      if (args.action === 'session_save' || args.action === 'session_load') {
        const handle = typeof args.handle === 'string' && args.handle.trim() ? args.handle.trim() : '';
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(handle)) {
          return VMarkMcpServer.errorResult(`${args.action} requires a 'handle' matching [A-Za-z0-9._-] (1..128)`);
        }
        const data = await server.sendBridgeRequest({
          type: args.action === 'session_save' ? 'vmark.browser.session.save' : 'vmark.browser.session.load',
          ...(tabId === undefined ? {} : { tabId }),
          handle,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'console_clear') {
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.console',
          ...(tabId === undefined ? {} : { tabId }),
          clear: true,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'workflow_run') {
        if (typeof args.source !== 'string' || args.source.trim() === '') {
          return VMarkMcpServer.errorResult('workflow_run requires a non-empty `source`');
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.workflow_run',
          ...(tabId === undefined ? {} : { tabId }),
          source: args.source,
          ...(args.inputs !== undefined ? { inputs: args.inputs as Record<string, string> } : {}),
          ...(args.allowRepeat === true ? { allowRepeat: true } : {}),
          ...(typeof args.resumeRunId === 'string' && args.resumeRunId !== '' ? { resumeRunId: args.resumeRunId } : {}),
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'workflow_cancel') {
        if (typeof args.runId !== 'string' || args.runId === '') {
          return VMarkMcpServer.errorResult('workflow_cancel requires a `runId`');
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.workflow_cancel',
          ...(tabId === undefined ? {} : { tabId }),
          runId: args.runId,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'workflow_record') {
        if (args.recordOp !== 'start' && args.recordOp !== 'stop') {
          return VMarkMcpServer.errorResult("workflow_record requires recordOp 'start' or 'stop'");
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.workflow_record',
          ...(tabId === undefined ? {} : { tabId }),
          recordOp: args.recordOp,
          ...(typeof args.site === 'string' ? { site: args.site } : {}),
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      return VMarkMcpServer.errorResult(`unknown action: ${String(args.action)}`);
    } catch (error) {
      return toErrorResult(error);
    }
}
