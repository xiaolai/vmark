import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSearchStore } from "@/stores/searchStore";
import {
  useDocumentContent,
  useDocumentCursorInfo,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import { useSourceMenuCommands } from "@/hooks/useSourceMenuCommands";
import { useSourceEditorSearch } from "@/hooks/useSourceEditorSearch";
import { useSourceEditorSync } from "@/hooks/useSourceEditorSync";
import {
  getCursorInfoFromCodeMirror,
  restoreCursorInCodeMirror,
} from "@/utils/cursorSync/codemirror";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import "@/plugins/codemirror/source-table.css";
import "@/plugins/codemirror/source-blocks.css";
import "@/plugins/mermaidPreview/mermaid-preview.css";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { countMatches } from "@/utils/sourceEditorSearch";
import {
  createSourceEditorExtensions,
  shortcutKeymapCompartment,
} from "@/utils/sourceEditorExtensions";

export function SourceEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isInternalChange = useRef(false);

  useSourceMenuCommands(viewRef);

  // Use document store for content (per-window state)
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent, setCursorInfo } = useDocumentActions();

  // Refs to capture callbacks for use in CodeMirror listener
  const setContentRef = useRef(setContent);
  const setCursorInfoRef = useRef(setCursorInfo);
  setContentRef.current = setContent;
  setCursorInfoRef.current = setCursorInfo;

  // Use editor store for global settings
  const wordWrap = useEditorStore((state) => state.wordWrap);
  const showLineNumbers = useEditorStore((state) => state.showLineNumbers);
  const showBrTags = useSettingsStore((state) => state.markdown.showBrTags);
  const autoPairEnabled = useSettingsStore((state) => state.markdown.autoPairEnabled);

  // Handle image drag-drop from Finder/Explorer
  useImageDragDrop({
    cmViewRef: viewRef,
    isSourceMode: true,
    enabled: true,
  });

  // Create CodeMirror instance
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isInternalChange.current = true;
        const newContent = update.state.doc.toString();
        setContentRef.current(newContent);
        requestAnimationFrame(() => {
          isInternalChange.current = false;
        });
        // Update match count when document changes and search is open
        const searchState = useSearchStore.getState();
        if (searchState.isOpen && searchState.query) {
          const matchCount = countMatches(
            newContent,
            searchState.query,
            searchState.caseSensitive,
            searchState.wholeWord,
            searchState.useRegex
          );
          // Keep currentIndex valid: reset to 0 if out of bounds or -1
          let newIndex = searchState.currentIndex;
          if (matchCount === 0) {
            newIndex = -1;
          } else if (newIndex < 0 || newIndex >= matchCount) {
            newIndex = 0;
          }
          useSearchStore.getState().setMatches(matchCount, newIndex);
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

    const state = EditorState.create({
      doc: content,
      extensions: createSourceEditorExtensions({
        initialWordWrap,
        initialShowBrTags,
        initialAutoPair,
        initialShowLineNumbers,
        updateListener,
      }),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    // Register with activeEditorStore for unified menu dispatcher
    useActiveEditorStore.getState().setActiveSourceView(view);

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

    // Auto-focus and restore cursor on mount
    // Capture cursorInfo at mount time (before it might change)
    const initialCursorInfo = cursorInfo;
    const focusTimeoutId = setTimeout(() => {
      // Guard: view may have been destroyed if component unmounted quickly
      if (!viewRef.current) return;
      view.focus();
      // Restore cursor position from previous mode if available
      if (initialCursorInfo) {
        restoreCursorInCodeMirror(view, initialCursorInfo);
      }
    }, 50);

    return () => {
      clearTimeout(focusTimeoutId);
      unsubscribeShortcuts();
      // Use conditional clear to avoid clearing a newly active view
      useActiveEditorStore.getState().clearSourceViewIfMatch(view);
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Use extracted hooks for sync and search functionality
  useSourceEditorSync({
    viewRef,
    isInternalChange,
    content,
    wordWrap,
    showBrTags,
    autoPairEnabled,
    showLineNumbers,
  });

  useSourceEditorSearch(viewRef);

  return <div ref={containerRef} className={`source-editor${showLineNumbers ? " show-line-numbers" : ""}`} />;
}

export default SourceEditor;
