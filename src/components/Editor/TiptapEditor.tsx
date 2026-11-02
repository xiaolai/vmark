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
 *   - Initial parse (tiptapInitialLoad.ts) runs in a layout effect for a small document, so
 *     the first painted frame of a tab switch already shows it (#1634); its outside setup
 *     (jump, focus, toolbar context) waits for a passive effect, after useEditor has kept or
 *     replaced the editor. A large one, or one opened under the loading indicator, defers
 *     via setTimeout(0) so the shell paints first.
 *     A parse that fails goes to services/editor/unparseableDocument.ts (Source mode + message).
 *   - shouldRerenderOnTransaction: false — Tiptap's default full-React-rerender per
 *     transaction is wasted work here since state flows through Zustand selectors.
 *   - content-visibility only on large docs and never on macOS: .cv-enabled marks those
 *     editors, .cv-idle applies it between edits (onUpdate, onTransaction, useContentVisibilityMode).
 *   - Native spellcheck disabled above 100K chars where rescans block the main thread.
 *   - Cursor tracking is delayed 200ms after creation to prevent spurious sync during
 *     initial render/focus.
 *   - Scroll offset is remembered per tab, so a remount with no cursor to restore
 *     to comes back to the reading position instead of the top (#1249).
 *   - Flusher registration moved to useEffect (not onCreate) to handle React Strict Mode
 *     double-mount without duplicate registrations.
 *   - Hidden mode skips all store updates and content syncs, deferring to visibility transition.
 *   - Preview mode (markdown split) syncs content but skips active-editor registration.
 *
 * @coordinates-with tiptapInitialLoad.ts — the one-time initial parse, immediate or deferred
 * @coordinates-with useTiptapFlush.ts — serialize-to-store flush + adaptive debounce machinery
 * @coordinates-with SourceEditor.tsx — shares document content via documentStore
 * @coordinates-with utils/markdownPipeline/ — parseMarkdown/serializeMarkdown for round-tripping
 * @coordinates-with utils/wysiwygFlush.ts — registers flusher for on-demand serialization before save
 * @module components/Editor/TiptapEditor
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useActiveTabId, useDocumentActions, useDocumentContent, useDocumentCursorInfo } from "@/hooks/useDocumentState";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { initializeRevisionTracking } from "@/services/mcpBridge/revisionTracker";
import { useWysiwygFlusherRegistration } from "@/hooks/useWysiwygFlusherRegistration";
import { useTiptapUnmountFlush } from "@/hooks/useTiptapUnmountFlush";
import { useFileLoadStore } from "@/stores/documentStore";
import { getCursorInfoFromTiptap } from "@/utils/cursorSync/tiptap";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { PROGRAMMATIC_SELECTION_META } from "@/services/editor/tiptapFocus";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { useTiptapSettingsSync } from "@/hooks/useTiptapSettingsSync";
import type { CursorInfo } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useFocusedPaneTiptapRegistration } from "@/hooks/useFocusedPaneTiptapRegistration";
import { useFocusedPaneState } from "@/hooks/useIsFocusedPane";
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { ImageContextMenu } from "./ImageContextMenu";
import { useTiptapContentSync } from "./useTiptapContentSync";
import { useTiptapFlush } from "./useTiptapFlush";
import { useWysiwygScrollMemory } from "./useWysiwygScrollMemory";
import { followContentReplacement, useContentVisibilityMode } from "./useContentVisibilityMode";
import {
  applySpellcheckForDocSize,
  buildTiptapEditorProps,
  CURSOR_TRACKING_DELAY_MS,
  spellcheckAttrForDocSize,
  suppressCvIdleDuringEdit,
} from "./tiptapEditorHelpers";
import { type FinishInitialLoad, shouldDeferInitialParse, startInitialLoad } from "./tiptapInitialLoad";

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
  const { isFocusedPane, isFocusedPaneRef } = useFocusedPaneState(windowLabel); // only the focused split pane takes focus (#1554)

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
  /* eslint-disable react-hooks/refs -- latest-value refs read by the deferred init parse and the unmount flush before effects run */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once per mount (the editor remounts per tab); the lint toggle is applied live inside the extension
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
  // eslint-disable-next-line react-hooks/refs -- the unmount-flush cleanup must see the latest flusher even before a passive effect runs
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

  // One-time setup per editor INSTANCE (React Strict Mode double-mounts, and
  // both the layout effect and onCreate call this). Revision tracking makes user
  // edits bump the token the MCP bridge's STALE checks depend on; it is keyed
  // per tab and bound to this editor. Cursor tracking opens after a delay of
  // its own, independent of the parse — it gates selection events, not content.
  // Flusher registration lives in a useEffect (not here) to avoid dual
  // registration under React Strict Mode and clean up on unmount.
  const initializedEditor = useRef<TiptapEditor | null>(null);
  const initializeEditor = useCallback((instance: TiptapEditor): FinishInitialLoad | null => {
    if (initializedEditor.current === instance) return null;
    initializedEditor.current = instance;
    editorInitialized.current = false;
    if (activeTabId) initializeRevisionTracking(instance, activeTabId);
    const finish = startInitialLoad(instance, activeTabId, {
      lastExternalContent, editorInitialized, contentRef, hiddenRef, previewRef,
      preserveLineBreaksRef, cursorInfoRef, isFocusedPaneRef,
    });
    cursorTrackingEnabled.current = false;
    if (trackingTimeoutId.current !== null) window.clearTimeout(trackingTimeoutId.current);
    trackingTimeoutId.current = window.setTimeout(() => {
      cursorTrackingEnabled.current = true;
    }, CURSOR_TRACKING_DELAY_MS);
    return finish;
  }, [activeTabId, lastExternalContent, isFocusedPaneRef]);

  const editor = useEditor({
    editable: !readOnly,
    extensions,
    // Tiptap re-renders the React tree on every transaction by default. VMark's
    // editor state flows through Zustand selectors and explicit onUpdate/onSelectionUpdate
    // hooks, so the blanket re-render is wasted work — especially on large docs where
    // typing produces dozens of transactions per second.
    shouldRerenderOnTransaction: false,
    editorProps: buildTiptapEditorProps(content.length),
    // Tiptap emits create a task AFTER mount — too late for a small document
    // to be in the first painted frame, so the layout effect below usually
    // initializes first and this is a no-op. It still starts deferred loads.
    onCreate: ({ editor }) => initializeEditor(editor)?.(),
    onUpdate: ({ editor, transaction }) => {
      // Skip programmatic content loads (reload/external sync set preventUpdate
      // to avoid a round-trip serialization that re-dirties the doc, #806).
      if (transaction?.getMeta("preventUpdate")) return;
      // Skip updates when hidden or a preview — prevents polluting the store
      /* v8 ignore next -- @preserve reason: hidden/preview path skips update; not exercised in WYSIWYG update tests */
      if (hiddenRef.current || previewRef.current) return;

      // Suppress content-visibility during active typing; re-enable after idle,
      // preserving the viewport (#823, #1340) — see suppressCvIdleDuringEdit.
      suppressCvIdleDuringEdit(
        editorContainerRef,
        editor.state.doc.content.size,
        cvIdleTimeoutRef,
      );

      // Debounced serialize-to-store (RAF for small docs, timeout for large).
      scheduleFlush(editor);
    },
    // Programmatic loads skip onUpdate; content-visibility follows them across the threshold.
    onTransaction: (event) => followContentReplacement(editorContainerRef, event, cvIdleTimeoutRef, hiddenRef.current),
    onSelectionUpdate: ({ editor, transaction }) => {
      if (hiddenRef.current || previewRef.current) return;
      // Selection text sync runs before the cursor-tracking gate (no feedback
      // loop) so the status bar reflects the active editor after a mode switch.
      const { from, to, empty } = editor.state.selection;
      setSelectedText(empty ? "" : editor.state.doc.textBetween(from, to, "\n", " "));
      if (!cursorTrackingEnabled.current || transaction?.getMeta(PROGRAMMATIC_SELECTION_META)) return;
      const view = getTiptapEditorView(editor);
      if (!view) return;
      scheduleCursorUpdate(getCursorInfoFromTiptap(view));
      useEditorStore.getState().setTiptapContext(extractTiptapContext(editor.state), view);
    },
  });

  // Keep editorRef aligned with the live editor for the unmount-flush cleanup.
  // Synced during render (not an effect) so it is set even if a passive effect
  // hasn't run, and so it survives the reverse-order cleanup race (#755).
  // eslint-disable-next-line react-hooks/refs -- editorRef must track the live editor for the unmount flush despite reverse-order cleanup
  editorRef.current = editor ?? null;

  // A small document loads here, while the editor is committed, so the first
  // painted frame already shows it (#1634). A large one is left to onCreate,
  // which defers its parse so the shell and the loading indicator paint first.
  // The rest of the load waits for the passive effect below, which runs after
  // useEditor's own: by then Tiptap has kept this editor or destroyed it.
  const finishLoad = useRef<FinishInitialLoad | null>(null);
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (shouldDeferInitialParse(contentRef.current, useFileLoadStore.getState().active)) return;
    const finish = initializeEditor(editor);
    if (finish) finishLoad.current = finish; // a Strict Mode re-run returns none
  }, [editor, initializeEditor]);
  useEffect(() => {
    const finish = finishLoad.current;
    finishLoad.current = null;
    finish?.();
  }, [editor]);

  // Settings → editor sync (invisibles, CJK spacing, read-only) — extracted
  // effects live in useTiptapSettingsSync.
  useTiptapSettingsSync(editor, { showInvisibles, cjkLetterSpacing, readOnly });

  // Null view when hidden/preview so outline sync skips stale/preview editors.
  const getEditorView = useCallback(
    () => (hidden || preview ? null : getTiptapEditorView(editor)),
    [editor, hidden, preview]
  );
  const handleImageContextMenuAction = useImageContextMenu(getEditorView);
  useOutlineSync(getEditorView, isFocusedPane);

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

  useWysiwygScrollMemory(editorContainerRef, activeTabId, !hidden && !preview);

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
    isFocusedPaneRef,
  });

  // The container's changing classes are written directly, never through className,
  // whose re-render would overwrite them: content-visibility (mount, hide/show) and
  // code-block line numbers.
  useContentVisibilityMode({ containerRef: editorContainerRef, content, hidden, cvIdleTimeoutRef });
  useLayoutEffect(() => {
    editorContainerRef.current?.classList.toggle("show-line-numbers", codeBlockLineNumbers);
  }, [codeBlockLineNumbers]);

  return (
    <>
      <div ref={editorContainerRef} className="tiptap-editor" style={hidden ? { display: "none" } : undefined}>
        <EditorContent editor={editor} />
      </div>
      {!hidden && <ImageContextMenu onAction={(action) => void handleImageContextMenuAction(action)} />}
    </>
  );
}
