/**
 * Block insert position helper.
 *
 * Purpose: computes where a new top-level block (alert, details, …) should be
 * inserted relative to the current selection. Shared by the alertBlock and
 * detailsBlock insert commands so the depth-aware calculation cannot drift
 * between them.
 *
 * Key decisions:
 *   - Depth-0 selections (AllSelection from Cmd+A, NodeSelection on a
 *     top-level node like an hr) would make `$from.end(0) + 1` exceed
 *     doc.content.size and throw — insert right after the selection at the
 *     top level instead.
 *
 * @coordinates-with alertBlock/tiptap.ts — insertAlertBlock command
 * @coordinates-with detailsBlock/tiptap.ts — insertDetailsBlock command
 * @module plugins/shared/blockInsertPos
 */

import type { Selection } from "@tiptap/pm/state";

/**
 * Position right after the block containing the selection head, or right
 * after the selection itself for depth-0 selections.
 */
export function blockInsertPos(selection: Selection): number {
  const { $from } = selection;
  return $from.depth > 0 ? $from.end($from.depth) + 1 : selection.$to.pos;
}
