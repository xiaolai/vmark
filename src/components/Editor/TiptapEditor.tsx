/**
 * TiptapEditorInner
 *
 * Purpose: WYSIWYG rich-text editing surface built on Tiptap/ProseMirror. Parses markdown
 * to ProseMirror document on load, serializes back on every edit with adaptive debouncing.
 *
 * Key decisions:
 *   - Initial content loaded via setContentWithoutHistory to avoid polluting the undo stack
 *     with the initial parse.
 *   - Adaptive debounce (100ms–5s) scales with document size: larger docs get longer
 *     delays to reduce serialization frequency without losing keystrokes on unmount.
 *   - Initial parse is deferred via setTimeout(0) so the editor shell renders before the
 *     heavy markdown→PM conversion runs, keeping the UI responsive on large documents.
 *   - shouldRerenderOnTransaction: false — Tiptap's default full-React-rerender per
 *     transaction is wasted work here since state flows through Zustand selectors.
 *   - content-visibility gated on .cv-idle (off during typing) and only above
 *     CV_IDLE_CHAR_THRESHOLD; stripped during edits, skipped on small docs (#823).
 *   - Native spellcheck disabled above 100K chars where rescans block the main thread.
 *   - Cursor tracking is delayed 200ms after creation to prevent spurious sync during
 *     initial render/focus.
 *   - Flusher registration moved to useEffect (not onCreate) to handle React Strict Mode
 *     double-mount without duplicate registrations.
 *   - Hidden mode skips all store updates and content syncs, deferring to visibility transition.
 *   - Preview mode (markdown split) syncs content but skips active-editor registration.
 *
 * @coordinates-with useTiptapFlush.ts — serialize-to-store flush + adaptive debounce machinery
 * @coordinates-with SourceEditor.tsx — shares document content via documentStore
 * @coordinates-with utils/markdownPipeline/ — parseMarkdown/serializeMarkdown for round-tripping
 * @coordinates-with utils/wysiwygFlush.ts — registers flusher for on-demand serialization before save
 * @module components/Editor/TiptapEditor
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useActiveTabId, useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { initializeRevisionTracking } from "@/hooks/mcpBridge/revisionTracker";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { useWysiwygFlusherRegistration } from "@/hooks/useWysiwygFlusherRegistration";
import { useTiptapUnmountFlush } from "@/hooks/useTiptapUnmountFlush";
import { useFileLoadStore } from "@/stores/documentStore";
import { getCursorInfoFromTiptap, restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/services/editor/tiptapFocus";
import { createTiptapExtensions } from "@/services/assembly/tiptapExtensions";
import { useTiptapSettingsSync } from "@/hooks/useTiptapSettingsSync";
import type { CursorInfo } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useFocusedPaneTiptapRegistration } from "@/hooks/useFocusedPaneTiptapRegistration";
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { tiptapError } from "@/utils/debug";
import { consumeWysiwygPendingNav } from "./wysiwygPendingNav";
import { ImageContextMenu } from "./ImageContextMenu";
import { useTiptapContentSync } from "./useTiptapContentSync";
import { useTiptapFlush } from "./useTiptapFlush";
import {
  applySpellcheckForDocSize,
  buildTiptapEditorProps,
  CURSOR_TRACKING_DELAY_MS,
  CV_IDLE_CHAR_THRESHOLD,
  setContentWithoutHistory,
  spellcheckAttrForDocSize,
  suppressCvIdleDuringEdit,
  syncMarkdownToEditor,
} from "./tiptapEditorHelpers";

interface TiptapEditorInnerProps {
  hidden?: boolean;
  readOnly?: boolean;
  /** Markdown-split live preview: syncs content but never the active editor. */
  preview?: boolean;
}

/** WYSIWYG rich-text editor built on Tiptap/ProseMirror with adaptive debounced serialization. */
export function TiptapEditorInner({ hidden = false, readOnly = false, preview = false }: TiptapEditorInnerProps) {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  // Keyed per tab (#1081) — pin store writes to this editor's own tab so a
  // late flush after a tab switch can't hit the new tab (cross-tab bleed).
  const activeTabId = useActiveTabId() ?? undefined;
  const { setContent, setCursorInfo, setSelectedText } = useDocumentActions(activeTabId);
  const preserveLineBreaks = useSettingsStore((state) => state.markdown.preserveLineBreaks);
  const hardBreakStyleOnSave = useSettingsStore((state) => state.markdown.hardBreakStyleOnSave);
  const codeBlockLineNumbers = useSettingsStore((state) => state.markdown.codeBlockLineNumbers);
  const cjkLetterSpacing = useSettingsStore((state) => state.appearance.cjkLetterSpacing);
  const showInvisibles = useSettingsStore((state) => state.markdown.showInvisibles);
  const windowLabel = useWindowLabel();

  const pendingCursorRaf = useRef<number | null>(null);
  const pendingCursorInfo = useRef<CursorInfo | null>(null);
  const cursorTrackingEnabled = useRef(false);
  const trackingTimeoutId = useRef<number | null>(null);
  const cursorInfoRef = useRef(cursorInfo);
  // Track whether onCreate has run to prevent external sync from running before editor is ready
  const editorInitialized = useRef(false);
  const preserveLineBreaksRef = useRef(preserveLineBreaks);
  const hardBreakStyleOnSaveRef = useRef(hardBreakStyleOnSave);
  const hiddenRef = useRef(hidden);
  const previewRef = useRef(preview);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const cvIdleTimeoutRef = useRef<number | null>(null);
  const contentRef = useRef(content);
  const editorRef = useRef<TiptapEditor | null>(null);
  // Latest-value refs synced during render: a deferred init parse (setTimeout) + the unmount-flush read these and need the latest committed value before effects run (#1063).
  /* eslint-disable react-hooks/refs */
  cursorInfoRef.current = cursorInfo;
  preserveLineBreaksRef.current = preserveLineBreaks;
  hardBreakStyleOnSaveRef.current = hardBreakStyleOnSave;
  hiddenRef.current = hidden;
  previewRef.current = preview;
  contentRef.current = content;
  /* eslint-enable react-hooks/refs */

  const extensions = useMemo(
    () => createTiptapExtensions({ tabId: activeTabId }),
    // tabId is captured at mount time — editor remounts per tab. The lint
    // toggle is handled LIVE inside the lint extension (settings-store
    // subscription), so it is deliberately not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Serialization flush + adaptive debounce machinery (useTiptapFlush) —
  // ref identities live there, stable for unmount-flush/content-sync below.
  const {
    isInternalChange,
    lastExternalContent,
    pendingRaf,
    pendingDebounceTimeout,
    internalChangeRaf,
    flushToStore,
    flushToStoreRef,
    scheduleFlush,
  } = useTiptapFlush({
    activeTabId,
    windowLabel,
    setContent,
    preserveLineBreaksRef,
    hardBreakStyleOnSaveRef,
  });
  // Synced during render so the unmount-flush cleanup below sees the latest flusher
  // even if a passive effect hasn't run yet (#755).
  // eslint-disable-next-line react-hooks/refs
  flushToStoreRef.current = flushToStore;

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
    // Tiptap re-renders the React tree on every transaction by default. VMark's
    // editor state flows through Zustand selectors and explicit onUpdate/onSelectionUpdate
    // hooks, so the blanket re-render is wasted work — especially on large docs where
    // typing produces dozens of transactions per second.
    shouldRerenderOnTransaction: false,
    editorProps: buildTiptapEditorProps(content.length),
    onCreate: ({ editor }) => {
      // Reset for this new editor instance (handles React Strict Mode double-mount)
      editorInitialized.current = false;

      // Wire MCP revision tracking so user edits bump the revision token that
      // optimistic-concurrency (STALE) checks in the MCP bridge depend on. The
      // transaction listener is bound to this editor and torn down with it.
      // Revision is keyed per tab (WI-0.10); this editor owns the active tab.
      if (activeTabId) initializeRevisionTracking(editor, activeTabId);

      // Capture content at mount time — the closure value is stable for this editor instance.
      const contentSnapshot = content;

      // Capture the in-flight load id (if any) so a stale completion from a
      // previous tab cannot clear a newer load indicator.
      const loadIdAtMount = useFileLoadStore.getState().active
        ? useFileLoadStore.getState().loadId
        : null;

      // Defer the heavy markdown→PM parse so the editor shell renders before the parse
      // blocks the main thread. For large documents this keeps the UI responsive.
      setTimeout(() => {
        if (editor.isDestroyed) return;
        try {
          const doc = parseMarkdown(editor.schema, contentSnapshot, {
            preserveLineBreaks: preserveLineBreaksRef.current,
          });
          // Use helper to avoid polluting undo history with initial content load
          setContentWithoutHistory(editor, doc);
          lastExternalContent.current = contentSnapshot;
          editorInitialized.current = true;

          // If content drifted while the deferred parse was pending, sync the
          // fresh value now — otherwise the external-sync effect (gated on
          // editorInitialized) already skipped it and would not refire until
          // the next content change.
          if (contentRef.current !== contentSnapshot) {
            syncMarkdownToEditor(
              editor, contentRef.current, lastExternalContent, preserveLineBreaksRef.current,
            );
          }
        } catch (error) {
          tiptapError(" Failed to parse initial markdown:", error);
          editorInitialized.current = true; // Unblock external sync even on parse error
        } finally {
          // Clear the "Opening large file…" StatusBar indicator once this
          // editor has a doc and is interactive. Scope the clear to the
          // loadId we captured at mount so a stale completion from a prior
          // tab cannot wipe a newer indicator.
          if (loadIdAtMount !== null) {
            useFileLoadStore.getState().endLoad(loadIdAtMount);
          }
        }

        const view = getTiptapEditorView(editor);

        // Focus/cursor restore after content is set (skipped for hidden/preview
        // so the preview can't steal focus from the editable source pane). A
        // pending content-search jump takes priority: the RAF-deferred focus
        // restore would clobber its selection, and without this consumption
        // the initial navigation was dropped entirely — the visibility effect
        // runs before this deferred init and never re-fires.
        if (!hiddenRef.current && !previewRef.current) {
          if (!consumeWysiwygPendingNav(view, activeTabId)) {
            scheduleTiptapFocusAndRestore(
              editor,
              () => cursorInfoRef.current,
              restoreCursorInTiptap
            );
          }
        }

        if (view && !previewRef.current) {
          useEditorStore.getState().setTiptapContext(extractTiptapContext(editor.state), view);
        }
      }, 0);

      // Cursor tracking setup is immediate — it starts the delay timer independently
      // of the parse, since it gates selection events not content loading.
      cursorTrackingEnabled.current = false;
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
      }
      trackingTimeoutId.current = window.setTimeout(() => {
        cursorTrackingEnabled.current = true;
      }, CURSOR_TRACKING_DELAY_MS);

      // NOTE: Flusher registration lives in a useEffect (not here) to avoid
      // dual registration under React Strict Mode and clean up on unmount.
    },
    onUpdate: ({ editor, transaction }) => {
      // Skip programmatic content loads (reload/external sync set preventUpdate
      // to avoid a round-trip serialization that re-dirties the doc, #806).
      if (transaction?.getMeta("preventUpdate")) return;
      // Skip updates when hidden or a preview — prevents polluting the store
      /* v8 ignore next -- @preserve reason: hidden/preview path skips update; not exercised in WYSIWYG update tests */
      if (hiddenRef.current || previewRef.current) return;

      // Suppress content-visibility during active typing; re-enable after
      // idle on large docs only (#823) — see suppressCvIdleDuringEdit.
      suppressCvIdleDuringEdit(
        editorContainerRef,
        editor.state.doc.content.size,
        cvIdleTimeoutRef,
      );

      // Debounced serialize-to-store (RAF for small docs, timeout for large).
      scheduleFlush(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      if (hiddenRef.current || previewRef.current) return;
      // Selection text sync runs before the cursor-tracking gate (no feedback
      // loop) so the status bar reflects the active editor after a mode switch.
      const { from, to, empty } = editor.state.selection;
      setSelectedText(empty ? "" : editor.state.doc.textBetween(from, to, "\n", " "));
      if (!cursorTrackingEnabled.current) return;
      const view = getTiptapEditorView(editor);
      if (!view) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(view));
      useEditorStore.getState().setTiptapContext(extractTiptapContext(editor.state), view);
    },
  });

  // Keep editorRef aligned with the live editor for the unmount-flush cleanup.
  // Synced during render (not an effect) so it is set even if a passive effect
  // hasn't run, and so it survives the reverse-order cleanup race (#755).
  // eslint-disable-next-line react-hooks/refs
  editorRef.current = editor ?? null;

  // Settings → editor sync (invisibles, CJK spacing, read-only) — extracted
  // effects live in useTiptapSettingsSync.
  useTiptapSettingsSync(editor, { showInvisibles, cjkLetterSpacing, readOnly });

  // Null view when hidden/preview so outline sync skips stale/preview editors.
  const getEditorView = useCallback(
    () => (hidden || preview ? null : getTiptapEditorView(editor)),
    [editor, hidden, preview]
  );
  const handleImageContextMenuAction = useImageContextMenu(getEditorView);
  useOutlineSync(getEditorView);

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    tiptapEditor: editor,
    isSourceMode: false,
    enabled: !!editor && !hidden && !preview,
  });

  // Cleanup pending timers/RAFs on unmount. Flush pending content BEFORE
  // cancelling — keystrokes in the debounce window live only in PM's doc (#755).
  useTiptapUnmountFlush({
    pendingRaf,
    pendingDebounceTimeout,
    pendingCursorRaf,
    internalChangeRaf,
    trackingTimeoutId,
    cvIdleTimeoutRef,
    editorRef,
    flushToStoreRef,
  });

  // Register save/Save-All flushers — only when visible and NOT a preview (a
  // preview must never serialize the read-only WYSIWYG over the source markdown).
  useWysiwygFlusherRegistration(editor, { flushToStore, hidden, preview, activeTabId });

  // Register into editorStore — visible + focused pane only (#1081).
  useFocusedPaneTiptapRegistration(editor, { hidden, preview, activeTabId, windowLabel });

  // Clear shared selectedText when this editor becomes hidden — prevents
  // its last selection from lingering in the status bar while the other
  // editor (Source mode) is active.
  useEffect(() => {
    if (hidden) setSelectedText("");
  }, [hidden, setSelectedText]);

  // Re-apply the spellcheck cutoff when the document crosses the 100K-char
  // threshold mid-session — the mount-time editorProps value never updates
  // on its own. The dep is the derived attribute, so the effect fires only
  // on threshold crossings (at most once per debounced flush), not per edit.
  const spellcheckAttr = spellcheckAttrForDocSize(content.length);
  useEffect(() => {
    if (!editor) return;
    applySpellcheckForDocSize(editor, contentRef.current.length);
  }, [editor, spellcheckAttr]);

  // Sync external content changes TO the editor (subsequent changes only —
  // onCreate owns the initial load) and handle hidden → visible transitions.
  // Extracted effects live in useTiptapContentSync.
  useTiptapContentSync({
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
  });

  // Initial cv-idle application is gated on document size — small docs skip the
  // optimization entirely to avoid the layout-shift / shaking pattern described
  // above CV_IDLE_CHAR_THRESHOLD. `content.length` is a cheap proxy for the PM
  // doc size (close enough for the threshold check; the exact post-parse size
  // governs onUpdate toggling).
  const shouldUseCvIdle = content.length >= CV_IDLE_CHAR_THRESHOLD;
  const editorClassName = [
    "tiptap-editor",
    shouldUseCvIdle ? "cv-idle" : null,
    codeBlockLineNumbers ? "show-line-numbers" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div ref={editorContainerRef} className={editorClassName} style={hidden ? { display: "none" } : undefined}>
        <EditorContent editor={editor} />
      </div>
      {!hidden && <ImageContextMenu onAction={handleImageContextMenuAction} />}
    </>
  );
}
