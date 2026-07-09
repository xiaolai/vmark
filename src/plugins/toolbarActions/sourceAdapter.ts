/**
 * Source Adapter
 *
 * Toolbar action dispatcher for source (CodeMirror) mode.
 * Routes toolbar actions to appropriate handlers; the switch narrows the
 * action string so category handlers receive typed action unions.
 *
 * @coordinates-with sourceInsertActions.ts — simple + block insertion handlers
 * @coordinates-with sourceBlockActions.ts — list, blockquote, heading-step handlers
 * @coordinates-with sourceTableActions.ts — table operation handlers
 * @coordinates-with sourceCjkActions.ts — CJK formatting and text cleanup handlers
 * @coordinates-with sourceTextTransforms.ts — line operations and text transformations
 * @coordinates-with sourceImageActions.ts — image insertion, link detection, unlink
 * @module plugins/toolbarActions/sourceAdapter
 */

import { undo, redo } from "@codemirror/commands";
import { buildDetailsBlock, buildDiagramBlock, buildGraphvizBlock, buildMarkmapBlock, buildMathBlock } from "@/plugins/sourceContextDetection/sourceInsertions";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceContextDetection/headingDetection";
import { expandSelectionInSource, selectBlockInSource, selectLineInSource, selectWordInSource } from "@/plugins/toolbarActions/sourceSelectionActions";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { SourceToolbarContext } from "./types";
import { applyMultiSelectionHeading } from "./sourceMultiSelection";
import { applyInlineFormat, handleClearFormatting } from "./sourceAdapterHelpers";
import { insertLinkSync, insertWikiSyntax, insertSourceBookmarkLink } from "./sourceAdapterLinks";
import { insertInlineMath } from "./sourceMathActions";
import { handleTableAction } from "./sourceTableActions";
import { handleFormatCJK, handleFormatCJKFile, handleRemoveTrailingSpaces, handleCollapseBlankLines, handleLineEndings } from "./sourceCjkActions";
import {
  handleMoveLineUp, handleMoveLineDown, handleDuplicateLine, handleDeleteLine,
  handleJoinLines, handleSortLinesAsc, handleSortLinesDesc, handleRemoveBlankLines,
  handleTransformCase, toUpperCase, toLowerCase, toTitleCase, toggleCase,
} from "./sourceTextTransforms";
import { insertImage, insertVideoTag, insertAudioTag } from "./sourceImageActions";
import { removeSourceLinkAtCursor } from "./sourceUnlink";
import {
  handleBuildInsert, handleInsertAlert, insertCodeBlock, insertDivider,
  insertFootnote, insertListMarker, insertOrToggleBlockquote, insertTable,
} from "./sourceInsertActions";
import {
  decreaseHeadingLevel, handleBlockquoteAction, handleListAction, increaseHeadingLevel,
} from "./sourceBlockActions";

// Re-export formatCJKCurrentBlock for external consumers
export { formatCJKCurrentBlock } from "./sourceCjkActions";

// --- Exported actions ---

export function setSourceHeadingLevel(context: SourceToolbarContext, level: number): boolean {
  const view = context.view;
  if (!view) return false;
  if (!canRunActionInMultiSelection(`heading:${level}`, context.multiSelection)) return false;

  if (applyMultiSelectionHeading(view, level)) return true;

  const info = getHeadingInfo(view);
  if (info) {
    setHeadingLevel(view, info, level);
    return true;
  }

  if (level === 0) return false;
  convertToHeading(view, level);
  return true;
}

export function performSourceToolbarAction(action: string, context: SourceToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;
  if (!canRunActionInMultiSelection(action, context.multiSelection)) return false;

  switch (action) {
    // Edit
    case "undo":
      return undo(view);
    case "redo":
      return redo(view);

    // Inline formatting
    case "bold":
      return applyInlineFormat(view, "bold");
    case "italic":
      return applyInlineFormat(view, "italic");
    case "strikethrough":
      return applyInlineFormat(view, "strikethrough");
    case "highlight":
      return applyInlineFormat(view, "highlight");
    case "superscript":
      return applyInlineFormat(view, "superscript");
    case "subscript":
      return applyInlineFormat(view, "subscript");
    case "code":
      return applyInlineFormat(view, "code");
    case "underline":
      return applyInlineFormat(view, "underline");

    // Links
    case "link":
      return insertLinkSync(view);
    case "link:wiki":
      return insertWikiSyntax(view, "[[", "]]", "page");
    case "link:bookmark":
      return insertSourceBookmarkLink(view);
    case "unlink":
      return removeSourceLinkAtCursor(view);

    // Clear formatting
    case "clearFormatting":
      return handleClearFormatting(view);
    case "increaseHeading":
      return increaseHeadingLevel(view);
    case "decreaseHeading":
      return decreaseHeadingLevel(view);

    // Simple insertions
    case "insertImage":
      return insertImage(view);
    case "insertVideo":
      return insertVideoTag(view);
    case "insertAudio":
      return insertAudioTag(view);
    case "insertFootnote":
      return insertFootnote(view);
    case "insertCodeBlock":
      return insertCodeBlock(view);
    case "insertBlockquote":
      return insertOrToggleBlockquote(view);
    case "insertDivider":
      return insertDivider(view);
    case "insertTable":
    case "insertTableBlock":
      return insertTable(view);
    case "insertBulletList":
      return insertListMarker(view, "- ");
    case "insertOrderedList":
      return insertListMarker(view, "1. ");
    case "insertTaskList":
      return insertListMarker(view, "- [ ] ");

    // Complex insertions
    case "insertDetails":
      return handleBuildInsert(view, buildDetailsBlock);
    case "insertAlertNote":
    case "insertAlertTip":
    case "insertAlertImportant":
    case "insertAlertWarning":
    case "insertAlertCaution":
      return handleInsertAlert(view, action);
    case "insertMath":
      return handleBuildInsert(view, buildMathBlock);
    case "insertDiagram":
      return handleBuildInsert(view, buildDiagramBlock);
    case "insertGraphvizDiagram":
      return handleBuildInsert(view, buildGraphvizBlock);
    case "insertMarkmap":
      return handleBuildInsert(view, buildMarkmapBlock);
    case "insertInlineMath":
      return insertInlineMath(view);

    // List operations
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "indent":
    case "outdent":
    case "removeList":
      return handleListAction(view, action);

    // Table operations
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
      return handleTableAction(view, action);

    // Blockquote operations
    case "nestBlockquote":
    case "unnestBlockquote":
    case "removeBlockquote":
      return handleBlockquoteAction(view, action);

    // Selection
    case "selectWord":
      return selectWordInSource(view);
    case "selectLine":
      return selectLineInSource(view);
    case "selectBlock":
      return selectBlockInSource(view);
    case "expandSelection":
      return expandSelectionInSource(view);

    // CJK formatting
    case "formatCJK":
      return handleFormatCJK(view);
    case "formatCJKFile":
      return handleFormatCJKFile(view);
    case "removeTrailingSpaces":
      return handleRemoveTrailingSpaces(view);
    case "collapseBlankLines":
      return handleCollapseBlankLines(view);
    case "lineEndingsLF":
      return handleLineEndings(view, "lf");
    case "lineEndingsCRLF":
      return handleLineEndings(view, "crlf");

    // Line operations
    case "moveLineUp":
      return handleMoveLineUp(view);
    case "moveLineDown":
      return handleMoveLineDown(view);
    case "duplicateLine":
      return handleDuplicateLine(view);
    case "deleteLine":
      return handleDeleteLine(view);
    case "joinLines":
      return handleJoinLines(view);
    case "sortLinesAsc":
      return handleSortLinesAsc(view);
    case "sortLinesDesc":
      return handleSortLinesDesc(view);
    case "removeBlankLines":
      return handleRemoveBlankLines(view);

    // Text transformations
    case "transformUppercase":
      return handleTransformCase(view, toUpperCase);
    case "transformLowercase":
      return handleTransformCase(view, toLowerCase);
    case "transformTitleCase":
      return handleTransformCase(view, toTitleCase);
    case "transformToggleCase":
      return handleTransformCase(view, toggleCase);

    default:
      return false;
  }
}
