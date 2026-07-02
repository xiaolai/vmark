/**
 * Code Preview Decoration Builder
 *
 * Purpose: Walks the document and builds the widget/node decorations for previewable
 * code blocks — edit header + live preview while editing, rendered/placeholder
 * preview widgets otherwise. Split from tiptap.ts for size.
 *
 * Key decisions:
 *   - Previews are ProseMirror widget decorations (not node views) to avoid
 *     complicating the document schema
 *   - Each preview type has its own renderer (in renderers/ directory)
 *   - Markmap renders to live DOM — its widgets skip the cache and are always fresh
 *   - The tracker object mirrors the per-extension closure state (live preview
 *     element + editing language) that tiptap.ts apply() uses for re-renders
 *
 * @coordinates-with tiptap.ts — apply() calls buildCodePreviewDecorations
 * @coordinates-with editMode.ts — edit-header widgets call exitEditMode
 * @coordinates-with previewHelpers.ts — shared element creation and utility functions
 * @coordinates-with renderers/ — per-language preview renderers
 * @module plugins/codePreview/previewDecorations
 */

import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import i18n from "@/i18n";
import {
  isLatexLanguage,
  createPreviewElement,
  createPreviewPlaceholder,
  createLivePreview,
  createEditHeader,
} from "./previewHelpers";
import { createLatexPreviewWidget } from "./renderers/renderLatex";
import { createMermaidPreviewWidget } from "./renderers/renderMermaidPreview";
import { createMarkmapPreviewWidget } from "./renderers/renderMarkmapPreview";
import { createSvgPreviewWidget } from "./renderers/renderSvgPreview";
import { createWorkflowPreviewWidget } from "./renderers/renderWorkflowPreview";
import { updateLivePreview, exitEditMode } from "./editMode";
import { isPreviewable } from "./transactionScan";
import {
  codePreviewPluginKey,
  previewCache,
  EDITING_STATE_CHANGED,
  type CodeBlockRange,
  type CodePreviewState,
} from "./pluginState";

/**
 * Mutable per-extension tracking of the live preview element and the language
 * being edited. Mirrors the closure variables tiptap.ts keeps per
 * addProseMirrorPlugins() call; apply() reads it to re-render on doc changes.
 */
export interface LivePreviewTracker {
  currentLivePreview: HTMLElement | null;
  currentEditingLanguage: string | null;
}

/**
 * Re-resolve a preview block's CURRENT position at interaction time. Widget
 * click handlers close over the position captured during the build scan, but
 * the apply() fast paths in tiptap.ts map decorations across doc changes
 * WITHOUT rebuilding them — so the closure position can be stale. The plugin
 * state's codeBlockRanges ARE mapped on every transaction and preserve the
 * build scan's order, so the range at the same index is the fresh position.
 * Returns null when the resolved position no longer holds a code block.
 */
function resolveBlockForEdit(
  view: EditorView,
  rangeIndex: number,
  buildPos: number,
): { pos: number; node: PMNode } | null {
  const pluginState: CodePreviewState | undefined = codePreviewPluginKey.getState(view.state);
  const pos = pluginState?.codeBlockRanges[rangeIndex]?.from ?? buildPos;
  const node = view.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "codeBlock" && node.type.name !== "code_block")) {
    return null;
  }
  return { pos, node };
}

/**
 * Full document scan producing the decorations and tracked code block ranges
 * for the plugin state. `prevEditingPos` is the previous plugin state's
 * editingPos (used to reset the tracker when editing ends);
 * `currentEditingPos` is the store's current editing position.
 */
export function buildCodePreviewDecorations(
  doc: PMNode,
  currentEditingPos: number | null,
  prevEditingPos: number | null,
  tracker: LivePreviewTracker,
): { decorations: Decoration[]; codeBlockRanges: CodeBlockRange[] } {
  const newDecorations: Decoration[] = [];
  const newCodeBlockRanges: CodeBlockRange[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock" && node.type.name !== "code_block") return;

    const language = (node.attrs.language ?? "").toLowerCase();
    const content = node.textContent;
    if (!isPreviewable(language, content)) return;
    const cacheKey = `${language}:${content}`;
    const nodeStart = pos;
    const nodeEnd = pos + node.nodeSize;

    // Track this code block's range for future incremental updates
    newCodeBlockRanges.push({ from: nodeStart, to: nodeEnd });

    // Check if this block is being edited
    const isEditing = currentEditingPos === nodeStart;

    if (isEditing) {
      tracker.currentEditingLanguage = language;

      // Add header widget before the code block
      const headerWidget = Decoration.widget(
        nodeStart,
        (widgetView) => {
          const onCopy = (language === "mermaid" || language === "markmap" || language === "svg")
            ? () => {
                const node = widgetView?.state.doc.nodeAt(nodeStart);
                if (node) navigator.clipboard.writeText(node.textContent);
              }
            : undefined;
          return createEditHeader(
            language,
            () => exitEditMode(widgetView, true), // Cancel
            () => exitEditMode(widgetView, false), // Save
            onCopy,
          );
        },
        { side: -1, key: `${nodeStart}:header` }
      );
      newDecorations.push(headerWidget);

      // Add editing class to code block
      newDecorations.push(
        Decoration.node(nodeStart, nodeEnd, {
          class: "code-block-editing",
          "data-language": language,
        })
      );

      // Add live preview widget after the code block
      const previewWidget = Decoration.widget(
        nodeEnd,
        () => {
          const preview = createLivePreview(language);
          tracker.currentLivePreview = preview;
          // Initial render
          updateLivePreview(preview, language, content);
          return preview;
        },
        { side: 1, key: `${nodeStart}:live-preview` }
      );
      newDecorations.push(previewWidget);

      return;
    }

    // Reset tracking when not editing
    if (prevEditingPos === nodeStart && currentEditingPos !== nodeStart) {
      tracker.currentLivePreview = null;
      tracker.currentEditingLanguage = null;
    }

    // Index of this block in the build scan — codeBlockRanges keeps the same
    // order and is position-mapped on every transaction (see resolveBlockForEdit).
    const rangeIndex = newCodeBlockRanges.length - 1;

    const handleEnterEdit = (view: EditorView | null | undefined) => {
      if (!view) return;
      const target = resolveBlockForEdit(view, rangeIndex, nodeStart);
      if (!target) return;
      // Update store FIRST (before dispatch, so decorations see the new state)
      useBlockMathEditingStore.getState().startEditing(target.pos, target.node.textContent);
      // Then dispatch transaction to trigger decoration rebuild
      const $pos = view.state.doc.resolve(target.pos + 1);
      const tr = view.state.tr.setSelection(TextSelection.near($pos));
      tr.setMeta(EDITING_STATE_CHANGED, true);
      view.dispatch(tr);
      view.focus();
    };

    newDecorations.push(
      Decoration.node(nodeStart, nodeEnd, {
        class: "code-block-preview-only",
        "data-language": language,
        contenteditable: "false",
      })
    );

    if (!content.trim()) {
      const placeholderLabel = language === "mermaid"
        ? i18n.t("editor:preview.emptyDiagram")
        : language === "markmap"
        ? i18n.t("editor:preview.emptyMindmap")
        : language === "svg"
        ? i18n.t("editor:preview.emptySvg")
        : (language === "yaml" || language === "yml")
        ? i18n.t("editor:preview.emptyWorkflow")
        : i18n.t("editor:preview.emptyMath");
      const widget = Decoration.widget(
        nodeEnd,
        (view) => createPreviewPlaceholder(language, placeholderLabel, () => handleEnterEdit(view)),
        { side: 1, key: `${cacheKey}:placeholder` }
      );
      newDecorations.push(widget);
      return;
    }

    // Check cache for already-rendered content
    const cached = previewCache.get(cacheKey);
    if (cached?.rendered) {
      const rendered = cached.rendered;
      const widget = Decoration.widget(
        nodeEnd,
        (view) => createPreviewElement(language, rendered, () => handleEnterEdit(view), content),
        { side: 1, key: cacheKey }
      );
      newDecorations.push(widget);
      return;
    }

    // Markmap renders to live DOM — skip cache, always create fresh
    if (language === "markmap") {
      newDecorations.push(
        createMarkmapPreviewWidget(nodeEnd, content, cacheKey, handleEnterEdit)
      );
      return;
    }

    // LaTeX (async rendering with placeholder)
    if (isLatexLanguage(language)) {
      newDecorations.push(
        createLatexPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
      );
      return;
    }

    // SVG (synchronous rendering)
    if (language === "svg") {
      newDecorations.push(
        createSvgPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
      );
      return;
    }

    // Mermaid (async rendering with placeholder)
    if (language === "mermaid") {
      newDecorations.push(
        createMermaidPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
      );
      return;
    }

    // GitHub Actions workflow YAML (async via xyflow snapshot
    // pipeline). Pipes IR → toGraph + applyLayout → hidden
    // ReactFlow root → html-to-image.toSvg → cached SVG.
    // Visual parity with the side-panel JobNode by sharing
    // the same React subtree. See
    // dev-docs/plans/20260504-workflow-fence-snapshot.md.
    if (language === "yaml" || language === "yml") {
      newDecorations.push(
        createWorkflowPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
      );
    }
  });

  return { decorations: newDecorations, codeBlockRanges: newCodeBlockRanges };
}
