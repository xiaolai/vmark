/**
 * Multi-cursor plugin for WYSIWYG editor
 *
 * Provides VSCode/Sublime-style multi-cursor editing in Tiptap/ProseMirror.
 */

export { MultiSelection } from "./MultiSelection";
export {
  multiCursorPlugin,
  multiCursorPluginKey,
  type MultiCursorPluginState,
} from "./multiCursorPlugin";
export { createMultiCursorDecorations } from "./decorations";
export {
  selectNextOccurrence,
  selectAllOccurrences,
  collapseMultiSelection,
} from "./commands";
export { multiCursorKeymap } from "./keymap";
export { multiCursorExtension, type MultiCursorOptions } from "./tiptap";
export {
  handleMultiCursorInput,
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
  handleMultiCursorArrow,
  handleMultiCursorKeyDown,
} from "./inputHandling";
export {
  addCursorAtPosition,
  removeCursorAtPosition,
  toggleCursorAtPosition,
} from "./altClick";
export {
  mergeOverlappingRanges,
  sortAndDedupeRanges,
  normalizeRanges,
  normalizeRangesWithPrimary,
} from "./rangeUtils";
