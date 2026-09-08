/**
 * Argument guards for the two embedded-browser tools.
 *
 * Split out of `browser.ts` so the tool file stays dispatch-only, and so the
 * two guards the 2026-07-28 round-2 audit flagged can be unit-tested directly:
 *
 *   - The 64 KiB payload cap was enforced with `.length` and Zod's string
 *     `.max()`, both of which count UTF-16 CODE UNITS. A 30,000-character CJK
 *     script is 90,000 UTF-8 bytes — 1.4x the advertised cap — and the app
 *     retains an approved payload verbatim and renders it in a human approval
 *     dialog, so the cap is a real bound, not a formality.
 *   - An invalid `profile` was coerced to `undefined`, so `browser.open`
 *     proceeded WITHOUT the persistent context the caller asked for: the agent
 *     believes it is reusing a login and is quietly anonymous instead.
 *
 * @coordinates-with tools/browser.ts, tools/browserRead.ts (the schemas: scriptSchema, MAX_WAIT_MS)
 * @coordinates-with tools/browserActions.tab.ts (readTimeout, readProfile, withinScriptBytes)
 * @coordinates-with tools/browserReadActions.ts (readTimeout)
 * @coordinates-with src/services/mcpBridge/v2/browserHelpers.ts (the app-side twins
 *   of MAX_SCRIPT_BYTES and MAX_WAIT_MS — keep the numbers in sync)
 */

import { z } from 'zod';
import { utf8ByteLength } from '../utils/toolOutput.js';
import type { ArgCheck } from './toolArgs.js';

/** Cap on a caller-supplied script / injected CSS, in UTF-8 BYTES. */
export const MAX_SCRIPT_BYTES = 64 * 1024;

/**
 * The longest wait a browser action accepts, in ms — the app-side twin is
 * `MAX_WAIT_MS` in `src/services/mcpBridge/v2/browserHelpers.ts`. It sits below
 * the bridge's first 10 s deadline on purpose: a wait that outlived that
 * deadline tripped the bridge's wake-and-retry recovery on every slow page
 * (audit 2026-09-03). Keep the two numbers in sync.
 */
export const MAX_WAIT_MS = 9_000;

/** Named persistent contexts are filesystem-safe and short. */
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Is a payload within the byte cap? */
export function withinScriptBytes(value: string): boolean {
  return utf8ByteLength(value) <= MAX_SCRIPT_BYTES;
}

/**
 * Zod for an optional caller-supplied payload bounded at `MAX_SCRIPT_BYTES`.
 *
 * `.max()` is kept because it is the only half a client can SEE (JSON Schema
 * has no byte-length keyword), and it is a valid necessary condition: a string
 * over 64 Ki code units is always over 64 KiB. The refinement is the exact
 * bound, and it runs in the SDK before the handler.
 *
 * The bound is not about scripts. It is about what VMark DOES with an
 * approval-gated payload: it retains it verbatim and renders it in a human
 * approval dialog. Every other caller-supplied payload on this tool — the text
 * an `act` types, a workflow's `source`, a `style` map, a class list, a
 * workflow's `inputs` — reaches the same dialog by the same route and had NO
 * bound at all (audit R3 #208). One constant, one reason, applied to all of
 * them; a separate item-count cap is deliberately NOT invented here, because
 * the byte bound is the one that was measured and the one the approval surface
 * needs.
 */
export function boundedTextSchema(description: string) {
  return z
    .string()
    .max(MAX_SCRIPT_BYTES)
    .refine(withinScriptBytes, `exceeds the ${MAX_SCRIPT_BYTES}-byte limit`)
    .optional()
    .describe(description);
}

/** The script/CSS spelling of `boundedTextSchema` — same bound, named for its use. */
export function scriptSchema(description: string) {
  return boundedTextSchema(description);
}

/** Is a whole collection within the byte cap once serialized? */
function withinCollectionBytes(value: unknown): boolean {
  return utf8ByteLength(JSON.stringify(value) ?? '') <= MAX_SCRIPT_BYTES;
}

/** An optional array of bounded strings, itself bounded as a whole. */
export function boundedStringArraySchema(description: string) {
  return z
    .array(z.string().max(MAX_SCRIPT_BYTES))
    .refine(withinCollectionBytes, `exceeds the ${MAX_SCRIPT_BYTES}-byte limit`)
    .optional()
    .describe(description);
}

/** An optional string→string record of bounded values, itself bounded as a whole. */
export function boundedStringRecordSchema(description: string) {
  return z
    .record(z.string().max(MAX_SCRIPT_BYTES), z.string().max(MAX_SCRIPT_BYTES))
    .refine(withinCollectionBytes, `exceeds the ${MAX_SCRIPT_BYTES}-byte limit`)
    .optional()
    .describe(description);
}

/**
 * A navigable destination: HTTP(S) only, and no backslash.
 *
 * The advertised schema accepted ANY string while the description promised an
 * HTTP(S) destination, so a client's generated tooling could not see the
 * constraint and a `file:` or `javascript:` URL was a valid MCP request that
 * only failed several layers down (audit R3 #209). Rust remains AUTHORITATIVE
 * — `src-tauri/src/browser/navigation_policy.rs` and `ai_policy.rs` enforce the
 * same rule, including the backslash — and this is the necessary condition
 * stated where the client can read it, in the same shape `boundedTextSchema`
 * uses for the byte cap.
 */
export function isNavigableUrl(value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (value.includes('\\')) return false;
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export function urlSchema(description: string) {
  return z
    .string()
    .refine(isNavigableUrl, 'must be an http:// or https:// URL')
    .optional()
    .describe(description);
}

/**
 * An optional wait bound. Absent stays absent (the app applies its default);
 * anything supplied must be an integer 1..MAX_WAIT_MS.
 *
 * Answers an `ArgCheck` so that "omitted" and "invalid" are different values
 * and the refusal text has ONE home. Its predecessor answered
 * `number | undefined` for both, so every caller re-derived the difference and
 * re-spelled the refusal — four copies of one contract across open, navigate,
 * wait and wait_for (audit row #176).
 */
export function readTimeout(value: unknown): ArgCheck<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  // `Number.isInteger` is false for NaN and ±Infinity, so no separate finiteness test.
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_WAIT_MS) {
    return { ok: false, error: `timeoutMs must be an integer from 1 to ${MAX_WAIT_MS}` };
  }
  return { ok: true, value };
}

/**
 * An optional `profile`. Absent means an anonymous tab; supplied means the
 * caller wants a named persistent context and MUST get it or an error.
 */
export function readProfile(value: unknown): ArgCheck<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!PROFILE_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error:
        'profile must match [A-Za-z0-9._-] (1..64 chars). It was NOT dropped: opening an ' +
        'anonymous tab when a named session was requested would silently lose the login you asked to reuse.',
    };
  }
  return { ok: true, value: trimmed };
}
