/**
 * Cursor Sync — Public API
 *
 * Purpose: Maintain cursor position when switching between WYSIWYG and Source modes.
 * The two editors (Tiptap/ProseMirror and CodeMirror) use different document models,
 * so this module bridges them via sourceLine attributes and text-based heuristics.
 *
 * Pipeline: getCursorInfo*() snapshots position -> CursorInfo travels across mode boundary
 *   -> restoreCursor*() replays position in the target editor.
 *
 * @module utils/cursorSync
 */

// Re-export all cursor sync utilities

// Types
export type { CursorContext } from "./types";

// Markdown utilities
export {
  detectNodeType,
  stripMarkdownSyntax,
  stripInlineFormatting,
  isInsideCodeBlock,
} from "./markdown";

// Matching utilities
export { extractCursorContext } from "./matching";

// Shared ProseMirror helpers
export {
  getSourceLineFromPos,
  estimateSourceLine,
  findClosestSourceLine,
  findColumnInLine,
  END_OF_LINE_THRESHOLD,
  MIN_CONTEXT_PATTERN_LENGTH,
} from "./pmHelpers";

// CodeMirror functions
export {
  getCursorInfoFromCodeMirror,
  restoreCursorInCodeMirror,
} from "./codemirror";

// ProseMirror functions
export {
  getCursorInfoFromProseMirror,
  restoreCursorInProseMirror,
} from "./prosemirror";
