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
 * Zod for a script / CSS payload.
 *
 * `.max()` is kept because it is the only half a client can SEE (JSON Schema
 * has no byte-length keyword), and it is a valid necessary condition: a string
 * over 64 Ki code units is always over 64 KiB. The refinement is the exact
 * bound, and it runs in the SDK before the handler.
 */
export function scriptSchema(description: string) {
  return z
    .string()
    .max(MAX_SCRIPT_BYTES)
    .refine(withinScriptBytes, `exceeds the ${MAX_SCRIPT_BYTES}-byte limit`)
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
