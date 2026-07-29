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
 * A required free-form string — a filesystem path. Blank (or whitespace-only)
 * is refused; the value itself is forwarded byte-for-byte.
 */
export function readRequiredPath(value: unknown, field: string): ArgCheck<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  return { ok: true, value };
}
