/**
 * WYSIWYG Adapter
 *
 * Purpose: Toolbar action dispatcher for WYSIWYG mode — maps every action ID
 * (formatting, insert, media, CJK, block ops) to the appropriate handler.
 * Implementations split across category-specific modules for the ~300-line limit.
 *
 * Pipeline: toolbar click -> runToolbarAction(id) -> switch(id) -> handler module
 * Key decisions:
 *   - Single giant switch for action routing (simple, greppable, no abstraction overhead)
 *   - True block insertions go AFTER the current block via `blockInsertPos`,
 *     never split it at the caret — the contract alerts and details already used
 *   - Multi-selection actions delegate to wysiwygMultiSelection.ts for per-range handling
 *   - Handler implementations split by category (links: wysiwygAdapterLinks.ts):
 *     - wysiwygAdapterFormatting.ts — text formatting, blockquote, case transforms
 *     - wysiwygHeadingLevel.ts — heading-level stepping (numeric: H1 → … → H6)
 *     - wysiwygAdapterInsert.ts — images, video, audio, YouTube, math, diagrams
 *     - wysiwygAdapterCodeBlock.ts — code block insertion / list-to-code conversion
 *     - wysiwygAdapterTables.ts — table insert/row/column/alignment/format operations
 *     - wysiwygAdapterLinkEditor.ts — link/wiki-link editing with smart clipboard
 *     - wysiwygAdapterCjk.ts — CJK formatting, trailing spaces, line endings
 *     - wysiwygAdapterBlockOps.ts — line move/duplicate/delete/join
 *     - wysiwygLineUnit.ts — resolves which node is "the line" for those
 *     - wysiwygAdapterUtils.ts — shared helpers (view checks, file paths, transforms)
 *
 * @coordinates-with sourceAdapter.ts — parallel implementation for Source mode
 * @coordinates-with enableRules.ts — decides which actions are enabled
 * @coordinates-with UniversalToolbar.tsx — calls runToolbarAction on button click
 * @module plugins/toolbarActions/wysiwygAdapter
 */
import type { AlertType } from "@/plugins/alertBlock/tiptap";
import { expandedToggleMark as expandedToggleMarkTiptap } from "@/plugins/editorPlugins/expandedToggleMark";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveBlockquote, handleListIndent, handleListOutdent, handleRemoveList, handleToBulletList, handleToOrderedList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { toggleTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";
import { expandSelectionInView, selectBlockInView, selectLineInView, selectWordInView } from "@/plugins/toolbarActions/tiptapSelectionActions";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./wysiwygMultiSelection";
import { insertWikiLink, insertBookmarkLink, removeLinkAtCursor } from "./wysiwygAdapterLinks";
import { clearFormattingInView, toggleBlockquote, handleWysiwygTransformCase, toggleQuoteStyleAtCursor } from "./wysiwygAdapterFormatting";
import { increaseHeadingLevel, decreaseHeadingLevel } from "./wysiwygHeadingLevel";
import { handleInsertImage, handleInsertVideo, handleInsertAudio, insertMathBlock, insertDiagramBlock, insertGraphvizBlock, insertMarkmapBlock, insertInlineMath } from "./wysiwygAdapterInsert";
import { handleInsertCodeBlock } from "./wysiwygAdapterCodeBlock";
import { openLinkEditor } from "./wysiwygAdapterLinkEditor";
import { handleFormatCJK, handleFormatCJKFile, handleRemoveTrailingSpaces, handleCollapseBlankLines, handleLineEndings } from "./wysiwygAdapterCjk";
import { blockInsertPos } from "@/plugins/shared/blockInsertPos";
import { handleWysiwygMoveBlockUp, handleWysiwygMoveBlockDown, handleWysiwygDuplicateBlock, handleWysiwygDeleteBlock, handleWysiwygJoinBlocks, handleWysiwygRemoveBlankLines } from "./wysiwygAdapterBlockOps";
import { performWysiwygTableAction } from "./wysiwygAdapterTables";
import type { WysiwygToolbarContext } from "./types";

const ALERT_TYPE_BY_ACTION = {
  insertAlertNote: "NOTE",
  insertAlertTip: "TIP",
  insertAlertImportant: "IMPORTANT",
  insertAlertWarning: "WARNING",
  insertAlertCaution: "CAUTION",
} as const satisfies Record<string, AlertType>;

/**
 * Set heading level in WYSIWYG mode. Exported for direct use by menu commands.
 * Level 0 means "paragraph" (remove heading).
 */
export function setWysiwygHeadingLevel(context: WysiwygToolbarContext, level: number): boolean {
  const editor = context.editor;
  if (!editor) return false;
  // The cast below to Tiptap's heading union is only sound for real levels.
  if (!Number.isInteger(level) || level < 0 || level > 6) return false;
  if (!canRunActionInMultiSelection(`heading:${level}`, context.multiSelection)) return false;

  const view = context.view;
  if (view && applyMultiSelectionHeading(view, editor, level)) return true;

  if (level === 0) {
    return editor.chain().focus().setParagraph().run();
  }

  return editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
}

/**
 * Main dispatcher: routes a toolbar action ID to the appropriate handler.
 * Returns true if the action was handled, false otherwise.
 */
export function performWysiwygToolbarAction(action: string, context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!canRunActionInMultiSelection(action, context.multiSelection)) return false;

  switch (action) {
    // Edit
    case "undo":
      return context.editor ? context.editor.commands.undo() : false;
    case "redo":
      return context.editor ? context.editor.commands.redo() : false;

    // Inline formatting
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

    // Links
    case "link":
      return openLinkEditor(context);
    case "link:wiki":
      return insertWikiLink(context);
    case "link:bookmark":
      return insertBookmarkLink(context);
    case "unlink":
      return removeLinkAtCursor(context);

    // Headings
    case "increaseHeading":
      return context.editor ? increaseHeadingLevel(context.editor) : false;
    case "decreaseHeading":
      return context.editor ? decreaseHeadingLevel(context.editor) : false;

    // Lists
    case "bulletList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? handleToBulletList(view) : false;
    case "orderedList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? handleToOrderedList(view) : false;
    case "taskList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return context.editor ? toggleTaskList(context.editor) : false;
    case "indent":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? handleListIndent(view) : false;
    case "outdent":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? handleListOutdent(view) : false;
    case "removeList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? handleRemoveList(view) : false;

    // Table operations (implementations in wysiwygAdapterTables.ts)
    case "insertTable":
    case "insertTableBlock":
    case "addRowAbove":
    case "addRow":
    case "addColLeft":
    case "addCol":
    case "deleteRow":
    case "deleteCol":
    case "deleteTable":
    case "alignLeft":
    case "alignCenter":
    case "alignRight":
    case "alignAllLeft":
    case "alignAllCenter":
    case "alignAllRight":
    case "formatTable":
      return performWysiwygTableAction(action, context);

    // Blockquote
    case "nestBlockquote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? handleBlockquoteNest(view) : false;
    case "unnestBlockquote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? handleBlockquoteUnnest(view) : false;
    case "removeBlockquote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? handleRemoveBlockquote(view) : false;
    case "insertBlockquote":
      return context.editor ? toggleBlockquote(context.editor) : false;

    // Insert actions
    case "insertImage":
      return handleInsertImage(context);
    case "insertVideo":
      return handleInsertVideo(context);
    case "insertAudio":
      return handleInsertAudio(context);
    case "insertCodeBlock":
      return handleInsertCodeBlock(context);
    case "insertDivider":
      if (!context.editor) return false;
      // Placed AFTER the current block, not at the caret. `setHorizontalRule`
      // splits the paragraph, so a rule dropped mid-sentence cut the sentence in
      // half. Alerts and details already use `blockInsertPos`; this is the same
      // contract for every true block insertion.
      return context.editor
        .chain()
        .focus()
        .insertContentAt(blockInsertPos(context.editor.state.selection), { type: "horizontalRule" })
        .run();
    case "insertMath":
      return insertMathBlock(context);
    case "insertDiagram":
      return insertDiagramBlock(context);
    case "insertGraphvizDiagram":
      return insertGraphvizBlock(context);
    case "insertMarkmap":
      return insertMarkmapBlock(context);
    case "insertInlineMath":
      return insertInlineMath(context);
    case "insertBulletList":
      return view ? handleToBulletList(view) : false;
    case "insertOrderedList":
      return view ? handleToOrderedList(view) : false;
    case "insertTaskList":
      return context.editor ? toggleTaskList(context.editor) : false;
    case "insertDetails":
      if (!context.editor) return false;
      return context.editor.commands.insertDetailsBlock();
    case "insertAlertNote":
    case "insertAlertTip":
    case "insertAlertImportant":
    case "insertAlertWarning":
    case "insertAlertCaution":
      if (!context.editor) return false;
      return context.editor.commands.insertAlertBlock(ALERT_TYPE_BY_ACTION[action]);
    case "insertFootnote":
      if (!context.editor) return false;
      return insertFootnoteAndOpenPopup(context.editor);

    // Quote style toggle
    case "toggleQuoteStyle":
      return context.editor ? toggleQuoteStyleAtCursor(context.editor) : false;

    // CJK formatting and cleanup
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

    // Selection actions
    case "selectWord":
      return view ? selectWordInView(view) : false;
    case "selectLine":
      return view ? selectLineInView(view) : false;
    case "selectBlock":
      return view ? selectBlockInView(view) : false;
    case "expandSelection":
      return view ? expandSelectionInView(view) : false;

    // Block operations (WYSIWYG equivalent of line operations)
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
