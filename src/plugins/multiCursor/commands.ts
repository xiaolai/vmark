/**
 * Multi-cursor commands for ProseMirror — stable entry point.
 *
 * Commands for creating and managing multi-cursor selections:
 * - selectNextOccurrence: Add next match (Cmd+D)
 * - selectAllOccurrences: Select all matches (Cmd+Shift+L)
 * - skipOccurrence: Skip current match, take the next (Cmd+Shift+D)
 * - collapseMultiSelection: Collapse to single cursor (Escape)
 * - softUndoCursor: Revert last cursor addition (Cmd+Alt+Z)
 * - addCursorAbove / addCursorBelow: Add a cursor vertically (Cmd+Alt+Arrow)
 *
 * Implementations live in occurrenceCommands.ts (text-match commands) and
 * cursorCommands.ts (cursor-set commands); this file re-exports them so
 * importers keep a single stable path.
 */
export {
  selectNextOccurrence,
  selectAllOccurrences,
  skipOccurrence,
} from "./occurrenceCommands";
export {
  collapseMultiSelection,
  softUndoCursor,
  addCursorAbove,
  addCursorBelow,
} from "./cursorCommands";
