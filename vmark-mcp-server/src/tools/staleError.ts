/**
 * Bridge-refusal handling for the two tools that can be refused as STALE.
 *
 * Purpose: a STALE rejection is the one refusal an agent must BRANCH on rather
 * than read — it carries the `current_revision` needed to re-read and retry.
 * Everything else is prose the agent surfaces to the user.
 *
 * Key decisions:
 *   - The parsed envelope is attached as `structuredContent`. Without it the
 *     retry token arrived only inside a sentence, so the agent had to regex
 *     prose for the value its next call depends on.
 *   - Attaching it to an `isError` result is safe: the SDK skips output-schema
 *     validation for error results, so this cannot convert a refusal into a
 *     protocol error.
 *   - A refusal that is NOT STALE — or not JSON at all — passes through
 *     untouched. Guessing structure onto an arbitrary message would put
 *     invented fields in a channel the agent is supposed to trust.
 *   - `reread` names the action to retry with, because `document.write` and
 *     `selection.set` recover through different reads.
 *
 * @coordinates-with tools/document.ts, tools/selection.ts
 */

import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import { structuredErrorResult } from '../utils/toolOutput.js';

/** The bridge's structured refusals travel as a JSON string in `error`. */
function parseBridgeError(message: string): Record<string, unknown> | null {
  if (!message.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(message);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Turn a bridge failure into a tool result, keeping a STALE refusal machine-readable.
 *
 * @param error  The rejection thrown by `sendBridgeRequest`.
 * @param reread The read action that produces a fresh revision, e.g. `document.read`.
 */
export function bridgeErrorResult(error: unknown, reread: string): ToolCallResult {
  const message = error instanceof Error ? error.message : String(error);
  const parsed = parseBridgeError(message);
  if (parsed?.error !== 'STALE') return VMarkMcpServer.errorResult(message);
  const revision =
    typeof parsed.current_revision === 'string' ? parsed.current_revision : 'unknown';
  return structuredErrorResult(
    `STALE: the document changed since your last read (current_revision: ${revision}). ` +
      `Re-read with \`${reread}\` and retry with the new revision — do not write the ` +
      `stale content back. Bridge response: ${message}`,
    parsed,
  );
}
