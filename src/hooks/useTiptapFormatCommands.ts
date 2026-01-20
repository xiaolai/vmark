import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, message } from "@tauri-apps/plugin-dialog";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { useDocumentStore } from "@/stores/documentStore";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useTabStore } from "@/stores/tabStore";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import { getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { findMarkRange } from "@/plugins/syntaxReveal/marks";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { insertBookmarkLink, insertWikiLink } from "@/plugins/toolbarActions/wysiwygAdapterLinks";
import { withReentryGuard } from "@/utils/reentryGuard";
import { MultiSelection } from "@/plugins/multiCursor";
import { isTerminalFocused } from "@/utils/focus";
import { readClipboardImagePath } from "@/utils/clipboardImagePath";
import { encodeMarkdownUrl } from "@/utils/markdownUrl";

const INSERT_IMAGE_GUARD = "menu-insert-image";

/**
 * Try to insert image from clipboard path.
 * Returns true if handled, false to fall back to file picker.
 */
async function tryClipboardImageInsertion(
  view: EditorView,
  windowLabel: string
): Promise<boolean> {
  const clipboardResult = await readClipboardImagePath();

  // No valid clipboard image
  if (!clipboardResult?.isImage || !clipboardResult.validated) {
    return false;
  }

  let imagePath = clipboardResult.path;

  // For local paths that need copying, copy to assets
  if (clipboardResult.needsCopy) {
    const docPath = getActiveFilePathForWindow(windowLabel);
    if (!docPath) {
      // Can't copy without document path, fall back to file picker
      return false;
    }

    try {
      const sourcePath = clipboardResult.resolvedPath ?? clipboardResult.path;
      imagePath = await copyImageToAssets(sourcePath, docPath);
    } catch {
      // Copy failed, fall back to file picker
      return false;
    }
  }

  // Insert image node
  insertBlockImageNode(
    view as unknown as Parameters<typeof insertBlockImageNode>[0],
    encodeMarkdownUrl(imagePath)
  );
  return true;
}

function getActiveFilePathForWindow(windowLabel: string): string | null {
  try {
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

function normalizeDialogPath(path: string | string[] | null): string | null {
  if (!path) return null;
  if (Array.isArray(path)) return path[0] ?? null;
  return path;
}

export function useTiptapFormatCommands(editor: TiptapEditor | null) {
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const createMarkListener = async (eventName: string, markType: string) => {
        const unlisten = await currentWindow.listen<string>(eventName, (event) => {
          if (event.payload !== windowLabel) return;
          // Skip editor-scoped shortcuts when terminal has focus
          if (isTerminalFocused()) return;
          const editor = editorRef.current;
          if (!editor) return;
          editor.commands.focus();
          expandedToggleMarkTiptap(editor.view, markType);
        });
        if (cancelled) {
          unlisten();
          return null;
        }
        return unlisten;
      };

      const unlistenImage = await currentWindow.listen<string>("menu:image", async (event) => {
        if (event.payload !== windowLabel) return;
        // Skip editor-scoped shortcuts when terminal has focus
        if (isTerminalFocused()) return;

        await withReentryGuard(windowLabel, INSERT_IMAGE_GUARD, async () => {
          const editor = editorRef.current;
          if (!editor) return;

          // First try clipboard - if image path is in clipboard, insert directly
          const handled = await tryClipboardImageInsertion(editor.view, windowLabel);
          if (handled) return;

          // No clipboard image, fall back to file picker
          const selected = await open({
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
              },
            ],
          });

          const sourcePath = normalizeDialogPath(selected);
          if (!sourcePath) return;

          const filePath = getActiveFilePathForWindow(windowLabel);

          if (!filePath) {
            await message(
              "Please save the document first to copy images to assets folder.",
              { title: "Unsaved Document", kind: "warning" }
            );
            return;
          }

          const relativePath = await copyImageToAssets(sourcePath, filePath);
          insertBlockImageNode(editor.view as unknown as Parameters<typeof insertBlockImageNode>[0], relativePath);
        });
      });
      if (cancelled) {
        unlistenImage();
        return;
      }
      unlistenRefs.current.push(unlistenImage);

      const unlistenClearFormat = await currentWindow.listen<string>("menu:clear-format", (event) => {
        if (event.payload !== windowLabel) return;
        // Skip editor-scoped shortcuts when terminal has focus
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state, dispatch } = view;
        const { selection } = state;
        const ranges = selection instanceof MultiSelection ? selection.ranges : [{ $from: selection.$from, $to: selection.$to }];
        let tr = state.tr;
        let applied = false;

        for (const range of ranges) {
          const from = range.$from.pos;
          const to = range.$to.pos;
          if (from === to) continue;
          applied = true;
          state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
            if (node.isText && node.marks.length > 0) {
              node.marks.forEach((mark: PMMark) => {
                tr = tr.removeMark(
                  Math.max(from, pos),
                  Math.min(to, pos + node.nodeSize),
                  mark.type
                );
              });
            }
          });
        }

        if (applied && tr.docChanged) {
          dispatch(tr);
          view.focus();
        }
      });
      if (cancelled) {
        unlistenClearFormat();
        return;
      }
      unlistenRefs.current.push(unlistenClearFormat);

      const unlistenBold = await createMarkListener("menu:bold", "bold");
      if (unlistenBold) unlistenRefs.current.push(unlistenBold);
      if (cancelled) return;

      const unlistenItalic = await createMarkListener("menu:italic", "italic");
      if (unlistenItalic) unlistenRefs.current.push(unlistenItalic);
      if (cancelled) return;

      const unlistenStrikethrough = await createMarkListener("menu:strikethrough", "strike");
      if (unlistenStrikethrough) unlistenRefs.current.push(unlistenStrikethrough);
      if (cancelled) return;

      const unlistenUnderline = await createMarkListener("menu:underline", "underline");
      if (unlistenUnderline) unlistenRefs.current.push(unlistenUnderline);
      if (cancelled) return;

      const unlistenCode = await createMarkListener("menu:code", "code");
      if (unlistenCode) unlistenRefs.current.push(unlistenCode);
      if (cancelled) return;

      // Special handler for link - opens popup instead of toggling when inside a link
      // For bookmark links (href starts with #), opens heading picker instead
      const unlistenLink = await currentWindow.listen<string>("menu:link", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;

        // Block if link popup or heading picker is already open
        if (useLinkPopupStore.getState().isOpen || useHeadingPickerStore.getState().isOpen) return;

        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const $from = view.state.selection.$from;
        const linkMarkType = view.state.schema.marks.link;

        // Check if inside an existing link
        if (linkMarkType) {
          const marksAtCursor = $from.marks();
          const linkMark = marksAtCursor.find((m) => m.type === linkMarkType);
          if (linkMark) {
            const markRange = findMarkRange($from.pos, linkMark, $from.start(), $from.parent);
            if (markRange) {
              const href = linkMark.attrs.href || "";

              // Check if it's a bookmark link (href starts with #)
              if (href.startsWith("#")) {
                // Extract headings from document
                const headings = extractHeadingsWithIds(view.state.doc);
                if (headings.length > 0) {
                  try {
                    const start = view.coordsAtPos(markRange.from);
                    const end = view.coordsAtPos(markRange.to);
                    const anchorRect = {
                      top: Math.min(start.top, end.top),
                      left: Math.min(start.left, end.left),
                      bottom: Math.max(start.bottom, end.bottom),
                      right: Math.max(start.right, end.right),
                    };

                    // Get container bounds for proper popup positioning
                    const containerEl = view.dom.closest(".editor-container") as HTMLElement;
                    const containerBounds = containerEl
                      ? getBoundaryRects(view.dom as HTMLElement, containerEl)
                      : getViewportBounds();

                    useHeadingPickerStore.getState().openPicker(headings, (id) => {
                      // Update the link's href to point to the new heading
                      const tr = view.state.tr;
                      tr.removeMark(markRange.from, markRange.to, linkMarkType);
                      tr.addMark(markRange.from, markRange.to, linkMarkType.create({ href: `#${id}` }));
                      view.dispatch(tr);
                      view.focus();
                    }, { anchorRect, containerBounds });
                    return;
                  } catch {
                    // Fall through to regular popup
                  }
                }
              }

              // Regular link - open link popup for editing
              try {
                const start = view.coordsAtPos(markRange.from);
                const end = view.coordsAtPos(markRange.to);
                useLinkPopupStore.getState().openPopup({
                  href,
                  linkFrom: markRange.from,
                  linkTo: markRange.to,
                  anchorRect: {
                    top: Math.min(start.top, end.top),
                    left: Math.min(start.left, end.left),
                    bottom: Math.max(start.bottom, end.bottom),
                    right: Math.max(start.right, end.right),
                  },
                });
                return;
              } catch {
                // Fall through to toggle behavior
              }
            }
          }
        }

        // Not inside a link - use standard toggle behavior
        editor.commands.focus();
        expandedToggleMarkTiptap(view, "link");
      });
      if (cancelled) {
        unlistenLink();
      } else {
        unlistenRefs.current.push(unlistenLink);
      }
      if (cancelled) return;

      const unlistenSubscript = await createMarkListener("menu:subscript", "subscript");
      if (unlistenSubscript) unlistenRefs.current.push(unlistenSubscript);
      if (cancelled) return;

      const unlistenSuperscript = await createMarkListener("menu:superscript", "superscript");
      if (unlistenSuperscript) unlistenRefs.current.push(unlistenSuperscript);
      if (cancelled) return;

      const unlistenHighlight = await createMarkListener("menu:highlight", "highlight");
      if (unlistenHighlight) unlistenRefs.current.push(unlistenHighlight);
      if (cancelled) return;

      // Wiki Link
      const unlistenWikiLink = await currentWindow.listen<string>("menu:wiki-link", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.commands.focus();
        insertWikiLink({ surface: "wysiwyg", view: editor.view, editor, context: null });
      });
      if (cancelled) {
        unlistenWikiLink();
        return;
      }
      unlistenRefs.current.push(unlistenWikiLink);

      // Bookmark Link
      const unlistenBookmark = await currentWindow.listen<string>("menu:bookmark", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.commands.focus();
        insertBookmarkLink({ surface: "wysiwyg", view: editor.view, editor, context: null });
      });
      if (cancelled) {
        unlistenBookmark();
        return;
      }
      unlistenRefs.current.push(unlistenBookmark);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
