/**
 * The refusals a journaled mutation can answer, written once.
 *
 * Purpose: `document.write`, `selection.set` and `workflow.apply_patch` all
 * run the app's controlled-mutation protocol, so an agent can be refused by
 * any of them with the same codes. Each tool's description used to spell the
 * list out by hand, and the copies drifted (one lost REVIEW_BACKLOG_FULL, and
 * workflow said only "the same journal refusals"). All three now embed
 * `JOURNAL_REFUSALS`; `__tests__/unit/tools/journalRefusals.test.ts` pins the
 * code list to the codes the app's journal error mapping answers.
 *
 * @coordinates-with src/services/mcpBridge/v2/journalV2Error.ts (repo root) — the codes the app answers
 * @module tools/journalRefusals
 */

/** Every code a journaled mutation can be refused or aborted with; nothing changed when one is returned. */
export const JOURNAL_REFUSAL_CODES = [
  'JOURNAL_BUSY',
  'STALE_PARENT',
  'JOURNAL_DEGRADED',
  'JOURNAL_UNAVAILABLE',
  'INVALID_TEXT',
  'REVIEW_BACKLOG_FULL',
  'INVALID_ADDRESSES',
  'ABORTED',
] as const;

/** The description sentence naming each refusal and what to do about it. */
export const JOURNAL_REFUSALS =
  'Refusals that change nothing: JOURNAL_BUSY (another write to the document is being recorded — retry shortly), ' +
  'STALE_PARENT (another window wrote the document — re-read and retry), JOURNAL_DEGRADED, JOURNAL_UNAVAILABLE, ' +
  'INVALID_TEXT (lone UTF-16 surrogate), REVIEW_BACKLOG_FULL (too many unreviewed AI changes on the document — ask the user to review them; retrying will not help), ' +
  'INVALID_ADDRESSES (an `addresses` id is malformed, repeated, unknown, deleted, resolved or of another document, or there are more than 64 — list the comments again), ' +
  'and ABORTED with `reason` edited/closed/composing/selection/applyRefused (the first four: the user acted on the document while the write was being recorded — re-read and retry; applyRefused: the editor did not accept the content). ' +
  'An INTERNAL error with `applied: true` is not a refusal: the edit changed the document before the editor failed, and that text was recorded (`durable`, `current_revision`) — re-read before writing again.';
