import { Extension } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import { Plugin, PluginKey, Selection, NodeSelection, type Command, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { openSourcePeek } from "@/utils/sourcePeek";
import { guardProseMirrorCommand } from "@/utils/imeGuard";
import { canRunActionInMultiSelection } from "@/plugins/toolbarActions/multiSelectionPolicy";
import { getWysiwygMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { expandedToggleMark } from "@/plugins/editorPlugins/expandedToggleMark";
import { findAnyMarkRangeAtCursor, findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { triggerPastePlainText } from "@/plugins/markdownPaste/tiptap";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readClipboardUrl } from "@/utils/clipboardUrl";


const editorKeymapPluginKey = new PluginKey("editorKeymaps");

function escapeMarkBoundary(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const { $from, empty } = selection;

  if (!empty) return false;

  const pos = $from.pos;
  const anyMarkRange = findAnyMarkRangeAtCursor(
    pos,
    $from as unknown as Parameters<typeof findAnyMarkRangeAtCursor>[1]
  );

  if (!anyMarkRange) {
    if (state.storedMarks && state.storedMarks.length > 0) {
      dispatch(state.tr.setStoredMarks([]));
      return true;
    }
    return false;
  }

  const { from: markFrom, to: markTo } = anyMarkRange;

  if (pos === markTo) {
    dispatch(state.tr.setStoredMarks([]));
    return true;
  }

  if (pos === markFrom) {
    if (markFrom > 1) {
      const tr = state.tr.setSelection(Selection.near(state.doc.resolve(markFrom - 1)));
      tr.setStoredMarks([]);
      dispatch(tr);
    } else {
      dispatch(state.tr.setStoredMarks([]));
    }
    return true;
  }

  const tr = state.tr.setSelection(Selection.near(state.doc.resolve(markTo)));
  tr.setStoredMarks([]);
  dispatch(tr);
  return true;
}

function bindIfKey(binds: Record<string, Command>, key: string, command: Command) {
  if (!key) return;
  binds[key] = guardProseMirrorCommand(command);
}

function wrapWithMultiSelectionGuard(action: string, command: Command): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const multi = getWysiwygMultiSelectionContext(view);
    if (!canRunActionInMultiSelection(action, multi)) return false;
    return command(state, dispatch, view);
  };
}

/**
 * Apply a link mark with a specific href to a range.
 */
function applyLinkWithUrl(view: EditorView, from: number, to: number, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return;

  const tr = state.tr.addMark(from, to, linkMark.create({ href: url }));
  dispatch(tr);
  view.focus();
}

/**
 * Insert a new text node with link mark when no selection/word exists.
 */
function insertLinkAtCursor(view: EditorView, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return;

  const { from } = state.selection;
  const textNode = state.schema.text(url, [linkMark.create({ href: url })]);
  const tr = state.tr.insert(from, textNode);
  dispatch(tr);
  view.focus();
}

/**
 * Insert inline math with toggle behavior for WYSIWYG mode.
 *
 * Behavior:
 * - Cursor at math_inline node → unwrap (convert to text)
 * - Has selection → wrap in math_inline, position cursor to enter edit mode
 * - No selection, word at cursor → wrap word, position cursor to enter edit mode
 * - No selection, no word → insert empty math_inline, enter edit mode
 *
 * Edit mode is triggered by positioning cursor so nodeAfter is the math node,
 * which causes inlineNodeEditing plugin to add .editing class.
 */
function handleInlineMathShortcut(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const mathInlineType = state.schema.nodes.math_inline;
  if (!mathInlineType) return false;

  const $from = state.selection.$from;

  // Check if we're in a NodeSelection of a math node - toggle off (unwrap)
  if (state.selection instanceof NodeSelection) {
    const node = state.selection.node;
    if (node.type.name === "math_inline") {
      const content = node.attrs.content || "";
      const pos = state.selection.from;
      const tr = state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        content ? state.schema.text(content) : []
      );
      // Position cursor at end of inserted text
      tr.setSelection(Selection.near(tr.doc.resolve(pos + content.length)));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // Check if cursor's nodeAfter is math_inline - toggle off (unwrap)
  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type.name === "math_inline") {
    const nodeEnd = from + nodeAfter.nodeSize;
    const content = nodeAfter.attrs.content || "";
    const tr = state.tr.replaceWith(
      from,
      nodeEnd,
      content ? state.schema.text(content) : []
    );
    // Position cursor at end of inserted text
    tr.setSelection(Selection.near(tr.doc.resolve(from + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Check if cursor's nodeBefore is math_inline - toggle off (unwrap)
  const nodeBefore = $from.nodeBefore;
  if (nodeBefore?.type.name === "math_inline") {
    const nodeStart = from - nodeBefore.nodeSize;
    const content = nodeBefore.attrs.content || "";
    const tr = state.tr.replaceWith(
      nodeStart,
      from,
      content ? state.schema.text(content) : []
    );
    // Position cursor at end of inserted text
    tr.setSelection(Selection.near(tr.doc.resolve(nodeStart + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Helper to focus math input after insertion with cursor at specific offset
  const focusMathInput = (cursorOffset?: number) => {
    requestAnimationFrame(() => {
      const mathInput = view.dom.querySelector(".math-inline.editing .math-inline-input") as HTMLInputElement;
      if (mathInput) {
        mathInput.focus();
        if (cursorOffset !== undefined) {
          mathInput.setSelectionRange(cursorOffset, cursorOffset);
        }
      }
    });
  };

  // Case 1: Has selection - wrap in math_inline, enter edit mode
  if (from !== to) {
    const selectedText = state.doc.textBetween(from, to, "");
    const mathNode = mathInlineType.create({ content: selectedText });
    const tr = state.tr.replaceSelectionWith(mathNode);
    // Position cursor before the node to trigger edit mode (nodeAfter = math)
    tr.setSelection(Selection.near(tr.doc.resolve(from)));
    dispatch(tr);
    // Cursor at end of content for selection wrapping
    focusMathInput(selectedText.length);
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    const wordText = state.doc.textBetween(wordRange.from, wordRange.to, "");
    // Calculate cursor offset within the word (restore cursor position)
    const cursorOffsetInWord = from - wordRange.from;
    const mathNode = mathInlineType.create({ content: wordText });
    const tr = state.tr.replaceWith(wordRange.from, wordRange.to, mathNode);
    // Position cursor before the node to trigger edit mode
    tr.setSelection(Selection.near(tr.doc.resolve(wordRange.from)));
    dispatch(tr);
    // Restore cursor offset within the input
    focusMathInput(cursorOffsetInWord);
    return true;
  }

  // Case 3: No selection, no word - insert empty math node, enter edit mode
  const mathNode = mathInlineType.create({ content: "" });
  const tr = state.tr.replaceSelectionWith(mathNode);
  // Position cursor before the node to trigger edit mode
  tr.setSelection(Selection.near(tr.doc.resolve(from)));
  dispatch(tr);
  focusMathInput(0);
  return true;
}

/**
 * Smart link insertion with clipboard URL detection for WYSIWYG mode.
 * Checks clipboard for URL and applies link directly if found.
 * Falls back to expandedToggleMark for normal link editing.
 */
function handleSmartLinkShortcut(view: EditorView): boolean {
  const { from, to } = view.state.selection;
  const $from = view.state.selection.$from;

  // Check if we're inside an existing link - if so, use normal toggle behavior
  const linkMark = view.state.schema.marks.link;
  if (linkMark) {
    const marksAtCursor = $from.marks();
    const hasLinkMark = marksAtCursor.some((m) => m.type === linkMark);
    if (hasLinkMark) {
      return expandedToggleMark(view, "link");
    }
  }

  // Try smart link insertion (async)
  void (async () => {
    const clipboardUrl = await readClipboardUrl();
    if (!clipboardUrl) {
      // No clipboard URL - fall back to normal behavior
      expandedToggleMark(view, "link");
      return;
    }

    // Has selection: apply link directly
    if (from !== to) {
      applyLinkWithUrl(view, from, to, clipboardUrl);
      return;
    }

    // No selection: try word expansion
    const wordRange = findWordAtCursor($from);
    if (wordRange) {
      applyLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
      return;
    }

    // No selection, no word: insert URL as linked text
    insertLinkAtCursor(view, clipboardUrl);
  })();

  return true;
}

export function buildEditorKeymapBindings(): Record<string, Command> {
  const shortcuts = useShortcutsStore.getState();
  const bindings: Record<string, Command> = {};

  bindIfKey(bindings, shortcuts.getShortcut("toggleSidebar"), () => {
    useUIStore.getState().toggleSidebar();
    return true;
  });

  // Note: sourceMode toggle is handled by useViewShortcuts hook at window level
  // to avoid double-toggle when both TipTap keymap and window handler fire

  bindIfKey(
    bindings,
    shortcuts.getShortcut("bold"),
    wrapWithMultiSelectionGuard("bold", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "bold");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("italic"),
    wrapWithMultiSelectionGuard("italic", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "italic");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("code"),
    wrapWithMultiSelectionGuard("code", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "code");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("strikethrough"),
    wrapWithMultiSelectionGuard("strikethrough", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "strike");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("underline"),
    wrapWithMultiSelectionGuard("underline", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "underline");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("link"),
    wrapWithMultiSelectionGuard("link", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleSmartLinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("highlight"),
    wrapWithMultiSelectionGuard("highlight", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "highlight");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("subscript"),
    wrapWithMultiSelectionGuard("subscript", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "subscript");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("superscript"),
    wrapWithMultiSelectionGuard("superscript", (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "superscript");
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("inlineMath"),
    wrapWithMultiSelectionGuard("inlineMath", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleInlineMathShortcut(view);
    })
  );

  bindIfKey(bindings, shortcuts.getShortcut("pastePlainText"), (_state, _dispatch, view) => {
    if (!view) return false;
    void triggerPastePlainText(view);
    return true;
  });

  bindIfKey(bindings, shortcuts.getShortcut("sourcePeek"), (_state, _dispatch, view) => {
    if (!view) return false;
    const sourcePeek = useSourcePeekStore.getState();
    if (sourcePeek.isOpen) {
      sourcePeek.close();
      return true;
    }
    const preserveLineBreaks = useSettingsStore.getState().markdown.preserveLineBreaks;
    const hardBreakStyleOnSave = useSettingsStore.getState().markdown.hardBreakStyleOnSave;
    const windowLabel = getCurrentWebviewWindow().label;
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : null;
    const hardBreakStyle = resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSave);
    openSourcePeek(view, { preserveLineBreaks, hardBreakStyle });
    return true;
  });

  bindings.Escape = guardProseMirrorCommand((_state: EditorState, _dispatch, view) => {
    if (!view) return false;
    const sourcePeek = useSourcePeekStore.getState();
    if (sourcePeek.isOpen) {
      sourcePeek.close();
      return true;
    }
    const uiStore = useUIStore.getState();
    if (uiStore.universalToolbarVisible) {
      uiStore.setUniversalToolbarVisible(false);
      return true;
    }
    return escapeMarkBoundary(view);
  });

  return bindings;
}

export const editorKeymapExtension = Extension.create({
  name: "editorKeymaps",
  priority: 1000,
  addProseMirrorPlugins() {
    let handler = keydownHandler(buildEditorKeymapBindings());
    const unsubscribe = useShortcutsStore.subscribe(() => {
      handler = keydownHandler(buildEditorKeymapBindings());
    });

    return [
      new Plugin({
        key: editorKeymapPluginKey,
        props: {
          handleKeyDown(view, event) {
            return handler(view, event);
          },
        },
        view() {
          return {
            destroy() {
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});

export { expandedToggleMark as expandedToggleMarkTiptap };
