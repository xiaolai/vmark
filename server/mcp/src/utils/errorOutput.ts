/**
 * errorOutput — the bounded error result.
 *
 * Purpose: an error result that also carries machine-readable detail, for
 * refusals an agent is expected to BRANCH on rather than read — a STALE write,
 * whose `current_revision` is the whole point of the response. The SDK skips
 * output-schema validation for `isError` results, so this cannot turn a refusal
 * into a protocol error.
 *
 * Bounded in BOTH channels (audit 2026-09-03 round 1): an error is small by
 * nature, but a page-derived message or record is not, and before this the
 * bridge frame limit was the only thing stopping it. An oversized or
 * unserializable record collapses to its branchable fields.
 *
 * @coordinates-with server/mcp/src/utils/toolOutput.ts — the shared byte bound
 * @module utils/errorOutput
 */
import type { ToolCallResult } from '../types.js';
import { sliceUtf8, utf8ByteLength } from './toolOutput.js';

export const MAX_ERROR_MESSAGE_BYTES = 8 * 1024;
export const MAX_ERROR_STRUCTURED_BYTES = 32 * 1024;

export function structuredErrorResult(
  message: string,
  structured: Record<string, unknown>,
): ToolCallResult {
  const text =
    utf8ByteLength(message) > MAX_ERROR_MESSAGE_BYTES
      ? `${sliceUtf8(message, MAX_ERROR_MESSAGE_BYTES)}… [error text truncated]`
      : message;
  let oversized = false;
  let unserializable = false;
  try {
    oversized = utf8ByteLength(JSON.stringify(structured)) > MAX_ERROR_STRUCTURED_BYTES;
  } catch {
    unserializable = true;
  }
  const structuredContent =
    oversized || unserializable
      ? {
          ...(oversized ? { truncated: true } : { unserializable: true }),
          ...(typeof structured.token === 'string' ? { token: structured.token } : {}),
          ...(typeof structured.code === 'string' ? { code: structured.code } : {}),
          ...(structured.needsApproval === true ? { needsApproval: true } : {}),
        }
      : structured;
  return {
    success: false,
    content: [{ type: 'text', text }],
    structuredContent,
    isError: true,
  };
}
