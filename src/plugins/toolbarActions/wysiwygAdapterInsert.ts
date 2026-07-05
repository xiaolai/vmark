/**
 * WYSIWYG Adapter - Insert Actions
 *
 * Purpose: Handles insertion of block-level and inline content in WYSIWYG mode —
 * images (smart clipboard detection), video/audio (parameterized file-picker +
 * copy-to-assets flow), math blocks/inline, diagrams, markmaps, code blocks.
 *
 * Key decisions:
 *   - Smart image insertion computes its target range AFTER all awaits so a
 *     doc edit during the async copy cannot misplace the replacement range
 *   - Image/video/audio share one MediaPickerSpec-driven picker flow
 *   - Inline math delegates to handleInlineMathShortcut (single source of truth)
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates insert actions here
 * @coordinates-with wysiwygAdapterUtils.ts — uses isViewConnected, getActiveFilePath
 * @coordinates-with editorPlugins/inlineMathCommand.ts — shared inline math toggle
 * @module plugins/toolbarActions/wysiwygAdapterInsert
 */
import { open, message } from "@tauri-apps/plugin-dialog";
import type { EditorView } from "@tiptap/pm/view";
import i18n from "@/i18n";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { copyMediaToAssets, insertBlockVideoNode, insertBlockAudioNode } from "@/hooks/useMediaOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { readClipboardImagePath } from "@/services/media/clipboardImagePath";
import { withReentryGuard } from "@/utils/reentryGuard";
import { DEFAULT_MERMAID_DIAGRAM } from "@/plugins/mermaid/constants";
import { DEFAULT_GRAPHVIZ_DIAGRAM } from "@/plugins/graphviz/constants";
import { DEFAULT_MARKMAP_CONTENT } from "@/plugins/markmap/constants";
import { handleInlineMathShortcut } from "@/plugins/editorPlugins/inlineMathCommand";
import { wysiwygAdapterWarn, wysiwygAdapterError } from "@/utils/debug";
import { isViewConnected, getActiveFilePath } from "./wysiwygAdapterUtils";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from "@/utils/mediaExtensions";
import type { WysiwygToolbarContext } from "./types";
import { errorMessage } from "@/utils/errorMessage";

const DEFAULT_MATH_BLOCK = "c = \\pm\\sqrt{a^2 + b^2}";

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
 *
 * The target range and alt text are computed from the CURRENT view state
 * after every await, so a doc change while the copy is in flight cannot
 * replace a stale (now wrong) range.
 */
async function trySmartImageInsertion(view: EditorView): Promise<boolean> {
  const clipboardResult = await readClipboardImagePath();

  // No valid clipboard image
  if (!clipboardResult?.isImage || !clipboardResult.validated) {
    return false;
  }

  // Verify view is still connected after async clipboard read
  if (!isViewConnected(view)) {
    wysiwygAdapterWarn("View disconnected after clipboard read");
    return false;
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
      wysiwygAdapterError("Failed to copy image to assets:", error);
      // Copy failed, fall back to file picker
      return false;
    }

    // Re-verify view is still connected after async copy
    if (!isViewConnected(view)) {
      wysiwygAdapterWarn("View disconnected after image copy");
      return false;
    }
  }

  // Determine target range and alt text from the selection as it is NOW —
  // after all awaits — so edits during the copy can't misplace the insert.
  const { from, to } = view.state.selection;
  let altText = "";
  let insertFrom = from;
  let insertTo = to;

  if (from !== to) {
    // Has selection: use as alt text
    altText = view.state.doc.textBetween(from, to, "");
  } else {
    // No selection: try word expansion
    const wordRange = findWordAtCursor(view.state.selection.$from);
    if (wordRange) {
      altText = view.state.doc.textBetween(wordRange.from, wordRange.to, "");
      insertFrom = wordRange.from;
      insertTo = wordRange.to;
    }
  }

  insertImageWithAlt(view, imagePath, altText, insertFrom, insertTo);
  return true;
}

function normalizeDialogPath(path: string | string[] | null): string | null {
  if (!path) return null;
  if (Array.isArray(path)) return path[0] ?? null;
  return path;
}

// --- Parameterized media insertion (image / video / audio) ---

interface MediaPickerSpec {
  /** Reentry guard id, e.g. "menu-insert-image" */
  guardId: string;
  /** File dialog filter label */
  filterName: string;
  extensions: readonly string[];
  /** dialog:unsavedDocument.* message key shown when the document is unsaved */
  unsavedMessageKey: string;
  copyToAssets: (sourcePath: string, docPath: string) => Promise<string>;
  insertNode: (view: EditorView, relativePath: string) => void;
  /** Log prefix used in "<logLabel> insertion failed:" warnings */
  logLabel: string;
}

const IMAGE_PICKER: MediaPickerSpec = {
  guardId: "menu-insert-image",
  filterName: "Images",
  extensions: IMAGE_EXTENSIONS,
  unsavedMessageKey: "dialog:unsavedDocument.messageInsertImages",
  copyToAssets: copyImageToAssets,
  insertNode: insertBlockImageNode,
  logLabel: "Image",
};

const VIDEO_PICKER: MediaPickerSpec = {
  guardId: "menu-insert-video",
  filterName: "Videos",
  extensions: VIDEO_EXTENSIONS,
  unsavedMessageKey: "dialog:unsavedDocument.messageAddMedia",
  copyToAssets: copyMediaToAssets,
  insertNode: insertBlockVideoNode,
  logLabel: "Video",
};

const AUDIO_PICKER: MediaPickerSpec = {
  guardId: "menu-insert-audio",
  filterName: "Audio",
  extensions: AUDIO_EXTENSIONS,
  unsavedMessageKey: "dialog:unsavedDocument.messageAddMedia",
  copyToAssets: copyMediaToAssets,
  insertNode: insertBlockAudioNode,
  logLabel: "Audio",
};

/** Open a file picker for the media type, copy the pick to assets, insert the node. */
async function insertMediaFromPicker(view: EditorView, spec: MediaPickerSpec): Promise<boolean> {
  const selected = await open({
    filters: [{ name: spec.filterName, extensions: [...spec.extensions] }],
  });

  const sourcePath = normalizeDialogPath(selected);
  if (!sourcePath) return false;

  const filePath = getActiveFilePath();
  if (!filePath) {
    await message(i18n.t(spec.unsavedMessageKey), {
      title: i18n.t("dialog:unsavedDocument.title"),
      kind: "warning",
    });
    return false;
  }

  const relativePath = await spec.copyToAssets(sourcePath, filePath);
  if (!isViewConnected(view)) return false;
  spec.insertNode(view, relativePath);
  return true;
}

/** Run an async insertion task behind the spec's reentry guard, logging failures. */
function runGuardedInsertion(spec: MediaPickerSpec, task: () => Promise<void>): boolean {
  const windowLabel = getWindowLabel();
  void withReentryGuard(windowLabel, spec.guardId, task).catch((error) => {
    wysiwygAdapterWarn(`${spec.logLabel} insertion failed:`, errorMessage(error));
  });
  return true;
}

/**
 * Handle the insertImage toolbar action.
 * Tries smart clipboard insertion first, then falls back to file picker.
 */
export function handleInsertImage(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  return runGuardedInsertion(IMAGE_PICKER, async () => {
    const handled = await trySmartImageInsertion(view);
    if (handled) return;
    await insertMediaFromPicker(view, IMAGE_PICKER);
  });
}

/**
 * Handle the insertVideo toolbar action. Opens a file picker for video files.
 */
export function handleInsertVideo(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  return runGuardedInsertion(VIDEO_PICKER, async () => {
    await insertMediaFromPicker(view, VIDEO_PICKER);
  });
}

/**
 * Handle the insertAudio toolbar action. Opens a file picker for audio files.
 */
export function handleInsertAudio(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  return runGuardedInsertion(AUDIO_PICKER, async () => {
    await insertMediaFromPicker(view, AUDIO_PICKER);
  });
}

// --- Block content insertion (math / diagram / graphviz / markmap) ---

/**
 * Insert a code block of `language`. A non-empty selection becomes the block
 * content (mirroring source mode, which wraps the selection in the fence);
 * otherwise `defaultText` is used.
 */
function insertLanguageBlock(
  context: WysiwygToolbarContext,
  language: string,
  defaultText: string,
): boolean {
  const editor = context.editor;
  if (!editor) return false;

  const { selection, doc } = editor.state;
  const selectedText = selection.empty ? "" : doc.textBetween(selection.from, selection.to, "\n");
  const text = selectedText || defaultText;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language },
      content: [{ type: "text", text }],
    })
    .run();
  return true;
}

/** Insert a LaTeX math code block (selection becomes the formula). */
export function insertMathBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "latex", DEFAULT_MATH_BLOCK);
}

/** Insert a Mermaid diagram code block (selection becomes the diagram source). */
export function insertDiagramBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "mermaid", DEFAULT_MERMAID_DIAGRAM);
}

/** Insert a Graphviz DOT diagram code block (selection becomes the DOT source). */
export function insertGraphvizBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "dot", DEFAULT_GRAPHVIZ_DIAGRAM);
}

/** Insert a Markmap mind-map code block (selection becomes the outline). */
export function insertMarkmapBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "markmap", DEFAULT_MARKMAP_CONTENT);
}

/**
 * Insert inline math with word expansion and toggle behavior.
 * Delegates to the shared handleInlineMathShortcut implementation
 * (also bound to the keyboard shortcut) — single source of truth.
 */
export function insertInlineMath(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;
  return handleInlineMathShortcut(view);
}
