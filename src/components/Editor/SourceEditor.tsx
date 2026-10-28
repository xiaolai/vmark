/**
 * SourceEditor
 *
 * Purpose: CodeMirror-based markdown source editing surface. Provides raw markdown editing
 * with syntax highlighting, line numbers, and bidirectional cursor sync with WYSIWYG mode.
 *
 * Key decisions:
 *   - CodeMirror instance is created once on mount (not per content change) — external
 *     content changes are patched in via dispatch to preserve undo history.
 *   - `isInternalChange` ref prevents echo loops: edits from CodeMirror → store → back
 *     to CodeMirror are suppressed.
 *   - Hidden mode (`hidden` prop) skips store updates (and provenance reports) to prevent
 *     stale writes when keepAlive mode keeps both editors mounted.
 *   - Parent scroll reset on mount fixes a displacement bug where .editor-content retains
 *     scrollTop from WYSIWYG mode.
 *   - Scroll offset is remembered per tab, so a remount with no cursor to restore
 *     to comes back to the reading position instead of the top (#1249).
 *
 * @coordinates-with TiptapEditor.tsx — shares document content via documentStore
 * @coordinates-with sourceFocusRestore.ts — the shared focus/cursor/scroll restore step
 * @coordinates-with sourceCursorTracker.ts — per-frame cursor snapshot and selected text
 * @coordinates-with services/search/sourceSearchCounter.ts — recounts find matches after edits
 * @coordinates-with stores/editorStore.ts — registers as the active source view
 * @coordinates-with services/agentJournal/collectors/sourceCollector.ts — reports edits ahead of the store write
 * @module components/Editor/SourceEditor
 */
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useShortcutsStore } from "@/stores/settingsStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useSourcePaneFocus } from "@/hooks/useSourcePaneFocus";
import { useIsFocusedPane } from "@/hooks/useIsFocusedPane";
import {
  useActiveTabId, useDocumentContent,
  useDocumentCursorInfo,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import { useSourceEditorSearch } from "@/hooks/useSourceEditorSearch";
import { useSourceEditorSync } from "@/hooks/useSourceEditorSync";
import { trackEditorScroll } from "@/services/editor/scrollPosition";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { useSourceOutlineSync } from "@/hooks/useSourceOutlineSync";
import { createSourceSearchRecount, sourceSearchPlace } from "@/services/search/sourceSearchCounter";
import {
  createSourceEditorExtensions,
  shortcutKeymapCompartment,
  readOnlyCompartment,
} from "@/services/assembly/sourceEditorExtensions";
import { focusAndRestoreSource, scheduleSourceFocusRestore } from "./sourceFocusRestore";
import { createSourceCursorTracker, sourceCursorExtension, type SourceCursorTracker } from "./sourceCursorTracker";
import { createSourceProvenance } from "@/services/agentJournal/collectors/sourceCollector";

interface SourceEditorProps {
  hidden?: boolean;
  readOnly?: boolean;
}

/** CodeMirror-based markdown source editor with syntax highlighting and bidirectional cursor sync. */
export function SourceEditor({ hidden = false, readOnly = false }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isInternalChange = useRef(false);
  const hiddenRef = useRef(hidden);
  const cursorTrackerRef = useRef<SourceCursorTracker | null>(null);

  // Use document store for content (per-window state)
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const tabId = useActiveTabId() ?? undefined; // THIS pane's tab — the window's active tab is the other pane's in a split (#1554)
  const { setContent, setCursorInfo, setSelectedText } = useDocumentActions(tabId);

  // Refs to capture callbacks for use in CodeMirror listener
  const setContentRef = useRef(setContent);
  const setCursorInfoRef = useRef(setCursorInfo);
  const setSelectedTextRef = useRef(setSelectedText);
  const cursorInfoRef = useRef(cursorInfo);
  // Latest-value refs synced during render: read by CodeMirror's update listener, a delayed focus/restore setTimeout, and an interval poll — all of which can fire before a passive effect would flush, so they need pre-commit freshness (#1063).
  /* eslint-disable react-hooks/refs -- latest-value refs read by CodeMirror listeners and timers that can fire before passive effects flush */
  hiddenRef.current = hidden;
  setContentRef.current = setContent;
  setCursorInfoRef.current = setCursorInfo;
  setSelectedTextRef.current = setSelectedText;
  cursorInfoRef.current = cursorInfo;
  /* eslint-enable react-hooks/refs */

  const wordWrap = useUIStore((state) => state.wordWrap);
  const showLineNumbers = useUIStore((state) => state.showLineNumbers);
  const showBrTags = useSettingsStore((state) => state.markdown.showBrTags);
  const showInvisibles = useSettingsStore((state) => state.markdown.showInvisibles);
  const autoPairEnabled = useSettingsStore((state) => state.markdown.autoPairEnabled);

  // Window label for tab ID resolution (stable per window)
  const windowLabel = useWindowLabel();
  const isFocusedPaneRef = useSourcePaneFocus(viewRef, windowLabel, hidden); // #1081
  const isFocusedPane = useIsFocusedPane(windowLabel);
  useSourceOutlineSync(viewRef, hidden || !isFocusedPane); // outline clicks address the focused pane only (#1554)

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    cmViewRef: viewRef,
    isSourceMode: true,
    enabled: !hidden,
  });

  // Reset parent scroll on mount/show: .editor-content keeps its WYSIWYG scrollTop
  // after overflow flips to hidden, displacing the source editor's content.
  useEffect(() => {
    const editorContent = containerRef.current?.closest(".editor-content") as HTMLElement | null;
    if (editorContent && !hidden) {
      editorContent.scrollTop = 0;
    }
  }, [hidden]);

  // On hide: publish a cursor snapshot still waiting for its frame (WYSIWYG restores from it),
  // then clear shared selectedText so the status bar stops showing this editor's selection.
  useEffect(() => {
    if (!hidden) return;
    cursorTrackerRef.current?.flush();
    setSelectedTextRef.current("");
  }, [hidden]);

  // Create CodeMirror instance
  useEffect(() => {
    /* v8 ignore next -- @preserve guard: true branch fires only when container unmounts mid-init */
    if (!containerRef.current || viewRef.current) return; // Guard: effect deps=[] ensures single run

    // Recount after edits; the current match keeps its place by position.
    const searchRecount = createSourceSearchRecount();

    const cursorTracker = createSourceCursorTracker({
      setCursorInfo: (info) => setCursorInfoRef.current(info),
      setSelectedText: (text) => setSelectedTextRef.current(text),
    });
    cursorTrackerRef.current = cursorTracker;

    const updateListener = EditorView.updateListener.of((update) => {
      // Skip updates when hidden — prevents polluting document store
      if (hiddenRef.current) return;

      if (update.docChanged) {
        isInternalChange.current = true;
        const newContent = update.state.doc.toString();
        setContentRef.current(newContent);
        requestAnimationFrame(() => {
          isInternalChange.current = false;
        });
        searchRecount.schedule(update.view); // only while the find bar has a query
      }
      // Track cursor position (once per frame) and selected text for mode sync
      if (update.selectionSet || update.docChanged) cursorTracker.track(update);
    });

    const initialWordWrap = useUIStore.getState().wordWrap;
    const initialShowLineNumbers = useUIStore.getState().showLineNumbers;
    const initialShowBrTags = useSettingsStore.getState().markdown.showBrTags;
    const initialShowInvisibles = useSettingsStore.getState().markdown.showInvisibles;
    const initialAutoPair = useSettingsStore.getState().markdown.autoPairEnabled ?? true;
    const initialLintEnabled = useSettingsStore.getState().markdown.lintEnabled ?? true;
    const mountTabId = tabId; // this pane's tab at mount time — SourceEditor remounts per tab, so it is stable
    // Reports each edit to the tab's provenance session before the store write; takes its start token now.
    const provenance = createSourceProvenance(mountTabId, () => !hiddenRef.current);
    // Capture file path for language mode detection (YAML vs markdown)
    /* v8 ignore next 2 -- @preserve reason: documentStore access at mount time; filePath is always available */
    const mountFilePath = mountTabId
      ? useDocumentStore.getState().documents[mountTabId]?.filePath ?? null
      : null;

    const state = EditorState.create({
      doc: content,
      extensions: createSourceEditorExtensions({
        initialWordWrap,
        initialShowBrTags,
        initialAutoPair,
        initialShowLineNumbers,
        initialShowInvisibles,
        initialReadOnly: readOnly,
        updateListener: [provenance.extension, updateListener, sourceCursorExtension, sourceSearchPlace],
        tabId: mountTabId,
        lintEnabled: initialLintEnabled,
        filePath: mountFilePath,
      }),
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    provenance.start(view);

    // Register only when visible + focused pane (#1081).
    if (!hiddenRef.current && isFocusedPaneRef.current) useEditorStore.getState().setActiveSourceView(view, mountTabId);

    const updateShortcutKeymap = () => {
      runOrQueueCodeMirrorAction(view, () => {
        view.dispatch({
          effects: shortcutKeymapCompartment.reconfigure(
            keymap.of(buildSourceShortcutKeymap())
          ),
        });
      });
    };
    updateShortcutKeymap();
    const unsubscribeShortcuts = useShortcutsStore.subscribe(updateShortcutKeymap);
    useEditorStore.getState().setSourceContext(
      computeSourceCursorContext(view),
      view
    );

    // Remember this tab's reading position while the view lives (#1249).
    const stopScrollMemory = trackEditorScroll(view.scrollDOM, mountTabId, "source");

    // Auto-focus and restore cursor/scroll on mount (only when visible)
    const initialCursorInfo = cursorInfo;
    const cancelFocusRestore = hiddenRef.current ? null : scheduleSourceFocusRestore(view, () => {
      /* v8 ignore next -- @preserve defensive guard: view is cleared by cleanup before timeout fires */
      if (!viewRef.current) return; // Defensive — cleanup cancels this restore
      focusAndRestoreSource(view, mountTabId, initialCursorInfo, isFocusedPaneRef.current); // only the focused pane takes focus (#1554)
    });

    return () => {
      cancelFocusRestore?.();
      searchRecount.cancel();
      unsubscribeShortcuts();
      stopScrollMemory();
      useEditorStore.getState().clearSourceViewIfMatch(view);
      cursorTracker.flush(); // a snapshot still waiting for its frame is published, not lost
      provenance.stop();
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once: creates the CodeMirror view; later prop changes are pushed by dedicated effects
  }, []);

  // Handle visibility transitions: hidden → visible
  useEffect(() => {
    if (hidden) return;
    const view = viewRef.current;
    /* v8 ignore next -- @preserve defensive guard: view is always set when this effect runs */
    if (!view) return;

    // Sync content from document store to CodeMirror
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      runOrQueueCodeMirrorAction(view, () => {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: content,
          },
        });
      });
    }

    // Register as active source view (focused pane only, #1081).
    if (isFocusedPaneRef.current) useEditorStore.getState().setActiveSourceView(view, tabId);

    // Focus and restore cursor/scroll
    scheduleSourceFocusRestore(view, () => {
      if (!viewRef.current || hiddenRef.current) return;
      focusAndRestoreSource(view, tabId, cursorInfoRef.current, isFocusedPaneRef.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the visibility transition only; it reads the current render's values when it runs
  }, [hidden]);

  // Toggle read-only mode when prop changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          EditorState.readOnly.of(readOnly)
        ),
      });
    });
  }, [readOnly]);

  // Use extracted hooks for sync and search functionality
  useSourceEditorSync({
    viewRef,
    isInternalChange,
    content,
    wordWrap,
    showBrTags,
    autoPairEnabled,
    showLineNumbers,
    showInvisibles,
    getCursorInfo: () => cursorInfoRef.current,
    hiddenRef,
  });

  useSourceEditorSearch(viewRef);

  return (
    <div
      ref={containerRef}
      className={`source-editor${showLineNumbers ? " show-line-numbers" : ""}`}
      style={hidden ? { display: "none" } : undefined}
    />
  );
}
