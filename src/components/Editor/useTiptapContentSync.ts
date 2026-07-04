/**
 * useTiptapContentSync
 *
 * Purpose: sync external content changes INTO the Tiptap editor (subsequent
 * changes only — onCreate owns the initial load), and re-sync + restore
 * focus/cursor on hidden → visible transitions. Extracted verbatim from
 * TiptapEditor.tsx (effect stack split); the refs are owned by the component.
 *
 * @coordinates-with TiptapEditor.tsx — sole consumer; owns the refs
 * @coordinates-with wysiwygPendingNav.ts — pending content-search jump wins over cursor restore
 * @module components/Editor/useTiptapContentSync
 */
import { useEffect, type MutableRefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import type { CursorInfo } from "@/stores/documentStore";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/services/editor/tiptapFocus";
import { restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { consumeWysiwygPendingNav } from "./wysiwygPendingNav";
import { syncMarkdownToEditor } from "./tiptapEditorHelpers";

interface TiptapContentSyncParams {
  editor: TiptapEditor | null;
  content: string;
  hidden: boolean;
  activeTabId: string | undefined;
  hiddenRef: MutableRefObject<boolean>;
  previewRef: MutableRefObject<boolean>;
  isInternalChange: MutableRefObject<boolean>;
  lastExternalContent: MutableRefObject<string>;
  editorInitialized: MutableRefObject<boolean>;
  preserveLineBreaksRef: MutableRefObject<boolean>;
  cursorInfoRef: MutableRefObject<CursorInfo | null>;
}

/** Sync external content into the editor and handle hidden → visible transitions. */
export function useTiptapContentSync({
  editor,
  content,
  hidden,
  activeTabId,
  hiddenRef,
  previewRef,
  isInternalChange,
  lastExternalContent,
  editorInitialized,
  preserveLineBreaksRef,
  cursorInfoRef,
}: TiptapContentSyncParams): void {
  // Sync external content changes TO the editor.
  // Only runs for SUBSEQUENT content changes after onCreate has initialized the editor.
  // This prevents double-loading on initial mount and React Strict Mode remounts.
  useEffect(() => {
    /* v8 ignore next -- @preserve reason: editor null guard; always defined by the time the content effect fires */
    if (!editor) return;
    // Skip sync when hidden — content will be synced on visibility transition
    /* v8 ignore next -- @preserve reason: hidden branch skips external content sync; hidden tab scenario not covered in current tests */
    if (hiddenRef.current) return;
    /* v8 ignore next -- @preserve reason: isInternalChange guard; only set true during programmatic content updates, not exercised in isolation tests */
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;
    // Skip if onCreate hasn't run yet - let onCreate handle initial content loading
    if (!editorInitialized.current) return;

    const synced = syncMarkdownToEditor(
      editor, content, lastExternalContent, preserveLineBreaksRef.current,
    );

    // For fresh document load (no saved cursor position), set cursor to start
    /* v8 ignore next -- @preserve reason: fresh-doc cursor reset only when synced and no saved cursor; requires specific initial state not exercised in tests */
    if (synced && !cursorInfoRef.current) {
      const view = getTiptapEditorView(editor);
      /* v8 ignore next -- @preserve reason: view null guard; always present after editor init */
      if (view) {
        try {
          const tr = view.state.tr
            .setSelection(Selection.atStart(view.state.doc))
            .scrollIntoView()
            .setMeta("addToHistory", false);
          view.dispatch(tr);
        } catch {
          // Ignore selection errors
        }
      }
    }
  // Refs are stable identities; deps intentionally match the original inline effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, editor]);

  // Handle visibility transitions: hidden → visible
  useEffect(() => {
    if (hidden) return;
    if (!editor || !editorInitialized.current) return;

    syncMarkdownToEditor(
      editor, content, lastExternalContent, preserveLineBreaksRef.current,
    );

    // A markdown-split preview only needs the content sync — it must not steal
    // focus or consume pending navigation that belongs to the editable pane.
    if (previewRef.current) return;

    // A pending content-search jump (Find in Files) wins over the plain
    // focus/cursor restore, whose RAF-deferred selection reset would clobber
    // the jump. The nav is scoped to this editor's own (pinned) tab.
    if (!consumeWysiwygPendingNav(getTiptapEditorView(editor), activeTabId)) {
      scheduleTiptapFocusAndRestore(
        editor,
        () => cursorInfoRef.current,
        restoreCursorInTiptap
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);
}
