/**
 * The executor's code-fence boundary.
 *
 * A fence holds literal text, so an action that writes markdown syntax into one
 * corrupts source code. Before this gate existed, pressing the bullet-list
 * shortcut with the caret inside a fence turned `const a = 1;` into
 * `- const a = 1;` — from a keyboard accelerator, with no toolbar involved.
 *
 * The gate lives in `isActionExecutable` for the same reason the table gate
 * does: the native menu path never consults the toolbar's enabled state.
 *
 * @coordinates-with services/commands/actionAvailability.ts — isActionExecutable
 * @coordinates-with plugins/toolbarActions/actionApplicability.ts — CODE_BLOCK_SAFE_ACTIONS
 * @module services/commands/codeBlockBoundary.test
 */
import { describe, it, expect } from "vitest";
import {
  CODE_BLOCK_SAFE_ACTIONS,
  isBlockedInCodeBlock,
} from "@/plugins/toolbarActions/actionApplicability";

describe("code-block safety policy", () => {
  it.each([
    "bulletList", "orderedList", "taskList",
    "insertBulletList", "insertOrderedList", "insertTaskList",
    "insertBlockquote", "nestBlockquote", "removeBlockquote",
    "heading:1", "heading:2", "increaseHeading", "decreaseHeading",
    "bold", "italic", "code", "strikethrough", "highlight",
    "insertTable", "insertDivider", "insertDetails", "insertAlertNote",
    "link", "insertImage", "insertMath", "formatCJK",
    "indent", "outdent", "removeList", "joinLines", "collapseBlankLines",
  ])("refuses %s inside a fence", (action) => {
    expect(isBlockedInCodeBlock(action)).toBe(true);
  });

  it.each([
    "undo", "redo",
    "insertCodeBlock",
    "selectWord", "selectLine", "selectBlock", "expandSelection",
    "moveLineUp", "moveLineDown", "duplicateLine", "deleteLine",
    "sortLinesAsc", "sortLinesDesc",
    "transformUppercase", "transformLowercase",
  ])("allows %s inside a fence", (action) => {
    expect(isBlockedInCodeBlock(action)).toBe(false);
  });

  it("is an ALLOW-list, so an unknown future action fails closed", () => {
    expect(isBlockedInCodeBlock("someActionAddedNextYear")).toBe(true);
  });

  it("keeps the escape hatch available", () => {
    // Every other block action is refused inside a fence; if the toggle were
    // refused too the caret would be trapped.
    expect(CODE_BLOCK_SAFE_ACTIONS.has("insertCodeBlock")).toBe(true);
  });
});
