/**
 * WYSIWYG Adapter - Insert Actions
 *
 * Purpose: Handles insertion of block-level and inline content in WYSIWYG mode:
 * images (with smart clipboard detection), math blocks/inline, diagrams,
 * markmaps, and code blocks.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates insert actions here
 * @coordinates-with wysiwygAdapterUtils.ts — uses isViewConnected, getActiveFilePath
 * @module plugins/toolbarActions/wysiwygAdapterInsert
 */
import { open, message } from "@tauri-apps/plugin-dialog";
import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { readClipboardImagePath } from "@/utils/clipboardImagePath";
import { withReentryGuard } from "@/utils/reentryGuard";
import { DEFAULT_MERMAID_DIAGRAM } from "@/plugins/mermaid/constants";
import { DEFAULT_MARKMAP_CONTENT } from "@/plugins/markmap/constants";
import { isViewConnected, getActiveFilePath } from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";

const DEFAULT_MATH_BLOCK = "c = \\pm\\sqrt{a^2 + b^2}";
const INSERT_IMAGE_GUARD = "menu-insert-image";

/**
 * Insert an image node with alt text.
 */
function insertImageWithAlt(view: EditorView, src: string, alt: string, from: number, to: number): void {
  const { state } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;

  const imageNode = imageType.create({ src, alt, title: "" });
  const tr = state.tr.replaceWith(from, to, imageNode);
  view.dispatch(tr);
  view.focus();
}

/**
 * Smart image insertion with clipboard path detection.
 * Returns true if handled, false to fall back to file picker.
 *
 * Behavior:
 * - Clipboard has image URL -> insert directly
 * - Clipboard has local path -> copy to assets, insert relative path
 * - Selection exists -> use as alt text
 * - No selection, word at cursor -> use word as alt text
 * - No clipboard image -> return false (fall back to file picker)
 */
async function trySmartImageInsertion(view: EditorView): Promise<boolean> {
  const clipboardResult = await readClipboardImagePath();

  // No valid clipboard image
  if (!clipboardResult?.isImage || !clipboardResult.validated) {
    return false;
  }

  // Verify view is still connected after async clipboard read
  if (!isViewConnected(view)) {
    console.warn("[wysiwygAdapter] View disconnected after clipboard read");
    return false;
  }

  // Capture selection state after async operation (may have changed)
  const { from, to } = view.state.selection;

  // Determine alt text from selection or word expansion
  let altText = "";
  let insertFrom = from;
  let insertTo = to;

  if (from !== to) {
    // Has selection: use as alt text
    altText = view.state.doc.textBetween(from, to, "");
  } else {
    // No selection: try word expansion
    const $from = view.state.selection.$from;
    const wordRange = findWordAtCursor($from);
    if (wordRange) {
      altText = view.state.doc.textBetween(wordRange.from, wordRange.to, "");
      insertFrom = wordRange.from;
      insertTo = wordRange.to;
    }
  }

  let imagePath = clipboardResult.path;

  // For local paths that need copying, copy to assets
  if (clipboardResult.needsCopy) {
    const docPath = getActiveFilePath();
    if (!docPath) {
      // Can't copy without document path, fall back to file picker
      return false;
    }

    try {
      const sourcePath = clipboardResult.resolvedPath ?? clipboardResult.path;
      imagePath = await copyImageToAssets(sourcePath, docPath);
    } catch (error) {
      console.error("[wysiwygAdapter] Failed to copy image to assets:", error);
      // Copy failed, fall back to file picker
      return false;
    }
  }

  // Re-verify view is still connected after async copy
  if (!isViewConnected(view)) {
    console.warn("[wysiwygAdapter] View disconnected after image copy");
    return false;
  }

  // Insert image with the path
  insertImageWithAlt(view, imagePath, altText, insertFrom, insertTo);
  return true;
}

function normalizeDialogPath(path: string | string[] | null): string | null {
  if (!path) return null;
  if (Array.isArray(path)) return path[0] ?? null;
  return path;
}

async function insertImageFromPicker(view: EditorView): Promise<boolean> {
  const selected = await open({
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
      },
    ],
  });

  const sourcePath = normalizeDialogPath(selected);
  if (!sourcePath) return false;

  const filePath = getActiveFilePath();
  if (!filePath) {
    await message(
      "Please save the document first to copy images to assets folder.",
      { title: "Unsaved Document", kind: "warning" }
    );
    return false;
  }

  const relativePath = await copyImageToAssets(sourcePath, filePath);
  if (!isViewConnected(view)) return false;
  insertBlockImageNode(view, relativePath);
  return true;
}

/**
 * Handle the insertImage toolbar action.
 * Tries smart clipboard insertion first, then falls back to file picker.
 */
export function handleInsertImage(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const windowLabel = getWindowLabel();
  void withReentryGuard(windowLabel, INSERT_IMAGE_GUARD, async () => {
    const handled = await trySmartImageInsertion(view);
    if (handled) return;
    await insertImageFromPicker(view);
  });

  return true;
}

/**
 * Insert a LaTeX math code block with default content.
 */
export function insertMathBlock(context: WysiwygToolbarContext): boolean {
  const editor = context.editor;
  if (!editor) return false;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: "latex" },
      content: [{ type: "text", text: DEFAULT_MATH_BLOCK }],
    })
    .run();
  return true;
}

/**
 * Insert a Mermaid diagram code block with default content.
 */
export function insertDiagramBlock(context: WysiwygToolbarContext): boolean {
  const editor = context.editor;
  if (!editor) return false;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: DEFAULT_MERMAID_DIAGRAM }],
    })
    .run();
  return true;
}

/**
 * Insert a Markmap mind-map code block with default content.
 */
export function insertMarkmapBlock(context: WysiwygToolbarContext): boolean {
  const editor = context.editor;
  if (!editor) return false;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: "markmap" },
      content: [{ type: "text", text: DEFAULT_MARKMAP_CONTENT }],
    })
    .run();
  return true;
}

/**
 * Insert inline math with word expansion.
 *
 * Behavior:
 * - Cursor at math_inline node -> unwrap (convert to text)
 * - Has selection -> wrap in math_inline, position cursor to enter edit mode
 * - No selection, word at cursor -> wrap word, position cursor to enter edit mode
 * - No selection, no word -> insert empty math_inline, enter edit mode
 */
export function insertInlineMath(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const mathInlineType = state.schema.nodes.math_inline;
  if (!mathInlineType) return false;

  const $from = state.selection.$from;

  // Check if we're in a NodeSelection of a math node - toggle off (unwrap)
  if (state.selection instanceof NodeSelection) {
    const node = state.selection.node;
    if (node.type.name === "math_inline") {
      const content = node.attrs.content || "";
      const pos = state.selection.from;
      const tr = state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        content ? state.schema.text(content) : []
      );
      tr.setSelection(Selection.near(tr.doc.resolve(pos + content.length)));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // Check if cursor's nodeAfter is math_inline - toggle off (unwrap)
  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type.name === "math_inline") {
    const nodeEnd = from + nodeAfter.nodeSize;
    const content = nodeAfter.attrs.content || "";
    const tr = state.tr.replaceWith(
      from,
      nodeEnd,
      content ? state.schema.text(content) : []
    );
    tr.setSelection(Selection.near(tr.doc.resolve(from + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Check if cursor's nodeBefore is math_inline - toggle off (unwrap)
  const nodeBefore = $from.nodeBefore;
  if (nodeBefore?.type.name === "math_inline") {
    const nodeStart = from - nodeBefore.nodeSize;
    const content = nodeBefore.attrs.content || "";
    const tr = state.tr.replaceWith(
      nodeStart,
      from,
      content ? state.schema.text(content) : []
    );
    tr.setSelection(Selection.near(tr.doc.resolve(nodeStart + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Helper to focus math input after insertion with cursor at specific offset
  const focusMathInput = (cursorOffset?: number) => {
    requestAnimationFrame(() => {
      const mathInput = view.dom.querySelector(".math-inline.editing .math-inline-input") as HTMLInputElement;
      if (mathInput) {
        mathInput.focus();
        if (cursorOffset !== undefined) {
          mathInput.setSelectionRange(cursorOffset, cursorOffset);
        }
      }
    });
  };

  // Case 1: Has selection - wrap in math_inline, enter edit mode
  if (from !== to) {
    const selectedText = state.doc.textBetween(from, to, "");
    const mathNode = mathInlineType.create({ content: selectedText });
    const tr = state.tr.replaceSelectionWith(mathNode);
    tr.setSelection(Selection.near(tr.doc.resolve(from)));
    dispatch(tr);
    focusMathInput(selectedText.length);
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    const wordText = state.doc.textBetween(wordRange.from, wordRange.to, "");
    // Calculate cursor offset within the word (restore cursor position)
    const cursorOffsetInWord = from - wordRange.from;
    const mathNode = mathInlineType.create({ content: wordText });
    const tr = state.tr.replaceWith(wordRange.from, wordRange.to, mathNode);
    tr.setSelection(Selection.near(tr.doc.resolve(wordRange.from)));
    dispatch(tr);
    focusMathInput(cursorOffsetInWord);
    return true;
  }

  // Case 3: No selection, no word - insert empty math node, enter edit mode
  const mathNode = mathInlineType.create({ content: "" });
  const tr = state.tr.replaceSelectionWith(mathNode);
  tr.setSelection(Selection.near(tr.doc.resolve(from)));
  dispatch(tr);
  focusMathInput(0);
  return true;
}
