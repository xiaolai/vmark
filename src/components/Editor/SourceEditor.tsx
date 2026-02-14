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

interface SourceEditorProps {
  hidden?: boolean;
}

export function SourceEditor({ hidden = false }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isInternalChange = useRef(false);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useSourceMenuCommands(viewRef);

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
    if (!containerRef.current || viewRef.current) return;

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
        if (!viewRef.current) return;
        view.focus();
        if (initialCursorInfo) {
          restoreCursorInCodeMirror(view, initialCursorInfo);
        } else {
          view.dispatch({
            selection: { anchor: 0 },
            scrollIntoView: true,
          });
        }
      }, 50);
    }

    return () => {
      if (focusTimeoutId !== null) clearTimeout(focusTimeoutId);
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
    setTimeout(() => {
      if (!viewRef.current || hiddenRef.current) return;
      view.focus();
      if (cursorInfoRef.current) {
        restoreCursorInCodeMirror(view, cursorInfoRef.current);
      }
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

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
