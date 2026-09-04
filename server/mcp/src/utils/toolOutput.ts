/**
 * Tool output construction: the single choke point for serialization,
 * the output bound, and structured content.
 *
 * Purpose (error results are bounded too — see `structuredErrorResult`, whose
 * message and record are capped separately, since a page-derived error could
 * otherwise grow to the bridge frame limit):
 * before this module the sidecar had NO output bound anywhere —
 * `document.read` serialized a whole document into one text block and shipped
 * it. The ecosystem convention is a ~25,000-token cap plus a steering message,
 * because a silent cut is worse than useless: the agent cannot distinguish a
 * truncated document from a short one, and writing back from a truncated read
 * destroys the unread remainder.
 *
 * Key decisions:
 *   - The bound is enforced in UTF-8 BYTES, not UTF-16 code units. Characters
 *     are not a proxy for tokens: `"汉".length` is 1 but the character costs
 *     3 bytes and roughly a whole token, so a chars-based cap let a CJK
 *     document run ~3x past the advertised limit. Bytes are what the wire
 *     carries and are within a small factor of tokens for every script.
 *   - The steering notice is paid for INSIDE the budget. Appending it after
 *     cutting to the limit — the first implementation — meant the response
 *     always exceeded the cap it advertised.
 *   - Truncation cuts on a CODE POINT boundary. `String.prototype.slice`
 *     bisects surrogate pairs, so an emoji (or any non-BMP character) landing
 *     on the cut point came out as a lone surrogate — mojibake in a payload
 *     the model is asked to reason about.
 *   - A truncated response is ONE envelope object, serialized into the text
 *     block and mirrored verbatim into `structuredContent`. The two channels
 *     used to disagree (partial JSON plus prose vs. a different notice
 *     object); clients feed both to the model, so disagreement is a bug.
 *   - Every truncation names a concrete way to get the rest. "Try again" is
 *     not a recovery path — the same call truncates at the same point.
 *
 * @coordinates-with server.ts (VMarkMcpServer.successJsonResult delegates here)
 * @coordinates-with tools/*.ts (per-action recovery hints, output schemas)
 */

import { z } from 'zod';
import type { ToolCallResult } from '../types.js';

/** Output budget in tokens — the ecosystem-conventional cap. */
export const MAX_OUTPUT_TOKENS = 25_000;

/**
 * Conservative UTF-8 bytes per token.
 *
 * 3 is the UTF-8 width of a CJK character, which is also ~1 token — the dense
 * case this app must handle. ASCII prose runs ~4 bytes/token, so English gets
 * headroom rather than an overrun. Emoji-dense text can still tokenize denser
 * than 3 bytes/token; short of shipping a tokenizer (a dependency this sidecar
 * will not take on) no character-side estimate closes that gap, and the notice
 * states the ratio so nobody reads the cap as exact.
 */
const BYTES_PER_TOKEN = 3;

/** Output budget in UTF-8 bytes, the unit actually enforced. */
export const MAX_OUTPUT_BYTES = MAX_OUTPUT_TOKENS * BYTES_PER_TOKEN;

/**
 * Recovery hints — how to get the data a truncated call could not return.
 *
 * Each is an instruction the agent can act on immediately. They are keyed by
 * the surface that can plausibly exceed the budget; everything else uses
 * `default`. A hint that cannot be followed is worse than none: it sends the
 * agent down a path that either does nothing or destroys data.
 */
export const RECOVERY = {
  default:
    'narrow the request so it returns less data — target a specific tabId, or ask for one part at a time.',
  documentRead:
    'do not write back from this read — the unread remainder would be destroyed. Use `selection.get` to work on the region the user has selected, or read the file from disk in ranges outside VMark and edit through `selection.set`.',
  selectionGet:
    'the selection itself exceeds the output budget — ask the user to select a smaller region, then call `selection.get` again.',
  sessionGetState:
    'session.get_state takes no arguments and has no pagination, so this call cannot be narrowed — the preview is all it can return. Work from the tab ids you can see, or ask the user to close windows/tabs and call again.',
  browserRead:
    'the ARIA snapshot of this page exceeds the output budget — use `browser_read` action `query` with a CSS selector to fetch only the elements you need.',
  browserQuery:
    'tighten the CSS `selector` so it matches fewer elements, and drop any `fields` (attributes/box/styles) you do not need.',
  browserExtract:
    'the extracted article exceeds the output budget — use `browser_read` action `query` with a CSS selector for the specific part you need, or `browser_read` action `read` for the structural snapshot.',
  browserConsole:
    'the captured console buffer is bigger than one response and `console` has no pagination, so there is no way to page to the rest. DO NOT drain it with `browser` action `console_clear` to get it: that returns the same oversized response AND discards every entry you never saw. Narrow the problem instead — reproduce the step you are debugging in a fresh tab so the buffer is small, or read the specific page state you need with `browser_read` action `query`. Use `console_clear` only once you have decided the unread entries do not matter and you want the next read to show only new output.',
  coherenceEdges:
    'this workspace has more non-fresh edges than fit in one response — resolve or waive the ones you can see, then call `coherence.edges` again.',
} as const;

/**
 * A truncated response, as both channels carry it.
 *
 * A type alias (not an interface) so it is assignable to the
 * `Record<string, unknown>` that `structuredContent` declares.
 */
type TruncationEnvelope = {
  truncated: true;
  truncation_note: string;
  bytes_total: number;
  bytes_shown: number;
  preview: string;
};

/**
 * The envelope as an MCP client sees it — spread into the output schema of any
 * tool that declares one, so a truncated response still validates and the
 * fields are documented rather than surprising.
 */
export const TRUNCATION_OUTPUT_SHAPE = {
  truncated: z.boolean().optional().describe('The response exceeded the output bound.'),
  truncation_note: z
    .string()
    .optional()
    .describe('What was cut and how to obtain the rest (truncated responses only).'),
  bytes_total: z.number().optional().describe('UTF-8 size of the full payload.'),
  bytes_shown: z.number().optional().describe('UTF-8 size of `preview`.'),
  preview: z
    .string()
    .optional()
    .describe('Leading slice of the payload, cut on a character boundary. Not valid JSON.'),
} as const;

/** UTF-8 size of a string — what the wire actually carries. */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Largest prefix of `buf` that fits `maxBytes` without bisecting a code point. */
function sliceBuffer(buf: Buffer, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (buf.length <= maxBytes) return buf.toString('utf8');
  // 0b10xxxxxx marks a UTF-8 continuation byte: cutting there splits a code
  // point (the surrogate-pair bug in string terms). Walk back to a lead byte.
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  const cut = buf.toString('utf8', 0, end);
  // A trailing zero-width joiner would leave a dangling emoji sequence.
  return cut.endsWith('\u200D') ? cut.slice(0, -1) : cut;
}

/**
 * Prefix of `text` fitting `maxBytes` UTF-8 bytes, cut on a code-point
 * boundary. Never emits a lone surrogate, so CJK, emoji, combining marks and
 * RTL text survive the cut intact.
 */
export function sliceUtf8(text: string, maxBytes: number): string {
  return sliceBuffer(Buffer.from(text, 'utf8'), maxBytes);
}

/** Serialize a payload the way every tool response does. */
function serialize(data: unknown): string {
  // JSON.stringify returns `undefined` (not a string) for undefined and for
  // functions/symbols — a naive caller then puts `text: undefined` in a
  // content block, which clients render as an empty message.
  return JSON.stringify(data, null, 2) ?? 'null';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function envelopeFor(
  preview: string,
  shown: number,
  total: number,
  limit: number,
  recovery: string,
): TruncationEnvelope {
  return {
    truncated: true,
    truncation_note:
      `=== [VMark MCP] OUTPUT TRUNCATED === The payload is ${total} UTF-8 bytes, over the ` +
      `${limit}-byte bound (~${MAX_OUTPUT_TOKENS} tokens at ~${BYTES_PER_TOKEN} bytes/token). ` +
      `\`preview\` holds the first ${shown} bytes, cut on a character boundary; it is a ` +
      `FRAGMENT and WILL NOT PARSE as JSON. ` +
      `DO NOT RETRY THIS CALL UNCHANGED — it truncates at the same point. ` +
      `To get the rest: ${recovery}`,
    bytes_total: total,
    bytes_shown: shown,
    preview,
  };
}

/** A payload after the output bound has been applied. */
export interface BoundedOutput {
  /** Text block contents: the payload, or the serialized envelope. */
  text: string;
  /** Present only when the bound bit. */
  envelope?: TruncationEnvelope;
}

/**
 * Apply the output bound.
 *
 * Under the bound the payload passes through untouched. Over it, the result is
 * a single envelope carrying as much of the payload as fits — the notice, the
 * JSON escaping of the preview, and the preview itself all charged against the
 * same budget, so the serialized envelope never exceeds `limit`.
 *
 * The one exception is a `limit` too small to hold the notice at all (a
 * pathological caller-supplied bound): the envelope still ships whole, because
 * an agent that cannot see WHY data is missing is worse off than one over budget.
 *
 * @param text     Serialized payload.
 * @param recovery Concrete instruction for obtaining the remainder.
 * @param limit    UTF-8 byte cap; defaults to {@link MAX_OUTPUT_BYTES}.
 */
export function applyOutputBound(
  text: string,
  recovery: string,
  limit: number = MAX_OUTPUT_BYTES,
): BoundedOutput {
  const buf = Buffer.from(text, 'utf8');
  const total = buf.length;
  if (total <= limit) return { text };

  // Measure candidates with `total` in the bytes_shown slot: it is the widest
  // value that slot can take, so the final envelope — which carries the real,
  // smaller count — can only be shorter. Measuring with the real count would
  // let a digit appear after the search and push the result past the budget.
  const fits = (preview: string) =>
    utf8ByteLength(serialize(envelopeFor(preview, total, total, limit, recovery))) <= limit;

  // Binary search the raw byte budget: JSON escaping expands the preview by an
  // amount that depends on its content (up to 6x for control characters), so
  // the escaped size cannot be derived from the raw size arithmetically.
  let lo = 0;
  let hi = total;
  let preview = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = sliceBuffer(buf, mid);
    if (fits(candidate)) {
      preview = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const envelope = envelopeFor(preview, utf8ByteLength(preview), total, limit, recovery);
  return { text: serialize(envelope), envelope };
}

/**
 * Successful tool result carrying a JSON text block, bounded in size.
 */
export function jsonResult(data: unknown, recovery: string = RECOVERY.default): ToolCallResult {
  const { text } = applyOutputBound(serialize(data), recovery);
  return { success: true, content: [{ type: 'text', text }] };
}

/**
 * Successful tool result carrying BOTH the JSON text block (spec back-compat —
 * clients that predate `structuredContent` still see the payload) and a
 * machine-readable `structuredContent` object.
 *
 * Only for tools that declare an `outputSchema`: the SDK rejects a non-error
 * result with an output schema and no structured content.
 *
 * When the bound bites, both channels carry the SAME envelope object.
 */
export function structuredJsonResult(
  data: unknown,
  recovery: string = RECOVERY.default,
): ToolCallResult {
  const { text, envelope } = applyOutputBound(serialize(data), recovery);
  return {
    success: true,
    content: [{ type: 'text', text }],
    structuredContent: envelope ?? (isPlainObject(data) ? data : { result: data }),
  };
}

