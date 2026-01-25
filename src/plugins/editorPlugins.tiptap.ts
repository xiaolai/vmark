import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import { Plugin, PluginKey, Selection, NodeSelection, TextSelection, type Command, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
} from "@/utils/textTransformations";
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
import { findAnyMarkRangeAtCursor, findMarkRange, findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import { getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { triggerPastePlainText } from "@/plugins/markdownPaste/tiptap";
import { handleRemoveBlockquote } from "@/plugins/formatToolbar/nodeActions.tiptap";
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
 * Open link popup for editing a regular hyperlink.
 */
function openLinkPopup(
  view: EditorView,
  markRange: { from: number; to: number },
  href: string
): boolean {
  try {
    const start = view.coordsAtPos(markRange.from);
    const end = view.coordsAtPos(markRange.to);
    useLinkPopupStore.getState().openPopup({
      href,
      linkFrom: markRange.from,
      linkTo: markRange.to,
      anchorRect: {
        top: Math.min(start.top, end.top),
        left: Math.min(start.left, end.left),
        bottom: Math.max(start.bottom, end.bottom),
        right: Math.max(start.right, end.right),
      },
    });
    // Don't call view.focus() - let popup focus its input
    return true;
  } catch {
    // Fall back to toggle if coords fail
    return expandedToggleMark(view, "link");
  }
}

/**
 * Smart link insertion with clipboard URL detection for WYSIWYG mode.
 * Checks clipboard for URL and applies link directly if found.
 * Falls back to expandedToggleMark for normal link editing.
 *
 * When cursor is inside an existing link:
 * - Bookmark link (href starts with #): opens heading picker
 * - Regular link: opens the link popup for editing
 *
 * When link popup or heading picker is already open, blocks the shortcut.
 */
function handleSmartLinkShortcut(view: EditorView): boolean {
  // Block if link popup, wiki link popup, or heading picker is already open
  if (useLinkPopupStore.getState().isOpen ||
      useWikiLinkPopupStore.getState().isOpen ||
      useHeadingPickerStore.getState().isOpen) {
    return true;
  }

  const { from, to } = view.state.selection;
  const $from = view.state.selection.$from;

  // Check if cursor is inside a wikiLink node
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "wikiLink") {
      try {
        const nodePos = $from.before(d);
        const coords = view.coordsAtPos(nodePos);
        const endCoords = view.coordsAtPos(nodePos + node.nodeSize);

        useWikiLinkPopupStore.getState().openPopup(
          {
            top: coords.top,
            left: coords.left,
            bottom: coords.bottom,
            right: endCoords.right,
          },
          String(node.attrs.value ?? ""),
          nodePos
        );
        return true;
      } catch {
        // Fall back to normal behavior if coords fail
      }
    }
  }

  // Check if we're inside an existing link
  const linkMarkType = view.state.schema.marks.link;
  if (linkMarkType) {
    const marksAtCursor = $from.marks();
    const linkMark = marksAtCursor.find((m) => m.type === linkMarkType);
    if (linkMark) {
      // Find the link's range
      const markRange = findMarkRange($from.pos, linkMark, $from.start(), $from.parent);
      if (markRange) {
        const href = linkMark.attrs.href || "";

        // All links (including bookmark links) use the same popup for editing
        return openLinkPopup(view, markRange, href);
      }
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

/**
 * Remove link from selection, keeping the text.
 */
function handleUnlinkShortcut(view: EditorView): boolean {
  const { state, dispatch } = view;
  const linkMarkType = state.schema.marks.link;
  if (!linkMarkType) return false;

  const $from = state.selection.$from;

  // Check if cursor is in a link
  const linkMark = $from.marks().find((m) => m.type === linkMarkType);
  if (!linkMark) return false;

  // Find the link's full range
  const markRange = findMarkRange($from.pos, linkMark, $from.start(), $from.parent);
  if (!markRange) return false;

  // Remove the link mark
  const tr = state.tr.removeMark(markRange.from, markRange.to, linkMarkType);
  dispatch(tr);
  view.focus();
  return true;
}

/**
 * Insert a new wiki link at cursor.
 */
function handleWikiLinkShortcut(view: EditorView): boolean {
  const { state, dispatch } = view;
  const wikiLinkType = state.schema.nodes.wikiLink;
  if (!wikiLinkType) return false;

  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";

  // Create wiki link with selected text as both target and display
  const target = selectedText || "page";
  const wikiLinkNode = wikiLinkType.create(
    { value: target },
    selectedText ? state.schema.text(selectedText) : state.schema.text(target)
  );

  const tr = state.tr.replaceSelectionWith(wikiLinkNode);
  dispatch(tr);

  // Open the popup for editing
  setTimeout(() => {
    const $pos = view.state.doc.resolve(from);
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === "wikiLink") {
        try {
          const nodePos = $pos.before(d);
          const coords = view.coordsAtPos(nodePos);
          const endCoords = view.coordsAtPos(nodePos + node.nodeSize);
          useWikiLinkPopupStore.getState().openPopup(
            {
              top: coords.top,
              left: coords.left,
              bottom: coords.bottom,
              right: endCoords.right,
            },
            String(node.attrs.value ?? ""),
            nodePos
          );
        } catch (err) {
          // coords fail when view is not attached or node position is invalid
          if (import.meta.env.DEV) {
            console.debug("[WikiLink shortcut] Failed to open popup:", err);
          }
        }
        break;
      }
    }
  }, 0);

  view.focus();
  return true;
}

/**
 * Insert bookmark link by opening heading picker.
 */
function handleBookmarkLinkShortcut(view: EditorView): boolean {
  // Block if heading picker is already open
  if (useHeadingPickerStore.getState().isOpen) {
    return true;
  }

  const { state } = view;
  const headings = extractHeadingsWithIds(state.doc);
  if (headings.length === 0) {
    // No headings - could show a toast here
    return false;
  }

  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";

  // Get anchor rect for popup positioning
  // When there's no selection width, we need a minimum width for the anchor rect
  // so the popup positioning algorithm has something to align with.
  const MINIMUM_ANCHOR_WIDTH = 10;
  const coords = view.coordsAtPos(from);
  const anchorRect = {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.left + MINIMUM_ANCHOR_WIDTH,
  };

  const containerEl = view.dom.closest(".editor-container") as HTMLElement;
  const containerBounds = containerEl
    ? getBoundaryRects(view.dom as HTMLElement, containerEl)
    : getViewportBounds();

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    const currentState = view.state;
    const linkMark = currentState.schema.marks.link;
    if (!linkMark) return;

    const tr = currentState.tr;
    const linkText = selectedText || text;
    const linkMarkInstance = linkMark.create({ href: `#${id}` });

    if (from === to) {
      // No selection - insert link with heading text
      const textNode = currentState.schema.text(linkText, [linkMarkInstance]);
      tr.insert(from, textNode);
    } else {
      // Has selection - apply link mark to selection
      tr.addMark(from, to, linkMarkInstance);
    }

    view.dispatch(tr);
    view.focus();
  }, { anchorRect, containerBounds });

  return true;
}

// --- Text transformation helpers for WYSIWYG ---

function wysiwygTransformSelection(view: EditorView, transform: (text: string) => string): boolean {
  const { state, dispatch } = view;
  const { from, to } = state.selection;
  if (from === to) return false; // No selection

  const selectedText = state.doc.textBetween(from, to, "");
  const transformed = transform(selectedText);

  if (transformed !== selectedText) {
    dispatch(state.tr.insertText(transformed, from, to));
    view.focus();
  }
  return true;
}

function doWysiwygTransformUppercase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toUpperCase);
}

function doWysiwygTransformLowercase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toLowerCase);
}

function doWysiwygTransformTitleCase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toTitleCase);
}

function doWysiwygTransformToggleCase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toggleCase);
}

// --- Line operation helpers for WYSIWYG ---

function getBlockRange(state: EditorState): { from: number; to: number; node: ReturnType<typeof state.doc.nodeAt> } | null {
  const { $from } = state.selection;
  // Find the outermost block node containing the cursor
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    // Stop at block-level nodes like paragraph, heading, etc.
    if (node.isBlock && !node.type.name.match(/^(bulletList|orderedList|blockquote|doc)$/)) {
      const from = $from.before(depth);
      const to = $from.after(depth);
      return { from, to, node };
    }
  }
  return null;
}

function doWysiwygMoveLineUp(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  // Find the previous sibling block
  const $from = state.doc.resolve(blockRange.from);
  if ($from.index($from.depth - 1) === 0) return false; // Already at top

  const prevBlockStart = $from.before($from.depth) - 1;
  const $prevFrom = state.doc.resolve(prevBlockStart);
  const prevBlock = $prevFrom.nodeBefore;
  if (!prevBlock) return false;

  const prevBlockFrom = prevBlockStart - prevBlock.nodeSize;

  // Swap blocks: delete current, insert before previous
  const currentNode = state.doc.nodeAt(blockRange.from);
  if (!currentNode) return false;

  const tr = state.tr;
  tr.delete(blockRange.from, blockRange.to);
  tr.insert(prevBlockFrom, currentNode);
  // Update selection to moved block
  tr.setSelection(TextSelection.near(tr.doc.resolve(prevBlockFrom + 1)));
  dispatch(tr);
  view.focus();
  return true;
}

function doWysiwygMoveLineDown(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  // Find the next sibling block
  const $to = state.doc.resolve(blockRange.to);
  const parentNode = $to.node($to.depth - 1);
  if ($to.index($to.depth - 1) >= parentNode.childCount - 1) return false; // Already at bottom

  const nextBlockEnd = blockRange.to + ($to.nodeAfter?.nodeSize ?? 0);
  const nextBlock = $to.nodeAfter;
  if (!nextBlock) return false;

  // Swap blocks: delete next, insert before current
  const currentNode = state.doc.nodeAt(blockRange.from);
  if (!currentNode) return false;

  const tr = state.tr;
  tr.delete(blockRange.to, nextBlockEnd);
  tr.insert(blockRange.from, nextBlock);
  // Update selection to moved block
  const newPos = blockRange.from + nextBlock.nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + 1)));
  dispatch(tr);
  view.focus();
  return true;
}

function doWysiwygDuplicateLine(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  const currentNode = state.doc.nodeAt(blockRange.from);
  if (!currentNode) return false;

  // Insert a copy after the current block
  const tr = state.tr.insert(blockRange.to, currentNode.copy(currentNode.content));
  // Move selection to duplicated block
  tr.setSelection(TextSelection.near(tr.doc.resolve(blockRange.to + 1)));
  dispatch(tr);
  view.focus();
  return true;
}

function doWysiwygDeleteLine(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  const tr = state.tr.delete(blockRange.from, blockRange.to);
  // Position cursor at the start of where the block was
  const newPos = Math.min(blockRange.from, tr.doc.content.size - 1);
  if (newPos > 0) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));
  }
  dispatch(tr);
  view.focus();
  return true;
}

function doWysiwygJoinLines(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { $from, $to, from, to } = state.selection;

  // If there's a selection spanning multiple blocks, join them
  if (from !== to) {
    const startBlock = $from.blockRange($to);
    if (startBlock && startBlock.depth > 0) {
      // Try to join the blocks
      const tr = state.tr;
      // Replace all newlines/block boundaries with spaces
      const text = state.doc.textBetween(from, to, " ");
      tr.insertText(text, from, to);
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // No selection: join current block with next
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  const $to2 = state.doc.resolve(blockRange.to);
  if (!$to2.nodeAfter) return false;

  const nextNode = $to2.nodeAfter;
  if (!nextNode.isTextblock) return false;

  const nextText = nextNode.textContent.trimStart();

  const tr = state.tr;
  // Delete next block
  tr.delete(blockRange.to, blockRange.to + nextNode.nodeSize);
  // Append next block's text to current block
  const insertPos = blockRange.to - 1;
  tr.insertText(" " + nextText, insertPos, insertPos);
  dispatch(tr);
  view.focus();
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
    shortcuts.getShortcut("unlink"),
    wrapWithMultiSelectionGuard("unlink", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleUnlinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("wikiLink"),
    wrapWithMultiSelectionGuard("wikiLink", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleWikiLinkShortcut(view);
    })
  );
  bindIfKey(
    bindings,
    shortcuts.getShortcut("bookmarkLink"),
    wrapWithMultiSelectionGuard("bookmarkLink", (_state, _dispatch, view) => {
      if (!view) return false;
      return handleBookmarkLinkShortcut(view);
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

  // Insert image - emit menu event to trigger the same flow as menu item
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), () => {
    void getCurrentWebviewWindow().emit("menu:image", getCurrentWebviewWindow().label);
    return true;
  });

  // Blockquote toggle - handle directly to avoid relying on Tauri menu accelerator
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), (_state, _dispatch, view) => {
    if (!view) return false;
    const editor = (view.dom as HTMLElement & { editor?: TiptapEditor }).editor;
    if (!editor) return false;

    if (editor.isActive("blockquote")) {
      // Remove blockquote - use handleRemoveBlockquote to unwrap the entire blockquote,
      // not just the current selection's block range (important for lists in blockquotes)
      handleRemoveBlockquote(view);
    } else {
      // Add blockquote - use ProseMirror wrap
      const { state, dispatch } = view;
      const { $from, $to } = state.selection;
      const blockquoteType = state.schema.nodes.blockquote;
      if (!blockquoteType) return false;

      // Find if we're inside a list - if so, wrap the entire list
      let wrapDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "bulletList" || node.type.name === "orderedList") {
          wrapDepth = d;
          break;
        }
      }

      let range;
      if (wrapDepth > 0) {
        // Wrap at list level
        const listStart = $from.before(wrapDepth);
        const listEnd = $from.after(wrapDepth);
        range = state.doc.resolve(listStart).blockRange(state.doc.resolve(listEnd));
      } else {
        // Normal block range for non-list content
        range = $from.blockRange($to);
      }

      if (range) {
        try {
          dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
          view.focus();
        } catch {
          // Wrap failed - might be schema constraint, ignore
        }
      }
    }
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

  // --- Line operations ---
  bindIfKey(bindings, shortcuts.getShortcut("moveLineUp"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygMoveLineUp(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("moveLineDown"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygMoveLineDown(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("duplicateLine"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygDuplicateLine(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("deleteLine"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygDeleteLine(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("joinLines"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygJoinLines(view);
  });
  // Note: Sort lines are not implemented for WYSIWYG as they work on plain text lines

  // --- Text transformations ---
  bindIfKey(bindings, shortcuts.getShortcut("transformUppercase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformUppercase(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformLowercase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformLowercase(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformTitleCase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformTitleCase(view);
  });
  bindIfKey(bindings, shortcuts.getShortcut("transformToggleCase"), (_state, _dispatch, view) => {
    if (!view) return false;
    return doWysiwygTransformToggleCase(view);
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
