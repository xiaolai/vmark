/**
 * Argument guards for the `browser` tool.
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
 * @coordinates-with tools/browser.ts (sole consumer)
 * @coordinates-with src/hooks/mcpBridge/v2/browserPower.ts (the app-side twin
 *   of MAX_SCRIPT_BYTES — keep the number in sync)
 */

import { z } from 'zod';
import { utf8ByteLength } from '../utils/toolOutput.js';
import type { ArgCheck } from './toolArgs.js';

/** Cap on a caller-supplied script / injected CSS, in UTF-8 BYTES. */
export const MAX_SCRIPT_BYTES = 64 * 1024;

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

/** A wait bound: an integer 1..12000 ms, or undefined when omitted. */
export function boundedTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }
  return value >= 1 && value <= 12_000 ? value : undefined;
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
