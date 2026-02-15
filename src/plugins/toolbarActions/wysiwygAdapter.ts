/**
 * WYSIWYG Adapter
 *
 * Purpose: Toolbar action dispatcher for WYSIWYG (ProseMirror/Tiptap) mode. Maps
 * every toolbar action ID to the appropriate handler function. Handler implementations
 * are split across category-specific modules to keep each file under ~300 lines.
 *
 * Pipeline: toolbar click -> runToolbarAction(id) -> switch(id) -> handler module
 *
 * Key decisions:
 *   - Single giant switch for action routing (simple, greppable, no abstraction overhead)
 *   - Multi-selection actions delegate to wysiwygMultiSelection.ts for per-range handling
 *   - Link/wiki-link actions delegate to wysiwygAdapterLinks.ts to keep this file focused
 *   - Handler implementations split by category:
 *     - wysiwygAdapterFormatting.ts — text formatting, headings, blockquote
 *     - wysiwygAdapterInsert.ts — images, math, diagrams, code blocks
 *     - wysiwygAdapterLinkEditor.ts — link/wiki-link editing with smart clipboard
 *     - wysiwygAdapterCjk.ts — CJK formatting, trailing spaces, line endings
 *     - wysiwygAdapterBlockOps.ts — block move/duplicate/delete/join
 *     - wysiwygAdapterUtils.ts — shared helpers (view checks, file paths, transforms)
 *
 * @coordinates-with sourceAdapter.ts — parallel implementation for Source mode
 * @coordinates-with enableRules.ts — decides which actions are enabled
 * @coordinates-with UniversalToolbar.tsx — calls runToolbarAction on button click
 * @module plugins/toolbarActions/wysiwygAdapter
 */
import { toast } from "sonner";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveBlockquote, handleListIndent, handleListOutdent, handleRemoveList, handleToBulletList, handleToOrderedList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable, formatTable } from "@/plugins/tableUI/tableActions.tiptap";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { toggleTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";
import { expandSelectionInView, selectBlockInView, selectLineInView, selectWordInView } from "@/plugins/toolbarActions/tiptapSelectionActions";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./wysiwygMultiSelection";
import { insertWikiLink, insertBookmarkLink } from "./wysiwygAdapterLinks";
import { clearFormattingInView, increaseHeadingLevel, decreaseHeadingLevel, toggleBlockquote, handleWysiwygTransformCase, toggleQuoteStyleAtCursor } from "./wysiwygAdapterFormatting";
import { handleInsertImage, insertMathBlock, insertDiagramBlock, insertMarkmapBlock, insertInlineMath } from "./wysiwygAdapterInsert";
import { openLinkEditor } from "./wysiwygAdapterLinkEditor";
import { handleFormatCJK, handleFormatCJKFile, handleRemoveTrailingSpaces, handleCollapseBlankLines, handleLineEndings } from "./wysiwygAdapterCjk";
import { handleWysiwygMoveBlockUp, handleWysiwygMoveBlockDown, handleWysiwygDuplicateBlock, handleWysiwygDeleteBlock, handleWysiwygJoinBlocks, handleWysiwygRemoveBlankLines } from "./wysiwygAdapterBlockOps";
import type { WysiwygToolbarContext } from "./types";

/**
 * Set heading level in WYSIWYG mode. Exported for direct use by menu commands.
 * Level 0 means "paragraph" (remove heading).
 */
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

    // Headings
    case "increaseHeading":
      return context.editor ? increaseHeadingLevel(context.editor) : false;
    case "decreaseHeading":
      return context.editor ? decreaseHeadingLevel(context.editor) : false;

    // Lists
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

    // Table operations
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
      if (view && formatTable(view)) {
        toast.success("Table formatted");
        return true;
      }
      return false;

    // Blockquote
    case "nestBlockquote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleBlockquoteNest(view), true) : false;
    case "unnestBlockquote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleBlockquoteUnnest(view), true) : false;
    case "removeBlockquote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleRemoveBlockquote(view), true) : false;
    case "insertBlockquote":
      return context.editor ? toggleBlockquote(context.editor) : false;

    // Insert actions
    case "insertImage":
      return handleInsertImage(context);
    case "insertCodeBlock":
      if (!context.editor) return false;
      context.editor.chain().focus().setCodeBlock().run();
      return true;
    case "insertDivider":
      if (!context.editor) return false;
      context.editor.chain().focus().setHorizontalRule().run();
      return true;
    case "insertMath":
      return insertMathBlock(context);
    case "insertDiagram":
      return insertDiagramBlock(context);
    case "insertMarkmap":
      return insertMarkmapBlock(context);
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
