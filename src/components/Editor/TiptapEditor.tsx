import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useDocumentActions, useDocumentContent } from "@/hooks/useDocumentState";
import { parseMarkdownToTiptapDoc, serializeTiptapDocToMarkdown } from "@/utils/tiptapMarkdown";
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";

export function TiptapEditorInner() {
  const content = useDocumentContent();
  const { setContent } = useDocumentActions();

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // We parse/serialize markdown ourselves.
        // Keep Tiptap defaults for schema names and commands.
      }),
      Image.configure({ inline: false }),
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
      registerActiveWysiwygFlusher(() => flushToStore(editor));
      requestAnimationFrame(() => editor.commands.focus());
    },
    onUpdate: ({ editor }) => {
      if (pendingRaf.current) return;
      pendingRaf.current = requestAnimationFrame(() => {
        pendingRaf.current = null;
        flushToStore(editor);
      });
    },
  });

  // Cleanup pendingRaf on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
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
