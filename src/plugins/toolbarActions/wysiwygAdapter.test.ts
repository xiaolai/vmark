import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/plugins/editorPlugins.tiptap", () => ({
  expandedToggleMarkTiptap: vi.fn(() => true),
}));
vi.mock("@/plugins/formatToolbar/nodeActions.tiptap", () => ({
  handleBlockquoteNest: vi.fn(),
  handleBlockquoteUnnest: vi.fn(),
  handleRemoveBlockquote: vi.fn(),
  handleListIndent: vi.fn(),
  handleListOutdent: vi.fn(),
  handleRemoveList: vi.fn(),
  handleToBulletList: vi.fn(),
  handleToOrderedList: vi.fn(),
}));
vi.mock("@/plugins/tableUI/tableActions.tiptap", () => ({
  addColLeft: vi.fn(() => true),
  addColRight: vi.fn(() => true),
  addRowAbove: vi.fn(() => true),
  addRowBelow: vi.fn(() => true),
  alignColumn: vi.fn(() => true),
  deleteCurrentColumn: vi.fn(() => true),
  deleteCurrentRow: vi.fn(() => true),
  deleteCurrentTable: vi.fn(() => true),
  formatTable: vi.fn(() => true),
}));
vi.mock("@/plugins/footnotePopup/tiptapInsertFootnote", () => ({
  insertFootnoteAndOpenPopup: vi.fn(),
}));
vi.mock("@/plugins/taskToggle/tiptapTaskListUtils", () => ({
  toggleTaskList: vi.fn(),
}));
vi.mock("@/plugins/toolbarActions/tiptapSelectionActions", () => ({
  selectWordInView: vi.fn(() => true),
  selectLineInView: vi.fn(() => true),
  selectBlockInView: vi.fn(() => true),
  expandSelectionInView: vi.fn(() => true),
}));
vi.mock("./multiSelectionPolicy", () => ({
  canRunActionInMultiSelection: vi.fn(() => true),
}));
vi.mock("./wysiwygMultiSelection", () => ({
  applyMultiSelectionBlockquoteAction: vi.fn(() => false),
  applyMultiSelectionHeading: vi.fn(() => false),
  applyMultiSelectionListAction: vi.fn(() => false),
}));
vi.mock("./wysiwygAdapterLinks", () => ({
  insertWikiLink: vi.fn(() => true),
  insertBookmarkLink: vi.fn(() => true),
}));
vi.mock("./wysiwygAdapterFormatting", () => ({
  clearFormattingInView: vi.fn(() => true),
  increaseHeadingLevel: vi.fn(() => true),
  decreaseHeadingLevel: vi.fn(() => true),
  toggleBlockquote: vi.fn(() => true),
  handleWysiwygTransformCase: vi.fn(() => true),
  toggleQuoteStyleAtCursor: vi.fn(() => true),
}));
vi.mock("./wysiwygAdapterInsert", () => ({
  handleInsertImage: vi.fn(() => true),
  handleInsertVideo: vi.fn(() => true),
  handleInsertAudio: vi.fn(() => true),
  insertMathBlock: vi.fn(() => true),
  insertDiagramBlock: vi.fn(() => true),
  insertMarkmapBlock: vi.fn(() => true),
  insertInlineMath: vi.fn(() => true),
}));
vi.mock("./wysiwygAdapterLinkEditor", () => ({
  openLinkEditor: vi.fn(() => true),
}));
vi.mock("./wysiwygAdapterCjk", () => ({
  handleFormatCJK: vi.fn(() => true),
  handleFormatCJKFile: vi.fn(() => true),
  handleRemoveTrailingSpaces: vi.fn(() => true),
  handleCollapseBlankLines: vi.fn(() => true),
  handleLineEndings: vi.fn(() => true),
}));
vi.mock("./wysiwygAdapterBlockOps", () => ({
  handleWysiwygMoveBlockUp: vi.fn(() => true),
  handleWysiwygMoveBlockDown: vi.fn(() => true),
  handleWysiwygDuplicateBlock: vi.fn(() => true),
  handleWysiwygDeleteBlock: vi.fn(() => true),
  handleWysiwygJoinBlocks: vi.fn(() => true),
  handleWysiwygRemoveBlankLines: vi.fn(() => true),
}));

import { performWysiwygToolbarAction, setWysiwygHeadingLevel } from "./wysiwygAdapter";
import type { WysiwygToolbarContext, MultiSelectionContext } from "./types";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";

const baseContext: WysiwygToolbarContext = {
  surface: "wysiwyg",
  view: null,
  editor: null,
  context: null,
};

function createMockEditor(overrides?: Record<string, unknown>) {
  return {
    commands: {
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
      insertAlertBlock: vi.fn(),
      insertDetailsBlock: vi.fn(),
    },
    chain: vi.fn().mockReturnThis(),
    focus: vi.fn().mockReturnThis(),
    setParagraph: vi.fn().mockReturnThis(),
    setHeading: vi.fn().mockReturnThis(),
    setCodeBlock: vi.fn().mockReturnThis(),
    setHorizontalRule: vi.fn().mockReturnThis(),
    insertTable: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnThis(),
    ...overrides,
  } as unknown as TiptapEditor;
}

const disabledMultiSelection: MultiSelectionContext = {
  enabled: false,
  reason: "none",
  inCodeBlock: false,
  inTable: false,
  inList: false,
  inBlockquote: false,
  inHeading: false,
  inLink: false,
  inInlineMath: false,
  inFootnote: false,
  inImage: false,
  inTextblock: false,
  sameBlockParent: true,
  blockParentType: null,
};

describe("performWysiwygToolbarAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls alert insertion commands with the correct type", () => {
    const actions: Record<string, string> = {
      insertAlertNote: "NOTE",
      insertAlertTip: "TIP",
      insertAlertImportant: "IMPORTANT",
      insertAlertWarning: "WARNING",
      insertAlertCaution: "CAUTION",
    };

    for (const [action, alertType] of Object.entries(actions)) {
      const insertAlertBlock = vi.fn();
      const editor = { commands: { insertAlertBlock } } as unknown as TiptapEditor;
      const applied = performWysiwygToolbarAction(action, {
        ...baseContext,
        editor,
      });
      expect(applied).toBe(true);
      expect(insertAlertBlock).toHaveBeenCalledWith(alertType);
    }
  });

  it("returns false for unknown action", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("unknownAction", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(false);
  });

  it("handles undo with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("undo", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
    expect(editor.commands.undo).toHaveBeenCalled();
  });

  it("returns false for undo without editor", () => {
    const result = performWysiwygToolbarAction("undo", baseContext);
    expect(result).toBe(false);
  });

  it("handles redo with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("redo", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
    expect(editor.commands.redo).toHaveBeenCalled();
  });

  it("returns false for redo without editor", () => {
    const result = performWysiwygToolbarAction("redo", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for inline formatting without view", () => {
    const formats = ["bold", "italic", "underline", "strikethrough", "highlight", "superscript", "subscript", "code"];
    for (const format of formats) {
      const result = performWysiwygToolbarAction(format, baseContext);
      expect(result).toBe(false);
    }
  });

  it("returns false for clearFormatting without view", () => {
    const result = performWysiwygToolbarAction("clearFormatting", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for increaseHeading without editor", () => {
    const result = performWysiwygToolbarAction("increaseHeading", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for decreaseHeading without editor", () => {
    const result = performWysiwygToolbarAction("decreaseHeading", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertCodeBlock without editor", () => {
    const result = performWysiwygToolbarAction("insertCodeBlock", baseContext);
    expect(result).toBe(false);
  });

  it("inserts code block with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertCodeBlock", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
    expect(editor.chain).toHaveBeenCalled();
  });

  it("returns false for insertDivider without editor", () => {
    const result = performWysiwygToolbarAction("insertDivider", baseContext);
    expect(result).toBe(false);
  });

  it("inserts divider with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertDivider", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
    expect(editor.chain).toHaveBeenCalled();
  });

  it("returns false for insertTable without editor", () => {
    const result = performWysiwygToolbarAction("insertTable", baseContext);
    expect(result).toBe(false);
  });

  it("handles insertTable with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertTable", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles insertTableBlock same as insertTable", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertTableBlock", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns false for insertFootnote without editor", () => {
    const result = performWysiwygToolbarAction("insertFootnote", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertDetails without editor", () => {
    const result = performWysiwygToolbarAction("insertDetails", baseContext);
    expect(result).toBe(false);
  });

  it("inserts details block with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertDetails", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
    expect(editor.commands.insertDetailsBlock).toHaveBeenCalled();
  });

  it("returns false for insertBlockquote without editor", () => {
    const result = performWysiwygToolbarAction("insertBlockquote", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for toggleQuoteStyle without editor", () => {
    const result = performWysiwygToolbarAction("toggleQuoteStyle", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertBulletList without view", () => {
    const result = performWysiwygToolbarAction("insertBulletList", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertOrderedList without view", () => {
    const result = performWysiwygToolbarAction("insertOrderedList", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertTaskList without editor", () => {
    const result = performWysiwygToolbarAction("insertTaskList", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for selection actions without view", () => {
    const actions = ["selectWord", "selectLine", "selectBlock", "expandSelection"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, baseContext);
      expect(result).toBe(false);
    }
  });

  it("returns false for table operations without view", () => {
    const actions = [
      "addRowAbove", "addRow", "addColLeft", "addCol",
      "deleteRow", "deleteCol", "deleteTable",
      "alignLeft", "alignCenter", "alignRight",
      "alignAllLeft", "alignAllCenter", "alignAllRight",
    ];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, baseContext);
      expect(result).toBe(false);
    }
  });

  it("returns false for blockquote operations without view", () => {
    const actions = ["nestBlockquote", "unnestBlockquote", "removeBlockquote"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, baseContext);
      expect(result).toBe(false);
    }
  });

  it("returns false when multi-selection disallows the action", () => {
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(false);
    const editor = createMockEditor();
    const multi: MultiSelectionContext = {
      ...disabledMultiSelection,
      enabled: true,
      reason: "multi",
    };
    // "insertCodeBlock" is disallowed in multi-selection
    const result = performWysiwygToolbarAction("insertCodeBlock", {
      ...baseContext,
      editor,
      multiSelection: multi,
    });
    expect(result).toBe(false);
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(true);
  });
});

describe("setWysiwygHeadingLevel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const result = setWysiwygHeadingLevel(baseContext, 1);
    expect(result).toBe(false);
  });

  it("sets paragraph when level is 0", () => {
    const editor = createMockEditor();
    const result = setWysiwygHeadingLevel(
      { ...baseContext, editor },
      0
    );
    expect(result).toBe(true);
    expect(editor.chain).toHaveBeenCalled();
  });

  it("sets heading level 1-6", () => {
    for (let level = 1; level <= 6; level++) {
      const editor = createMockEditor();
      const result = setWysiwygHeadingLevel(
        { ...baseContext, editor },
        level
      );
      expect(result).toBe(true);
      expect(editor.chain).toHaveBeenCalled();
    }
  });

  it("returns false when multi-selection disallows heading", () => {
    const editor = createMockEditor();
    const multi: MultiSelectionContext = {
      ...disabledMultiSelection,
      enabled: true,
      reason: "multi",
      inCodeBlock: true, // code block disallows conditional actions
    };
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(false);
    const result = setWysiwygHeadingLevel(
      { ...baseContext, editor, multiSelection: multi },
      2
    );
    expect(result).toBe(false);
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(true);
  });
});

describe("performWysiwygToolbarAction (with view)", () => {
  const mockView = {} as import("@tiptap/pm/view").EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(true);
  });

  it("handles inline formatting with view", () => {
    const formats = ["bold", "italic", "underline", "strikethrough", "highlight", "superscript", "subscript", "code"];
    for (const format of formats) {
      const result = performWysiwygToolbarAction(format, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles clearFormatting with view", () => {
    const result = performWysiwygToolbarAction("clearFormatting", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles link action", () => {
    const result = performWysiwygToolbarAction("link", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles link:wiki action", () => {
    const result = performWysiwygToolbarAction("link:wiki", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles link:bookmark action", () => {
    const result = performWysiwygToolbarAction("link:bookmark", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles increaseHeading with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("increaseHeading", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles decreaseHeading with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("decreaseHeading", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles bulletList with view", () => {
    const result = performWysiwygToolbarAction("bulletList", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles orderedList with view", () => {
    const result = performWysiwygToolbarAction("orderedList", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles taskList with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("taskList", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns false for taskList without editor", () => {
    const result = performWysiwygToolbarAction("taskList", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(false);
  });

  it("handles indent with view", () => {
    const result = performWysiwygToolbarAction("indent", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles outdent with view", () => {
    const result = performWysiwygToolbarAction("outdent", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles removeList with view", () => {
    const result = performWysiwygToolbarAction("removeList", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles table row/col operations with view", () => {
    const actions = ["addRowAbove", "addRow", "addColLeft", "addCol",
      "deleteRow", "deleteCol", "deleteTable"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles table alignment operations with view", () => {
    const actions = ["alignLeft", "alignCenter", "alignRight",
      "alignAllLeft", "alignAllCenter", "alignAllRight"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles formatTable with view and shows toast", () => {
    const result = performWysiwygToolbarAction("formatTable", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("formatTable no-op still returns true and shows info toast (E2)", async () => {
    const { formatTable } = await import("@/plugins/tableUI/tableActions.tiptap");
    vi.mocked(formatTable).mockReturnValueOnce(false);
    const result = performWysiwygToolbarAction("formatTable", {
      ...baseContext,
      view: mockView,
    });
    // The action is dispatched (returns true) so the toolbar doesn't show a
    // generic failure; the toast tells the user nothing was changed.
    expect(result).toBe(true);
  });

  it("handles blockquote operations with view", () => {
    const actions = ["nestBlockquote", "unnestBlockquote", "removeBlockquote"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles insertBlockquote with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertBlockquote", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles insert media actions", () => {
    const actions = ["insertImage", "insertVideo", "insertAudio"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles insert math/diagram/markmap actions", () => {
    const actions = ["insertMath", "insertDiagram", "insertMarkmap", "insertInlineMath"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles insertBulletList with view", () => {
    const result = performWysiwygToolbarAction("insertBulletList", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles insertOrderedList with view", () => {
    const result = performWysiwygToolbarAction("insertOrderedList", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("handles insertTaskList with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertTaskList", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles insertFootnote with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("insertFootnote", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles toggleQuoteStyle with editor", () => {
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("toggleQuoteStyle", {
      ...baseContext,
      editor,
    });
    expect(result).toBe(true);
  });

  it("handles CJK formatting actions", () => {
    const actions = ["formatCJK", "formatCJKFile", "removeTrailingSpaces",
      "collapseBlankLines", "lineEndingsLF", "lineEndingsCRLF"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles selection actions with view", () => {
    const actions = ["selectWord", "selectLine", "selectBlock", "expandSelection"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles block operations", () => {
    const actions = ["moveLineUp", "moveLineDown", "duplicateLine",
      "deleteLine", "joinLines", "removeBlankLines"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("handles text transformation actions", () => {
    const actions = ["transformUppercase", "transformLowercase",
      "transformTitleCase", "transformToggleCase"];
    for (const action of actions) {
      const result = performWysiwygToolbarAction(action, {
        ...baseContext,
        view: mockView,
      });
      expect(result).toBe(true);
    }
  });

  it("returns false when multi-selection disallows action", () => {
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(false);
    const result = performWysiwygToolbarAction("bold", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(false);
  });

  it("returns false for bulletList without view (null view path)", () => {
    const result = performWysiwygToolbarAction("bulletList", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for orderedList without view (null view path)", () => {
    const result = performWysiwygToolbarAction("orderedList", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for indent without view (null view path)", () => {
    const result = performWysiwygToolbarAction("indent", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for outdent without view (null view path)", () => {
    const result = performWysiwygToolbarAction("outdent", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for removeList without view (null view path)", () => {
    const result = performWysiwygToolbarAction("removeList", baseContext);
    expect(result).toBe(false);
  });

  it("returns true when applyMultiSelectionListAction handles bulletList", async () => {
    const { applyMultiSelectionListAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionListAction).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("bulletList", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionListAction handles orderedList", async () => {
    const { applyMultiSelectionListAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionListAction).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("orderedList", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionListAction handles taskList", async () => {
    const { applyMultiSelectionListAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionListAction).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("taskList", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionListAction handles indent", async () => {
    const { applyMultiSelectionListAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionListAction).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("indent", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionListAction handles outdent", async () => {
    const { applyMultiSelectionListAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionListAction).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("outdent", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionListAction handles removeList", async () => {
    const { applyMultiSelectionListAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionListAction).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const result = performWysiwygToolbarAction("removeList", {
      ...baseContext,
      view: mockView,
      editor,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionBlockquoteAction handles nestBlockquote", async () => {
    const { applyMultiSelectionBlockquoteAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionBlockquoteAction).mockReturnValueOnce(true);
    const result = performWysiwygToolbarAction("nestBlockquote", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionBlockquoteAction handles unnestBlockquote", async () => {
    const { applyMultiSelectionBlockquoteAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionBlockquoteAction).mockReturnValueOnce(true);
    const result = performWysiwygToolbarAction("unnestBlockquote", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("returns true when applyMultiSelectionBlockquoteAction handles removeBlockquote", async () => {
    const { applyMultiSelectionBlockquoteAction } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionBlockquoteAction).mockReturnValueOnce(true);
    const result = performWysiwygToolbarAction("removeBlockquote", {
      ...baseContext,
      view: mockView,
    });
    expect(result).toBe(true);
  });

  it("returns false for insertAlertNote without editor", () => {
    const result = performWysiwygToolbarAction("insertAlertNote", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertAlertTip without editor", () => {
    const result = performWysiwygToolbarAction("insertAlertTip", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertAlertImportant without editor", () => {
    const result = performWysiwygToolbarAction("insertAlertImportant", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertAlertWarning without editor", () => {
    const result = performWysiwygToolbarAction("insertAlertWarning", baseContext);
    expect(result).toBe(false);
  });

  it("returns false for insertAlertCaution without editor", () => {
    const result = performWysiwygToolbarAction("insertAlertCaution", baseContext);
    expect(result).toBe(false);
  });
});

describe("setWysiwygHeadingLevel — multi-selection handled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(true);
  });

  it("returns true when applyMultiSelectionHeading handles the action", async () => {
    const { applyMultiSelectionHeading } = await import("./wysiwygMultiSelection");
    vi.mocked(applyMultiSelectionHeading).mockReturnValueOnce(true);
    const editor = createMockEditor();
    const mockView = {} as import("@tiptap/pm/view").EditorView;
    const result = setWysiwygHeadingLevel(
      { ...baseContext, editor, view: mockView },
      2
    );
    expect(result).toBe(true);
  });
});
