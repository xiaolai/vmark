// Audit rows #175 / #177 — the shared action dispatcher behind both browser tools.
//
// Routing used to be a chain of `if (args.action === …)` blocks inside each
// tool, mixed with validation, request construction and error handling. It is
// now ONE table lookup, so its own failure modes are tested once, here, against
// a synthetic table — independently of any real handler.
import { describe, it, expect } from 'vitest';
import { VMarkMcpServer } from '../../../src/server.js';
import {
  dispatchBrowserAction,
  type BrowserActionContext,
  type BrowserActionTable,
} from '../../../src/tools/browserDispatch.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

function ctx(args: Record<string, unknown>, tabId?: string): BrowserActionContext {
  // No handler here touches the server; the dispatcher only passes it through.
  return { server: {} as VMarkMcpServer, args, tabId };
}

const table: BrowserActionTable<'ping'> = {
  ping: async ({ args, tabId }) => VMarkMcpServer.successJsonResult({ got: args.payload, tabId }),
};

describe('dispatchBrowserAction — routing', () => {
  it('routes a known action to its handler, carrying the pre-validated tabId', async () => {
    const result = await dispatchBrowserAction(table, ctx({ action: 'ping', payload: 1, tabId: 'raw' }, 'b1'));

    expect(result.isError).toBeUndefined();
    // `tabId` is the value the TOOL validated, never the raw argument.
    expect(toolJson(result)).toEqual({ got: 1, tabId: 'b1' });
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'refuses the inherited key %s instead of calling Object.prototype',
    async (action) => {
      // A bare `table[action]` resolves these to functions and would CALL them.
      // The SDK enum rejects them upstream, but `callTool` skips schema
      // validation, so the table must refuse them itself.
      const result = await dispatchBrowserAction(table, ctx({ action }));

      expect(result.isError).toBe(true);
      expect(toolText(result)).toBe(`unknown action: ${action}`);
    },
  );

  it.each([
    { args: { action: 'teleport' }, rendered: 'teleport' },
    { args: { action: 42 }, rendered: '42' },
    { args: { action: null }, rendered: 'null' },
    { args: {}, rendered: 'undefined' },
  ])('names an unknown action $rendered exactly as the caller spelled it', async ({ args, rendered }) => {
    const result = await dispatchBrowserAction(table, ctx(args));

    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe(`unknown action: ${rendered}`);
  });
});

describe('dispatchBrowserAction — failure rendering', () => {
  it('keeps an approval envelope thrown by a handler as guidance, not an opaque error', async () => {
    const refusing: BrowserActionTable<'boom'> = {
      boom: async () => {
        const error = new Error('blocked') as Error & { data?: unknown };
        error.data = { needsApproval: true, operation: 'click', url: 'https://a.test' };
        throw error;
      },
    };

    const result = await dispatchBrowserAction(refusing, ctx({ action: 'boom' }));

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("approval required: 'click' on https://a.test");
    expect(result.structuredContent).toMatchObject({ needsApproval: true, operation: 'click' });
  });

  it('renders an ordinary throw as its message', async () => {
    const failing: BrowserActionTable<'boom'> = {
      boom: async () => {
        throw new Error('no active browser tab');
      },
    };

    const result = await dispatchBrowserAction(failing, ctx({ action: 'boom' }));

    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe('no active browser tab');
  });

  it('awaits the handler, so an async rejection is rendered rather than escaping', async () => {
    const rejecting: BrowserActionTable<'later'> = {
      later: () => Promise.reject(new Error('late failure')),
    };

    await expect(dispatchBrowserAction(rejecting, ctx({ action: 'later' }))).resolves.toMatchObject({
      isError: true,
    });
  });
});
