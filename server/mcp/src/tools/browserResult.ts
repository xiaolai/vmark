/**
 * Shared result rendering for the two embedded-browser tools.
 *
 * Both halves of the split surface can hit the same approval refusal — a read
 * against a human-owned tab needs attachment just as an `act` needs a grant —
 * so the renderer that turns that refusal into actionable prose lives here
 * rather than in either tool.
 *
 * @coordinates-with tools/browser.ts (the mutating half)
 * @coordinates-with tools/browserRead.ts (the read-only half)
 */

import { VMarkMcpServer } from '../server.js';
import { isNeedsApproval } from '../bridge/core-types.js';

/**
 * Turn a bridge failure into a tool result.
 *
 * An approval refusal is not an ordinary error — it is a request for human
 * consent. Render it so the AI can tell the user exactly what is being asked
 * for, and tell it not to just retry (a retry re-raises the same request).
 */
export function toErrorResult(error: unknown) {
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
