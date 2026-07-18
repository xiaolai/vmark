/**
 * Search replace staleness tests (Codex audit finding 7).
 *
 * (a) Within the 200ms doc-change debounce, Replace Current/All must not act
 *     on mapped ranges whose text no longer matches the query.
 * (b) Replace transactions must be constructed INSIDE the IME-guard callback:
 *     when the action is queued (composition), a transaction built at event
 *     time is stale and throws "mismatched transaction" on dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

vi.mock("../search.css", () => ({}));

// Controllable IME guard: execute immediately, or queue for later.
const queuedActions: Array<() => void> = [];
let queueMode = false;
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: (_view: unknown, action: () => void) => {
    if (queueMode) queuedActions.push(action);
    else action();
  },
}));

const mockSearchState = {
  isOpen: false,
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  matchCount: 0,
  currentIndex: -1,
  setMatches: vi.fn(),
  findNext: vi.fn(),
};

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      search: mockSearchState,
      searchSetMatches: mockSearchState.setMatches,
      searchFindNext: mockSearchState.findNext,
    }),
    subscribe: () => () => {},
  },
}));

import { searchExtension } from "../tiptap";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { inline: true },
  },
});

function createDoc(texts: string[]) {
  return schema.node(
    "doc",
    null,
    texts.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])),
  );
}

function getPlugin() {
  const extensionContext = {
    name: searchExtension.name,
    options: searchExtension.options,
    storage: searchExtension.storage,
    editor: {} as never,
    type: null,
    parent: undefined,
  };
  const plugins = searchExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
  return plugins[0];
}

type MockView = {
  state: EditorState;
  dom: HTMLElement;
  dispatch: ReturnType<typeof vi.fn>;
};

/** Mock view whose dispatch applies the tr — a mismatched transaction throws
 *  here exactly as it would in the real EditorView. */
function makeView(state: EditorState): MockView {
  const view: MockView = {
    state,
    dom: document.createElement("div"),
    dispatch: vi.fn((tr: Parameters<EditorState["apply"]>[0]) => {
      view.state = view.state.apply(tr);
    }),
  };
  return view;
}

describe("replace staleness (Codex audit finding 7)", () => {
  let activeHandle: { destroy?: () => void } | null = null;

  beforeEach(() => {
    mockSearchState.isOpen = false;
    mockSearchState.query = "";
    mockSearchState.replaceText = "";
    mockSearchState.caseSensitive = false;
    mockSearchState.wholeWord = false;
    mockSearchState.useRegex = false;
    mockSearchState.matchCount = 0;
    mockSearchState.currentIndex = -1;
    mockSearchState.setMatches.mockClear();
    mockSearchState.findNext.mockClear();
    queuedActions.length = 0;
    queueMode = false;
  });

  afterEach(() => {
    // Destroy even when an assertion failed mid-test, so window listeners
    // never leak into the next test.
    activeHandle?.destroy?.();
    activeHandle = null;
    queueMode = false;
    queuedActions.length = 0;
  });

  function setupOpenSearch(docTexts: string[], query: string, replaceText: string) {
    mockSearchState.isOpen = true;
    mockSearchState.query = query;
    mockSearchState.replaceText = replaceText;
    mockSearchState.currentIndex = 0;

    const plugin = getPlugin();
    const doc = createDoc(docTexts);
    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const scanned = state.apply(state.tr); // initial match scan
    const view = makeView(scanned);
    const handle = plugin.spec.view!(view as never);
    activeHandle = handle;
    return { plugin, view, handle };
  }

  it("Replace Current skips a mapped range whose text no longer matches (edit within debounce)", () => {
    const { view, handle } = setupOpenSearch(["hello world"], "hello", "hi");

    // Edit within the debounce window: delete "h". The plugin maps the match
    // [1,6] → [1,5], whose text is now "ello" — no longer the query.
    view.state = view.state.apply(view.state.tr.delete(1, 2));
    expect(view.state.doc.textContent).toBe("ello world");
    view.dispatch.mockClear();

    window.dispatchEvent(new Event("search:replace-current"));

    // The stale range must be skipped — no dispatch, doc unchanged.
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.state.doc.textContent).toBe("ello world");
    handle.destroy!();
  });

  it("Replace Current still replaces a mapped range that remains a live match", () => {
    const { view, handle } = setupOpenSearch(["hello world"], "hello", "hi");

    // Insert BEFORE the match: mapped range [3,8] still reads "hello".
    view.state = view.state.apply(view.state.tr.insertText("X ", 1));
    expect(view.state.doc.textContent).toBe("X hello world");

    window.dispatchEvent(new Event("search:replace-current"));

    expect(view.state.doc.textContent).toBe("X hi world");
    handle.destroy!();
  });

  it("queued Replace Current builds its transaction at execution time (no mismatched transaction)", () => {
    const { view, handle } = setupOpenSearch(["hello world"], "hello", "hi");

    queueMode = true;
    window.dispatchEvent(new Event("search:replace-current"));
    // Nothing dispatched while queued.
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(queuedActions).toHaveLength(1);

    // The doc changes while the action sits in the queue (composition commit).
    view.state = view.state.apply(view.state.tr.insertText("X ", 1));

    queueMode = false;
    // Executing the deferred action must not throw and must replace the
    // CURRENT position of the match.
    queuedActions.shift()!();
    expect(view.state.doc.textContent).toBe("X hi world");
    handle.destroy!();
  });

  it("queued Replace All builds its transaction at execution time", () => {
    const { view, handle } = setupOpenSearch(["hello world hello"], "hello", "hi");

    queueMode = true;
    window.dispatchEvent(new Event("search:replace-all"));
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(queuedActions).toHaveLength(1);

    view.state = view.state.apply(view.state.tr.insertText("X ", 1));

    queueMode = false;
    queuedActions.shift()!();
    expect(view.state.doc.textContent).toBe("X hi world hi");
    handle.destroy!();
  });

  it("Replace All within the debounce acts on fresh matches, not the stale mapped list", () => {
    const { view, handle } = setupOpenSearch(["hello"], "hello", "hi");

    // New occurrence typed within the debounce window — the plugin's mapped
    // match list still only knows about the first one.
    const end = view.state.doc.content.size - 1;
    view.state = view.state.apply(view.state.tr.insertText(" hello", end));
    expect(view.state.doc.textContent).toBe("hello hello");

    window.dispatchEvent(new Event("search:replace-all"));

    expect(view.state.doc.textContent).toBe("hi hi");
    handle.destroy!();
  });
});
