import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";
import { getCursorInfoFromTiptap, restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { getTiptapEditorView } from "@/utils/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/utils/tiptapFocus";
import { createTiptapExtensions } from "@/utils/tiptapExtensions";
import type { CursorInfo } from "@/stores/documentStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { useTiptapCJKFormatCommands } from "@/hooks/useTiptapCJKFormatCommands";
import { useTiptapFormatCommands } from "@/hooks/useTiptapFormatCommands";
import { useTiptapParagraphCommands } from "@/hooks/useTiptapParagraphCommands";
import { useTiptapSelectionCommands } from "@/hooks/useTiptapSelectionCommands";
import { useTiptapTableCommands } from "@/hooks/useTiptapTableCommands";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { ImageContextMenu } from "./ImageContextMenu";
import { SourcePeek } from "./SourcePeek";

/**
 * Delay before enabling cursor tracking after editor creation.
 * Prevents spurious cursor sync during initial render/focus.
 */
const CURSOR_TRACKING_DELAY_MS = 200;


export function TiptapEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();
  const preserveLineBreaks = useSettingsStore((state) => state.markdown.preserveLineBreaks);
  const hardBreakStyleOnSave = useSettingsStore((state) => state.markdown.hardBreakStyleOnSave);
  const windowLabel = useWindowLabel();

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingCursorRaf = useRef<number | null>(null);
  const internalChangeRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  const preserveLineBreaksRef = useRef(preserveLineBreaks);
  const hardBreakStyleOnSaveRef = useRef(hardBreakStyleOnSave);
  cursorInfoRef.current = cursorInfo;
  preserveLineBreaksRef.current = preserveLineBreaks;
  hardBreakStyleOnSaveRef.current = hardBreakStyleOnSave;

  const extensions = useMemo(() => createTiptapExtensions(), []);

  const flushToStore = useCallback(
    (editor: TiptapEditor) => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }

      const markdown = serializeMarkdown(editor.schema, editor.state.doc, {
        preserveLineBreaks: preserveLineBreaksRef.current,
        hardBreakStyle: (() => {
          const tabId = useTabStore.getState().activeTabId[windowLabel];
          if (!tabId) return resolveHardBreakStyle("unknown", hardBreakStyleOnSaveRef.current);
          const doc = useDocumentStore.getState().getDocument(tabId);
          return resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSaveRef.current);
        })(),
      });

      isInternalChange.current = true;
      lastExternalContent.current = markdown;
      setContent(markdown);

      // Cancel previous RAF if pending, then schedule reset
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
      }
      internalChangeRaf.current = requestAnimationFrame(() => {
        internalChangeRaf.current = null;
        isInternalChange.current = false;
      });
    },
    [setContent, windowLabel]
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
        const doc = parseMarkdown(editor.schema, content, {
          preserveLineBreaks: preserveLineBreaksRef.current,
        });
        lastExternalContent.current = content;
        editor.commands.setContent(doc, { emitUpdate: false });
      } catch (error) {
        console.error("[TiptapEditor] Failed to parse initial markdown:", error);
        // Don't update lastExternalContent on parse error - allows retry on next sync
      }

      cursorTrackingEnabled.current = false;
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
      }
      trackingTimeoutId.current = window.setTimeout(() => {
        cursorTrackingEnabled.current = true;
      }, CURSOR_TRACKING_DELAY_MS);

      // NOTE: Flusher registration moved to useEffect to avoid dual registration issues
      // with React Strict Mode. The useEffect ensures proper cleanup on unmount.

      scheduleTiptapFocusAndRestore(
        editor,
        () => cursorInfoRef.current,
        restoreCursorInTiptap
      );

      const view = getTiptapEditorView(editor);
      if (view) {
        useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
      }
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
      const view = getTiptapEditorView(editor);
      if (!view) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(view));
      useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
    },
  });

  const getEditorView = useCallback(() => getTiptapEditorView(editor), [editor]);
  const handleImageContextMenuAction = useImageContextMenu(getEditorView);
  useOutlineSync(getEditorView);

  useTiptapParagraphCommands(editor);
  useTiptapFormatCommands(editor);
  useTiptapTableCommands(editor);
  useTiptapSelectionCommands(editor);
  useTiptapCJKFormatCommands(editor);

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    tiptapEditor: editor,
    isSourceMode: false,
    enabled: !!editor,
  });

  // Cleanup all pending timers/RAFs on unmount to prevent memory leaks
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
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
        internalChangeRaf.current = null;
      }
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
        trackingTimeoutId.current = null;
      }
    };
  }, []);

  // Register flusher that captures the current editor directly.
  // The useEffect re-runs whenever `editor` changes, so the flusher
  // always has a fresh reference to the current editor instance.
  // The cleanup function unregisters on unmount, preventing stale editors
  // from being used in React Strict Mode scenarios.
  useEffect(() => {
    if (!editor) return;
    registerActiveWysiwygFlusher(() => {
      flushToStore(editor);
    });
    return () => {
      registerActiveWysiwygFlusher(null);
    };
  }, [editor, flushToStore]);

  useEffect(() => {
    useTiptapEditorStore.getState().setEditor(editor ?? null);
    return () => {
      useTiptapEditorStore.getState().clear();
    };
  }, [editor]);

  // Sync external content changes TO the editor.
  useEffect(() => {
    if (!editor) return;
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;

    try {
      const doc = parseMarkdown(editor.schema, content, {
        preserveLineBreaks: preserveLineBreaksRef.current,
      });
      editor.commands.setContent(doc, { emitUpdate: false });
      // Only update lastExternalContent after successful parse to allow retry on failure
      lastExternalContent.current = content;
    } catch (error) {
      console.error("[TiptapEditor] Failed to parse external markdown:", error);
    }
  }, [content, editor]);

  return (
    <>
      <div className="tiptap-editor">
        <EditorContent editor={editor} />
      </div>
      <ImageContextMenu onAction={handleImageContextMenuAction} />
      <SourcePeek getEditorView={getEditorView} />
    </>
  );
}
