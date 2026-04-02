/**
 * TiptapEditorInner
 *
 * Purpose: WYSIWYG rich-text editing surface built on Tiptap/ProseMirror. Parses markdown
 * to ProseMirror document on load, serializes back on every edit with adaptive debouncing.
 *
 * Key decisions:
 *   - Initial content loaded via setContentWithoutHistory to avoid polluting the undo stack
 *     with the initial parse.
 *   - Adaptive debounce (100ms for small docs, 500ms for 50KB+) balances responsiveness
 *     with serialization cost on large documents.
 *   - Cursor tracking is delayed 200ms after creation to prevent spurious sync during
 *     initial render/focus.
 *   - Flusher registration moved to useEffect (not onCreate) to handle React Strict Mode
 *     double-mount without duplicate registrations.
 *   - Hidden mode skips all store updates and content syncs, deferring to visibility transition.
 *
 * @coordinates-with SourceEditor.tsx — shares document content via documentStore
 * @coordinates-with utils/markdownPipeline/ — parseMarkdown/serializeMarkdown for round-tripping
 * @coordinates-with utils/wysiwygFlush.ts — registers flusher for on-demand serialization before save
 * @module components/Editor/TiptapEditor
 */
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
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
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { handleTableScrollToSelection } from "@/plugins/tableScroll/scrollGuard";
import { tiptapError, contentSearchLog } from "@/utils/debug";
import { consumePendingContentSearchNav, openFindBarWithQuery } from "@/hooks/contentSearchNavigation";
import { ImageContextMenu } from "./ImageContextMenu";

/**
 * Delay before enabling cursor tracking after editor creation.
 * Prevents spurious cursor sync during initial render/focus.
 */
const CURSOR_TRACKING_DELAY_MS = 200;

/**
 * Set editor content without adding to undo history.
 * Tiptap's setContent in v3.x does NOT exclude from history by default,
 * so we use a direct ProseMirror transaction with addToHistory: false.
 */
function setContentWithoutHistory(editor: TiptapEditor, doc: PMNode): void {
  const view = getTiptapEditorView(editor);
  if (!view) {
    // Fallback to standard setContent if view not available
    editor.commands.setContent(doc, { emitUpdate: false });
    return;
  }

  const { state } = view;
  const tr = state.tr
    .replaceWith(0, state.doc.content.size, doc.content)
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true); // Don't emit update event
  view.dispatch(tr);
}

/**
 * Calculate adaptive debounce delay based on document size.
 * Larger documents get longer delays to reduce parsing overhead during typing.
 *
 * @param docSize - Document size in characters
 * @returns Delay in milliseconds
 */
function getAdaptiveDebounceDelay(docSize: number): number {
  if (docSize > 50000) return 500;  // 50KB+: 500ms
  if (docSize > 20000) return 300;  // 20KB+: 300ms
  return 100;                        // Default: 100ms (using RAF for small docs)
}

/**
 * Parse markdown and sync it into the editor without touching undo history.
 * Updates lastExternalContent tracking ref on success.
 * Returns true if content was synced, false if already current or on error.
 */
function syncMarkdownToEditor(
  editor: TiptapEditor,
  markdown: string,
  lastExternalContent: MutableRefObject<string>,
  preserveLineBreaks: boolean,
): boolean {
  if (markdown === lastExternalContent.current) return false;
  try {
    const doc = parseMarkdown(editor.schema, markdown, { preserveLineBreaks });
    setContentWithoutHistory(editor, doc);
    lastExternalContent.current = markdown;
    return true;
  } catch (error) {
    tiptapError(" Failed to sync markdown:", error);
    return false;
  }
}

interface TiptapEditorInnerProps {
  hidden?: boolean;
  readOnly?: boolean;
}

/** WYSIWYG rich-text editor built on Tiptap/ProseMirror with adaptive debounced serialization. */
export function TiptapEditorInner({ hidden = false, readOnly = false }: TiptapEditorInnerProps) {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();
  const preserveLineBreaks = useSettingsStore((state) => state.markdown.preserveLineBreaks);
  const hardBreakStyleOnSave = useSettingsStore((state) => state.markdown.hardBreakStyleOnSave);
  const showLineNumbers = useEditorStore((state) => state.showLineNumbers);
  const cjkLetterSpacing = useSettingsStore((state) => state.appearance.cjkLetterSpacing);
  const lintEnabled = useSettingsStore((state) => state.markdown.lintEnabled);
  const windowLabel = useWindowLabel();
  /* v8 ignore next -- @preserve reason: runtime window label lookup; windowLabel always resolves in tests */
  const activeTabId = useTabStore((state) => state.activeTabId[windowLabel] ?? undefined);

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingDebounceTimeout = useRef<number | null>(null);
  const pendingCursorRaf = useRef<number | null>(null);
  const internalChangeRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  // Track whether onCreate has run to prevent external sync from running before editor is ready
  const editorInitialized = useRef(false);
  const preserveLineBreaksRef = useRef(preserveLineBreaks);
  const hardBreakStyleOnSaveRef = useRef(hardBreakStyleOnSave);
  const hiddenRef = useRef(hidden);
  cursorInfoRef.current = cursorInfo;
  preserveLineBreaksRef.current = preserveLineBreaks;
  hardBreakStyleOnSaveRef.current = hardBreakStyleOnSave;
  hiddenRef.current = hidden;

  const extensions = useMemo(
    () => createTiptapExtensions({ tabId: activeTabId, lintEnabled }),
    // tabId and lintEnabled are captured at mount time — editor remounts per tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
          /* v8 ignore next -- @preserve reason: no active tabId only if tab store is uninitialized; always set during normal editor lifecycle */
          if (!tabId) return resolveHardBreakStyle("unknown", hardBreakStyleOnSaveRef.current);
          const doc = useDocumentStore.getState().getDocument(tabId);
          /* v8 ignore next -- @preserve reason: doc?.hardBreakStyle ?? fallback only when doc is null; doc always present for active tab */
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
    /* v8 ignore next -- @preserve reason: null guard when no cursor update is pending; scheduling ensures value is always set before flush */
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
    editable: !readOnly,
    extensions,
    editorProps: {
      attributes: {
        class: "ProseMirror",
        // Enable native browser spellcheck for system-level spell checking
        spellcheck: "true",
      },
      // Suppress ProseMirror's default scrollRectIntoView when cursor is in a table
      // to prevent horizontal scroll jumps on .table-scroll-wrapper
      handleScrollToSelection(view) {
        return handleTableScrollToSelection(view);
      },
    },
    onCreate: ({ editor }) => {
      // Reset for this new editor instance (handles React Strict Mode double-mount)
      editorInitialized.current = false;

      try {
        const doc = parseMarkdown(editor.schema, content, {
          preserveLineBreaks: preserveLineBreaksRef.current,
        });
        lastExternalContent.current = content;
        // Use helper to avoid polluting undo history with initial content load
        setContentWithoutHistory(editor, doc);
        editorInitialized.current = true;
      } catch (error) {
        tiptapError(" Failed to parse initial markdown:", error);
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

      // Only focus/restore cursor when not hidden
      if (!hiddenRef.current) {
        scheduleTiptapFocusAndRestore(
          editor,
          () => cursorInfoRef.current,
          restoreCursorInTiptap
        );
      }

      const view = getTiptapEditorView(editor);
      if (view) {
        useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
      }
    },
    onUpdate: ({ editor }) => {
      // Skip updates when hidden — prevents polluting document store
      /* v8 ignore next -- @preserve reason: hidden path skips update; hidden mode not exercised in WYSIWYG update tests */
      if (hiddenRef.current) return;

      // Cancel any pending flush
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingDebounceTimeout.current) {
        clearTimeout(pendingDebounceTimeout.current);
        pendingDebounceTimeout.current = null;
      }

      // Use adaptive delay based on document size
      const docSize = editor.state.doc.content.size;
      const delay = getAdaptiveDebounceDelay(docSize);

      if (delay <= 100) {
        // Small documents: use RAF for immediate updates
        pendingRaf.current = requestAnimationFrame(() => {
          pendingRaf.current = null;
          flushToStore(editor);
        });
      } else {
        // Large documents: use debounced timeout
        pendingDebounceTimeout.current = window.setTimeout(() => {
          pendingDebounceTimeout.current = null;
          flushToStore(editor);
        }, delay);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (hiddenRef.current) return;
      if (!cursorTrackingEnabled.current) return;
      const view = getTiptapEditorView(editor);
      if (!view) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(view));
      useTiptapEditorStore.getState().setContext(extractTiptapContext(editor.state), view);
    },
  });

  // Return null from getEditorView when hidden to prevent outline sync from stale editor
  const getEditorView = useCallback(
    () => (hidden ? null : getTiptapEditorView(editor)),
    [editor, hidden]
  );
  const handleImageContextMenuAction = useImageContextMenu(getEditorView);
  useOutlineSync(getEditorView);

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    tiptapEditor: editor,
    isSourceMode: false,
    enabled: !!editor && !hidden,
  });

  // Cleanup all pending timers/RAFs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingDebounceTimeout.current) {
        clearTimeout(pendingDebounceTimeout.current);
        pendingDebounceTimeout.current = null;
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

  // Register flusher — only when visible
  useEffect(() => {
    if (!editor || hidden) return;
    registerActiveWysiwygFlusher(() => {
      flushToStore(editor);
    });
    return () => {
      registerActiveWysiwygFlusher(null);
    };
  }, [editor, flushToStore, hidden]);

  // Register editor stores — only when visible
  useEffect(() => {
    if (!hidden) {
      useTiptapEditorStore.getState().setEditor(editor ?? null);
      if (editor) {
        useActiveEditorStore.getState().setActiveWysiwygEditor(editor);
      }
    }
    return () => {
      useTiptapEditorStore.getState().clear();
      if (editor) {
        useActiveEditorStore.getState().clearWysiwygEditorIfMatch(editor);
      }
    };
  }, [editor, hidden]);

  // Force CJK letter spacing decorations to recalculate when setting changes.
  // The plugin tracks wasEnabled state, but needs a transaction to trigger apply().
  useEffect(() => {
    if (!editor) return;
    // Dispatch empty transaction to trigger plugin state recalculation
    const view = getTiptapEditorView(editor);
    if (view) {
      const tr = view.state.tr
        .setMeta("cjkLetterSpacingChanged", true)
        .setMeta("addToHistory", false); // Settings change shouldn't pollute undo history
      view.dispatch(tr);
    }
  }, [editor, cjkLetterSpacing]);

  // Toggle editor editability when read-only mode changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

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
  }, [content, editor]);

  // Handle visibility transitions: hidden → visible
  useEffect(() => {
    if (hidden) return;
    if (!editor || !editorInitialized.current) return;

    syncMarkdownToEditor(
      editor, content, lastExternalContent, preserveLineBreaksRef.current,
    );

    // Focus and restore cursor
    scheduleTiptapFocusAndRestore(
      editor,
      () => cursorInfoRef.current,
      restoreCursorInTiptap
    );

    // Consume pending content search nav (set when opening a file from Find in Files)
    const activeTabId = useTabStore.getState().activeTabId[windowLabel];
    if (activeTabId) {
      const pendingNav = consumePendingContentSearchNav(activeTabId);
      if (pendingNav) {
        contentSearchLog("WYSIWYG nav to line", pendingNav.line);
        // In WYSIWYG mode, scroll to approximate position by walking block nodes
        const view = getTiptapEditorView(editor);
        if (view) {
          // Walk the document to find the Nth block (lines map roughly to blocks)
          let blockCount = 0;
          let targetPos = 0;
          view.state.doc.descendants((node, pos) => {
            if (node.isBlock && node.isTextblock) {
              blockCount++;
              if (blockCount === pendingNav.line) {
                targetPos = pos;
                return false; // stop walking
              }
            }
            return true;
          });
          if (targetPos > 0) {
            view.dispatch(
              view.state.tr
                .setSelection(Selection.near(view.state.doc.resolve(targetPos)))
                .scrollIntoView()
            );
          }
          // Pre-fill FindBar after a brief delay to let the scroll settle
          setTimeout(() => openFindBarWithQuery(pendingNav.query), 100);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  /* v8 ignore next -- @preserve reason: show-line-numbers CSS class branch not exercised in current TiptapEditor render tests */
  const editorClassName = showLineNumbers
    ? "tiptap-editor show-line-numbers"
    : "tiptap-editor";

  return (
    <>
      <div className={editorClassName} style={hidden ? { display: "none" } : undefined}>
        <EditorContent editor={editor} />
      </div>
      {!hidden && <ImageContextMenu onAction={handleImageContextMenuAction} />}
    </>
  );
}
