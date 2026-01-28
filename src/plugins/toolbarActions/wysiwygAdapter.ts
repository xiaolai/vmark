import { open, message } from "@tauri-apps/plugin-dialog";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { resolveLinkPopupPayload } from "@/plugins/formatToolbar/linkPopupUtils";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveBlockquote, handleListIndent, handleListOutdent, handleRemoveList, handleToBulletList, handleToOrderedList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable, formatTable } from "@/plugins/tableUI/tableActions.tiptap";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { useTabStore } from "@/stores/tabStore";
import { collapseNewlines, formatMarkdown, formatSelection, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { normalizeLineEndings, resolveHardBreakStyle } from "@/utils/linebreaks";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { toUpperCase, toLowerCase, toTitleCase, toggleCase } from "@/utils/textTransformations";
import { readClipboardImagePath } from "@/utils/clipboardImagePath";
import { readClipboardUrl } from "@/utils/clipboardUrl";
import { withReentryGuard } from "@/utils/reentryGuard";
import { MultiSelection } from "@/plugins/multiCursor";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { WysiwygToolbarContext } from "./types";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./wysiwygMultiSelection";
import { insertWikiLink, insertBookmarkLink } from "./wysiwygAdapterLinks";
import { DEFAULT_MERMAID_DIAGRAM } from "@/plugins/mermaid/constants";
import { toggleTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";
import { expandSelectionInView, selectBlockInView, selectLineInView, selectWordInView } from "@/plugins/toolbarActions/tiptapSelectionActions";

const DEFAULT_MATH_BLOCK = "c = \\pm\\sqrt{a^2 + b^2}";
const INSERT_IMAGE_GUARD = "menu-insert-image";

/**
 * Check if an editor view is still connected and valid.
 */
function isViewConnected(view: EditorView): boolean {
  try {
    return view.dom?.isConnected ?? false;
  } catch {
    return false;
  }
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
 * Insert a new text node with link mark when no selection exists.
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
 * Get the active document file path for the current window.
 */
function getActiveFilePath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

/**
 * Insert an image node with alt text.
 */
function insertImageWithAlt(view: EditorView, src: string, alt: string, from: number, to: number): void {
  const { state } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;

  const imageNode = imageType.create({ src, alt, title: "" });
  const tr = state.tr.replaceWith(from, to, imageNode);
  view.dispatch(tr);
  view.focus();
}

/**
 * Smart image insertion with clipboard path detection.
 * Returns true if handled, false to fall back to file picker.
 *
 * Behavior:
 * - Clipboard has image URL → insert directly
 * - Clipboard has local path → copy to assets, insert relative path
 * - Selection exists → use as alt text
 * - No selection, word at cursor → use word as alt text
 * - No clipboard image → return false (fall back to file picker)
 */
async function trySmartImageInsertion(view: EditorView): Promise<boolean> {
  const clipboardResult = await readClipboardImagePath();

  // No valid clipboard image
  if (!clipboardResult?.isImage || !clipboardResult.validated) {
    return false;
  }

  // Verify view is still connected after async clipboard read
  if (!isViewConnected(view)) {
    console.warn("[wysiwygAdapter] View disconnected after clipboard read");
    return false;
  }

  // Capture selection state after async operation (may have changed)
  const { from, to } = view.state.selection;

  // Determine alt text from selection or word expansion
  let altText = "";
  let insertFrom = from;
  let insertTo = to;

  if (from !== to) {
    // Has selection: use as alt text
    altText = view.state.doc.textBetween(from, to, "");
  } else {
    // No selection: try word expansion
    const $from = view.state.selection.$from;
    const wordRange = findWordAtCursor($from);
    if (wordRange) {
      altText = view.state.doc.textBetween(wordRange.from, wordRange.to, "");
      insertFrom = wordRange.from;
      insertTo = wordRange.to;
    }
  }

  let imagePath = clipboardResult.path;

  // For local paths that need copying, copy to assets
  if (clipboardResult.needsCopy) {
    const docPath = getActiveFilePath();
    if (!docPath) {
      // Can't copy without document path, fall back to file picker
      return false;
    }

    try {
      const sourcePath = clipboardResult.resolvedPath ?? clipboardResult.path;
      imagePath = await copyImageToAssets(sourcePath, docPath);
    } catch (error) {
      console.error("[wysiwygAdapter] Failed to copy image to assets:", error);
      // Copy failed, fall back to file picker
      return false;
    }
  }

  // Re-verify view is still connected after async copy
  if (!isViewConnected(view)) {
    console.warn("[wysiwygAdapter] View disconnected after image copy");
    return false;
  }

  // Insert image with the path
  insertImageWithAlt(view, imagePath, altText, insertFrom, insertTo);
  return true;
}

/**
 * Smart link insertion with clipboard URL detection.
 * Returns true if handled, false to fall back to popup.
 */
async function trySmartLinkInsertion(view: EditorView, inLink: boolean): Promise<boolean> {
  // If already in a link, don't use clipboard - let user edit existing link
  if (inLink) return false;

  const clipboardUrl = await readClipboardUrl();
  if (!clipboardUrl) return false;

  // Verify view is still connected after async clipboard read
  if (!isViewConnected(view)) {
    console.warn("[wysiwygAdapter] View disconnected after clipboard read");
    return false;
  }

  // Get current selection (may have changed during async)
  const { from, to } = view.state.selection;

  // Has selection: apply link directly
  if (from !== to) {
    applyLinkWithUrl(view, from, to, clipboardUrl);
    return true;
  }

  // No selection: try word expansion
  const $from = view.state.selection.$from;
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    applyLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
    return true;
  }

  // No selection, no word: insert URL as linked text
  insertLinkAtCursor(view, clipboardUrl);
  return true;
}

/**
 * Find wiki link node at the cursor position.
 * Returns { pos, node } if cursor is inside a wikiLink, null otherwise.
 */
function findWikiLinkAtCursor(view: EditorView): { pos: number; node: import("@tiptap/pm/model").Node } | null {
  const { state } = view;
  const { $from } = state.selection;

  // Check if cursor is inside a wikiLink node by walking up the tree
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "wikiLink") {
      return { pos: $from.before(d), node };
    }
  }

  return null;
}

function openLinkEditor(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  // Check if cursor is inside a wiki link - if so, open wiki link popup
  const wikiLink = findWikiLinkAtCursor(view);
  if (wikiLink) {
    try {
      const coords = view.coordsAtPos(wikiLink.pos);
      const nodeSize = wikiLink.node.nodeSize;
      const endCoords = view.coordsAtPos(wikiLink.pos + nodeSize);

      useWikiLinkPopupStore.getState().openPopup(
        {
          top: coords.top,
          left: coords.left,
          bottom: coords.bottom,
          right: endCoords.right,
        },
        String(wikiLink.node.attrs.value ?? ""),
        wikiLink.pos
      );
      view.focus();
    } catch (error) {
      console.error("[wysiwygAdapter] Failed to open wiki link popup:", error);
    }
    return true;
  }

  const inLink = !!context.context?.inLink;

  // Try smart link insertion first (async, fires and forgets)
  void trySmartLinkInsertion(view, inLink).then((handled) => {
    if (handled) return;

    // Verify view is still connected before fallback
    if (!isViewConnected(view)) {
      console.warn("[wysiwygAdapter] View disconnected, skipping link popup");
      return;
    }

    // Fall back to popup or word expansion
    const selection = view.state.selection;
    const payload = resolveLinkPopupPayload(
      { from: selection.from, to: selection.to },
      context.context?.inLink ?? null
    );

    if (!payload) {
      expandedToggleMarkTiptap(view, "link");
      return;
    }

    try {
      const start = view.coordsAtPos(payload.linkFrom);
      const end = view.coordsAtPos(payload.linkTo);

      useLinkPopupStore.getState().openPopup({
        href: payload.href,
        linkFrom: payload.linkFrom,
        linkTo: payload.linkTo,
        anchorRect: {
          top: Math.min(start.top, end.top),
          left: Math.min(start.left, end.left),
          bottom: Math.max(start.bottom, end.bottom),
          right: Math.max(start.right, end.right),
        },
      });
      view.focus();
    } catch (error) {
      console.error("[wysiwygAdapter] Failed to open link popup:", error);
      expandedToggleMarkTiptap(view, "link");
    }
  });

  return true;
}

function clearFormattingInView(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const ranges = selection instanceof MultiSelection
    ? selection.ranges
    : [{ $from: selection.$from, $to: selection.$to }];
  let tr = state.tr;
  let applied = false;

  for (const range of ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from === to) continue;
    applied = true;
    state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
      if (node.isText && node.marks.length > 0) {
        node.marks.forEach((mark: PMMark) => {
          tr = tr.removeMark(
            Math.max(from, pos),
            Math.min(to, pos + node.nodeSize),
            mark.type
          );
        });
      }
    });
  }

  if (applied && tr.docChanged) {
    dispatch(tr);
    view.focus();
    return true;
  }
  return false;
}

function getCurrentHeadingLevel(editor: TiptapEditor): number | null {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  if (parent.type.name === "heading") {
    return parent.attrs.level as number;
  }
  return null;
}

function increaseHeadingLevel(editor: TiptapEditor): boolean {
  const currentLevel = getCurrentHeadingLevel(editor);
  if (currentLevel === null) {
    editor.chain().focus().setHeading({ level: 6 }).run();
    return true;
  }
  if (currentLevel > 1) {
    editor.chain().focus().setHeading({ level: (currentLevel - 1) as 1 | 2 | 3 | 4 | 5 }).run();
    return true;
  }
  return false;
}

function decreaseHeadingLevel(editor: TiptapEditor): boolean {
  const currentLevel = getCurrentHeadingLevel(editor);
  if (currentLevel === null) return false;
  if (currentLevel < 6) {
    editor.chain().focus().setHeading({ level: (currentLevel + 1) as 2 | 3 | 4 | 5 | 6 }).run();
    return true;
  }
  editor.chain().focus().setParagraph().run();
  return true;
}

function toggleBlockquote(editor: TiptapEditor): boolean {
  if (editor.isActive("blockquote")) {
    // Use handleRemoveBlockquote to properly unwrap the entire blockquote,
    // not just the current selection's block range
    handleRemoveBlockquote(editor.view);
    return true;
  }

  const { state, dispatch } = editor.view;
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
    const listStart = $from.before(wrapDepth);
    const listEnd = $from.after(wrapDepth);
    range = state.doc.resolve(listStart).blockRange(state.doc.resolve(listEnd));
  } else {
    range = $from.blockRange($to);
  }

  if (range) {
    try {
      dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
      editor.view.focus();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function normalizeDialogPath(path: string | string[] | null): string | null {
  if (!path) return null;
  if (Array.isArray(path)) return path[0] ?? null;
  return path;
}

async function insertImageFromPicker(view: EditorView): Promise<boolean> {
  const selected = await open({
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
      },
    ],
  });

  const sourcePath = normalizeDialogPath(selected);
  if (!sourcePath) return false;

  const filePath = getActiveFilePath();
  if (!filePath) {
    await message(
      "Please save the document first to copy images to assets folder.",
      { title: "Unsaved Document", kind: "warning" }
    );
    return false;
  }

  const relativePath = await copyImageToAssets(sourcePath, filePath);
  if (!isViewConnected(view)) return false;
  insertBlockImageNode(view, relativePath);
  return true;
}

function handleInsertImage(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const windowLabel = getWindowLabel();
  void withReentryGuard(windowLabel, INSERT_IMAGE_GUARD, async () => {
    const handled = await trySmartImageInsertion(view);
    if (handled) return;
    await insertImageFromPicker(view);
  });

  return true;
}

export function setWysiwygHeadingLevel(context: WysiwygToolbarContext, level: number): boolean {
  const editor = context.editor;
  if (!editor) return false;
  if (!canRunActionInMultiSelection(`heading:${level}`, context.multiSelection)) return false;

  const view = context.view;
  if (view && applyMultiSelectionHeading(view, editor, level)) return true;

  if (level === 0) {
    editor.chain().focus().setParagraph().run();
    return true;
  }

  editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  return true;
}

function insertMathBlock(context: WysiwygToolbarContext): boolean {
  const editor = context.editor;
  if (!editor) return false;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: "latex" },
      content: [{ type: "text", text: DEFAULT_MATH_BLOCK }],
    })
    .run();
  return true;
}

function insertDiagramBlock(context: WysiwygToolbarContext): boolean {
  const editor = context.editor;
  if (!editor) return false;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: DEFAULT_MERMAID_DIAGRAM }],
    })
    .run();
  return true;
}

/**
 * Insert inline math with word expansion.
 *
 * Behavior:
 * - Cursor at math_inline node → unwrap (convert to text)
 * - Has selection → wrap in math_inline, position cursor to enter edit mode
 * - No selection, word at cursor → wrap word, position cursor to enter edit mode
 * - No selection, no word → insert empty math_inline, enter edit mode
 */
function insertInlineMath(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

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
    tr.setSelection(Selection.near(tr.doc.resolve(from)));
    dispatch(tr);
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
    tr.setSelection(Selection.near(tr.doc.resolve(wordRange.from)));
    dispatch(tr);
    focusMathInput(cursorOffsetInWord);
    return true;
  }

  // Case 3: No selection, no word - insert empty math node, enter edit mode
  const mathNode = mathInlineType.create({ content: "" });
  const tr = state.tr.replaceSelectionWith(mathNode);
  tr.setSelection(Selection.near(tr.doc.resolve(from)));
  dispatch(tr);
  focusMathInput(0);
  return true;
}

export function performWysiwygToolbarAction(action: string, context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!canRunActionInMultiSelection(action, context.multiSelection)) return false;

  switch (action) {
    // Edit
    case "undo":
      return context.editor ? context.editor.commands.undo() : false;
    case "redo":
      return context.editor ? context.editor.commands.redo() : false;

    case "bold":
      return view ? expandedToggleMarkTiptap(view, "bold") : false;
    case "italic":
      return view ? expandedToggleMarkTiptap(view, "italic") : false;
    case "underline":
      return view ? expandedToggleMarkTiptap(view, "underline") : false;
    case "strikethrough":
      return view ? expandedToggleMarkTiptap(view, "strike") : false;
    case "highlight":
      return view ? expandedToggleMarkTiptap(view, "highlight") : false;
    case "superscript":
      return view ? expandedToggleMarkTiptap(view, "superscript") : false;
    case "subscript":
      return view ? expandedToggleMarkTiptap(view, "subscript") : false;
    case "code":
      return view ? expandedToggleMarkTiptap(view, "code") : false;
    case "clearFormatting":
      return view ? clearFormattingInView(view) : false;
    case "link":
      return openLinkEditor(context);
    case "increaseHeading":
      return context.editor ? increaseHeadingLevel(context.editor) : false;
    case "decreaseHeading":
      return context.editor ? decreaseHeadingLevel(context.editor) : false;
    case "bulletList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleToBulletList(view), true) : false;
    case "orderedList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleToOrderedList(view), true) : false;
    case "taskList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      if (!context.editor) return false;
      toggleTaskList(context.editor);
      return true;
    case "indent":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleListIndent(view), true) : false;
    case "outdent":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleListOutdent(view), true) : false;
    case "removeList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleRemoveList(view), true) : false;
    case "insertTable":
    case "insertTableBlock":
      if (!context.editor) return false;
      context.editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      return true;
    case "addRowAbove":
      return view ? addRowAbove(view) : false;
    case "addRow":
      return view ? addRowBelow(view) : false;
    case "addColLeft":
      return view ? addColLeft(view) : false;
    case "addCol":
      return view ? addColRight(view) : false;
    case "deleteRow":
      return view ? deleteCurrentRow(view) : false;
    case "deleteCol":
      return view ? deleteCurrentColumn(view) : false;
    case "deleteTable":
      return view ? deleteCurrentTable(view) : false;
    case "alignLeft":
      return view ? alignColumn(view, "left", false) : false;
    case "alignCenter":
      return view ? alignColumn(view, "center", false) : false;
    case "alignRight":
      return view ? alignColumn(view, "right", false) : false;
    case "alignAllLeft":
      return view ? alignColumn(view, "left", true) : false;
    case "alignAllCenter":
      return view ? alignColumn(view, "center", true) : false;
    case "alignAllRight":
      return view ? alignColumn(view, "right", true) : false;
    case "formatTable":
      return view ? formatTable(view) : false;
    case "nestQuote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleBlockquoteNest(view), true) : false;
    case "unnestQuote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleBlockquoteUnnest(view), true) : false;
    case "removeQuote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleRemoveBlockquote(view), true) : false;
    case "insertImage":
      return handleInsertImage(context);
    case "insertCodeBlock":
      if (!context.editor) return false;
      context.editor.chain().focus().setCodeBlock().run();
      return true;
    case "insertBlockquote":
      return context.editor ? toggleBlockquote(context.editor) : false;
    case "insertDivider":
      if (!context.editor) return false;
      context.editor.chain().focus().setHorizontalRule().run();
      return true;
    case "insertMath":
      return insertMathBlock(context);
    case "insertDiagram":
      return insertDiagramBlock(context);
    case "insertInlineMath":
      return insertInlineMath(context);
    case "insertBulletList":
      if (!view) return false;
      handleToBulletList(view);
      return true;
    case "insertOrderedList":
      if (!view) return false;
      handleToOrderedList(view);
      return true;
    case "insertTaskList":
      if (!context.editor) return false;
      toggleTaskList(context.editor);
      return true;
    case "insertDetails":
      if (!context.editor) return false;
      context.editor.commands.insertDetailsBlock();
      return true;
    case "insertAlertNote":
      if (!context.editor) return false;
      context.editor.commands.insertAlertBlock("NOTE");
      return true;
    case "insertAlertTip":
      if (!context.editor) return false;
      context.editor.commands.insertAlertBlock("TIP");
      return true;
    case "insertAlertImportant":
      if (!context.editor) return false;
      context.editor.commands.insertAlertBlock("IMPORTANT");
      return true;
    case "insertAlertWarning":
      if (!context.editor) return false;
      context.editor.commands.insertAlertBlock("WARNING");
      return true;
    case "insertAlertCaution":
      if (!context.editor) return false;
      context.editor.commands.insertAlertBlock("CAUTION");
      return true;
    case "insertFootnote":
      if (!context.editor) return false;
      insertFootnoteAndOpenPopup(context.editor);
      return true;
    case "link:wiki":
      return insertWikiLink(context);
    case "link:bookmark":
      return insertBookmarkLink(context);
    case "formatCJK":
      return handleFormatCJK(context);
    case "formatCJKFile":
      return handleFormatCJKFile(context);
    case "removeTrailingSpaces":
      return handleRemoveTrailingSpaces(context);
    case "collapseBlankLines":
      return handleCollapseBlankLines(context);
    case "lineEndingsLF":
      return handleLineEndings(context, "lf");
    case "lineEndingsCRLF":
      return handleLineEndings(context, "crlf");
    case "selectWord":
      return view ? selectWordInView(view) : false;
    case "selectLine":
      return view ? selectLineInView(view) : false;
    case "selectBlock":
      return view ? selectBlockInView(view) : false;
    case "expandSelection":
      return view ? expandSelectionInView(view) : false;

    // Line operations (WYSIWYG block-level operations)
    case "moveLineUp":
      return handleWysiwygMoveBlockUp(context);
    case "moveLineDown":
      return handleWysiwygMoveBlockDown(context);
    case "duplicateLine":
      return handleWysiwygDuplicateBlock(context);
    case "deleteLine":
      return handleWysiwygDeleteBlock(context);
    case "joinLines":
      return handleWysiwygJoinBlocks(context);
    case "removeBlankLines":
      return handleWysiwygRemoveBlankLines(context);

    // Text transformations
    case "transformUppercase":
      return handleWysiwygTransformCase(context, "uppercase");
    case "transformLowercase":
      return handleWysiwygTransformCase(context, "lowercase");
    case "transformTitleCase":
      return handleWysiwygTransformCase(context, "titleCase");
    case "transformToggleCase":
      return handleWysiwygTransformCase(context, "toggleCase");

    default:
      return false;
  }
}

// --- CJK formatting helpers ---

function getSerializeOptions(): { preserveLineBreaks: boolean; hardBreakStyle: "twoSpaces" | "backslash" } {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : null;
  const preserveLineBreaks = useSettingsStore.getState().markdown.preserveLineBreaks;
  const hardBreakStyleOnSave = useSettingsStore.getState().markdown.hardBreakStyleOnSave;
  const hardBreakStyle = resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSave);
  return { preserveLineBreaks, hardBreakStyle };
}

function shouldPreserveTwoSpaceBreaks(): boolean {
  return getSerializeOptions().hardBreakStyle === "twoSpaces";
}

/**
 * Apply a full-document transformation via proper editor transaction.
 * Uses ProseMirror transaction with explicit addToHistory to ensure undo works.
 */
function applyFullDocumentTransform(
  context: WysiwygToolbarContext,
  transform: (markdown: string) => string
): boolean {
  const { editor, view } = context;
  if (!editor || !view) return false;

  const serializeOpts = getSerializeOptions();

  // Serialize current editor content directly (avoids stale store data)
  const currentMarkdown = serializeMarkdown(editor.schema, editor.state.doc, serializeOpts);

  // Apply transformation
  const transformed = transform(currentMarkdown);

  // Only update if changed
  if (transformed === currentMarkdown) {
    return true;
  }

  // Parse back to ProseMirror doc and apply via transaction
  // Using replaceWith + setMeta ensures proper undo history
  try {
    const newDoc = parseMarkdown(editor.schema, transformed, {
      preserveLineBreaks: serializeOpts.preserveLineBreaks,
    });

    const { state, dispatch } = view;
    const tr = state.tr
      .replaceWith(0, state.doc.content.size, newDoc.content)
      .setMeta("addToHistory", true);

    dispatch(tr);
    view.focus();
    return true;
  } catch (error) {
    console.error("[wysiwygAdapter] Failed to apply document transform:", error);
    return false;
  }
}

function handleFormatCJK(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();

  // Check if there's a selection
  if (!editor.state.selection.empty) {
    const { state, dispatch } = view;
    const { from, to } = state.selection;
    const selectedText = state.doc.textBetween(from, to, "\n");
    const formatted = formatSelection(selectedText, config, { preserveTwoSpaceHardBreaks });
    if (formatted !== selectedText) {
      const tr = state.tr
        .replaceWith(from, to, state.schema.text(formatted))
        .setMeta("addToHistory", true);
      dispatch(tr);
      view.focus();
    }
    return true;
  }

  // No selection - format entire file
  return handleFormatCJKFile(context);
}

function handleFormatCJKFile(context: WysiwygToolbarContext): boolean {
  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();

  return applyFullDocumentTransform(context, (markdown) =>
    formatMarkdown(markdown, config, { preserveTwoSpaceHardBreaks })
  );
}

function handleRemoveTrailingSpaces(context: WysiwygToolbarContext): boolean {
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();

  return applyFullDocumentTransform(context, (markdown) =>
    removeTrailingSpaces(markdown, { preserveTwoSpaceHardBreaks })
  );
}

function handleCollapseBlankLines(context: WysiwygToolbarContext): boolean {
  return applyFullDocumentTransform(context, collapseNewlines);
}

function handleLineEndings(context: WysiwygToolbarContext, target: "lf" | "crlf"): boolean {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;

  // Apply the transformation via proper editor transaction
  applyFullDocumentTransform(context, (content) => normalizeLineEndings(content, target));

  // Update metadata in store (this doesn't affect editor state)
  if (tabId) {
    useDocumentStore.getState().setLineMetadata(tabId, { lineEnding: target });
  }

  return true;
}

// --- Block operations (WYSIWYG equivalent of line operations) ---

function handleWysiwygMoveBlockUp(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  // Find current block's position in doc
  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);

  if (blockIndex === 0) return false; // Already at top

  // Get parent and swap with previous sibling
  const parent = $from.node(blockDepth - 1);
  const prevBlock = parent.child(blockIndex - 1);
  const currentBlock = parent.child(blockIndex);

  const tr = state.tr;

  // Calculate positions
  const pos = $from.before(blockDepth);
  const prevStart = pos - prevBlock.nodeSize;

  // Delete current block and insert before prev
  tr.delete(pos, pos + currentBlock.nodeSize);
  tr.insert(prevStart, currentBlock);

  // Update selection to stay with the moved block
  const newPos = prevStart + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

function handleWysiwygMoveBlockDown(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);

  if (blockIndex >= parent.childCount - 1) return false; // Already at bottom

  const currentBlock = parent.child(blockIndex);
  const nextBlock = parent.child(blockIndex + 1);

  const tr = state.tr;

  // Calculate positions
  const pos = $from.before(blockDepth);
  const nextEnd = pos + currentBlock.nodeSize + nextBlock.nodeSize;

  // Delete next block and insert before current
  const nextStart = pos + currentBlock.nodeSize;
  tr.delete(nextStart, nextEnd);
  tr.insert(pos, nextBlock);

  // Update selection to stay with the moved block
  const newPos = pos + nextBlock.nodeSize + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

function handleWysiwygDuplicateBlock(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);
  const currentBlock = parent.child(blockIndex);

  const tr = state.tr;
  const blockEnd = $from.after(blockDepth);

  // Insert copy after current block
  tr.insert(blockEnd, currentBlock.copy(currentBlock.content));

  // Move selection to duplicated block
  const newPos = blockEnd + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

function handleWysiwygDeleteBlock(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockStart = $from.before(blockDepth);
  const blockEnd = $from.after(blockDepth);

  const tr = state.tr;
  tr.delete(blockStart, blockEnd);

  // Position cursor at start of next block or end of document
  const newPos = Math.min(blockStart, tr.doc.content.size);
  if (newPos > 0) {
    tr.setSelection(Selection.near(tr.doc.resolve(newPos)));
  }

  dispatch(tr);
  editor.commands.focus();
  return true;
}

function handleWysiwygJoinBlocks(context: WysiwygToolbarContext): boolean {
  const { editor } = context;
  if (!editor) return false;

  // Use TipTap's built-in join command
  return editor.commands.joinBackward();
}

function handleWysiwygRemoveBlankLines(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { from, to, empty } = state.selection;

  if (empty) return false; // No selection

  // Find empty block nodes within selection and delete them
  // Empty blocks: paragraphs with no content, empty list items, etc.
  const tr = state.tr;
  const nodesToDelete: { from: number; to: number }[] = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    // Check if this is a block node that's "empty" (no text content)
    if (node.isBlock && !node.isTextblock) {
      // Skip container nodes like lists, blockquotes
      return true;
    }

    if (node.isTextblock) {
      // Check if the block is empty or contains only whitespace
      const text = node.textContent;
      if (text.trim() === "") {
        // Only delete if fully within selection
        const nodeEnd = pos + node.nodeSize;
        if (pos >= from && nodeEnd <= to) {
          nodesToDelete.push({ from: pos, to: nodeEnd });
        }
      }
    }
    return true;
  });

  if (nodesToDelete.length === 0) return true; // Nothing to remove

  // Delete in reverse order to preserve positions
  for (let i = nodesToDelete.length - 1; i >= 0; i--) {
    const { from: delFrom, to: delTo } = nodesToDelete[i];
    tr.delete(tr.mapping.map(delFrom), tr.mapping.map(delTo));
  }

  dispatch(tr);
  editor.commands.focus();
  return true;
}

// --- Text transformations ---

function handleWysiwygTransformCase(
  context: WysiwygToolbarContext,
  caseType: "uppercase" | "lowercase" | "titleCase" | "toggleCase"
): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { from, to, empty } = state.selection;

  if (empty) return false; // No selection

  // Get selected text
  let selectedText = "";
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      const start = Math.max(0, from - pos);
      const end = Math.min(node.text.length, to - pos);
      if (start < end) {
        selectedText += node.text.slice(start, end);
      }
    }
  });

  if (!selectedText) return false;

  // Apply transformation
  let transformed: string;
  switch (caseType) {
    case "uppercase":
      transformed = toUpperCase(selectedText);
      break;
    case "lowercase":
      transformed = toLowerCase(selectedText);
      break;
    case "titleCase":
      transformed = toTitleCase(selectedText);
      break;
    case "toggleCase":
      transformed = toggleCase(selectedText);
      break;
  }

  if (transformed === selectedText) return true;

  // Replace text while preserving marks
  const tr = state.tr;
  tr.insertText(transformed, from, to);
  dispatch(tr);

  // Restore selection
  editor.commands.setTextSelection({ from, to: from + transformed.length });
  editor.commands.focus();
  return true;
}
