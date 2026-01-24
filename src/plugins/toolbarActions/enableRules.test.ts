import { describe, it, expect } from "vitest";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import { getToolbarButtonState } from "./enableRules";
import type { ToolbarGroupButton, ToolbarActionItem } from "@/components/Editor/UniversalToolbar/toolbarGroups";

function createItem(action: string, enabledIn: ToolbarActionItem["enabledIn"]): ToolbarActionItem {
  return {
    id: `${action}-item`,
    icon: "",
    label: action,
    action,
    enabledIn,
  };
}

function createGroupButton(action: string, items: ToolbarActionItem[]): ToolbarGroupButton {
  return {
    id: action,
    type: "dropdown",
    icon: "",
    label: action,
    action,
    enabledIn: ["always"],
    items,
  };
}

describe("getToolbarButtonState (source)", () => {
  const view = {} as CodeMirrorView;

  it("keeps dropdown button clickable even when items are disabled (no selection)", () => {
    const button = createGroupButton("inline", [createItem("bold", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
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
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    // Dropdown buttons are always clickable so users can see the menu
    expect(state.disabled).toBe(false);
    // But individual items inside are disabled based on context
    expect(state.itemStates?.[0].disabled).toBe(true);
  });

  it("enables inline formats with selection", () => {
    const button = createGroupButton("inline", [createItem("bold", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
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
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: true,
        selectionFrom: 1,
        selectionTo: 3,
      },
    });

    expect(state.disabled).toBe(false);
  });

  it("disables actions with enabledIn: never", () => {
    // Use enabledIn: ["never"] to test not-implemented logic since all Source actions are now implemented
    const button = createGroupButton("hypothetical", [createItem("futureAction", ["never"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
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
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    expect(state.notImplemented).toBe(true);
    expect(state.disabled).toBe(true);
  });

  it("enables insertDetails in source mode (now implemented)", () => {
    const button = createGroupButton("expandables", [createItem("insertDetails", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
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
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    expect(state.notImplemented).toBe(false);
    expect(state.disabled).toBe(false); // enabled in textblock context
  });

  it("enables alert insert actions in source mode", () => {
    const alertActions = [
      "insertAlertNote",
      "insertAlertTip",
      "insertAlertImportant",
      "insertAlertWarning",
      "insertAlertCaution",
    ];

    for (const action of alertActions) {
      const button = createGroupButton("expandables", [createItem(action, ["textblock"])]);
      const state = getToolbarButtonState(button, {
        surface: "source",
        view,
        context: {
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
          contextMode: "inline-insert",
          nearSpace: false,
          nearPunctuation: false,
          hasSelection: false,
          selectionFrom: 0,
          selectionTo: 0,
        },
      });

      expect(state.notImplemented).toBe(false);
      expect(state.disabled).toBe(false);
    }
  });

  it("enables list actions when in list", () => {
    const button = createGroupButton("list", [createItem("indent", ["list"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
        inCodeBlock: null,
        inBlockMath: null,
        inTable: null,
        inList: { type: "bullet", depth: 1, nodePos: 0 },
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
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    expect(state.disabled).toBe(false);
  });

  it("disables link action when cursor is inside a link", () => {
    const button = createGroupButton("link", [createItem("link", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
        inCodeBlock: null,
        inBlockMath: null,
        inTable: null,
        inList: null,
        inBlockquote: null,
        inHeading: null,
        inLink: { href: "https://example.com", from: 0, to: 10 },
        inImage: null,
        inInlineMath: null,
        inFootnote: null,
        activeFormats: [],
        formatRanges: [],
        innermostFormat: null,
        atLineStart: false,
        atBlankLine: false,
        inWord: null,
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    expect(state.itemStates?.[0].disabled).toBe(true);
  });

  it("disables wiki link action when cursor is inside a link", () => {
    const button = createGroupButton("link", [createItem("link:wiki", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
        inCodeBlock: null,
        inBlockMath: null,
        inTable: null,
        inList: null,
        inBlockquote: null,
        inHeading: null,
        inLink: { href: "https://example.com", from: 0, to: 10 },
        inImage: null,
        inInlineMath: null,
        inFootnote: null,
        activeFormats: [],
        formatRanges: [],
        innermostFormat: null,
        atLineStart: false,
        atBlankLine: false,
        inWord: null,
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    expect(state.itemStates?.[0].disabled).toBe(true);
  });

  it("disables code action when cursor is inside a link", () => {
    const button = createGroupButton("inline", [createItem("code", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
        inCodeBlock: null,
        inBlockMath: null,
        inTable: null,
        inList: null,
        inBlockquote: null,
        inHeading: null,
        inLink: { href: "https://example.com", from: 0, to: 10 },
        inImage: null,
        inInlineMath: null,
        inFootnote: null,
        activeFormats: [],
        formatRanges: [],
        innermostFormat: null,
        atLineStart: false,
        atBlankLine: false,
        inWord: null,
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: true,
        selectionFrom: 1,
        selectionTo: 5,
      },
    });

    expect(state.itemStates?.[0].disabled).toBe(true);
  });

  it("enables bold action when cursor is inside a link (basic marks allowed)", () => {
    const button = createGroupButton("inline", [createItem("bold", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
        inCodeBlock: null,
        inBlockMath: null,
        inTable: null,
        inList: null,
        inBlockquote: null,
        inHeading: null,
        inLink: { href: "https://example.com", from: 0, to: 10 },
        inImage: null,
        inInlineMath: null,
        inFootnote: null,
        activeFormats: [],
        formatRanges: [],
        innermostFormat: null,
        atLineStart: false,
        atBlankLine: false,
        inWord: null,
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: true,
        selectionFrom: 1,
        selectionTo: 5,
      },
    });

    // Bold is allowed inside links (basic marks permitted)
    expect(state.itemStates?.[0].disabled).toBe(false);
  });

  it("enables link action when cursor is NOT inside a link", () => {
    const button = createGroupButton("link", [createItem("link", ["textblock"])]);
    const state = getToolbarButtonState(button, {
      surface: "source",
      view,
      context: {
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
        contextMode: "inline-insert",
        nearSpace: false,
        nearPunctuation: false,
        hasSelection: false,
        selectionFrom: 0,
        selectionTo: 0,
      },
    });

    expect(state.itemStates?.[0].disabled).toBe(false);
  });
});
