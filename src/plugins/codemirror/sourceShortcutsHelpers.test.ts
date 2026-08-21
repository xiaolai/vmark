/**
 * Source Shortcuts Helpers Tests
 *
 * Tests for text transformation, line operation, navigation,
 * block formatting, and CJK formatting helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mockSearchSlice = {
  isOpen: false,
  matchCount: 0,
};
const mockUIStore = {
  search: mockSearchSlice,
  searchOpen: vi.fn(),
  searchFindNext: vi.fn(),
  searchFindPrevious: vi.fn(),
};

vi.mock("@/plugins/shared/hostSearch", () => ({
  bindHostSearch: vi.fn(),
  resetHostSearch: vi.fn(),
  hostSearch: {
    current: () => mockUIStore.search,
    open: () => mockUIStore.searchOpen(),
    findNext: () => mockUIStore.searchFindNext(),
    findPrevious: () => mockUIStore.searchFindPrevious(),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      cjkFormatting: {},
      markdown: { hardBreakStyleOnSave: "backslash" },
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({ hardBreakStyle: "unknown" }),
      setContent: vi.fn(),
    }),
  },
}));

const mockActiveTabId: Record<string, string | undefined> = { main: "tab-1" };

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: mockActiveTabId,
    }),
  },
}));

vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: () => "main",
}));

const mockResolveHardBreakStyle = vi.fn(() => "backslash");

vi.mock("@/utils/linebreaks", () => ({
  resolveHardBreakStyle: (...args: unknown[]) => mockResolveHardBreakStyle(...args),
}));

vi.mock("@/lib/cjkFormatter", () => ({
  formatMarkdown: (content: string) => content.replace(/hello/g, "HELLO"),
}));

vi.mock("@/stores/sourceCursorContextStore", () => ({
  useEditorStore: { getState: () => ({ context: {} }) },
}));

const mockPerformSourceToolbarAction = vi.fn();
const mockSetSourceHeadingLevel = vi.fn(() => true);
const mockFormatCJKCurrentBlock = vi.fn(() => true);

vi.mock("@/plugins/toolbarActions/sourceAdapter", () => ({
  performSourceToolbarAction: (...args: unknown[]) => mockPerformSourceToolbarAction(...args),
  setSourceHeadingLevel: (...args: unknown[]) => mockSetSourceHeadingLevel(...args),
  formatCJKCurrentBlock: (...args: unknown[]) => mockFormatCJKCurrentBlock(...args),
}));

vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getSourceMultiSelectionContext: () => ({}),
}));

const mockGetHeadingInfo = vi.fn(() => null);
const mockSetHeadingLevel = vi.fn();
const mockConvertToHeading = vi.fn();

vi.mock("@/plugins/sourceContextDetection/headingDetection", () => ({
  getHeadingInfo: (...args: unknown[]) => mockGetHeadingInfo(...args),
  setHeadingLevel: (...args: unknown[]) => mockSetHeadingLevel(...args),
  convertToHeading: (...args: unknown[]) => mockConvertToHeading(...args),
}));

const mockGetListItemInfo = vi.fn(() => null);
const mockConvertListBlock = vi.fn();
const mockRemoveList = vi.fn();

vi.mock("@/plugins/sourceContextDetection/listBlockConversion", () => ({
  convertListBlock: (...args: unknown[]) => mockConvertListBlock(...args),
}));

vi.mock("@/plugins/sourceContextDetection/listDetection", () => ({
  getListItemInfo: (...args: unknown[]) => mockGetListItemInfo(...args),
  removeList: (...args: unknown[]) => mockRemoveList(...args),
}));

const mockToggleBlockquoteAction = vi.fn();

vi.mock("@/plugins/sourceContextDetection/blockquoteActions", () => ({
  toggleBlockquote: (...args: unknown[]) => mockToggleBlockquoteAction(...args),
}));

vi.mock("@/utils/textTransformations", () => ({
  toUpperCase: (s: string) => s.toUpperCase(),
  toLowerCase: (s: string) => s.toLowerCase(),
  toTitleCase: (s: string) => s.replace(/\b\w/g, (c: string) => c.toUpperCase()),
  toggleCase: (s: string) => s === s.toUpperCase() ? s.toLowerCase() : s.toUpperCase(),
  moveLinesUp: (text: string, from: number, to: number) => {
    if (from === 0) return null;
    return { newText: text, newFrom: from, newTo: to };
  },
  moveLinesDown: (text: string, from: number, to: number) => {
    if (to >= text.length) return null;
    return { newText: text, newFrom: from, newTo: to };
  },
  duplicateLines: (text: string, from: number, to: number) => ({
    newText: text + "\n" + text.substring(from, to),
    newFrom: from,
    newTo: to,
  }),
  deleteLines: (text: string) => ({
    newText: text.split("\n").slice(1).join("\n"),
    newCursor: 0,
  }),
  joinLines: (text: string, from: number, to: number) => ({
    newText: text,
    newFrom: from,
    newTo: to,
  }),
  sortLinesAscending: (text: string, from: number, to: number) => ({
    newText: text,
    newFrom: from,
    newTo: to,
  }),
  sortLinesDescending: (text: string, from: number, to: number) => ({
    newText: text,
    newFrom: from,
    newTo: to,
  }),
}));

const mockCopyAsHtml = vi.fn();
vi.mock("@/export", () => ({
  copyAsHtml: (...args: unknown[]) => mockCopyAsHtml(...args),
}));

import {
  openFindBar,
  findNextMatch,
  findPreviousMatch,
  copySelectionAsHtml,
} from "./sourceShortcutsHelpers";

const viewInstances: EditorView[] = [];

function createView(content: string, cursorPos?: number, headPos?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const anchor = cursorPos ?? 0;
  const head = headPos ?? anchor;

  const state = EditorState.create({
    doc: content,
    selection: { anchor, head },
  });
  const view = new EditorView({ state, parent });
  viewInstances.push(view);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchSlice.isOpen = false;
  mockSearchSlice.matchCount = 0;
});

afterEach(() => {
  viewInstances.forEach((v) => {
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  });
  viewInstances.length = 0;
});


describe("openFindBar", () => {
  it("opens search and returns true", () => {
    const result = openFindBar();
    expect(result).toBe(true);
    expect(mockUIStore.searchOpen).toHaveBeenCalled();
  });
});

describe("findNextMatch", () => {
  it("calls findNext when search is open with matches", () => {
    mockSearchSlice.isOpen = true;
    mockSearchSlice.matchCount = 5;
    const view = createView("test");
    const result = findNextMatch(view);
    expect(result).toBe(true);
    expect(mockUIStore.searchFindNext).toHaveBeenCalled();
  });

  it("returns false when search is not open", () => {
    mockSearchSlice.isOpen = false;
    const view = createView("test");
    const result = findNextMatch(view);
    expect(result).toBe(false);
  });

  it("returns false when no matches", () => {
    mockSearchSlice.isOpen = true;
    mockSearchSlice.matchCount = 0;
    const view = createView("test");
    const result = findNextMatch(view);
    expect(result).toBe(false);
  });
});

describe("findPreviousMatch", () => {
  it("calls findPrevious when search is open with matches", () => {
    mockSearchSlice.isOpen = true;
    mockSearchSlice.matchCount = 5;
    const view = createView("test");
    const result = findPreviousMatch(view);
    expect(result).toBe(true);
    expect(mockUIStore.searchFindPrevious).toHaveBeenCalled();
  });

  it("returns false when search is not open", () => {
    mockSearchSlice.isOpen = false;
    const view = createView("test");
    const result = findPreviousMatch(view);
    expect(result).toBe(false);
  });
});

describe("copySelectionAsHtml", () => {
  it("returns true with no selection (copies entire document)", async () => {
    const view = createView("test");
    const result = copySelectionAsHtml(view);
    expect(result).toBe(true);
    // Allow the dynamic import promise chain to resolve
    await new Promise((r) => setTimeout(r, 0));
  });

  it("returns true with a selection (copies selected text)", async () => {
    const view = createView("hello world", 0, 5);
    const result = copySelectionAsHtml(view);
    expect(result).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
  });

  it("handles dynamic import failure gracefully (catch callback)", async () => {
    mockCopyAsHtml.mockImplementationOnce(() => {
      throw new Error("export failed");
    });
    const view = createView("test content");
    const result = copySelectionAsHtml(view);
    expect(result).toBe(true);
    // Allow the promise chain (.then → throw → .catch) to settle
    await new Promise((r) => setTimeout(r, 10));
  });
});

