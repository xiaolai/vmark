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
 *   - Hidden mode (`hidden` prop) skips store updates to prevent stale writes when
 *     keepAlive mode keeps both editors mounted.
 *   - Parent scroll reset on mount fixes a displacement bug where .editor-content retains
 *     scrollTop from WYSIWYG mode.
 *
 * @coordinates-with TiptapEditor.tsx — shares document content via documentStore
 * @coordinates-with utils/cursorSync/codemirror.ts — cursor position extraction/restoration
 * @coordinates-with stores/activeEditorStore.ts — registers as the active source view
 * @module components/Editor/SourceEditor
 */
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSearchStore } from "@/stores/searchStore";
import { useTabStore } from "@/stores/tabStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import {
  useDocumentContent,
  useDocumentCursorInfo,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import { useSourceEditorSearch } from "@/hooks/useSourceEditorSearch";
import { useSourceEditorSync } from "@/hooks/useSourceEditorSync";
import {
  getCursorInfoFromCodeMirror,
  restoreCursorInCodeMirror,
} from "@/utils/cursorSync/codemirror";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { useSourceOutlineSync } from "@/hooks/useSourceOutlineSync";
import { countMatches } from "@/utils/sourceEditorSearch";
import { createDebouncedSearchCounter } from "@/utils/debouncedSearchCount";
import {
  createSourceEditorExtensions,
  shortcutKeymapCompartment,
  readOnlyCompartment,
} from "@/utils/sourceEditorExtensions";
import { consumePendingLintScroll } from "@/hooks/lintNavigation";
import { consumePendingContentSearchNav, openFindBarWithQuery } from "@/hooks/contentSearchNavigation";

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
  hiddenRef.current = hidden;

  useSourceOutlineSync(viewRef, hidden);

  // Use document store for content (per-window state)
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();

  // Refs to capture callbacks for use in CodeMirror listener
  const setContentRef = useRef(setContent);
  const setCursorInfoRef = useRef(setCursorInfo);
  const cursorInfoRef = useRef(cursorInfo);
  setContentRef.current = setContent;
  setCursorInfoRef.current = setCursorInfo;
  cursorInfoRef.current = cursorInfo;

  // Use editor store for global settings
  const wordWrap = useEditorStore((state) => state.wordWrap);
  const showLineNumbers = useEditorStore((state) => state.showLineNumbers);
  const showBrTags = useSettingsStore((state) => state.markdown.showBrTags);
  const autoPairEnabled = useSettingsStore((state) => state.markdown.autoPairEnabled);

  // Window label for tab ID resolution (stable per window)
  const windowLabel = useWindowLabel();

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    cmViewRef: viewRef,
    isSourceMode: true,
    enabled: !hidden,
  });

  // Reset parent scroll when source editor mounts or becomes visible.
  // .editor-content retains its scrollTop from WYSIWYG mode even after
  // overflow switches to hidden, causing the source editor to appear
  // displaced (content at bottom instead of top).
  useEffect(() => {
    const editorContent = containerRef.current?.closest(".editor-content") as HTMLElement | null;
    if (editorContent && !hidden) {
      editorContent.scrollTop = 0;
    }
  }, [hidden]);

  // Create CodeMirror instance
  useEffect(() => {
    /* v8 ignore next -- @preserve guard: true branch fires only when container unmounts mid-init */
    if (!containerRef.current || viewRef.current) return; // Guard: effect deps=[] ensures single run

    const searchCounter = createDebouncedSearchCounter(
      (content, _query, _caseSensitive, _wholeWord, _useRegex) => {
        // Re-read fresh state: search params may have changed during the debounce delay
        const freshState = useSearchStore.getState();
        if (!freshState.isOpen || !freshState.query) return;
        const matchCount = countMatches(content, freshState.query, freshState.caseSensitive, freshState.wholeWord, freshState.useRegex);
        // Keep currentIndex valid: reset to 0 if out of bounds or -1
        let newIndex = freshState.currentIndex;
        if (matchCount === 0) {
          newIndex = -1;
        } else if (newIndex < 0 || newIndex >= matchCount) {
          newIndex = 0;
        }
        useSearchStore.getState().setMatches(matchCount, newIndex);
      }
    );

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
        // Update match count when document changes and search is open (debounced)
        const searchState = useSearchStore.getState();
        if (searchState.isOpen && searchState.query) {
          searchCounter.schedule(
            newContent,
            searchState.query,
            searchState.caseSensitive,
            searchState.wholeWord,
            searchState.useRegex
          );
        }
      }
      // Track cursor position for mode sync
      if (update.selectionSet || update.docChanged) {
        const info = getCursorInfoFromCodeMirror(update.view);
        setCursorInfoRef.current(info);
      }
    });

    const initialWordWrap = useEditorStore.getState().wordWrap;
    const initialShowLineNumbers = useEditorStore.getState().showLineNumbers;
    const initialShowBrTags = useSettingsStore.getState().markdown.showBrTags;
    const initialAutoPair = useSettingsStore.getState().markdown.autoPairEnabled ?? true;
    const initialLintEnabled = useSettingsStore.getState().markdown.lintEnabled ?? true;
    // Capture tabId at mount time — SourceEditor remounts per tab so this is stable
    const { activeTabId: currentTabId } = useTabStore.getState();
    /* v8 ignore next -- @preserve reason: runtime window label lookup; windowLabel always resolves in tests */
    const mountTabId = currentTabId[windowLabel] ?? undefined;
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
        initialReadOnly: readOnly,
        updateListener,
        tabId: mountTabId,
        lintEnabled: initialLintEnabled,
        filePath: mountFilePath,
      }),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Only register and focus when not hidden
    if (!hiddenRef.current) {
      useActiveEditorStore.getState().setActiveSourceView(view);
    }

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
    useSourceCursorContextStore.getState().setContext(
      computeSourceCursorContext(view),
      view
    );

    // Auto-focus and restore cursor on mount (only when visible)
    const initialCursorInfo = cursorInfo;
    let focusTimeoutId: ReturnType<typeof setTimeout> | null = null;
    if (!hiddenRef.current) {
      focusTimeoutId = setTimeout(() => {
        /* v8 ignore next -- @preserve defensive guard: view is cleared by cleanup before timeout fires */
        if (!viewRef.current) return; // Defensive — cleanup clears this timeout
        view.focus();
        if (initialCursorInfo) {
          restoreCursorInCodeMirror(view, initialCursorInfo);
        } else {
          view.dispatch({
            selection: { anchor: 0 },
            scrollIntoView: true,
          });
        }
        // Consume pending lint scroll (set when switching to Source mode for a sourceOnly diagnostic)
        if (mountTabId) {
          const pendingOffset = consumePendingLintScroll(mountTabId);
          if (pendingOffset !== undefined) {
            view.dispatch({
              effects: EditorView.scrollIntoView(
                Math.min(pendingOffset, view.state.doc.length)
              ),
            });
          }
          // Consume pending content search nav (set when opening a file from Find in Files)
          const pendingNav = consumePendingContentSearchNav(mountTabId);
          if (pendingNav) {
            const line = Math.min(pendingNav.line, view.state.doc.lines);
            const lineInfo = view.state.doc.line(line);
            view.dispatch({
              selection: { anchor: lineInfo.from },
              effects: EditorView.scrollIntoView(lineInfo.from),
            });
            // Pre-fill FindBar with the search query
            setTimeout(() => openFindBarWithQuery(pendingNav.query), 100);
          }
        }
      }, 50);
    }

    return () => {
      if (focusTimeoutId !== null) clearTimeout(focusTimeoutId);
      searchCounter.cancel();
      unsubscribeShortcuts();
      useActiveEditorStore.getState().clearSourceViewIfMatch(view);
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Register as active source view
    useActiveEditorStore.getState().setActiveSourceView(view);

    // Focus and restore cursor
    const { activeTabId: tabIds } = useTabStore.getState();
    const visibleTabId = tabIds[windowLabel] ?? undefined;
    setTimeout(() => {
      if (!viewRef.current || hiddenRef.current) return;
      view.focus();
      if (cursorInfoRef.current) {
        restoreCursorInCodeMirror(view, cursorInfoRef.current);
      }
      // Consume pending lint scroll (set when switching to Source mode for a sourceOnly diagnostic)
      if (visibleTabId) {
        const pendingOffset = consumePendingLintScroll(visibleTabId);
        if (pendingOffset !== undefined) {
          view.dispatch({
            effects: EditorView.scrollIntoView(
              Math.min(pendingOffset, view.state.doc.length)
            ),
          });
        }
        // Consume pending content search nav (set when opening a file from Find in Files)
        const pendingNav = consumePendingContentSearchNav(visibleTabId);
        if (pendingNav) {
          const line = Math.min(pendingNav.line, view.state.doc.lines);
          const lineInfo = view.state.doc.line(line);
          view.dispatch({
            selection: { anchor: lineInfo.from },
            effects: EditorView.scrollIntoView(lineInfo.from),
          });
          setTimeout(() => openFindBarWithQuery(pendingNav.query), 100);
        }
      }
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

export default SourceEditor;
