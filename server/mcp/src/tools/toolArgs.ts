/**
 * Cross-tool argument guards.
 *
 * Purpose: the frontend resolvers test ids for truthiness (`if (tabIdArg)`),
 * so an EMPTY STRING means "use the focused tab / window". A caller that sent
 * `tabId: ""` — or a garbled non-string id, which the tools used to drop to
 * `undefined` — therefore had `document.write` replace and SAVE a document it
 * never named. Wrong-target writes are the worst failure this surface has, so
 * a supplied-but-invalid identifier is REFUSED here, never normalized away.
 *
 * Two layers, deliberately:
 *   - The Zod schemas carry the same rule (`z.string().trim().min(1)`), which
 *     is what the MCP SDK enforces before a handler ever runs.
 *   - These guards are the defensive half. `VMarkMcpServer.callTool` is also
 *     reachable directly (health check, tests, any future in-process caller)
 *     and performs no schema validation at all.
 *
 * Identifiers are trimmed; filesystem PATHS are not. A trailing space is legal
 * in a POSIX filename, so trimming a path would silently retarget the write —
 * the very class of bug this module exists to prevent.
 *
 * @coordinates-with tools/{document,selection,workflow,workspace,browser}.ts
 */

import { z } from 'zod';

/**
 * A tool handler's raw argument bag, before any guard has run.
 *
 * Lived in `server.ts` alongside a set of `getStringArg`/`requireNumberArg`
 * extractors that no tool ever called (they were deleted with the `windowId`
 * surface, audit 20260728 §4). The type itself is still used, so it moved to
 * the module that actually owns argument handling.
 */
export type ToolArgs = Record<string, unknown>;

/** A validated argument, or the refusal to send back to the caller. */
export type ArgCheck<T> = { ok: true; value: T } | { ok: false; error: string };

/** Zod for an optional identifier: absent, or non-blank after trimming. */
export function optionalIdSchema(description: string) {
  return z.string().trim().min(1).optional().describe(description);
}

/** Zod for an optional path: absent, or non-empty. Never trimmed. */
export function optionalPathSchema(description: string) {
  return z.string().min(1).optional().describe(description);
}

/** Zod for an optional optimistic-concurrency token: absent, or non-blank. */
export function optionalRevisionSchema(description: string) {
  return z.string().trim().min(1).optional().describe(description);
}

function blankIdError(field: string): string {
  return `${field} must be a non-empty string when provided — omit it to target the focused tab/window`;
}

/**
 * An optional identifier. Absent stays absent (the focused target); anything
 * supplied must be a non-blank string.
 */
export function readOptionalId(value: unknown, field: string): ArgCheck<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: blankIdError(field) };
  }
  return { ok: true, value: value.trim() };
}

/** A required identifier: a non-blank string. */
export function readRequiredId(value: unknown, field: string): ArgCheck<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

/**
 * An optional optimistic-concurrency token. Absent means "write
 * unconditionally"; anything SUPPLIED must be a non-blank string.
 *
 * Every tool used to write `typeof args.expected_revision === 'string' ? … :
 * undefined`, which converts a caller's mistake — a number, a null, an object,
 * a blank string — into exactly the value that DISABLES stale-write
 * protection. A guarded write silently became an unconditional one, and only
 * for callers that got it wrong (audit R2 #226/#231/#237). `callTool` is
 * reachable without schema validation, so the guard, not the schema, is what
 * holds.
 */
export function readOptionalRevision(value: unknown, field = 'expected_revision'): ArgCheck<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      ok: false,
      error: `${field} must be a non-empty revision string when provided — omit it to write unconditionally`,
    };
  }
  return { ok: true, value: value.trim() };
}

/**
 * An optional boolean flag. Absent stays absent (the tool's default); anything
 * SUPPLIED must be a real boolean.
 *
 * `args.save === false ? false : undefined` read every non-boolean as "use the
 * default", so a caller passing the STRING `"false"` — the natural mistake
 * from a shell or a JSON-ish client — got the disk write it was trying to
 * prevent (audit R2 #227).
 */
export function readOptionalBoolean(value: unknown, field: string): ArgCheck<boolean | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'boolean') {
    return { ok: false, error: `${field} must be true or false when provided (got ${typeof value})` };
  }
  return { ok: true, value };
}

/**
 * A required free-form string — a filesystem path. Blank (or whitespace-only)
 * is refused; the value itself is forwarded byte-for-byte.
 */
export function readRequiredPath(value: unknown, field: string): ArgCheck<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  return { ok: true, value };
}
