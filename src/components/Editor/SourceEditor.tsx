import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  searchKeymap,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { useEditorStore } from "@/stores/editorStore";

// Compartment for dynamic line wrapping
const lineWrapCompartment = new Compartment();

export function SourceEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isInternalChange = useRef(false);

  const content = useEditorStore((state) => state.content);
  const wordWrap = useEditorStore((state) => state.wordWrap);

  // Create CodeMirror instance
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isInternalChange.current = true;
        const newContent = update.state.doc.toString();
        useEditorStore.getState().setContent(newContent);
        requestAnimationFrame(() => {
          isInternalChange.current = false;
        });
      }
    });

    const initialWordWrap = useEditorStore.getState().wordWrap;

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Line wrapping (dynamic via compartment)
        lineWrapCompartment.of(initialWordWrap ? EditorView.lineWrapping : []),
        // Multi-cursor support
        drawSelection(),
        dropCursor(),
        // History (undo/redo)
        history(),
        // Keymaps
        keymap.of([
          // Cmd+D: select next occurrence
          { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
          // Cmd+Shift+L: select all occurrences
          { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        // Markdown syntax
        markdown(),
        // Listen for changes
        updateListener,
        // Theme/styling
        EditorView.theme({
          "&": {
            fontSize: "18px",
            height: "100%",
          },
          ".cm-content": {
            fontFamily: "var(--font-sans)",
            lineHeight: "1.8",
            caretColor: "var(--text-color)",
            padding: "0",
          },
          ".cm-line": {
            padding: "0",
          },
          "&.cm-focused": {
            outline: "none",
          },
          ".cm-selectionBackground, .cm-content ::selection": {
            backgroundColor: "var(--selection-color, rgba(0, 122, 255, 0.2)) !important",
          },
          ".cm-cursor": {
            borderLeftColor: "var(--text-color)",
            borderLeftWidth: "2px",
          },
          // Secondary cursors for multi-cursor
          ".cm-cursor-secondary": {
            borderLeftColor: "var(--primary-color)",
            borderLeftWidth: "2px",
          },
        }),
        // Allow multiple selections
        EditorState.allowMultipleSelections.of(true),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Auto-focus on mount with delay for proper DOM sync
    setTimeout(() => {
      view.focus();
    }, 50);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external content changes to CodeMirror
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isInternalChange.current) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }, [content]);

  // Update line wrapping when wordWrap changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: lineWrapCompartment.reconfigure(
        wordWrap ? EditorView.lineWrapping : []
      ),
    });
  }, [wordWrap]);

  return <div ref={containerRef} className="source-editor" />;
}

export default SourceEditor;
