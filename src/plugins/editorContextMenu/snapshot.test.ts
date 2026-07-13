// WI-2.1 / WI-3.1 — snapshot providers: normalized state capture from the
// live editor contexts, per-item active/disabled aggregation via the real
// enable rules, link mapping (WYSIWYG mark range; source syntax parsing),
// and the format-policy resolution.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

const mocks = vi.hoisted(() => ({
  getWysiwygMultiSelectionContext: vi.fn(() => undefined),
  getSourceMultiSelectionContext: vi.fn(() => undefined),
  getCurrentWebviewWindow: vi.fn(() => ({ label: "main" })),
  getFormatById: vi.fn(() => undefined as unknown),
}));
vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: mocks.getWysiwygMultiSelectionContext,
  getSourceMultiSelectionContext: mocks.getSourceMultiSelectionContext,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: mocks.getCurrentWebviewWindow,
}));
vi.mock("@/lib/formats/registry", () => ({
  getFormatById: mocks.getFormatById,
}));

import { buildSourceSnapshot, buildWysiwygSnapshot, getActiveFormatMenuPolicy } from "./snapshot";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";

// ---------------------------------------------------------------------------
// WYSIWYG: real ProseMirror states — the snapshot derives its context from the
// live view, so a fake state object would not exercise the code under test.
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    codeBlock: { group: "block", content: "text*", code: true, attrs: { language: { default: "" } } },
    blockquote: { group: "block", content: "block+" },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph+" },
    text: { inline: true, group: "inline" },
  },
  marks: {
    link: { attrs: { href: { default: "" } }, toDOM: (m) => ["a", { href: m.attrs.href }, 0] },
    bold: { toDOM: () => ["strong", 0] },
  },
});

const n = schema.nodes;

/** EditorState with the caret at `cursor` (or a range selection). */
function stateWith(doc: ReturnType<typeof schema.node>, cursor: number, head?: number) {
  const state = EditorState.create({ doc, schema });
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, cursor, head ?? cursor)
    )
  );
}

/** Register a WYSIWYG view whose state is `state`. `storedContext` is what the
 *  editorStore cache holds — deliberately settable to a *stale* value. */
function registerWysiwyg(state: EditorState, storedContext: Record<string, unknown> = {}) {
  useEditorStore.setState((s) => ({
    tiptap: {
      ...s.tiptap,
      editorView: { state } as never,
      context: {
        hasSelection: false,
        atLineStart: false,
        contextMode: "insert",
        surface: "wysiwyg",
        ...storedContext,
      } as never,
    },
  }));
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
  mocks.getCurrentWebviewWindow.mockReturnValue({ label: "main" });
  mocks.getFormatById.mockReturnValue(undefined);
  useEditorStore.setState((s) => ({
    tiptap: { ...s.tiptap, editorView: null, editor: null, context: null },
    source: { ...s.source, editorView: null, context: null },
  }));
  useTabStore.setState({ activeTabId: {}, tabs: {} } as never);
});

describe("buildWysiwygSnapshot", () => {
  it("returns null when no editor is registered", () => {
    expect(buildWysiwygSnapshot()).toBeNull();
  });

  it("normalizes heading, link, and empty-selection state", () => {
    // <h3>go <a href="https://x.example">there</a></h3> — caret inside the link
    const doc = schema.node("doc", null, [
      n.heading.create({ level: 3 }, [
        schema.text("go "),
        schema.text("there", [schema.marks.link.create({ href: "https://x.example" })]),
      ]),
    ]);
    registerWysiwyg(stateWith(doc, 6));

    expect(buildWysiwygSnapshot()).toMatchObject({
      surface: "wysiwyg",
      selectionEmpty: true,
      headingLevel: 3,
      inBlockquote: false,
      // "go " = 1..4, link text = 4..9
      link: { href: "https://x.example", from: 4, to: 9 },
    });
  });

  it("normalizes list and blockquote state, and reports a non-empty selection", () => {
    const doc = schema.node("doc", null, [
      n.blockquote.create(null, [
        n.bulletList.create(null, [
          n.listItem.create(null, [n.paragraph.create(null, [schema.text("item")])]),
        ]),
      ]),
    ]);
    registerWysiwyg(stateWith(doc, 5, 8));

    expect(buildWysiwygSnapshot()).toMatchObject({
      selectionEmpty: false,
      listType: "bullet",
      inBlockquote: true,
      headingLevel: null,
      link: null,
    });
  });

  it("marks code-block context and disables block actions there", () => {
    const doc = schema.node("doc", null, [
      n.codeBlock.create({ language: "ts" }, [schema.text("const a = 1")]),
    ]);
    registerWysiwyg(stateWith(doc, 2));

    const snap = buildWysiwygSnapshot();
    expect(snap?.inCodeBlock).toBe(true);
    // heading:1 is textblock-gated → disabled inside a code block
    expect(snap?.disabledActions).toContain("heading:1");
  });

  // Regression (audit 20260713): during the editor's initial cursor-tracking
  // delay, selection updates never reach editorStore. A right-click that moves
  // the caret must still describe where the caret *now* is, not where the cache
  // says it was.
  it("derives state from the live view, not from a stale cached context", () => {
    const doc = schema.node("doc", null, [
      n.paragraph.create(null, [schema.text("plain")]),
      n.heading.create({ level: 2 }, [schema.text("target")]),
    ]);
    // Live caret sits in the <h2>; the cached context still describes the
    // paragraph — and even claims a code block and a link that no longer apply.
    registerWysiwyg(stateWith(doc, 10), {
      inCodeBlock: { language: "rs", from: 0, to: 6 },
      inLink: { href: "https://stale.example", text: "", from: 1, to: 6, contentFrom: 1, contentTo: 6 },
      inHeading: undefined,
    });

    const snap = buildWysiwygSnapshot();
    expect(snap?.headingLevel).toBe(2);
    expect(snap?.inCodeBlock).toBe(false);
    expect(snap?.link).toBeNull();
    // …and the action states follow the live context, not the cache.
    expect(snap?.disabledActions).not.toContain("heading:1");
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
  const PERMISSIVE = { paragraphFormatting: true, insertBlockActions: true };

  function seedDocumentTab(formatId: string) {
    useTabStore.setState({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", kind: "document", formatId }] },
    } as never);
  }

  it("defaults permissive when no tab is active", () => {
    expect(getActiveFormatMenuPolicy()).toEqual(PERMISSIVE);
  });

  it("reads the active document tab's format policy (restricted format)", () => {
    seedDocumentTab("json");
    mocks.getFormatById.mockReturnValue({
      adapters: { menuPolicy: { paragraphFormatting: false, insertBlockActions: false } },
    });

    expect(getActiveFormatMenuPolicy()).toEqual({
      paragraphFormatting: false,
      insertBlockActions: false,
    });
    expect(mocks.getFormatById).toHaveBeenCalledWith("json");
  });

  it("reads the active document tab's format policy (markdown — both bits)", () => {
    seedDocumentTab("markdown");
    mocks.getFormatById.mockReturnValue({
      adapters: { menuPolicy: { paragraphFormatting: true, insertBlockActions: true } },
    });

    expect(getActiveFormatMenuPolicy()).toEqual(PERMISSIVE);
  });

  it("stays permissive when the format id cannot be resolved in the registry", () => {
    seedDocumentTab("unknown-format");
    mocks.getFormatById.mockReturnValue(undefined);

    expect(getActiveFormatMenuPolicy()).toEqual(PERMISSIVE);
  });

  it("stays permissive for a non-document tab (terminal, browser, …)", () => {
    useTabStore.setState({
      activeTabId: { main: "tab-term" },
      tabs: { main: [{ id: "tab-term", kind: "terminal" }] },
    } as never);

    expect(getActiveFormatMenuPolicy()).toEqual(PERMISSIVE);
    expect(mocks.getFormatById).not.toHaveBeenCalled();
  });

  it("stays permissive when the active tab id no longer resolves to a tab", () => {
    useTabStore.setState({
      activeTabId: { main: "gone" },
      tabs: { main: [] },
    } as never);

    expect(getActiveFormatMenuPolicy()).toEqual(PERMISSIVE);
  });

  it("stays permissive when the webview label is unavailable (non-Tauri host)", () => {
    mocks.getCurrentWebviewWindow.mockImplementation(() => {
      throw new Error("no webview");
    });

    expect(getActiveFormatMenuPolicy()).toEqual(PERMISSIVE);
  });
});
