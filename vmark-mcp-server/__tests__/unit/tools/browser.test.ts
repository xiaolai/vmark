// WI-2.5/R5 — the browser tool's approval path.
//
// A refused action is NOT an ordinary error: it is a request for human consent.
// The bridge failure carries a structured envelope ({needsApproval, operation,
// url}); the tool must turn that into actionable guidance for the AI, not an
// opaque throw. Before this, BridgeResponse forbade `data` on failure and
// sendBridgeRequest did `throw new Error(response.error)` — with no `error`
// field the AI received an EMPTY error and never learned consent was pending.
import { describe, it, expect, vi } from 'vitest';
import { isNeedsApproval } from '../../../src/bridge/core-types.js';

describe('isNeedsApproval', () => {
  it('recognizes the approval envelope', () => {
    expect(isNeedsApproval({ needsApproval: true, operation: 'click', url: 'https://a.com' })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isNeedsApproval(null)).toBe(false);
    expect(isNeedsApproval(undefined)).toBe(false);
    expect(isNeedsApproval({})).toBe(false);
    expect(isNeedsApproval({ needsApproval: false })).toBe(false);
    expect(isNeedsApproval('needsApproval')).toBe(false);
    // Truthy-but-not-true must not pass: authority is never inferred loosely.
    expect(isNeedsApproval({ needsApproval: 'yes' })).toBe(false);
  });
});

describe('registerBrowserTools — approval handling', () => {
  /** Minimal harness: capture the handler `registerBrowserTool` registers. */
  async function harness(sendBridgeRequest: (req: unknown) => Promise<unknown>) {
    const { registerBrowserTool } = await import('../../../src/tools/browser.js');
    let handler!: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    const server = {
      registerTool: (_config: unknown, h: typeof handler) => {
        handler = h;
      },
      sendBridgeRequest: vi.fn(sendBridgeRequest),
    };
    registerBrowserTool(server as never);
    return { handler, server };
  }

  it('surfaces an approval request as actionable guidance, not an empty error', async () => {
    // The sidecar throws when the bridge reports failure; the approval envelope
    // rides on the thrown error.
    const { handler } = await harness(async () => {
      const err = new Error("approval required: 'click' on https://blog.example.com") as Error & {
        data?: unknown;
      };
      err.data = { needsApproval: true, operation: 'click', url: 'https://blog.example.com' };
      throw err;
    });

    const result = await handler({
      action: 'act',
      operation: 'click',
      role: 'button',
      name: 'Publish',
    });

    const text = result.content.map((c) => c.text).join('\n');
    // The AI must be able to tell the human WHAT is being asked for.
    expect(text).toContain('approval');
    expect(text).toContain('click');
    expect(text).toContain('https://blog.example.com');
    // And it must not look like a success.
    expect(result.isError).toBe(true);
  });

  it('still reports ordinary failures as errors', async () => {
    const { handler } = await harness(async () => {
      throw new Error('no active browser tab');
    });

    const result = await handler({ action: 'act', operation: 'click', role: 'button', name: 'X' });
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toContain('no active browser tab');
    expect(result.isError).toBe(true);
  });

  it('rejects an act with a missing role or name instead of targeting the first element', async () => {
    const { handler, server } = await harness(async () => ({}));
    const result = await handler({ action: 'act', operation: 'click', role: '', name: '' });
    expect(result.isError).toBe(true);
    expect(server.sendBridgeRequest).not.toHaveBeenCalled();
  });
});
