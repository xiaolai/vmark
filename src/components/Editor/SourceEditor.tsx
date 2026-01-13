import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, toggleBlockComment } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  search,
  selectNextOccurrence,
  selectSelectionMatches,
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSearchStore } from "@/stores/searchStore";
import {
  useDocumentContent,
  useDocumentCursorInfo,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import {
  getCursorInfoFromCodeMirror,
  restoreCursorInCodeMirror,
} from "@/utils/cursorSync/codemirror";
import {
  sourceEditorTheme,
  codeHighlightStyle,
  createBrHidingPlugin,
  createListBlankLinePlugin,
  createMarkdownAutoPairPlugin,
  markdownPairBackspace,
  tabEscapeKeymap,
  tabIndentFallbackKeymap,
  shiftTabIndentFallbackKeymap,
  listContinuationKeymap,
  tableTabKeymap,
  tableShiftTabKeymap,
  createSmartPastePlugin,
  createSourceFocusModePlugin,
  createSourceTypewriterPlugin,
  createImeGuardPlugin,
} from "@/plugins/codemirror";
import { toggleTaskList } from "@/plugins/sourceFormatPopup/taskListActions";
import {
  sourceFormatExtension,
  SourceFormatPopup,
  toggleTablePopup,
  triggerFormatPopup,
  applyFormat,
} from "@/plugins/sourceFormatPopup";
import { guardCodeMirrorKeyBinding, runOrQueueCodeMirrorAction } from "@/utils/imeGuard";

// Custom brackets config for markdown (^, standard brackets)
const markdownCloseBrackets = markdownLanguage.data.of({
  closeBrackets: {
    brackets: ["(", "[", "{", '"', "'", "`", "^"],
  },
});

// Compartment for dynamic line wrapping
const lineWrapCompartment = new Compartment();
// Compartment for br tag visibility
const brVisibilityCompartment = new Compartment();
// Compartment for auto-pairing brackets
const autoPairCompartment = new Compartment();

export function SourceEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isInternalChange = useRef(false);

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
  const showBrTags = useSettingsStore((state) => state.markdown.showBrTags);
  const autoPairEnabled = useSettingsStore((state) => state.markdown.autoPairEnabled);

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
      }
      // Track cursor position for mode sync
      if (update.selectionSet || update.docChanged) {
        const info = getCursorInfoFromCodeMirror(update.view);
        setCursorInfoRef.current(info);
      }
    });

    const initialWordWrap = useEditorStore.getState().wordWrap;
    const initialShowBrTags = useSettingsStore.getState().markdown.showBrTags;
    const initialAutoPair = useSettingsStore.getState().markdown.autoPairEnabled ?? true;

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Line wrapping (dynamic via compartment)
        lineWrapCompartment.of(initialWordWrap ? EditorView.lineWrapping : []),
        // BR visibility (dynamic via compartment) - hide when showBrTags is false
        brVisibilityCompartment.of(createBrHidingPlugin(!initialShowBrTags)),
        // Auto-pair brackets (dynamic via compartment)
        autoPairCompartment.of(initialAutoPair ? closeBrackets() : []),
        // Custom markdown brackets config (^, ==, standard brackets)
        markdownCloseBrackets,
        // Markdown auto-pair with delay judgment (*, _, ~) and code fence
        createMarkdownAutoPairPlugin(),
        // Hide blank lines between list items
        createListBlankLinePlugin(),
        // Smart paste: URL on selection creates markdown link
        createSmartPastePlugin(),
        // IME guard: flush queued work after composition ends
        createImeGuardPlugin(),
        // Focus mode: dim non-current paragraph
        createSourceFocusModePlugin(),
        // Typewriter mode: keep cursor centered
        createSourceTypewriterPlugin(),
        // Multi-cursor support
        drawSelection(),
        dropCursor(),
        // History (undo/redo)
        history(),
        // Keymaps (no searchKeymap - we use our unified FindBar)
        keymap.of([
          // Smart list continuation (must be before default keymap)
          listContinuationKeymap,
          // Table Tab navigation (must be before tabEscape)
          tableTabKeymap,
          tableShiftTabKeymap,
          // Tab to jump over closing brackets (must be before default keymap)
          tabEscapeKeymap,
          // Backspace to delete both halves of markdown pairs
          markdownPairBackspace,
          // Mod+Shift+Enter: toggle task list checkbox
          guardCodeMirrorKeyBinding({
            key: "Mod-Shift-Enter",
            run: (view) => toggleTaskList(view),
            preventDefault: true,
          }),
          // Cmd+D: select next occurrence
          guardCodeMirrorKeyBinding({ key: "Mod-d", run: selectNextOccurrence, preventDefault: true }),
          // Cmd+Shift+L: select all occurrences
          guardCodeMirrorKeyBinding({ key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true }),
          // Cmd+Option+W: toggle word wrap
          guardCodeMirrorKeyBinding({
            key: "Mod-Alt-w",
            run: () => {
              useEditorStore.getState().toggleWordWrap();
              return true;
            },
            preventDefault: true,
          }),
          // Cmd+Option+T: toggle table popup (when cursor is in table)
          guardCodeMirrorKeyBinding({
            key: "Mod-Alt-t",
            run: (view) => toggleTablePopup(view),
            preventDefault: true,
          }),
          // Cmd+E: trigger format popup at cursor (context-aware)
          guardCodeMirrorKeyBinding({
            key: "Mod-e",
            run: (view) => triggerFormatPopup(view),
            preventDefault: true,
          }),
          // Cmd+`: inline code (reassigned from Cmd+E)
          guardCodeMirrorKeyBinding({
            key: "Mod-`",
            run: (view) => {
              applyFormat(view, "code");
              return true;
            },
            preventDefault: true,
          }),
          // Cmd+/: override to prevent default toggle comment (used for source mode toggle)
          guardCodeMirrorKeyBinding({
            key: "Mod-/",
            run: () => true, // Consume the key, let menu handle source mode toggle
            preventDefault: true,
          }),
          // Cmd+Shift+\: toggle HTML comment <!-- -->
          guardCodeMirrorKeyBinding({
            key: "Mod-Shift-\\",
            run: (view) => toggleBlockComment(view),
            preventDefault: true,
          }),
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          // Fallback Tab handlers: insert spaces if Tab/Shift-Tab not handled above
          tabIndentFallbackKeymap,
          shiftTabIndentFallbackKeymap,
        ]),
        // Search extension (programmatic control only, no panel)
        search(),
        // Markdown syntax with code block language support
        markdown({ codeLanguages: languages }),
        // Syntax highlighting for code blocks
        syntaxHighlighting(codeHighlightStyle, { fallback: true }),
        // Listen for changes
        updateListener,
        // Theme/styling
        sourceEditorTheme,
        // Allow multiple selections
        EditorState.allowMultipleSelections.of(true),
        // Source format popup (shows on selection)
        sourceFormatExtension,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Auto-focus and restore cursor on mount
    // Capture cursorInfo at mount time (before it might change)
    const initialCursorInfo = cursorInfo;
    setTimeout(() => {
      view.focus();
      // Restore cursor position from previous mode if available
      if (initialCursorInfo) {
        restoreCursorInCodeMirror(view, initialCursorInfo);
      }
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
      runOrQueueCodeMirrorAction(view, () => {
        view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
        });
      });
    }
  }, [content]);

  // Update line wrapping when wordWrap changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: lineWrapCompartment.reconfigure(
          wordWrap ? EditorView.lineWrapping : []
        ),
      });
    });
  }, [wordWrap]);

  // Update br visibility when showBrTags changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: brVisibilityCompartment.reconfigure(
          createBrHidingPlugin(!showBrTags)
        ),
      });
    });
  }, [showBrTags]);

  // Update auto-pairing when setting changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: autoPairCompartment.reconfigure(
          autoPairEnabled ? closeBrackets() : []
        ),
      });
    });
  }, [autoPairEnabled]);

  // Subscribe to searchStore for programmatic search
  useEffect(() => {
    const unsubscribe = useSearchStore.subscribe((state, prevState) => {
      const view = viewRef.current;
      if (!view) return;

      // Update search query when it changes
      if (
        state.query !== prevState.query ||
        state.caseSensitive !== prevState.caseSensitive ||
        state.wholeWord !== prevState.wholeWord ||
        state.useRegex !== prevState.useRegex
      ) {
        if (state.query) {
          const query = new SearchQuery({
            search: state.query,
            caseSensitive: state.caseSensitive,
            wholeWord: state.wholeWord,
            regexp: state.useRegex,
          });
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(query) });
          });
        } else {
          // Clear search
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
          });
        }
      }

      // Handle find next/previous
      if (state.currentIndex !== prevState.currentIndex && state.currentIndex >= 0) {
        const direction = state.currentIndex > prevState.currentIndex ? 1 : -1;
        if (direction > 0) {
          runOrQueueCodeMirrorAction(view, () => findNext(view));
        } else {
          runOrQueueCodeMirrorAction(view, () => findPrevious(view));
        }
      }

      // Handle replace
      if (state.replaceText !== prevState.replaceText && state.isOpen) {
        const query = new SearchQuery({
          search: state.query,
          replace: state.replaceText,
          caseSensitive: state.caseSensitive,
          wholeWord: state.wholeWord,
          regexp: state.useRegex,
        });
        runOrQueueCodeMirrorAction(view, () => {
          view.dispatch({ effects: setSearchQuery.of(query) });
        });
      }
    });

    // Handle replace actions via custom events
    const handleReplaceCurrent = () => {
      const view = viewRef.current;
      if (view) runOrQueueCodeMirrorAction(view, () => replaceNext(view));
    };

    const handleReplaceAll = () => {
      const view = viewRef.current;
      if (view) runOrQueueCodeMirrorAction(view, () => replaceAll(view));
    };

    window.addEventListener("search:replace-current", handleReplaceCurrent);
    window.addEventListener("search:replace-all", handleReplaceAll);

    return () => {
      unsubscribe();
      window.removeEventListener("search:replace-current", handleReplaceCurrent);
      window.removeEventListener("search:replace-all", handleReplaceAll);
    };
  }, []);

  return (
    <>
      <div ref={containerRef} className="source-editor" />
      <SourceFormatPopup />
    </>
  );
}

export default SourceEditor;
