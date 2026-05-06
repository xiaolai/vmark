/**
 * CodeMirror Extensions Configuration
 *
 * Purpose: Assembles the CodeMirror extension stack for VMark's source editor —
 * markdown language support, custom keymaps, themes, decorations (media tags), and plugins.
 *
 * Key decisions:
 *   - Uses Compartments for settings that can change at runtime (line numbers,
 *     word wrap, font size, typewriter mode, focus mode, etc.)
 *   - Custom undo/redo routes through unified history (shared with WYSIWYG)
 *   - IME guard prevents premature commits during CJK composition
 *   - Plugins are loaded via imports from codemirror/ directory (co-located)
 *
 * @coordinates-with SourceEditor.tsx — creates EditorView with these extensions
 * @coordinates-with codemirror/theme.ts — visual theme for the source editor
 * @coordinates-with codemirror/ — individual plugin modules for source features
 * @module utils/sourceEditorExtensions
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history } from "@codemirror/commands";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { workflowWarn } from "@/utils/debug";
import { performUnifiedUndo, performUnifiedRedo } from "@/hooks/useUnifiedHistory";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { isYamlFileName } from "@/utils/dropPaths";
import { sourceWorkflowPreviewExtensions } from "@/plugins/codemirror/sourceWorkflowPreview";
// WI-2.4 — sourceGhaWorkflowPreview retired. Standalone workflow YAML
// files now route through the YAML adapter's schemaRenderer
// (registry-driven). The markdown source mode no longer needs to
// detect workflow-shaped content.
import { workflowCompletionExtension } from "@/plugins/codemirror/sourceWorkflowCompletion";
import { workflowCursorSyncExtension } from "@/plugins/codemirror/sourceWorkflowCursorSync";
import { gotoExtension } from "@/plugins/codemirror/sourceWorkflowGoto";
import { yamlLintExtension } from "@/plugins/codemirror/sourceYamlLint";
import { isWorkflowEnabled } from "@/utils/workflowFeatureFlag";
import { syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { search } from "@codemirror/search";
import { selectNextOccurrenceSource, selectAllOccurrencesSource } from "@/plugins/codemirror/sourceSelectOccurrence";
import { useEditorStore } from "@/stores/editorStore";
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
  tableModEnterKeymap,
  tableModShiftEnterKeymap,
  tableArrowUpKeymap,
  tableArrowDownKeymap,
  createSmartPastePlugin,
  createSourceCopyOnSelectPlugin,
  createSourceFocusModePlugin,
  createSourceTypewriterPlugin,
  createImeGuardPlugin,
  imeScrollGuard,
  createSourceCursorContextPlugin,
  createSourceMathPreviewPlugin,
  createSourceImagePreviewPlugin,
  sourceMultiCursorExtensions,
  sourceTableContextMenuExtensions,
  sourceTableCellHighlightExtensions,
  sourceDiagramPreviewExtensions,
  sourceAlertDecorationExtensions,
  sourceDetailsDecorationExtensions,
  sourceMediaDecorationExtensions,
  visualLineUpKeymap,
  visualLineDownKeymap,
  visualLineUpSelectKeymap,
  visualLineDownSelectKeymap,
  smartHomeKeymap,
  smartHomeSelectKeymap,
  structuralBackspaceKeymap,
  structuralDeleteKeymap,
  listSmartIndentKeymap,
  listSmartOutdentKeymap,
} from "@/plugins/codemirror";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { toggleTaskList } from "@/plugins/sourceContextDetection/taskListActions";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { createSourceImagePopupPlugin } from "@/plugins/sourceImagePopup";
import { createSourceLinkPopupPlugin } from "@/plugins/sourceLinkPopup";
import { createSourceLinkCreatePopupPlugin } from "@/plugins/sourceLinkCreatePopup";
import { createSourceWikiLinkPopupPlugin } from "@/plugins/sourceWikiLinkPopup";
import { createSourceFootnotePopupPlugin } from "@/plugins/sourceFootnotePopup";
import { createSourceLintExtension } from "@/plugins/codemirror/sourceLint";

// Compartments for dynamic configuration
export const lineWrapCompartment = new Compartment();
export const brVisibilityCompartment = new Compartment();
export const autoPairCompartment = new Compartment();
export const lineNumbersCompartment = new Compartment();
export const shortcutKeymapCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();

// Custom brackets config for markdown (^, standard brackets)
const markdownCloseBrackets = markdownLanguage.data.of({
  closeBrackets: {
    brackets: ["(", "[", "{", '"', "'", "^"],
  },
});

interface ExtensionConfig {
  initialWordWrap: boolean;
  initialShowBrTags: boolean;
  initialAutoPair: boolean;
  initialShowLineNumbers: boolean;
  initialReadOnly?: boolean;
  updateListener: Extension;
  /** Tab ID for per-tab lint diagnostics (required when lintEnabled is true) */
  tabId?: string;
  /** Whether to include the lint annotation extension */
  lintEnabled?: boolean;
  /** File path for language mode detection (YAML vs markdown) */
  filePath?: string | null;
}

/**
 * Creates the array of CodeMirror extensions for the source editor.
 */
export function createSourceEditorExtensions(config: ExtensionConfig): Extension[] {
  const { initialWordWrap, initialShowBrTags, initialAutoPair, initialShowLineNumbers, updateListener, tabId, lintEnabled, filePath } = config;
  // YAML detection is independent of the workflow feature flag — every
  // YAML file gets `lang-yaml` highlighting and parse-error linting.
  // Workflow-only extensions (preview, completion, goto, cursor sync)
  // additionally gate on `isWorkflowEnabled()`. Codex audit MED-2 fix.
  const isYaml = filePath
    ? isYamlFileName(filePath.split(/[\\/]/).pop() ?? "")
    : false;
  const workflowFeatures = isYaml && isWorkflowEnabled();

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
    // Copy on select: auto-copy selected text to clipboard on mouseup
    createSourceCopyOnSelectPlugin(),
    // IME guard: flush queued work after composition ends
    createImeGuardPlugin(),
    // Strip scrollIntoView from IME compose transactions so the viewport
    // does not jitter on every pinyin/kana/hangul keystroke (issue #814)
    imeScrollGuard,
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
    // Read-only mode (dynamic via compartment)
    readOnlyCompartment.of(EditorState.readOnly.of(config.initialReadOnly ?? false)),
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
      // List smart indent/outdent (must be before tabEscape to take priority on list lines)
      listSmartIndentKeymap,
      listSmartOutdentKeymap,
      // Table arrow escape (first/last block handling)
      tableArrowUpKeymap,
      tableArrowDownKeymap,
      // Table Mod-Enter shortcuts (must be before task list toggle)
      tableModEnterKeymap,
      tableModShiftEnterKeymap,
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
      // Cmd+D: select next occurrence (custom — CJK-aware, code fence boundary-aware)
      guardCodeMirrorKeyBinding({
        key: "Mod-d",
        run: (view) => {
          const spec = selectNextOccurrenceSource(view.state);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        },
        preventDefault: true,
      }),
      // Cmd+Shift+L: select all occurrences (custom — code fence boundary-aware)
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-l",
        run: (view) => {
          const spec = selectAllOccurrencesSource(view.state);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        },
        preventDefault: true,
      }),
      // Cmd+Option+W: toggle word wrap
      guardCodeMirrorKeyBinding({
        key: "Mod-Alt-w",
        run: () => {
          useEditorStore.getState().toggleWordWrap();
          return true;
        },
        preventDefault: true,
      }),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      // Unified undo/redo that works across mode switches
      guardCodeMirrorKeyBinding({
        key: "Mod-z",
        run: () => performUnifiedUndo(getCurrentWindowLabel()),
        preventDefault: true,
      }),
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-z",
        run: () => performUnifiedRedo(getCurrentWindowLabel()),
        preventDefault: true,
      }),
      // Windows/Linux convention: Ctrl+Y for redo (skip on macOS where Cmd+Y = AI Genies)
      /* v8 ignore next 7 -- @preserve reason: isMacPlatform() compile-time constant; only one branch is taken per test run */
      ...(isMacPlatform() ? [] : [
        guardCodeMirrorKeyBinding({
          key: "Mod-y",
          run: () => performUnifiedRedo(getCurrentWindowLabel()),
          preventDefault: true,
        }),
      ]),
      // Fallback Tab handlers: insert spaces if Tab/Shift-Tab not handled above
      tabIndentFallbackKeymap,
      shiftTabIndentFallbackKeymap,
    ]),
    // Search extension (programmatic control only, no panel)
    search(),
    // Language mode: YAML for .yml/.yaml files, markdown for everything else
    isYaml ? yaml() : markdown({ codeLanguages: languages }),
    // Workflow preview plugin for YAML files (parses YAML → workflowPreviewStore)
    ...(workflowFeatures ? sourceWorkflowPreviewExtensions : []),
    // YAML parse-error linter (every YAML file, regardless of workflow
    // flag). Surfaces duplicate keys, unterminated strings, indentation
    // breaks via the CodeMirror gutter.
    ...(isYaml ? [yamlLintExtension()] : []),
    // Workflow expression autocomplete inside ${{ }} (WI-A.1).
    ...(workflowFeatures ? [workflowCompletionExtension()] : []),
    // Source cursor → canvas job selection (WI-B.3).
    ...(workflowFeatures ? [workflowCursorSyncExtension()] : []),
    // Cmd/Ctrl-Click on `uses:` opens local target (WI-B.2).
    ...(workflowFeatures && filePath
      ? [
          gotoExtension({
            filePath,
            windowLabel: getCurrentWindowLabel(),
            onOpenFailure: (reason) => {
              workflowWarn(
                `[gha goto-def] could not open local target (${reason})`,
              );
            },
          }),
        ]
      : []),
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
    // Link popup editor (click to edit, Cmd+Click to open)
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
    // Diagram preview (mermaid + SVG)
    ...sourceDiagramPreviewExtensions,
    // Alert block decorations (colored left border)
    ...sourceAlertDecorationExtensions,
    // Details block decorations
    ...sourceDetailsDecorationExtensions,
    // Media tag decorations (video, audio, YouTube iframe)
    ...sourceMediaDecorationExtensions,
    // Lint annotations (gated by lintEnabled setting and tabId availability)
    /* v8 ignore next -- @preserve reason: extension config branch; depends on runtime settings and tab state */
    ...(lintEnabled && tabId ? createSourceLintExtension(tabId) : []),
  ];
}
