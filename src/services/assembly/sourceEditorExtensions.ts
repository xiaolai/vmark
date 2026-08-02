/**
 * CodeMirror Extensions Configuration
 *
 * Purpose: Assembles the CodeMirror extension stack for VMark's source editor —
 *
 * Composition goes through `resolveExtensions` (ADR-015 D1): each entry carries
 * an explicit id, and the resolver — not array position — produces the final
 * order. WI-3.4: order is pinned by explicit `after` constraints derived from
 * `SOURCE_COMPOSITION_ORDER` (`compositionOrder.ts`), so the `parts` array is
 * sorted alphabetically before composition. The result is flattened one level so
 * entries that were `...spread` before keep their original shape. The keymap
 * lives in sourceEditorKeymap.ts.
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
 * @coordinates-with codemirror/, hostAdapters.ts — source plugins and their stores
 * @module utils/sourceEditorExtensions
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, lineNumbers } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { workflowWarn } from "@/utils/debug";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { markdownLanguageSupport } from "@/lib/formats/markdownLanguageSupport";
import { languages } from "@codemirror/language-data";
import { isYamlFileName } from "@/utils/dropPaths";
import { dispatchEditor } from "@/lib/formats/registry";
import { sourceWorkflowPreviewExtensions } from "@/plugins/codemirror/sourceWorkflowPreview";
// WI-2.4 — sourceGhaWorkflowPreview retired. Standalone workflow YAML
// files now route through the YAML adapter's schemaRenderer
// (registry-driven). The markdown source mode no longer needs to
// detect workflow-shaped content.
import { workflowCompletionExtension } from "@/plugins/codemirror/sourceWorkflowCompletion";
import { workflowCursorSyncExtension } from "@/plugins/codemirror/sourceWorkflowCursorSync";
import { gotoExtension } from "@/plugins/codemirror/sourceWorkflowGoto";
import { yamlLintExtension } from "@/plugins/codemirror/sourceYamlLint";
import { isWorkflowEnabled } from "@/services/featureFlags/workflowFeatureFlag";
import { syntaxHighlighting } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { search } from "@codemirror/search";
import {
  sourceEditorTheme,
  codeHighlightStyle,
  createBrHidingPlugin, createShowInvisiblesPlugin,
  showInvisiblesTheme,
  createListBlankLinePlugin,
  createMarkdownAutoPairPlugin,
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
  sourceInactiveSelectionExtensions,
  sourceTableContextMenuExtensions,
  sourceTableCellHighlightExtensions,
  sourceDiagramPreviewExtensions,
  sourceAlertDecorationExtensions,
  sourceDetailsDecorationExtensions,
  sourceMediaDecorationExtensions,
} from "@/plugins/codemirror";
import { buildSourceKeymapEntries } from "./sourceEditorKeymap";
import { resolveExtensions } from "@/lib/extensions/resolve";
import { deriveAfterConstraints, assertCanonicalCoverage } from "./extensionOrdering";
import { SOURCE_COMPOSITION_ORDER } from "./compositionOrder";
import type { VMarkExtension } from "@/lib/extensions/types";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { sourceEditorContextMenuExtension } from "@/plugins/codemirror/editorContextMenu";
import { createSourceImagePopupPlugin } from "@/plugins/sourceImagePopup";
import { createSourceLinkPopupPlugin } from "@/plugins/sourceLinkPopup";
import { pluginStores } from "./hostAdapters";
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
export const showInvisiblesCompartment = new Compartment();

// Custom brackets config for markdown (^, standard brackets)
const markdownCloseBrackets = markdownLanguage.data.of({
  closeBrackets: { brackets: ["(", "[", "{", '"', "'", "^"] },
});

interface ExtensionConfig {
  initialWordWrap: boolean;
  initialShowBrTags: boolean;
  initialAutoPair: boolean;
  initialShowLineNumbers: boolean;
  initialReadOnly?: boolean;
  initialShowInvisibles?: boolean;
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
/**
 * The CodeMirror language pack for `filePath`, from the format registry.
 *
 * Formats that bundle their pack anyway expose it synchronously via
 * `FormatConfig.language`, so the primary path never mounts unhighlighted
 * (ADR-015 Phase 4A, option 2).
 *
 * Falls back to markdown when the registry is unavailable — `dispatchEditor`
 * throws if no format has been registered, which happens in unit tests that
 * build extensions without bootstrapping. A source editor with the wrong
 * highlighting is recoverable; one that throws on construction is not.
 */
function resolveLanguage(filePath: string | null | undefined): Extension {
  const fallback = () => markdownLanguageSupport(languages);
  try {
    return dispatchEditor(filePath ?? null).language?.() ?? fallback();
  } catch {
    return fallback();
  }
}

export function createSourceEditorExtensions(config: ExtensionConfig): Extension[] {
  const { initialWordWrap, initialShowBrTags, initialAutoPair, initialShowLineNumbers, initialShowInvisibles = false, updateListener, tabId, lintEnabled, filePath } = config;
  // YAML detection ignores the workflow feature flag — every YAML file gets
  // `lang-yaml` highlighting and parse-error linting; workflow-only extensions
  // (preview, completion, goto, cursor sync) gate on isWorkflowEnabled(). MED-2.
  const isYaml = filePath
    ? isYamlFileName(filePath.split(/[\\/]/).pop() ?? "")
    : false;
  const workflowFeatures = isYaml && isWorkflowEnabled();

  const parts: Array<{ id: string; ext: Extension }> = [
    // Line wrapping (dynamic via compartment)
    { id: "source.lineWrapCompartment", ext: lineWrapCompartment.of(initialWordWrap ? EditorView.lineWrapping : []) },
    // BR visibility (dynamic via compartment) - hide when showBrTags is false
    { id: "source.brVisibilityCompartment", ext: brVisibilityCompartment.of(createBrHidingPlugin(!initialShowBrTags)) },
    // Show invisible characters (dynamic via compartment)
    {
      id: "source.showInvisiblesCompartment",
      ext: showInvisiblesCompartment.of([
      createShowInvisiblesPlugin(initialShowInvisibles),
      showInvisiblesTheme,
    ]),
    },
    // Auto-pair brackets (dynamic via compartment)
    { id: "source.autoPairCompartment", ext: autoPairCompartment.of(initialAutoPair ? closeBrackets() : []) },
    // Line numbers (dynamic via compartment)
    { id: "source.lineNumbersCompartment", ext: lineNumbersCompartment.of(initialShowLineNumbers ? lineNumbers() : []) },
    // Custom markdown brackets config (^, ==, standard brackets)
    { id: "source.markdownCloseBrackets", ext: markdownCloseBrackets },
    // Markdown auto-pair with delay judgment (*, _, ~) and code fence
    { id: "source.markdownAutoPairPlugin", ext: createMarkdownAutoPairPlugin() },
    // Hide blank lines between list items
    { id: "source.listBlankLinePlugin", ext: createListBlankLinePlugin() },
    // Smart paste: URL on selection creates markdown link
    { id: "source.smartPastePlugin", ext: createSmartPastePlugin() },
    // Copy on select: auto-copy selected text to clipboard on mouseup
    { id: "source.sourceCopyOnSelectPlugin", ext: createSourceCopyOnSelectPlugin() },
    // IME guard: flush queued work after composition ends
    { id: "source.imeGuardPlugin", ext: createImeGuardPlugin() },
    // Strip scrollIntoView from IME compose transactions to avoid viewport jitter (#814)
    { id: "source.imeScrollGuard", ext: imeScrollGuard },
    // Focus mode: dim non-current paragraph
    { id: "source.sourceFocusModePlugin", ext: createSourceFocusModePlugin() },
    // Typewriter mode: keep cursor centered
    { id: "source.sourceTypewriterPlugin", ext: createSourceTypewriterPlugin() },
    // Multi-cursor support
    { id: "source.drawSelection", ext: drawSelection() },
    { id: "source.dropCursor", ext: dropCursor() },
    { id: "source.multiCursorExtensions", ext: sourceMultiCursorExtensions },
    // Allow multiple selections
    { id: "source.editorState", ext: EditorState.allowMultipleSelections.of(true) },
    // Dimmed selection overlay while the editor is blurred (e.g. in the terminal).
    { id: "source.inactiveSelectionExtensions", ext: sourceInactiveSelectionExtensions },
    // History (undo/redo)
    { id: "source.history", ext: history() },
    // Shortcuts from settings (dynamic via compartment)
    { id: "source.shortcutKeymapCompartment", ext: shortcutKeymapCompartment.of(keymap.of(buildSourceShortcutKeymap())) },
    // Read-only mode (dynamic via compartment)
    { id: "source.readOnlyCompartment", ext: readOnlyCompartment.of(EditorState.readOnly.of(config.initialReadOnly ?? false)) },
    // Keymaps (no searchKeymap - we use our unified FindBar)
    { id: "source.keymap", ext: keymap.of(buildSourceKeymapEntries()) },
    // Search extension (programmatic control only, no panel)
    { id: "source.search", ext: search() },
    // Language mode: YAML for .yml/.yaml files, markdown for everything else
    // Language comes from the format registry, not a hard-coded branch. Formats
    // that bundle their pack anyway expose it synchronously via
    // `FormatConfig.language`, so the primary path never mounts unhighlighted;
    // anything else falls back to the statically imported markdown pack until
    // the async `loadLanguage` path is wired (ADR-015 Phase 4A).
    { id: "source.language", ext: resolveLanguage(filePath) },
    // Workflow preview plugin for YAML files (parses YAML → workflowPreviewStore)
    { id: "source.workflowPreview", ext: (workflowFeatures ? sourceWorkflowPreviewExtensions : []) },
    // YAML parse-error linter (every YAML file, regardless of workflow
    // flag). Surfaces duplicate keys, unterminated strings, indentation
    // breaks via the CodeMirror gutter.
    { id: "source.yamlLint", ext: (isYaml ? [yamlLintExtension()] : []) },
    // Workflow expression autocomplete inside ${{ }} (WI-A.1).
    { id: "source.workflowCompletion", ext: (workflowFeatures ? [workflowCompletionExtension()] : []) },
    // Source cursor → canvas job selection (WI-B.3).
    { id: "source.workflowCursorSync", ext: (workflowFeatures ? [workflowCursorSyncExtension()] : []) },
    // Cmd/Ctrl-Click on `uses:` opens local target (WI-B.2).
    {
      id: "source.gotoExtension",
      ext: (workflowFeatures && filePath
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
    },
    // Syntax highlighting for code blocks
    { id: "source.syntaxHighlighting", ext: syntaxHighlighting(codeHighlightStyle, { fallback: true }) },
    // Listen for changes
    { id: "source.updateListener", ext: updateListener },
    // Theme/styling
    { id: "source.editorTheme", ext: sourceEditorTheme },
    // Source cursor context for toolbar actions
    { id: "source.sourceCursorContextPlugin", ext: createSourceCursorContextPlugin() },
    // Inline math preview
    { id: "source.sourceMathPreviewPlugin", ext: createSourceMathPreviewPlugin() },
    // Inline image preview
    { id: "source.sourceImagePreviewPlugin", ext: createSourceImagePreviewPlugin() },
    // Image popup editor
    { id: "source.sourceImagePopupPlugin", ext: createSourceImagePopupPlugin() },
    // Link popup editor (click to edit, Cmd+Click to open)
    { id: "source.sourceLinkPopupPlugin", ext: createSourceLinkPopupPlugin(pluginStores.link) },
    // Link create popup (Cmd+K when no link, no clipboard URL)
    { id: "source.sourceLinkCreatePopupPlugin", ext: createSourceLinkCreatePopupPlugin(pluginStores.linkCreate) },
    // Wiki link popup editor
    { id: "source.sourceWikiLinkPopupPlugin", ext: createSourceWikiLinkPopupPlugin(pluginStores.wikiLink) },
    // Footnote popup editor
    { id: "source.sourceFootnotePopupPlugin", ext: createSourceFootnotePopupPlugin(pluginStores.footnote) },
    // Table context menu
    { id: "source.tableContextMenuExtensions", ext: sourceTableContextMenuExtensions },
    // Generic editor context menu — after the table menu, which owns tables (ADR-5)
    { id: "source.editorContextMenuExtension", ext: sourceEditorContextMenuExtension },
    // Table cell highlight
    { id: "source.tableCellHighlightExtensions", ext: sourceTableCellHighlightExtensions },
    // Diagram preview (mermaid + SVG)
    { id: "source.diagramPreviewExtensions", ext: sourceDiagramPreviewExtensions },
    // Alert block decorations (colored left border)
    { id: "source.alertDecorationExtensions", ext: sourceAlertDecorationExtensions },
    // Details block decorations
    { id: "source.detailsDecorationExtensions", ext: sourceDetailsDecorationExtensions },
    // Media tag decorations (video, audio, YouTube iframe)
    { id: "source.mediaDecorationExtensions", ext: sourceMediaDecorationExtensions },
    // Lint annotations (gated by lintEnabled setting and tabId availability)
    {
      id: "source.lint",
      /* v8 ignore next -- @preserve reason: extension config branch; depends on runtime settings and tab state */
      ext: lintEnabled && tabId ? createSourceLintExtension(tabId) : [],
    },
  ];

  // WI-3.4: array position is no longer load-bearing. The order is declared once
  // in SOURCE_COMPOSITION_ORDER and pinned via explicit `after` constraints, so
  // the array is sorted alphabetically before composition and the resolver still
  // reproduces the canonical order exactly. `assertCanonicalCoverage` fails loud
  // if `parts` and the canonical list ever drift apart.
  assertCanonicalCoverage(
    "source",
    SOURCE_COMPOSITION_ORDER,
    parts.map((p) => p.id),
  );
  const after = deriveAfterConstraints(
    SOURCE_COMPOSITION_ORDER,
    parts.map((p) => p.id),
  );
  const descriptors: VMarkExtension[] = [...parts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, ext }) => ({
      id,
      contributions: [{ kind: "codemirror", factory: () => ext }],
      ordering: after.has(id) ? { after: after.get(id) } : undefined,
    }));

  const { ordered, errors } = resolveExtensions(descriptors);
  if (errors.length > 0) {
    throw new Error(
      `Source editor composition failed:\n${errors
        .map((error) => `  - [${error.code}] ${error.message}`)
        .join("\n")}`,
    );
  }

  // Flatten one level: entries that were `...spread` before are now a single
  // nested array. CodeMirror flattens nested Extensions itself, but restoring
  // the original shape keeps composition output byte-identical to pre-migration.
  return ordered
    .map(
      (descriptor) =>
        (descriptor.contributions[0] as { factory: () => Extension }).factory(),
    )
    .flat() as Extension[];
}
