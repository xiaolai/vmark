/**
 * Toolbar Parity Tests
 *
 * Verifies that button states (active, disabled) match between WYSIWYG and Source modes
 * for equivalent cursor contexts. This ensures consistent toolbar behavior.
 */

import { describe, expect, it } from "vitest";
import { getToolbarButtonState, getToolbarItemState } from "../enableRules";
import type { ToolbarGroupButton, ToolbarActionItem } from "@/components/Editor/UniversalToolbar/toolbarGroups";
import type { WysiwygToolbarContext, SourceToolbarContext } from "../types";
import type { CursorContext as WysiwygCursorContext } from "@/plugins/toolbarContext/types";
import type { CursorContext as SourceCursorContext } from "@/types/cursorContext";
import type { ContextMode } from "@/types/cursorContext";

// Mock views - just need basic structure
const mockWysiwygView = {
  state: {
    selection: { from: 0, to: 0, empty: true, $from: { marks: () => [] } },
    storedMarks: null,
    schema: { marks: {} },
    doc: { rangeHasMark: () => false },
  },
} as unknown as WysiwygToolbarContext["view"];

const mockSourceView = {
  state: {
    selection: { main: { from: 0, to: 0 }, ranges: [{ from: 0, to: 0 }] },
    doc: { lineAt: () => ({ text: "" }), sliceString: () => "", length: 100 },
  },
} as unknown as SourceToolbarContext["view"];

// Helper to create WYSIWYG context
function createWysiwygContext(overrides: Partial<WysiwygCursorContext> = {}): WysiwygCursorContext {
  return {
    surface: "wysiwyg",
    hasSelection: false,
    atLineStart: false,
    contextMode: "insert",
    ...overrides,
  };
}

// Helper to create Source context
function createSourceContext(overrides: Partial<SourceCursorContext> = {}): SourceCursorContext {
  return {
    inCodeBlock: null,
    inBlockMath: null,
    inTable: null,
    inList: null,
    inBlockquote: null,
    inHeading: null,
    inLink: null,
    inImage: null,
    inInlineMath: null,
    inFootnote: null,
    activeFormats: [],
    formatRanges: [],
    innermostFormat: null,
    atLineStart: false,
    atBlankLine: false,
    inWord: null,
    contextMode: "inline-insert" as ContextMode,
    nearSpace: false,
    nearPunctuation: false,
    hasSelection: false,
    selectionFrom: 0,
    selectionTo: 0,
    ...overrides,
  };
}

// Helper to create toolbar button definition
function createButton(action: string, enabledIn: string[] = ["always"]): ToolbarGroupButton {
  return {
    id: `test-${action}`,
    type: "dropdown",
    action,
    enabledIn: enabledIn as ToolbarGroupButton["enabledIn"],
    icon: "test-icon",
    label: "Test",
    items: [],
  };
}

function createActionItem(action: string, enabledIn: string[] = ["always"]): ToolbarActionItem {
  return {
    id: `test-${action}`,
    type: "action" as const,
    action,
    enabledIn: enabledIn as ToolbarActionItem["enabledIn"],
    icon: "test-icon",
    label: "Test",
  };
}

describe("Toolbar Parity", () => {
  describe("heading content", () => {
    it("button states match for heading content in both modes", () => {
      // WYSIWYG: heading level 2
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inHeading: { level: 2, nodePos: 0 },
        }),
      };

      // Source: heading level 2
      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inHeading: { level: 2, nodePos: 0 },
        }),
      };

      const headingButton = createButton("heading", ["always"]);
      const wysiwygState = getToolbarButtonState(headingButton, wysiwygCtx);
      const sourceState = getToolbarButtonState(headingButton, sourceCtx);

      // Both should show heading as active
      expect(wysiwygState.active).toBe(true);
      expect(sourceState.active).toBe(true);
      expect(wysiwygState.active).toBe(sourceState.active);
    });

    it("heading:N items show active for matching level in both modes", () => {
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inHeading: { level: 3, nodePos: 0 },
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inHeading: { level: 3, nodePos: 0 },
        }),
      };

      const heading3Item = createActionItem("heading:3", ["always"]);
      const heading4Item = createActionItem("heading:4", ["always"]);

      const wysiwygH3 = getToolbarItemState(heading3Item, wysiwygCtx);
      const sourceH3 = getToolbarItemState(heading3Item, sourceCtx);
      const wysiwygH4 = getToolbarItemState(heading4Item, wysiwygCtx);
      const sourceH4 = getToolbarItemState(heading4Item, sourceCtx);

      // Both modes: H3 active, H4 not active
      expect(wysiwygH3.active).toBe(true);
      expect(sourceH3.active).toBe(true);
      expect(wysiwygH4.active).toBe(false);
      expect(sourceH4.active).toBe(false);
    });
  });

  describe("list content", () => {
    it("button states match for bullet list in both modes", () => {
      // WYSIWYG: uses listType field
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inList: { listType: "bullet", depth: 1 },
        }),
      };

      // Source: uses type field
      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inList: { type: "bullet", depth: 1, nodePos: 0 },
        }),
      };

      const bulletButton = createButton("bulletList", ["always"]);
      const orderedButton = createButton("orderedList", ["always"]);

      // Bullet list should be active in both
      expect(getToolbarButtonState(bulletButton, wysiwygCtx).active).toBe(true);
      expect(getToolbarButtonState(bulletButton, sourceCtx).active).toBe(true);

      // Ordered list should NOT be active in both
      expect(getToolbarButtonState(orderedButton, wysiwygCtx).active).toBe(false);
      expect(getToolbarButtonState(orderedButton, sourceCtx).active).toBe(false);
    });

    it("button states match for ordered list in both modes", () => {
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inList: { listType: "ordered", depth: 1 },
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inList: { type: "ordered", depth: 1, nodePos: 0 },
        }),
      };

      const orderedButton = createButton("orderedList", ["always"]);

      expect(getToolbarButtonState(orderedButton, wysiwygCtx).active).toBe(true);
      expect(getToolbarButtonState(orderedButton, sourceCtx).active).toBe(true);
    });

    it("button states match for task list in both modes", () => {
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inList: { listType: "task", depth: 1 },
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inList: { type: "task", depth: 1, nodePos: 0 },
        }),
      };

      const taskButton = createButton("taskList", ["always"]);

      expect(getToolbarButtonState(taskButton, wysiwygCtx).active).toBe(true);
      expect(getToolbarButtonState(taskButton, sourceCtx).active).toBe(true);
    });
  });

  describe("table content", () => {
    it("button states match for table content in both modes", () => {
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inTable: { row: 0, col: 0, totalRows: 3, totalCols: 3 },
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inTable: { row: 0, col: 0, isHeader: true, nodePos: 0 },
        }),
      };

      // Both contexts are in a table - enabled state for table-specific actions should match
      const tableButton = createButton("insertTable", ["table"]);

      const wysiwygState = getToolbarButtonState(tableButton, wysiwygCtx);
      const sourceState = getToolbarButtonState(tableButton, sourceCtx);

      // Both should be enabled when in table
      expect(wysiwygState.disabled).toBe(false);
      expect(sourceState.disabled).toBe(false);
    });
  });

  describe("blockquote content", () => {
    it("button states match for blockquote content in both modes", () => {
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inBlockquote: { depth: 1 },
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inBlockquote: { depth: 1, nodePos: 0 },
        }),
      };

      // Both contexts are in a blockquote
      const quoteButton = createButton("blockquote", ["blockquote"]);

      const wysiwygState = getToolbarButtonState(quoteButton, wysiwygCtx);
      const sourceState = getToolbarButtonState(quoteButton, sourceCtx);

      // Both should be enabled when in blockquote
      expect(wysiwygState.disabled).toBe(false);
      expect(sourceState.disabled).toBe(false);
    });
  });

  describe("disabled states", () => {
    it("disabled buttons match in both modes for same context", () => {
      // Both outside any special context
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          hasSelection: false,
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          hasSelection: false,
        }),
      };

      // Table-only button should be disabled in both modes (not in table)
      const tableOnlyButton = createButton("deleteRow", ["table"]);

      expect(getToolbarButtonState(tableOnlyButton, wysiwygCtx).disabled).toBe(true);
      expect(getToolbarButtonState(tableOnlyButton, sourceCtx).disabled).toBe(true);

      // List-only button should be disabled in both modes (not in list)
      const listOnlyButton = createButton("indent", ["list"]);

      expect(getToolbarButtonState(listOnlyButton, wysiwygCtx).disabled).toBe(true);
      expect(getToolbarButtonState(listOnlyButton, sourceCtx).disabled).toBe(true);
    });

    it("code block disables textblock actions in both modes", () => {
      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          inCodeBlock: { language: "javascript", from: 0, to: 100 },
        }),
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          inCodeBlock: { language: "javascript", nodePos: 0 },
        }),
      };

      // Textblock-only button should be disabled in both modes (in code block)
      const textblockButton = createButton("bold", ["textblock"]);

      expect(getToolbarButtonState(textblockButton, wysiwygCtx).disabled).toBe(true);
      expect(getToolbarButtonState(textblockButton, sourceCtx).disabled).toBe(true);
    });
  });

  describe("multi-selection policy", () => {
    it("multi-selection disables same actions in both modes", () => {
      const multiSelectionContext = {
        enabled: true,
        reason: "multi" as const,
        inCodeBlock: false,
        inTable: false,
        inList: false,
        inBlockquote: false,
        inHeading: false,
        inLink: false,
        inInlineMath: false,
        inFootnote: false,
        inImage: false,
        inTextblock: true,
        sameBlockParent: false,
        blockParentType: null,
      };

      const wysiwygCtx: WysiwygToolbarContext = {
        surface: "wysiwyg",
        view: mockWysiwygView,
        editor: null,
        context: createWysiwygContext({
          hasSelection: true,
        }),
        multiSelection: multiSelectionContext,
      };

      const sourceCtx: SourceToolbarContext = {
        surface: "source",
        view: mockSourceView,
        context: createSourceContext({
          hasSelection: true,
        }),
        multiSelection: multiSelectionContext,
      };

      // These actions should have same disabled state in multi-selection
      const boldButton = createButton("bold", ["always"]);
      const linkButton = createButton("link", ["always"]);

      const wysiwygBold = getToolbarButtonState(boldButton, wysiwygCtx);
      const sourceBold = getToolbarButtonState(boldButton, sourceCtx);

      // Both should allow bold in multi-selection (format action)
      expect(wysiwygBold.disabled).toBe(sourceBold.disabled);

      const wysiwygLink = getToolbarButtonState(linkButton, wysiwygCtx);
      const sourceLink = getToolbarButtonState(linkButton, sourceCtx);

      // Link behavior should be consistent across modes
      expect(wysiwygLink.disabled).toBe(sourceLink.disabled);
    });
  });
});
