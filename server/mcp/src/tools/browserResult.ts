/**
 * Shared result rendering for the two embedded-browser tools.
 *
 * Both halves of the split surface can hit the same approval refusal — a read
 * against a human-owned tab needs attachment just as an `act` needs a grant —
 * so the renderer that turns that refusal into actionable prose lives here
 * rather than in either tool.
 *
 * Audit 2026-09-03 E-02: every non-approval failure used to be rendered as its
 * message alone, dropping the structured `data` the webview attached — the
 * navigation ticket a TIMEOUT still carries (so `wait` can retrieve it), an
 * act's `reason`/`by`/`matchedTotal`/`url`/`generation`, the retry verb an open
 * refused for approval names. The prose said those fields existed; the model
 * never saw them. Now every failure with data carries it in `structuredContent`
 * and, bounded, in the text.
 *
 * @coordinates-with tools/browser.ts (the mutating half)
 * @coordinates-with tools/browserRead.ts (the read-only half)
 */

import { VMarkMcpServer } from '../server.js';
import { isNeedsApproval } from '../bridge/core-types.js';
import { structuredErrorResult } from '../utils/errorOutput.js';

/** Longest JSON rendering of failure data appended to the error text. The full
 *  object always travels in `structuredContent`; this keeps the text readable. */
const MAX_INLINE_DATA_CHARS = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The verb the client should retry with after the user approves, if the
 *  webview named one (an `open` refused pending approval keeps its tab, and a
 *  fresh `open` would create a tab the tab-bound approval cannot cover). */
function retryHint(data: Record<string, unknown>): string {
  const retry = data.retry;
  if (isRecord(retry) && typeof retry.action === 'string' && typeof retry.tabId === 'string') {
    return (
      ` Once they have approved, retry with browser {action:"${retry.action}", tabId:"${retry.tabId}"}` +
      ' — a fresh open would create a new tab that the approval cannot cover.'
    );
  }
  return ' Once they have approved, try again.';
}

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
    // Spread into a plain record: `NeedsApproval` has no index signature, and
    // `structuredContent` wants one.
    const structured: Record<string, unknown> = { ...data };
    return structuredErrorResult(
      `approval required: '${data.operation}' on ${data.url}. ` +
        'Ask the user to approve this action in VMark and WAIT.' +
        retryHint(structured) +
        ' Do not retry before they have approved — a retry only re-raises the same request.',
      structured,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isRecord(data)) {
    let inline: string;
    try {
      inline = JSON.stringify(data);
    } catch {
      inline = '[unserializable data]';
    }
    if (inline.length > MAX_INLINE_DATA_CHARS) inline = `${inline.slice(0, MAX_INLINE_DATA_CHARS)}…`;
    return structuredErrorResult(`${message}\n${inline}`, data);
  }
  return VMarkMcpServer.errorResult(message);
}
