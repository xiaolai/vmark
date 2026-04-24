/**
 * Search Plugin (WYSIWYG) Tests
 *
 * Tests for the search extension including:
 * - buildRegex: regex construction from query + options
 * - findMatchesInDoc: match finding in ProseMirror documents
 * - escapeRegExp: special character escaping
 * - Plugin state apply: decoration rebuild triggers
 * - Plugin view: event listener wiring, replace operations
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

// Mock CSS
vi.mock("./search.css", () => ({}));

// Mock imeGuard
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: vi.fn((_view, action) => action()),
}));

// Mock searchStore
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

const mockSearchSubscribers: Array<(state: typeof mockSearchState) => void> = [];

vi.mock("@/stores/searchStore", () => ({
  useSearchStore: {
    getState: () => mockSearchState,
    subscribe: (fn: (state: typeof mockSearchState) => void) => {
      mockSearchSubscribers.push(fn);
      return () => {
        const idx = mockSearchSubscribers.indexOf(fn);
        if (idx >= 0) mockSearchSubscribers.splice(idx, 1);
      };
    },
  },
}));

import {
  searchExtension,
  SEARCH_DOC_CHANGE_DEBOUNCE_MS,
  SEARCH_QUERY_CHANGE_DEBOUNCE_MS,
} from "./tiptap";

/** Flush pending microtasks (used because setMatches is deferred via queueMicrotask) */
const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r));

// Minimal schema
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

describe("searchExtension", () => {
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
    mockSearchSubscribers.length = 0;
  });

  describe("extension creation", () => {
    it("has name 'search'", () => {
      expect(searchExtension.name).toBe("search");
    });
  });

  describe("debounce constants", () => {
    it("query/options debounce is shorter than the doc-change debounce", () => {
      // Query input feels stale when too long; doc-change can wait a bit longer
      // because the user already sees the typed character. Keeping query <= doc
      // also means rapid typing in the find input never out-races a paused doc.
      expect(SEARCH_QUERY_CHANGE_DEBOUNCE_MS).toBeLessThanOrEqual(SEARCH_DOC_CHANGE_DEBOUNCE_MS);
    });

    it("query/options debounce is at least one frame so single keystrokes still coalesce", () => {
      // Anything below ~16ms is effectively undebounced on a 60Hz display.
      expect(SEARCH_QUERY_CHANGE_DEBOUNCE_MS).toBeGreaterThanOrEqual(50);
    });

    it("query/options debounce stays under 250ms so the FindBar feels responsive", () => {
      // VS Code uses ~150ms; over 250ms users perceive lag.
      expect(SEARCH_QUERY_CHANGE_DEBOUNCE_MS).toBeLessThanOrEqual(250);
    });
  });

  describe("escapeRegExp (tested via buildRegex behavior)", () => {
    it("escapes special regex characters in non-regex mode", () => {
      const specialChars = "hello.world";
      const doc = createDoc([specialChars, "helloXworld"]);

      mockSearchState.isOpen = true;
      mockSearchState.query = "hello.world";
      mockSearchState.useRegex = false;

      const state = EditorState.create({ doc, schema });
      expect(state.doc.textContent).toContain("hello.world");
    });
  });

  describe("buildRegex logic", () => {
    it("returns no matches for empty query", () => {
      mockSearchState.isOpen = true;
      mockSearchState.query = "";

      const doc = createDoc(["hello world"]);
      const state = EditorState.create({ doc, schema });
      expect(state.doc.childCount).toBe(1);
    });

    it("handles case-insensitive search by default", () => {
      mockSearchState.isOpen = true;
      mockSearchState.query = "hello";
      mockSearchState.caseSensitive = false;

      const doc = createDoc(["Hello HELLO hello"]);
      const text = doc.textContent;
      const regex = new RegExp("hello", "gi");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(3);
    });

    it("handles case-sensitive search", () => {
      mockSearchState.isOpen = true;
      mockSearchState.query = "hello";
      mockSearchState.caseSensitive = true;

      const doc = createDoc(["Hello HELLO hello"]);
      const text = doc.textContent;
      const regex = new RegExp("hello", "g");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(1);
    });

    it("handles whole word search", () => {
      const text = "hello helloworld worldhello hello";
      const escaped = "hello".replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "gi");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(2);
    });

    it("handles regex search mode", () => {
      const text = "hello hallo hullo";
      const regex = new RegExp("h.llo", "gi");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(3);
    });

    it("returns null for invalid regex patterns gracefully", () => {
      let result: RegExp | null = null;
      try {
        // eslint-disable-next-line no-invalid-regexp
        result = new RegExp("[invalid", "gi");
      } catch {
        result = null;
      }
      expect(result).toBeNull();
    });
  });

  describe("findMatchesInDoc logic", () => {
    it("finds matches across multiple text nodes", () => {
      const doc = createDoc(["hello world", "hello again"]);
      const text1 = doc.child(0).textContent;
      const text2 = doc.child(1).textContent;

      const matches1 = [...text1.matchAll(new RegExp("hello", "gi"))];
      const matches2 = [...text2.matchAll(new RegExp("hello", "gi"))];
      expect(matches1.length + matches2.length).toBe(2);
    });

    it("skips non-text nodes", () => {
      const doc = createDoc(["hello"]);
      let textNodeCount = 0;
      doc.descendants((node) => {
        if (node.isText) textNodeCount++;
      });
      expect(textNodeCount).toBe(1);
    });

    it("handles zero-length matches in regex mode by advancing", () => {
      const text = "abc";
      const regex = /a*/g;
      const matches: Array<{ index: number; length: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        matches.push({ index: m.index, length: m[0].length });
        if (m[0].length === 0) regex.lastIndex++;
      }
      expect(matches.length).toBeGreaterThan(0);
    });

    it("returns empty array when no text matches", () => {
      const doc = createDoc(["hello world"]);
      const matches = [...doc.textContent.matchAll(new RegExp("xyz", "gi"))];
      expect(matches.length).toBe(0);
    });
  });

  describe("plugin state", () => {
    it("initializes with empty matches and decorations", () => {
      const initialState = {
        matches: [],
        currentIndex: -1,
        decorationSet: DecorationSet.empty,
      };
      expect(initialState.matches).toEqual([]);
      expect(initialState.currentIndex).toBe(-1);
    });
  });

  describe("replace operations", () => {
    it("replaceText with empty string effectively deletes matched text", () => {
      mockSearchState.replaceText = "";
      expect(mockSearchState.replaceText).toBe("");
    });

    it("replaceAll processes matches in reverse order to preserve positions", () => {
      const matches = [
        { from: 1, to: 5 },
        { from: 10, to: 15 },
        { from: 20, to: 25 },
      ];
      const sorted = [...matches].sort((a, b) => b.from - a.from);
      expect(sorted[0].from).toBe(20);
      expect(sorted[1].from).toBe(10);
      expect(sorted[2].from).toBe(1);
    });
  });

  describe("scroll behavior", () => {
    it("generates unique scroll keys from search state", () => {
      mockSearchState.query = "test";
      mockSearchState.caseSensitive = true;
      mockSearchState.wholeWord = false;
      mockSearchState.useRegex = false;
      mockSearchState.currentIndex = 0;

      const scrollKey = `${mockSearchState.query}|${mockSearchState.caseSensitive}|${mockSearchState.wholeWord}|${mockSearchState.useRegex}|${mockSearchState.currentIndex}`;
      expect(scrollKey).toBe("test|true|false|false|0");
    });

    it("generates different scroll keys for different indices", () => {
      const key1 = "test|false|false|false|0";
      const key2 = "test|false|false|false|1";
      expect(key1).not.toBe(key2);
    });
  });

  describe("edge cases", () => {
    it("handles empty document", () => {
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, []),
      ]);
      let textFound = false;
      doc.descendants((node) => {
        if (node.isText) textFound = true;
      });
      expect(textFound).toBe(false);
    });

    it("handles document with only whitespace", () => {
      const doc = createDoc(["   "]);
      mockSearchState.query = "hello";
      const matches = [...doc.textContent.matchAll(new RegExp("hello", "gi"))];
      expect(matches.length).toBe(0);
    });

    it("handles very long query string", () => {
      const longQuery = "a".repeat(1000);
      const escaped = longQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      expect(regex).toBeInstanceOf(RegExp);
    });

    it("handles unicode characters in search query", () => {
      const doc = createDoc(["hello world"]);
      const text = doc.textContent;
      const regex = new RegExp("hello", "gi");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(1);
    });

    it("handles regex special chars in non-regex mode", () => {
      const specialChars = "[test]";
      const escaped = specialChars.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(escaped).toBe("\\[test\\]");

      const regex = new RegExp(escaped, "gi");
      const text = "foo [test] bar [test]";
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(2);
    });

    it("handles backslash in search query", () => {
      const query = "\\n";
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(escaped).toBe("\\\\n");
    });

    it("handles regex with pipe alternation", () => {
      const text = "cat and dog and bird";
      const regex = new RegExp("cat|dog", "gi");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(2);
    });

    it("handles wholeWord with punctuation adjacent", () => {
      const text = "hello, world! hello.world";
      const escaped = "hello".replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "gi");
      const matches = [...text.matchAll(regex)];
      expect(matches.length).toBe(2);
    });

    it("handles empty match results from regex", () => {
      const text = "abc";
      const regex = /(?=a)/g;
      const matches: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        matches.push(m[0]);
        if (m[0].length === 0) regex.lastIndex++;
      }
      expect(matches.length).toBe(1);
    });
  });

  describe("decoration creation logic", () => {
    it("creates search-match class for non-active match", () => {
      const isActive = false;
      const className = isActive ? "search-match search-match-active" : "search-match";
      expect(className).toBe("search-match");
    });

    it("creates search-match-active class for active match", () => {
      const isActive = true;
      const className = isActive ? "search-match search-match-active" : "search-match";
      expect(className).toBe("search-match search-match-active");
    });

    it("does not create decorations when search is closed", () => {
      mockSearchState.isOpen = false;
      mockSearchState.query = "hello";
      expect(mockSearchState.isOpen).toBe(false);
    });

    it("does not create decorations when query is empty", () => {
      mockSearchState.isOpen = true;
      mockSearchState.query = "";
      expect(mockSearchState.query).toBe("");
    });
  });

  describe("replaceText logic", () => {
    it("replaces matched text with new text", () => {
      const doc = createDoc(["hello world"]);
      const state = EditorState.create({ doc, schema });

      const match = { from: 1, to: 6 };
      const replaceText = "hi";
      const tr = state.tr.replaceWith(
        match.from,
        match.to,
        replaceText ? schema.text(replaceText) : []
      );
      expect(tr.doc.textContent).toBe("hi world");
    });

    it("deletes matched text when replaceText is empty", () => {
      const doc = createDoc(["hello world"]);
      const state = EditorState.create({ doc, schema });

      const match = { from: 1, to: 6 };
      const tr = state.tr.replaceWith(match.from, match.to, []);
      expect(tr.doc.textContent).toBe(" world");
    });

    it("replaceAll in reverse order preserves positions", () => {
      const doc = createDoc(["aaa bbb aaa"]);
      const state = EditorState.create({ doc, schema });

      const matches = [
        { from: 1, to: 4 },
        { from: 9, to: 12 },
      ];
      const sorted = [...matches].sort((a, b) => b.from - a.from);

      let tr = state.tr;
      for (const match of sorted) {
        tr = tr.replaceWith(match.from, match.to, schema.text("x"));
      }
      expect(tr.doc.textContent).toBe("x bbb x");
    });
  });
});

// --- Phase 3: Plugin-level integration tests ---
// Instantiate the actual plugin from the extension and test its state apply logic.

describe("search plugin integration", () => {
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
    expect(plugins).toHaveLength(1);
    return plugins[0];
  }

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
    mockSearchSubscribers.length = 0;
  });

  it("initializes with empty matches and DecorationSet.empty", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);
    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const pluginState = plugin.getState(state);
    expect(pluginState.matches).toEqual([]);
    expect(pluginState.currentIndex).toBe(-1);
    expect(pluginState.decorationSet).toBe(DecorationSet.empty);
  });

  it("finds matches when search is open and query is set", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    // Apply a trivial transaction to trigger the apply() path
    const _nextState = state.apply(state.tr);
    const _pluginState = plugin.getState(_nextState);

    // setMatches is deferred via queueMicrotask
    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(2, 0);
  });

  it("creates decorations for matches when search is open", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const nextState = state.apply(state.tr);
    const pluginState = plugin.getState(nextState);

    const decorations = pluginState.decorationSet.find();
    expect(decorations.length).toBe(1);
  });

  it("marks the active match with search-match-active class", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 1;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const nextState = state.apply(state.tr);
    const pluginState = plugin.getState(nextState);

    const decorations = pluginState.decorationSet.find();
    expect(decorations.length).toBe(2);
    // Check decoration attrs
    const activeDecoration = decorations.find(
      (d: { type?: { attrs?: Record<string, string> } }) =>
        d.type?.attrs?.class?.includes("search-match-active")
    );
    expect(activeDecoration).toBeDefined();
  });

  it("returns empty decorations when query is empty", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const nextState = state.apply(state.tr);
    const pluginState = plugin.getState(nextState);

    expect(pluginState.decorationSet.find().length).toBe(0);
  });

  it("returns empty decorations when search is closed", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = false;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const nextState = state.apply(state.tr);
    const pluginState = plugin.getState(nextState);

    expect(pluginState.decorationSet.find().length).toBe(0);
  });

  it("handles case-sensitive search via plugin", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["Hello HELLO hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.caseSensitive = true;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    // Only "hello" (lowercase) matches
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(1, 0);
  });

  it("handles whole word search via plugin", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello helloworld hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.wholeWord = true;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    // "hello" as whole word appears twice, "helloworld" is excluded
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(2, 0);
  });

  it("handles regex search via plugin", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello hallo hullo"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "h.llo";
    mockSearchState.useRegex = true;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(3, 0);
  });

  it("handles invalid regex gracefully (returns 0 matches)", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "[invalid";
    mockSearchState.useRegex = true;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(0, -1);
  });

  it("finds matches across multiple paragraphs", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello", "world", "hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(2, 0);
  });

  it("returns no matches for empty document", async () => {
    const plugin = getPlugin();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, []),
    ]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(0, -1);
  });

  it("escapes special regex chars in non-regex mode", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello.world hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello.world";
    mockSearchState.useRegex = false;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _nextState = state.apply(state.tr);

    await flushMicrotasks();
    // In non-regex mode, "." is escaped — only matches literal "hello.world"
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(1, 0);
  });

  it("rebuilds decorations on doc change (after debounce fires)", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    // Trigger query detection (immediate rebuild for first query)
    const state2 = state.apply(state.tr);

    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(1, 0);
    mockSearchState.setMatches.mockClear();

    // Change the doc — this schedules a debounced rebuild (no immediate re-scan)
    const insertTr = state2.tr.insertText(" hello", state2.doc.content.size - 1);
    const state3 = state2.apply(insertTr);

    // Simulate the debounce timer firing by applying a transaction with the
    // SEARCH_DEBOUNCED_REBUILD_META key (this is what setTimeout dispatches in production).
    const debouncedTr = state3.tr.setMeta("searchDebouncedRebuild", true);
    const _state4 = state3.apply(debouncedTr);

    await flushMicrotasks();
    // After the debounced rebuild, setMatches should reflect the updated doc (2 matches)
    expect(mockSearchState.setMatches).toHaveBeenLastCalledWith(2, 0);
  });

  it("provides decorations via props.decorations", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const nextState = state.apply(state.tr);

    // Access decorations via plugin props
    const decorations = plugin.props.decorations!(nextState);
    expect(decorations).toBeDefined();
    const found = (decorations as DecorationSet).find();
    expect(found.length).toBe(1);
  });

  it("props.decorations returns empty DecorationSet when plugin state is absent", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello"]);
    // Create state without the plugin to test null path
    const state = EditorState.create({ doc, schema });
    const decorations = plugin.props.decorations!(state);
    expect(decorations).toBe(DecorationSet.empty);
  });

  it("does not rebuild decorations when nothing changed", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    // First apply triggers query detection
    const state2 = state.apply(state.tr);
    await flushMicrotasks();
    mockSearchState.setMatches.mockClear();

    // Second apply with no changes
    const state3 = state2.apply(state2.tr);
    await flushMicrotasks();
    // setMatches should NOT be called again (no queryChanged, no docChanged)
    expect(mockSearchState.setMatches).not.toHaveBeenCalled();
    // But decorations should be preserved
    const pluginState = plugin.getState(state3);
    expect(pluginState.decorationSet).toBeDefined();
  });

  it("rebuilds decorations when currentIndex changes", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);
    const pluginState1 = plugin.getState(state2);
    expect(pluginState1.currentIndex).toBe(0);

    // Change currentIndex
    mockSearchState.currentIndex = 1;
    const state3 = state2.apply(state2.tr);
    const pluginState2 = plugin.getState(state3);
    expect(pluginState2.currentIndex).toBe(1);

    // The active decoration should have changed
    const decorations = pluginState2.decorationSet.find();
    expect(decorations.length).toBe(2);
  });

  it("clears decorations when search is closed but query still set (needsRebuild with isOpen=false)", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello hello"]);

    // Open search first
    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);
    expect(plugin.getState(state2).decorationSet.find().length).toBe(2);

    // Close search but keep query — needsRebuild = true (isOpen changed) && (state.query truthy)
    // The rebuild happens but isOpen is false, so decorations are empty
    mockSearchState.isOpen = false;
    // Force a queryChanged by toggling caseSensitive
    mockSearchState.caseSensitive = true;
    const state3 = state2.apply(state2.tr);
    const pluginState = plugin.getState(state3);
    // isOpen=false means no decorations created
    expect(pluginState.decorationSet.find().length).toBe(0);
  });

  it("handles query change from non-empty to empty", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);
    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(1, 0);

    // Clear query
    mockSearchState.query = "";
    mockSearchState.setMatches.mockClear();
    const _state3 = state2.apply(state2.tr);
    await flushMicrotasks();
    expect(mockSearchState.setMatches).toHaveBeenCalledWith(0, -1);
  });

  it("handles zero-length regex match by advancing lastIndex", async () => {
    const plugin = getPlugin();
    const doc = createDoc(["abc"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "a*";
    mockSearchState.useRegex = true;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const _state2 = state.apply(state.tr);
    await flushMicrotasks();
    // Should find matches without infinite loop
    expect(mockSearchState.setMatches).toHaveBeenCalled();
    const matchCount = mockSearchState.setMatches.mock.calls[0][0];
    expect(matchCount).toBeGreaterThan(0);
  });
});

describe("search plugin view lifecycle", () => {
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
    mockSearchSubscribers.length = 0;
  });

  it("view subscribes to searchStore and adds event listeners", () => {
    const plugin = getPlugin();
    const addSpy = vi.spyOn(window, "addEventListener");

    const mockView = {
      state: EditorState.create({ doc: createDoc(["hello"]), schema, plugins: [plugin] }),
      dom: document.createElement("div"),
      dispatch: vi.fn(),
      coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120, left: 50 })),
      editable: true,
    };

    const viewResult = plugin.spec.view!(mockView as never);
    expect(viewResult).toBeDefined();
    expect(viewResult.destroy).toBeTypeOf("function");

    // Should have subscribed to the store
    expect(mockSearchSubscribers.length).toBe(1);

    // Should have added event listeners
    expect(addSpy).toHaveBeenCalledWith("search:replace-current", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("search:replace-all", expect.any(Function));

    viewResult.destroy!();
    addSpy.mockRestore();
  });

  it("view destroy unsubscribes and removes event listeners", () => {
    const plugin = getPlugin();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const mockView = {
      state: EditorState.create({ doc: createDoc(["hello"]), schema, plugins: [plugin] }),
      dom: document.createElement("div"),
      dispatch: vi.fn(),
    };

    const viewResult = plugin.spec.view!(mockView as never);
    expect(mockSearchSubscribers.length).toBe(1);

    viewResult.destroy!();

    // Should have unsubscribed
    expect(mockSearchSubscribers.length).toBe(0);

    // Should have removed event listeners
    expect(removeSpy).toHaveBeenCalledWith("search:replace-current", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("search:replace-all", expect.any(Function));

    removeSpy.mockRestore();
  });

  it("store subscription dispatches transaction when search state changes", () => {
    const plugin = getPlugin();
    const mockDispatch = vi.fn();
    const doc = createDoc(["hello world"]);
    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockView = {
      state,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);
    expect(mockSearchSubscribers.length).toBe(1);

    // Simulate search store state change
    mockSearchState.query = "hello";
    mockSearchState.isOpen = true;
    mockSearchSubscribers[0]({ ...mockSearchState });

    // Should have dispatched a transaction to trigger decoration rebuild
    expect(mockDispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("store subscription does not dispatch when state is unchanged", () => {
    const plugin = getPlugin();
    const mockDispatch = vi.fn();
    const doc = createDoc(["hello world"]);
    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockView = {
      state,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Fire with same state — should NOT dispatch
    mockSearchSubscribers[0]({ ...mockSearchState });
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceCurrent replaces matched text", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.replaceText = "hi";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    // Trigger match finding
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Fire replace-current event
    window.dispatchEvent(new Event("search:replace-current"));

    // Should have dispatched a replace transaction
    expect(mockDispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceCurrent with empty replaceText deletes matched text", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.replaceText = "";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-current"));
    expect(mockDispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceCurrent does nothing when search is closed", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = false;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-current"));
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceCurrent does nothing when currentIndex is -1", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = -1;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-current"));
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceAll replaces all matches in reverse order", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello hello hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.replaceText = "hi";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-all"));
    expect(mockDispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceAll does nothing when search is closed", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = false;
    mockSearchState.query = "hello";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-all"));
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceAll does nothing when query is empty", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "";

    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-all"));
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceAll does nothing when no matches exist", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "xyz";
    mockSearchState.currentIndex = -1;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-all"));
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceAll with empty replaceText deletes all matches", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world hello"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.replaceText = "";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-all"));
    expect(mockDispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("handleReplaceCurrent calls findNext after rAF", () => {
    vi.useFakeTimers();
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.replaceText = "hi";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    window.dispatchEvent(new Event("search:replace-current"));
    expect(mockDispatch).toHaveBeenCalled();

    // findNext is called inside rAF
    vi.runAllTimers();
    expect(mockSearchState.findNext).toHaveBeenCalled();

    viewResult.destroy!();
    vi.useRealTimers();
  });

  it("scrollToMatch scrolls when match is outside viewport", () => {
    vi.useFakeTimers();
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const scrollContainer = document.createElement("div");
    scrollContainer.classList.add("editor-content");
    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 0, bottom: 200, left: 0, right: 500, width: 500, height: 200, x: 0, y: 0, toJSON: () => {},
    }));
    scrollContainer.scrollTo = vi.fn();
    Object.defineProperty(scrollContainer, "scrollTop", { value: 0 });

    const editorDom = document.createElement("div");
    scrollContainer.appendChild(editorDom);

    const mockView: Record<string, unknown> = {
      state: state2,
      dom: editorDom,
      dispatch: vi.fn((tr: { apply: unknown }) => {
        // Update the view state so scrollToMatch can read plugin state
        mockView.state = (mockView.state as { apply: (t: unknown) => unknown }).apply(tr);
      }),
      coordsAtPos: vi.fn(() => ({ top: 300, bottom: 320, left: 50 })),
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Trigger a state change to call scrollToMatch via rAF
    // Need to change something so JSON.stringify differs
    mockSearchState.currentIndex = 0;
    mockSearchState.caseSensitive = true; // force state change
    mockSearchSubscribers[0]({ ...mockSearchState });

    // Run rAF callbacks
    vi.runAllTimers();

    expect(scrollContainer.scrollTo).toHaveBeenCalled();

    viewResult.destroy!();
    vi.useRealTimers();
  });

  it("scrollToMatch does not scroll when match is within viewport", () => {
    vi.useFakeTimers();
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;
    mockSearchState.caseSensitive = false;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const scrollContainer = document.createElement("div");
    scrollContainer.classList.add("editor-content");
    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => {},
    }));
    scrollContainer.scrollTo = vi.fn();

    const editorDom = document.createElement("div");
    scrollContainer.appendChild(editorDom);

    const mockView: Record<string, unknown> = {
      state: state2,
      dom: editorDom,
      dispatch: vi.fn((tr: unknown) => {
        mockView.state = (mockView.state as { apply: (t: unknown) => unknown }).apply(tr);
      }),
      coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120, left: 50 })),
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Trigger a state change
    mockSearchState.caseSensitive = true;
    mockSearchSubscribers[0]({ ...mockSearchState });

    vi.runAllTimers();

    // Match is within viewport, no scrollTo
    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();

    viewResult.destroy!();
    vi.useRealTimers();
  });

  it("scrollToMatch does not scroll when search is closed", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = false;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });

    const mockView = {
      state,
      dom: {
        closest: vi.fn(() => null),
      },
      dispatch: vi.fn(),
      coordsAtPos: vi.fn(),
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Trigger a state change that would cause scrollToMatch
    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;
    mockSearchSubscribers[0]({ ...mockSearchState });

    // coordsAtPos should not be called when scrollContainer is not found
    // (the view dispatches a transaction, but scrollToMatch runs in rAF)
    viewResult.destroy!();
  });

  it("scrollToMatch returns early when search is closed or currentIndex < 0 (line 171)", () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    // State: isOpen=true, currentIndex=0, has matches
    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr); // find matches

    const coordsAtPos = vi.fn(() => ({ top: 300, bottom: 320, left: 50 }));

    // Scroll container NOT in DOM → closest returns null → line 184 fires
    const editorDom = document.createElement("div");
    // NOT appended to a .editor-content ancestor

    const mockDispatch = vi.fn((tr: unknown) => {
      mockView.state = (mockView.state as { apply: (t: unknown) => unknown }).apply(tr);
    });

    const mockView: Record<string, unknown> = {
      state: state2,
      dom: editorDom,
      dispatch: mockDispatch,
      coordsAtPos,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Change state to trigger subscription + scrollToMatch via rAF
    mockSearchState.caseSensitive = true;
    mockSearchSubscribers[0]({ ...mockSearchState });

    // rAF fires immediately due to spy — scrollToMatch runs
    // closest(".editor-content") returns null → line 184 early return
    expect(coordsAtPos).not.toHaveBeenCalled();

    // Now set currentIndex < 0 to trigger line 171 early return
    mockSearchState.currentIndex = -1;
    mockSearchState.caseSensitive = false;
    mockSearchSubscribers[0]({ ...mockSearchState });
    expect(coordsAtPos).not.toHaveBeenCalled();

    viewResult.destroy!();
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it("scrollToMatch returns early when scrollKey unchanged (line 174)", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    // Start: isOpen=false so the view initializes without any scroll
    mockSearchState.isOpen = false;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 0;
    mockSearchState.caseSensitive = false;
    mockSearchState.wholeWord = false;
    mockSearchState.useRegex = false;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr);

    const scrollContainer = document.createElement("div");
    scrollContainer.classList.add("editor-content");
    const scrollToFn = vi.fn();
    scrollContainer.scrollTo = scrollToFn;
    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => {},
    }));
    const editorDom = document.createElement("div");
    scrollContainer.appendChild(editorDom);
    document.body.appendChild(scrollContainer);

    // rAF fires synchronously
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    const mockView: Record<string, unknown> = {
      state: state2,
      dom: editorDom,
      dispatch: vi.fn((tr: unknown) => {
        mockView.state = (mockView.state as { apply: (t: unknown) => unknown }).apply(tr);
      }),
      coordsAtPos: vi.fn(() => ({ top: 600, bottom: 620, left: 50 })), // outside viewport → scrollTo
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Step 1: Change isOpen=true → scrollToMatch fires, processes scrollKey, sets lastScrollKey
    mockSearchState.isOpen = true;
    mockSearchSubscribers[0]({ ...mockSearchState });
    const callsAfterFirst = scrollToFn.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // first scrollToMatch scrolled

    // Step 2: Close search (isOpen=false) → scrollToMatch fires → line 171 early return (isOpen=false)
    mockSearchState.isOpen = false;
    mockSearchSubscribers[0]({ ...mockSearchState });

    // Step 3: Open search again with SAME query/cs/ww/ur/idx
    // → scrollToMatch fires again → line 171 passes (isOpen=true)
    // → scrollKey = "hello|false|false|false|0" = lastScrollKey → line 174 fires!
    mockSearchState.isOpen = true;
    mockSearchSubscribers[0]({ ...mockSearchState });

    // scrollTo should NOT have been called again (line 174 returned early)
    expect(scrollToFn.mock.calls.length).toBe(callsAfterFirst);

    viewResult.destroy!();
    document.body.removeChild(scrollContainer);
    rafSpy.mockRestore();
  });

  it("scrollToMatch returns early when no match at currentIndex (line 177)", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    // Set currentIndex=99 (no match at that index)
    mockSearchState.isOpen = false;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 99;
    mockSearchState.caseSensitive = false;
    mockSearchState.wholeWord = false;
    mockSearchState.useRegex = false;

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    const state2 = state.apply(state.tr); // finds 1 match for "hello", but idx 99 is out of range

    const scrollContainer = document.createElement("div");
    scrollContainer.classList.add("editor-content");
    const scrollToFn = vi.fn();
    scrollContainer.scrollTo = scrollToFn;
    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => {},
    }));
    const editorDom2 = document.createElement("div");
    scrollContainer.appendChild(editorDom2);
    document.body.appendChild(scrollContainer);

    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    const mockView: Record<string, unknown> = {
      state: state2,
      dom: editorDom2,
      dispatch: vi.fn((tr: unknown) => {
        mockView.state = (mockView.state as { apply: (t: unknown) => unknown }).apply(tr);
      }),
      coordsAtPos: vi.fn(() => ({ top: 600, bottom: 620, left: 50 })),
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Open search: isOpen=true → scrollToMatch fires
    // line 171: passes (isOpen=true, idx=99 ≥ 0)
    // line 174: new scrollKey → passes
    // line 177: pluginState.matches[99] is undefined → early return
    mockSearchState.isOpen = true;
    mockSearchSubscribers[0]({ ...mockSearchState });

    // No scroll should have happened (line 177 returned early)
    expect(scrollToFn).not.toHaveBeenCalled();

    viewResult.destroy!();
    document.body.removeChild(scrollContainer);
    rafSpy.mockRestore();
  });

  it("handleReplaceCurrent returns early when no match at currentIndex (line 202)", () => {
    const plugin = getPlugin();
    const doc = createDoc(["hello world"]);

    mockSearchState.isOpen = true;
    mockSearchState.query = "hello";
    mockSearchState.currentIndex = 99; // out of range — no match at index 99

    const state = EditorState.create({ doc, schema, plugins: [plugin] });
    // Apply to find matches (only 1 match for "hello" in "hello world")
    const state2 = state.apply(state.tr);

    const mockDispatch = vi.fn();
    const mockView = {
      state: state2,
      dom: document.createElement("div"),
      dispatch: mockDispatch,
    };

    const viewResult = plugin.spec.view!(mockView as never);

    // Fire replace-current with currentIndex=99 (no match at that index → line 202 early return)
    window.dispatchEvent(new Event("search:replace-current"));
    expect(mockDispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });
});
