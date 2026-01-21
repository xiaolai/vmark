import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  search,
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
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
import {
  getCursorInfoFromCodeMirror,
  restoreCursorInCodeMirror,
} from "@/utils/cursorSync/codemirror";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
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
  tableArrowUpKeymap,
  tableArrowDownKeymap,
  createSmartPastePlugin,
  createSourceFocusModePlugin,
  createSourceTypewriterPlugin,
  createImeGuardPlugin,
  createSourceCursorContextPlugin,
  createSourceMathPreviewPlugin,
  createSourceImagePreviewPlugin,
  sourceMultiCursorExtensions,
  sourceSpellCheckExtensions,
  sourceTableContextMenuExtensions,
  sourceTableCellHighlightExtensions,
  sourceMermaidPreviewExtensions,
  sourceAlertDecorationExtensions,
  sourceDetailsDecorationExtensions,
} from "@/plugins/codemirror";
import {
  selectAllOccurrencesInBlock,
  selectNextOccurrenceInBlock,
} from "@/plugins/codemirror/sourceMultiCursorCommands";
import "@/plugins/codemirror/source-table.css";
import "@/plugins/codemirror/source-blocks.css";
import "@/plugins/mermaidPreview/mermaid-preview.css";
import { buildSourceShortcutKeymap } from "@/plugins/codemirror/sourceShortcuts";
import { toggleTaskList } from "@/plugins/sourceFormatPopup/taskListActions";
import { guardCodeMirrorKeyBinding, runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { computeSourceCursorContext } from "@/plugins/sourceFormatPopup/cursorContext";
import { useImageDragDrop } from "@/hooks/useImageDragDrop";
import { createSourceImagePopupPlugin } from "@/plugins/sourceImagePopup";
import { createSourceLinkPopupPlugin } from "@/plugins/sourceLinkPopup";
import { createSourceMathPopupPlugin } from "@/plugins/sourceMathPopup";
import { createSourceWikiLinkPopupPlugin } from "@/plugins/sourceWikiLinkPopup";
import { createSourceFootnotePopupPlugin } from "@/plugins/sourceFootnotePopup";

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count matches in the document text.
 * Used to update the search store's match count in source mode.
 */
function countMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): number {
  if (!query) return 0;

  const flags = caseSensitive ? "g" : "gi";
  let pattern: string;

  if (useRegex) {
    pattern = query;
    // In regex mode, wholeWord is ignored (user handles it manually)
  } else {
    pattern = escapeRegExp(query);
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    // Invalid regex
    return 0;
  }

  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    count++;
    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) regex.lastIndex++;
  }

  return count;
}

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
// Compartment for source shortcuts
const shortcutKeymapCompartment = new Compartment();

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
        ...sourceMultiCursorExtensions,
        // History (undo/redo)
        history(),
        // Shortcuts from settings (dynamic via compartment)
        shortcutKeymapCompartment.of(keymap.of(buildSourceShortcutKeymap())),
        // Keymaps (no searchKeymap - we use our unified FindBar)
        keymap.of([
          // Smart list continuation (must be before default keymap)
          listContinuationKeymap,
          // Table Tab navigation (must be before tabEscape)
          tableTabKeymap,
          tableShiftTabKeymap,
          // Table arrow escape (first/last block handling)
          tableArrowUpKeymap,
          tableArrowDownKeymap,
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
          // Cmd+D: select next occurrence (current block only)
          guardCodeMirrorKeyBinding({
            key: "Mod-d",
            run: selectNextOccurrenceInBlock,
            preventDefault: true,
          }),
          // Cmd+Shift+L: select all occurrences (current block only)
          guardCodeMirrorKeyBinding({
            key: "Mod-Shift-l",
            run: selectAllOccurrencesInBlock,
            preventDefault: true,
          }),
          // Cmd+Option+W: toggle word wrap
          guardCodeMirrorKeyBinding({
            key: "Mod-Alt-w",
            run: () => {
              useEditorStore.getState().toggleWordWrap();
              return true;
            },
            preventDefault: true,
          }),
          // Note: Universal toolbar shortcut is handled by useUniversalToolbar.
          // The context-aware popup is retired in favor of the universal toolbar.
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
        // Source cursor context for toolbar actions
        createSourceCursorContextPlugin(),
        // Inline math preview
        createSourceMathPreviewPlugin(),
        // Inline image preview
        createSourceImagePreviewPlugin(),
        // Image popup editor
        createSourceImagePopupPlugin(),
        // Link popup editor
        createSourceLinkPopupPlugin(),
        // Math popup editor
        createSourceMathPopupPlugin(),
        // Wiki link popup editor
        createSourceWikiLinkPopupPlugin(),
        // Footnote popup editor
        createSourceFootnotePopupPlugin(),
        // Spell check
        ...sourceSpellCheckExtensions,
        // Table context menu
        ...sourceTableContextMenuExtensions,
        // Table cell highlight
        ...sourceTableCellHighlightExtensions,
        // Mermaid preview
        ...sourceMermaidPreviewExtensions,
        // Alert block decorations (colored left border)
        ...sourceAlertDecorationExtensions,
        // Details block decorations
        ...sourceDetailsDecorationExtensions,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
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
    setTimeout(() => {
      view.focus();
      // Restore cursor position from previous mode if available
      if (initialCursorInfo) {
        restoreCursorInCodeMirror(view, initialCursorInfo);
      }
    }, 50);

    return () => {
      unsubscribeShortcuts();
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
    // Initialize match count if there's an active search query (e.g., switched from rich-text mode)
    const initSearchState = () => {
      const view = viewRef.current;
      if (!view) return;
      const state = useSearchStore.getState();
      if (state.isOpen && state.query) {
        const text = view.state.doc.toString();
        const matchCount = countMatches(
          text,
          state.query,
          state.caseSensitive,
          state.wholeWord,
          state.useRegex
        );
        useSearchStore.getState().setMatches(matchCount, matchCount > 0 ? 0 : -1);
        // Also set the search query in CodeMirror
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
    };
    // Delay to ensure view is ready
    const timeoutId = setTimeout(initSearchState, 100);

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
          // Count matches and update store
          const text = view.state.doc.toString();
          const matchCount = countMatches(
            text,
            state.query,
            state.caseSensitive,
            state.wholeWord,
            state.useRegex
          );
          useSearchStore.getState().setMatches(matchCount, matchCount > 0 ? 0 : -1);
        } else {
          // Clear search
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
          });
          useSearchStore.getState().setMatches(0, -1);
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

    // Helper to update match count after document changes
    const updateMatchCount = () => {
      const view = viewRef.current;
      if (!view) return;
      const state = useSearchStore.getState();
      if (!state.query) return;

      const text = view.state.doc.toString();
      const matchCount = countMatches(
        text,
        state.query,
        state.caseSensitive,
        state.wholeWord,
        state.useRegex
      );
      // Keep currentIndex valid: reset to 0 if out of bounds or -1
      let newIndex = state.currentIndex;
      if (matchCount === 0) {
        newIndex = -1;
      } else if (newIndex < 0 || newIndex >= matchCount) {
        newIndex = 0;
      }
      useSearchStore.getState().setMatches(matchCount, newIndex);
    };

    // Handle replace actions via custom events
    const handleReplaceCurrent = () => {
      const view = viewRef.current;
      if (view) {
        runOrQueueCodeMirrorAction(view, () => replaceNext(view));
        // Update match count after replace - double rAF for state to settle
        requestAnimationFrame(() => requestAnimationFrame(updateMatchCount));
      }
    };

    const handleReplaceAll = () => {
      const view = viewRef.current;
      if (view) {
        runOrQueueCodeMirrorAction(view, () => replaceAll(view));
        // Update match count after replace all - double rAF for state to settle
        requestAnimationFrame(() => requestAnimationFrame(updateMatchCount));
      }
    };

    window.addEventListener("search:replace-current", handleReplaceCurrent);
    window.addEventListener("search:replace-all", handleReplaceAll);

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
      window.removeEventListener("search:replace-current", handleReplaceCurrent);
      window.removeEventListener("search:replace-all", handleReplaceAll);
    };
  }, []);

  return <div ref={containerRef} className="source-editor" />;
}

export default SourceEditor;
