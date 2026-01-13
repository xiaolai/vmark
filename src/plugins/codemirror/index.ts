/**
 * CodeMirror Plugins
 *
 * Custom plugins and configuration for the Source mode editor.
 */

export { sourceEditorTheme, codeHighlightStyle } from "./theme";
export { createBrHidingPlugin } from "./brHidingPlugin";
export { createListBlankLinePlugin } from "./listBlankLinePlugin";
export { createMarkdownAutoPairPlugin, markdownPairBackspace } from "./markdownAutoPair";
export { tabEscapeKeymap } from "./tabEscape";
export { tabIndentFallbackKeymap, shiftTabIndentFallbackKeymap } from "./tabIndent";
export { listContinuationKeymap } from "./listContinuation";
export { tableTabKeymap, tableShiftTabKeymap } from "./tableTabNav";
export { createSmartPastePlugin } from "./smartPaste";
export { createSourceFocusModePlugin } from "./focusModePlugin";
export { createSourceTypewriterPlugin } from "./typewriterModePlugin";
export { createImeGuardPlugin } from "./imeGuard";
