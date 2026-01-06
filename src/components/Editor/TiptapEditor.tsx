import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import { parseMarkdownToTiptapDoc, serializeTiptapDocToMarkdown } from "@/utils/tiptapMarkdown";
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";
import { getCursorInfoFromTiptap, restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import type { CursorInfo } from "@/stores/documentStore";
import { smartPasteExtension } from "@/plugins/smartPaste/tiptap";
import { linkPopupExtension } from "@/plugins/linkPopup/tiptap";

const CURSOR_TRACKING_DELAY_MS = 200;

export function TiptapEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingCursorRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  cursorInfoRef.current = cursorInfo;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // We parse/serialize markdown ourselves.
        // Keep Tiptap defaults for schema names and commands.
      }),
      Image.configure({ inline: false }),
      smartPasteExtension,
      linkPopupExtension,
    ],
    []
  );

  const flushToStore = useCallback(
    (editor: TiptapEditor) => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }

      const markdown = serializeTiptapDocToMarkdown(editor.state.doc);
      isInternalChange.current = true;
      lastExternalContent.current = markdown;
      setContent(markdown);
      requestAnimationFrame(() => {
        isInternalChange.current = false;
      });
    },
    [setContent]
  );

  const flushCursorInfo = useCallback(() => {
    pendingCursorRaf.current = null;
    if (!pendingCursorInfo.current) return;
    setCursorInfo(pendingCursorInfo.current);
    pendingCursorInfo.current = null;
  }, [setCursorInfo]);

  const scheduleCursorUpdate = useCallback(
    (info: CursorInfo) => {
      pendingCursorInfo.current = info;
      if (pendingCursorRaf.current === null) {
        pendingCursorRaf.current = requestAnimationFrame(flushCursorInfo);
      }
    },
    [flushCursorInfo]
  );

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: "ProseMirror",
      },
    },
    onCreate: ({ editor }) => {
      try {
        const doc = parseMarkdownToTiptapDoc(editor.schema, content);
        lastExternalContent.current = content;
        editor.commands.setContent(doc, { emitUpdate: false });
      } catch (error) {
        console.error("[TiptapEditor] Failed to parse initial markdown:", error);
        lastExternalContent.current = content;
      }

      cursorTrackingEnabled.current = false;
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
      }
      trackingTimeoutId.current = window.setTimeout(() => {
        cursorTrackingEnabled.current = true;
      }, CURSOR_TRACKING_DELAY_MS);

      registerActiveWysiwygFlusher(() => flushToStore(editor));
      requestAnimationFrame(() => {
        editor.commands.focus();
        const info = cursorInfoRef.current;
        if (info) {
          restoreCursorInTiptap(editor.view, info);
        }
      });
    },
    onUpdate: ({ editor }) => {
      if (pendingRaf.current) return;
      pendingRaf.current = requestAnimationFrame(() => {
        pendingRaf.current = null;
        flushToStore(editor);
      });
    },
    onSelectionUpdate: ({ editor }) => {
      if (!cursorTrackingEnabled.current) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(editor.view));
    },
  });

  // Cleanup pendingRaf on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingCursorRaf.current) {
        cancelAnimationFrame(pendingCursorRaf.current);
        pendingCursorRaf.current = null;
      }
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
        trackingTimeoutId.current = null;
      }
    };
  }, []);

  // Ensure we don't keep a stale flusher if the editor is destroyed/recreated.
  useEffect(() => {
    if (!editor) return;
    registerActiveWysiwygFlusher(() => flushToStore(editor));
    return () => {
      registerActiveWysiwygFlusher(null);
    };
  }, [editor, flushToStore]);

  // Sync external content changes TO the editor.
  useEffect(() => {
    if (!editor) return;
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;

    lastExternalContent.current = content;
    try {
      const doc = parseMarkdownToTiptapDoc(editor.schema, content);
      editor.commands.setContent(doc, { emitUpdate: false });
    } catch (error) {
      console.error("[TiptapEditor] Failed to parse external markdown:", error);
    }
  }, [content, editor]);

  return (
    <div className="tiptap-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
