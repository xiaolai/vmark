/**
 * CodeMirror Plugins — Barrel Export
 *
 * Purpose: Central export point for all custom CodeMirror 6 plugins, keymaps,
 * and decorations (alerts, details, media tags) used by the Source mode editor.
 *
 * Pipeline: sourceEditorExtensions.ts imports from here → assembles into EditorState config
 *
 * @coordinates-with utils/sourceEditorExtensions.ts — consumes these exports to build the CM6 editor
 * @module plugins/codemirror
 */

export { sourceEditorTheme, codeHighlightStyle } from "./theme";
export { createBrHidingPlugin } from "./brHidingPlugin";
export { createListBlankLinePlugin } from "./listBlankLinePlugin";
export { createMarkdownAutoPairPlugin, markdownPairBackspace } from "./markdownAutoPair";
export { tabEscapeKeymap } from "./tabEscape";
export { tabIndentFallbackKeymap, shiftTabIndentFallbackKeymap } from "./tabIndent";
export { listContinuationKeymap } from "./listContinuation";
export { tableTabKeymap, tableShiftTabKeymap, tableArrowUpKeymap, tableArrowDownKeymap, tableModEnterKeymap, tableModShiftEnterKeymap } from "./tableTabNav";
export { createSmartPastePlugin } from "./smartPaste";
export { createSourceFocusModePlugin } from "./focusModePlugin";
export { createSourceTypewriterPlugin } from "./typewriterModePlugin";
export { createImeGuardPlugin } from "./imeGuard";
export { createSourceCursorContextPlugin } from "./sourceCursorContext";
export { createSourceMathPreviewPlugin } from "./sourceMathPreview";
export { createSourceImagePreviewPlugin } from "./sourceImagePreview";
export { sourceMultiCursorExtensions } from "./sourceMultiCursorPlugin";
export { sourceTableContextMenuExtensions } from "./sourceTableContextMenu";
export { sourceTableCellHighlightExtensions } from "./sourceTableCellHighlight";
export { sourceDiagramPreviewExtensions } from "./sourceMermaidPreview";
export { sourceAlertDecorationExtensions } from "./sourceAlertDecoration";
export { sourceDetailsDecorationExtensions } from "./sourceDetailsDecoration";
export { sourceMediaDecorationExtensions } from "./sourceMediaDecoration";
export {
  visualLineUpKeymap,
  visualLineDownKeymap,
  visualLineUpSelectKeymap,
  visualLineDownSelectKeymap,
  smartHomeKeymap,
  smartHomeSelectKeymap,
} from "./visualLineNav";
export { structuralBackspaceKeymap, structuralDeleteKeymap } from "./structuralCharProtection";
export { listSmartIndentKeymap, listSmartOutdentKeymap } from "./listSmartIndent";
export { createSourceCopyOnSelectPlugin } from "./sourceCopyOnSelect";
