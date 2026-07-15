/**
 * Browser tool — read and act on the embedded browser tab (WI-2.5 / R5).
 *
 * Exposes the live embedded browser to AI clients: `read` returns an ARIA
 * snapshot of the current page (the driver's isolated-world eval); `act` clicks
 * or types by ARIA role + accessible name. `act` is gated by the user's scoped
 * standing grants on the VMark side — an ungranted operation comes back with
 * `needsApproval: true` (ask the user), and `upload` is never permitted.
 *
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-2.5.
 */

import { VMarkMcpServer } from '../server.js';
import type { ToolArgs } from '../server.js';
import { isNeedsApproval } from '../bridge/core-types.js';

/** Cap on a caller-supplied script / injected CSS. The app retains an approved
 *  payload verbatim and renders it in the approval dialog, so an untrusted client
 *  must not be able to stream unbounded payloads across the bridge. Kept in sync
 *  with `MAX_SCRIPT_BYTES` in `src/hooks/mcpBridge/v2/browserPower.ts`. */
const MAX_SCRIPT_BYTES = 64 * 1024;

/**
 * Turn a bridge failure into a tool result.
 *
 * An approval refusal is not an ordinary error — it is a request for human
 * consent. Render it so the AI can tell the user exactly what is being asked
 * for, and tell it not to just retry (a retry re-raises the same request).
 */
function toErrorResult(error: unknown) {
  const data = (error as { data?: unknown })?.data;
  if (isNeedsApproval(data)) {
    return VMarkMcpServer.errorResult(
      `approval required: '${data.operation}' on ${data.url}. ` +
        'Ask the user to approve this action in VMark, then try again. ' +
        'Do not retry until they have approved — a retry only re-raises the same request.',
    );
  }
  return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
}

function timeoutMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= 12_000 ? value : undefined;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string when provided`);
  }
  return value;
}

export function registerBrowserTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'browser',
      description:
        'Read and act on the embedded browser tab.\n\n' +
        'Actions:\n' +
        "- read: Return {url, snapshot} where snapshot is a flat ARIA tree [{role,name}] of the page's interactive/structural elements. Pass `tabId` to target a specific browser tab; omit to use the focused tab. Read before acting so you target elements by their real accessible name.\n" +
        '- act: Interact with the page. operation "click"|"type" target a stable {ref} from a prior read (precise) or ARIA {role, name} — a ref is only honored for an already-granted operation; if it may need approval use role+name so the user sees what they approve. operation "scroll" takes {ref} (scroll it into view) or {dy} (a pixel delta). operation "key" takes {key} (e.g. "Enter", "Escape", "Tab"), optional {ref} to target, and optional {modifiers:{ctrl,shift,alt,meta}}. scroll/key dispatch SYNTHETIC events, so a site gating on event.isTrusted may ignore them. All actions are gated by the user\'s standing grants: an un-granted operation returns success:false with data.needsApproval:true — surface that and wait rather than retrying. Upload is never permitted (an AI-chosen file upload is an exfiltration path).\n' +
        '- open: Create an AI-owned browser tab at an HTTP(S) URL and wait for its navigation.\n' +
        '- navigate: Navigate an AI-owned tab and wait for the returned navigation ticket.\n' +
        '- wait: Wait for an existing navigation ticket without starting a new navigation. All waits are bounded to 12 seconds.\n' +
        '- wait_for: Poll until a page condition holds or the timeout elapses — pass exactly one of {ref} (from a read), {role, name?}, or {text} (a substring of visible text). Returns {matched: true|false} so you can tell "found" from "timed out". Use it to make a flow deterministic (act → wait_for the result → read) instead of guessing. Bounded to 12 seconds.\n' +
        '- screenshot: Return a JPEG image of the tab\'s current rendering, so you can see layout and rendered state the ARIA tree does not name. Pass `tabId` to target a specific tab; omit for the focused tab. Read-class: allowed on an AI-owned tab; a human tab requires attachment.\n' +
        '- query: Structured DOM detection the ARIA snapshot cannot name (tables, JSON blobs, computed values). Args {tabId?, selector, fields?:{attributes,box,styles:[...]}}. Returns {count, elements:[{ref,tag,text,...}]}. Read-class.\n' +
        '- style: CSS manipulation — dismiss a blocking overlay, highlight a target. Args {tabId?, ref?|selector, set?:{prop:value}, addClasses?, removeClasses?, injectCss?}. Act-class (approval-gated).\n' +
        '- execute_js: Run an arbitrary script in the isolated content world (DOM + CSS, NOT the page\'s own JS globals) for what the structured verbs cannot express. Args {tabId?, script}. Approved PER CALL only (never remembered); the result is page-derived and UNTRUSTED — do not feed it back into an act as a target. Use query/style first; reach for this only when they cannot express the need.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'act', 'open', 'navigate', 'wait', 'wait_for', 'screenshot', 'query', 'style', 'execute_js'],
            description: 'The action to perform',
          },
          tabId: {
            type: 'string',
            description: 'Target browser tab id (from session.get_state). Omit to use the focused tab.',
          },
          operation: {
            type: 'string',
            enum: ['click', 'type', 'scroll', 'key'],
            description: 'The interaction to perform (act only).',
          },
          dy: {
            type: 'number',
            description: 'Vertical pixel delta for a delta scroll (act, operation=scroll, no ref).',
          },
          key: {
            type: 'string',
            description: 'Key name to press, e.g. "Enter", "Escape", "Tab" (act, operation=key).',
          },
          modifiers: {
            type: 'object',
            description: 'Optional keyboard modifiers {ctrl,shift,alt,meta} (act, operation=key).',
            properties: {
              ctrl: { type: 'boolean' },
              shift: { type: 'boolean' },
              alt: { type: 'boolean' },
              meta: { type: 'boolean' },
            },
          },
          role: {
            type: 'string',
            description: 'ARIA role of the target, e.g. button/link/textbox (act only).',
          },
          name: {
            type: 'string',
            description: 'Accessible name of the target element (act, role/name mode).',
          },
          ref: {
            type: 'string',
            description:
              'Stable element handle from a prior read (e.g. "e5"). The precise act target — used instead of role+name, and only for an already-granted operation (act only).',
          },
          selector: {
            type: 'string',
            description: 'CSS selector (query, style).',
          },
          fields: {
            type: 'object',
            description: 'Extra data per element: {attributes:bool, box:bool, styles:[cssProp,...]} (query only).',
          },
          set: {
            type: 'object',
            description: 'Inline style properties to set, {cssProp: value} (style only).',
          },
          addClasses: {
            type: 'array',
            items: { type: 'string' },
            description: 'Classes to add (style only).',
          },
          removeClasses: {
            type: 'array',
            items: { type: 'string' },
            description: 'Classes to remove (style only).',
          },
          injectCss: {
            type: 'string',
            description: 'CSS to inject as a <style> block — page-wide, NOT selector-scoped (style only).',
          },
          script: {
            type: 'string',
            description: 'Isolated-world script to run; must `return` a JSON-serializable value (execute_js only).',
          },
          text: {
            type: 'string',
            description: 'Text to type into the target (act, operation=type).',
          },
          url: {
            type: 'string',
            description: 'HTTP(S) destination (open/navigate only).',
          },
          navigationId: {
            type: 'string',
            description: 'Existing navigation ticket (wait only).',
          },
          timeoutMs: {
            type: 'integer',
            minimum: 1,
            maximum: 12000,
            description: 'Maximum wait in milliseconds (default 12000).',
          },
        },
        required: ['action'],
      },
    },
    async (args: ToolArgs) => {
      // tabId: omit → focused tab. If explicitly provided it must be a
      // non-blank string; a blank/garbled id must not silently fall through to
      // the active tab and read or mutate the wrong one.
      let tabId: string | undefined;
      try {
        tabId = optionalId(args.tabId, 'tabId');
      } catch (error) {
        return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
      }

      try {
        if (args.action === 'read') {
          const data = await server.sendBridgeRequest({ type: 'vmark.browser.read', tabId });
          return VMarkMcpServer.successJsonResult(data);
        }
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
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.open',
            url: args.url,
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'navigate') {
          if (typeof args.url !== 'string' || args.url.trim().length === 0) {
            return VMarkMcpServer.errorResult('url must be a non-empty string');
          }
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.navigate',
            ...(tabId === undefined ? {} : { tabId }),
            url: args.url,
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'wait') {
          let navigationId: string | undefined;
          try {
            navigationId = optionalId(args.navigationId, 'navigationId');
          } catch (error) {
            return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
          }
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.wait',
            ...(tabId === undefined ? {} : { tabId }),
            ...(navigationId === undefined ? {} : { navigationId }),
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'wait_for') {
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref : undefined;
          const role = typeof args.role === 'string' && args.role.trim() ? args.role : undefined;
          const text = typeof args.text === 'string' && args.text.length > 0 ? args.text : undefined;
          const modes = [ref, role, text].filter((v) => v !== undefined).length;
          if (modes !== 1) {
            return VMarkMcpServer.errorResult(
              'wait_for needs exactly one of: ref, role (+optional name), or text',
            );
          }
          const name = typeof args.name === 'string' ? args.name : undefined;
          const condition =
            ref !== undefined
              ? { ref }
              : role !== undefined
                ? { role, ...(name !== undefined ? { name } : {}) }
                : { text };
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.wait_for',
            ...(tabId === undefined ? {} : { tabId }),
            ...condition,
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'query') {
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
          if (typeof passthrough.injectCss === 'string' && passthrough.injectCss.length > MAX_SCRIPT_BYTES) {
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
          if (script.length > MAX_SCRIPT_BYTES) {
            return VMarkMcpServer.errorResult(`execute_js script exceeds the ${MAX_SCRIPT_BYTES}-byte limit`);
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.execute_js',
            ...(tabId === undefined ? {} : { tabId }),
            script,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'screenshot') {
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
        return VMarkMcpServer.errorResult(`unknown action: ${String(args.action)}`);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
