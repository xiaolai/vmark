/**
 * CodeMirror extensions configuration for the source editor.
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { search, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";
import {
  sourceEditorTheme,
  codeHighlightStyle,
  createBrHidingPlugin,
  createListBlankLinePlugin,
  createMarkdownAutoPairPlugin,
  markdownPairBackspace,
  tabEscapeKeymap,
  tabIndentFallbackKeymap,
  shiftTabIndentFallbackKeymap,
  listContinuationKeymap,
  tableTabKeymap,
  tableShiftTabKeymap,
  tableArrowUpKeymap,
  tableArrowDownKeymap,
  createSmartPastePlugin,
  createSourceFocusModePlugin,
  createSourceTypewriterPlugin,
  createImeGuardPlugin,
  createSourceCursorContextPlugin,
  createSourceMathPreviewPlugin,
  createSourceImagePreviewPlugin,
  sourceMultiCursorExtensions,
  sourceTableContextMenuExtensions,
  sourceTableCellHighlightExtensions,
  sourceMermaidPreviewExtensions,
  sourceAlertDecorationExtensions,
  sourceDetailsDecorationExtensions,
  visualLineUpKeymap,
  visualLineDownKeymap,
  visualLineUpSelectKeymap,
  visualLineDownSelectKeymap,
  smartHomeKeymap,
  smartHomeSelectKeymap,
  structuralBackspaceKeymap,
  structuralDeleteKeymap,
} from "@/plugins/codemirror";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { toggleTaskList } from "@/plugins/sourceContextDetection/taskListActions";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { createSourceImagePopupPlugin } from "@/plugins/sourceImagePopup";
import { createSourceLinkPopupPlugin } from "@/plugins/sourceLinkPopup";
import { createSourceLinkTooltipPlugin } from "@/plugins/sourceLinkTooltip";
import { createSourceLinkCreatePopupPlugin } from "@/plugins/sourceLinkCreatePopup";
import { createSourceWikiLinkPopupPlugin } from "@/plugins/sourceWikiLinkPopup";
import { createSourceFootnotePopupPlugin } from "@/plugins/sourceFootnotePopup";

// Compartments for dynamic configuration
export const lineWrapCompartment = new Compartment();
export const brVisibilityCompartment = new Compartment();
export const autoPairCompartment = new Compartment();
export const lineNumbersCompartment = new Compartment();
export const shortcutKeymapCompartment = new Compartment();

// Custom brackets config for markdown (^, standard brackets)
const markdownCloseBrackets = markdownLanguage.data.of({
  closeBrackets: {
    brackets: ["(", "[", "{", '"', "'", "`", "^"],
  },
});

interface ExtensionConfig {
  initialWordWrap: boolean;
  initialShowBrTags: boolean;
  initialAutoPair: boolean;
  initialShowLineNumbers: boolean;
  updateListener: Extension;
}

/**
 * Creates the array of CodeMirror extensions for the source editor.
 */
export function createSourceEditorExtensions(config: ExtensionConfig): Extension[] {
  const { initialWordWrap, initialShowBrTags, initialAutoPair, initialShowLineNumbers, updateListener } = config;

  return [
    // Line wrapping (dynamic via compartment)
    lineWrapCompartment.of(initialWordWrap ? EditorView.lineWrapping : []),
    // BR visibility (dynamic via compartment) - hide when showBrTags is false
    brVisibilityCompartment.of(createBrHidingPlugin(!initialShowBrTags)),
    // Auto-pair brackets (dynamic via compartment)
    autoPairCompartment.of(initialAutoPair ? closeBrackets() : []),
    // Line numbers (dynamic via compartment)
    lineNumbersCompartment.of(initialShowLineNumbers ? lineNumbers() : []),
    // Custom markdown brackets config (^, ==, standard brackets)
    markdownCloseBrackets,
    // Markdown auto-pair with delay judgment (*, _, ~) and code fence
    createMarkdownAutoPairPlugin(),
    // Hide blank lines between list items
    createListBlankLinePlugin(),
    // Smart paste: URL on selection creates markdown link
    createSmartPastePlugin(),
    // IME guard: flush queued work after composition ends
    createImeGuardPlugin(),
    // Focus mode: dim non-current paragraph
    createSourceFocusModePlugin(),
    // Typewriter mode: keep cursor centered
    createSourceTypewriterPlugin(),
    // Multi-cursor support
    drawSelection(),
    dropCursor(),
    ...sourceMultiCursorExtensions,
    // Allow multiple selections
    EditorState.allowMultipleSelections.of(true),
    // History (undo/redo)
    history(),
    // Shortcuts from settings (dynamic via compartment)
    shortcutKeymapCompartment.of(keymap.of(buildSourceShortcutKeymap())),
    // Keymaps (no searchKeymap - we use our unified FindBar)
    keymap.of([
      // Visual line navigation (must be before default keymap to override)
      visualLineUpKeymap,
      visualLineDownKeymap,
      visualLineUpSelectKeymap,
      visualLineDownSelectKeymap,
      // Smart Home key (toggles between first non-whitespace and line start)
      smartHomeKeymap,
      smartHomeSelectKeymap,
      // Structural character protection (table pipes, list markers, blockquote markers)
      structuralBackspaceKeymap,
      structuralDeleteKeymap,
      // Smart list continuation (must be before default keymap)
      listContinuationKeymap,
      // Table Tab navigation (must be before tabEscape)
      tableTabKeymap,
      tableShiftTabKeymap,
      // Table arrow escape (first/last block handling)
      tableArrowUpKeymap,
      tableArrowDownKeymap,
      // Tab to jump over closing brackets (must be before default keymap)
      tabEscapeKeymap,
      // Backspace to delete both halves of markdown pairs
      markdownPairBackspace,
      // Mod+Shift+Enter: toggle task list checkbox
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-Enter",
        run: (view) => toggleTaskList(view),
        preventDefault: true,
      }),
      // Cmd+D: select next occurrence (official CodeMirror implementation)
      guardCodeMirrorKeyBinding({
        key: "Mod-d",
        run: (view) => selectNextOccurrence({ state: view.state, dispatch: view.dispatch }),
        preventDefault: true,
      }),
      // Cmd+Shift+L: select all occurrences (official CodeMirror implementation)
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-l",
        run: (view) => selectSelectionMatches({ state: view.state, dispatch: view.dispatch }),
        preventDefault: true,
      }),
      // Cmd+Option+W: toggle word wrap
      guardCodeMirrorKeyBinding({
        key: "Mod-Alt-w",
        run: () => {
          useViewSettingsStore.getState().toggleWordWrap();
          return true;
        },
        preventDefault: true,
      }),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      // Fallback Tab handlers: insert spaces if Tab/Shift-Tab not handled above
      tabIndentFallbackKeymap,
      shiftTabIndentFallbackKeymap,
    ]),
    // Search extension (programmatic control only, no panel)
    search(),
    // Markdown syntax with code block language support
    markdown({ codeLanguages: languages }),
    // Syntax highlighting for code blocks
    syntaxHighlighting(codeHighlightStyle, { fallback: true }),
    // Listen for changes
    updateListener,
    // Theme/styling
    sourceEditorTheme,
    // Source cursor context for toolbar actions
    createSourceCursorContextPlugin(),
    // Inline math preview
    createSourceMathPreviewPlugin(),
    // Inline image preview
    createSourceImagePreviewPlugin(),
    // Image popup editor
    createSourceImagePopupPlugin(),
    // Link tooltip (hover)
    createSourceLinkTooltipPlugin(),
    // Link popup editor (Cmd+K)
    createSourceLinkPopupPlugin(),
    // Link create popup (Cmd+K when no link, no clipboard URL)
    createSourceLinkCreatePopupPlugin(),
    // Wiki link popup editor
    createSourceWikiLinkPopupPlugin(),
    // Footnote popup editor
    createSourceFootnotePopupPlugin(),
    // Table context menu
    ...sourceTableContextMenuExtensions,
    // Table cell highlight
    ...sourceTableCellHighlightExtensions,
    // Mermaid preview
    ...sourceMermaidPreviewExtensions,
    // Alert block decorations (colored left border)
    ...sourceAlertDecorationExtensions,
    // Details block decorations
    ...sourceDetailsDecorationExtensions,
  ];
}
