// WI-2.1 / WI-3.1 — snapshot providers: normalized state capture from the
// live editor contexts, per-item active/disabled aggregation via the real
// enable rules, link mapping (WYSIWYG mark range; source syntax parsing),
// and the permissive format-policy default.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWysiwygMultiSelectionContext: vi.fn(() => undefined),
  getSourceMultiSelectionContext: vi.fn(() => undefined),
}));
vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: mocks.getWysiwygMultiSelectionContext,
  getSourceMultiSelectionContext: mocks.getSourceMultiSelectionContext,
}));

import { buildSourceSnapshot, buildWysiwygSnapshot, getActiveFormatMenuPolicy } from "./snapshot";
import { useEditorStore } from "@/stores/editorStore";

function fakeWysiwygView(selectionEmpty = true) {
  return {
    state: {
      schema: { marks: {} },
      storedMarks: null,
      selection: { empty: selectionEmpty, from: 1, to: 1, $from: { marks: () => [] } },
      doc: { rangeHasMark: () => false },
    },
  };
}

function wysiwygContext(overrides: Record<string, unknown> = {}) {
  return {
    hasSelection: false,
    inCodeBlock: undefined,
    inTable: undefined,
    inList: undefined,
    inBlockquote: undefined,
    inHeading: undefined,
    inLink: undefined,
    ...overrides,
  };
}

function fakeSourceView(linkSyntax = "[t](https://inline.example)", docText = "", selectionEmpty = true) {
  return {
    state: {
      selection: { main: { empty: selectionEmpty }, ranges: [{ empty: selectionEmpty }] },
      doc: {
        sliceString: vi.fn(() => linkSyntax),
        toString: vi.fn(() => docText),
      },
    },
  };
}

function sourceContext(overrides: Record<string, unknown> = {}) {
  return {
    hasSelection: false,
    inCodeBlock: null,
    inTable: null,
    inList: null,
    inBlockquote: null,
    inHeading: null,
    inLink: null,
    activeFormats: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState((s) => ({
    tiptap: { ...s.tiptap, editorView: null, editor: null, context: null },
    source: { ...s.source, editorView: null, context: null },
  }));
});

describe("buildWysiwygSnapshot", () => {
  it("returns null when no editor is registered", () => {
    expect(buildWysiwygSnapshot()).toBeNull();
  });

  it("normalizes block, list, heading, and link state", () => {
    useEditorStore.setState((s) => ({
      tiptap: {
        ...s.tiptap,
        editorView: fakeWysiwygView(false) as never,
        context: wysiwygContext({
          hasSelection: true,
          inHeading: { level: 3 },
          inList: { listType: "task", depth: 1 },
          inBlockquote: { depth: 1 },
          inLink: { href: "https://x.example", text: "x", from: 4, to: 9, contentFrom: 5, contentTo: 6 },
        }) as never,
      },
    }));
    const snap = buildWysiwygSnapshot();
    expect(snap).toMatchObject({
      surface: "wysiwyg",
      selectionEmpty: false,
      headingLevel: 3,
      listType: "task",
      inBlockquote: true,
      link: { href: "https://x.example", from: 4, to: 9 },
    });
  });

  it("marks code-block context and disables block actions there", () => {
    useEditorStore.setState((s) => ({
      tiptap: {
        ...s.tiptap,
        editorView: fakeWysiwygView() as never,
        context: wysiwygContext({ inCodeBlock: { language: "ts" } }) as never,
      },
    }));
    const snap = buildWysiwygSnapshot();
    expect(snap?.inCodeBlock).toBe(true);
    // heading:1 is textblock-gated → disabled inside a code block
    expect(snap?.disabledActions).toContain("heading:1");
  });
});

describe("buildSourceSnapshot", () => {
  it("returns null when no source editor is registered", () => {
    expect(buildSourceSnapshot()).toBeNull();
  });

  it("parses inline link targets from the link's source syntax", () => {
    useEditorStore.setState((s) => ({
      source: {
        ...s.source,
        editorView: fakeSourceView("[t](https://inline.example)") as never,
        context: sourceContext({
          inLink: { href: "", text: "t", from: 0, to: 27, contentFrom: 1, contentTo: 2 },
        }) as never,
      },
    }));
    const snap = buildSourceSnapshot();
    expect(snap?.link).toEqual({ href: "https://inline.example", from: 0, to: 27 });
  });

  it("yields href null for unresolved reference links (Copy Link disabled)", () => {
    useEditorStore.setState((s) => ({
      source: {
        ...s.source,
        editorView: fakeSourceView("[t][missing]", "doc without defs") as never,
        context: sourceContext({
          inLink: { href: "", text: "t", from: 0, to: 12, contentFrom: 1, contentTo: 2 },
        }) as never,
      },
    }));
    expect(buildSourceSnapshot()?.link).toEqual({ href: null, from: 0, to: 12 });
  });

  it("maps source list types and heading levels", () => {
    useEditorStore.setState((s) => ({
      source: {
        ...s.source,
        editorView: fakeSourceView(undefined, "", false) as never,
        context: sourceContext({
          inList: { type: "ordered" },
          inHeading: { level: 2 },
          hasSelection: true,
        }) as never,
      },
    }));
    const snap = buildSourceSnapshot();
    expect(snap).toMatchObject({
      surface: "source",
      selectionEmpty: false,
      listType: "ordered",
      headingLevel: 2,
      link: null,
    });
  });
});

describe("getActiveFormatMenuPolicy", () => {
  it("defaults permissive when the format cannot be resolved", () => {
    expect(getActiveFormatMenuPolicy()).toEqual({
      paragraphFormatting: true,
      insertBlockActions: true,
    });
  });
});
