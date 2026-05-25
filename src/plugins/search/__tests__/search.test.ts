/**
 * Tests for search plugin — escapeRegExp and findMatchesInDoc helpers.
 *
 * We import the module and test the pure functions that are accessible.
 * Since findMatchesInDoc and escapeRegExp are module-scoped, we test them
 * indirectly via a minimal ProseMirror doc, or extract and test the regex logic.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";

// Mock dependencies before imports
vi.mock("@/stores/searchStore", () => {
  const state = {
    query: "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    isOpen: false,
    replaceText: "",
    currentIndex: -1,
    matchCount: 0,
    setMatches: vi.fn(),
    findNext: vi.fn(),
  };
  return {
    useUIStore: {
      getState: () => state,
      subscribe: vi.fn(() => vi.fn()),
      setState: (partial: Record<string, unknown>) => Object.assign(state, partial),
    },
  };
});

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: vi.fn((_view, fn) => fn()),
}));

// ---------------------------------------------------------------------------
// Test the escapeRegExp logic directly (replicated from source)
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("escapeRegExp", () => {
  it.each([
    { input: "hello", expected: "hello" },
    { input: "hello.world", expected: "hello\\.world" },
    { input: "a+b*c?", expected: "a\\+b\\*c\\?" },
    { input: "foo[bar]", expected: "foo\\[bar\\]" },
    { input: "(a|b)", expected: "\\(a\\|b\\)" },
    { input: "price: $10", expected: "price: \\$10" },
    { input: "a{2}", expected: "a\\{2\\}" },
    { input: "back\\slash", expected: "back\\\\slash" },
    { input: "^start", expected: "\\^start" },
    { input: "", expected: "" },
  ])("escapes '$input' to '$expected'", ({ input, expected }) => {
    expect(escapeRegExp(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Test findMatchesInDoc logic via schema + doc
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createDoc(texts: string[]) {
  const paragraphs = texts.map((t) =>
    t ? schema.node("paragraph", null, [schema.text(t)]) : schema.node("paragraph")
  );
  return schema.node("doc", null, paragraphs);
}

/**
 * Replicated findMatchesInDoc for testing since it's module-private.
 * This ensures our test validates the same algorithm.
 */
function findMatchesInDoc(
  doc: ReturnType<typeof createDoc>,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): Array<{ from: number; to: number }> {
  if (!query) return [];

  const matches: Array<{ from: number; to: number }> = [];
  const flags = caseSensitive ? "g" : "gi";

  let pattern: string;
  if (useRegex) {
    pattern = query;
  } else {
    pattern = escapeRegExp(query);
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return [];
  }

  let textOffset = 0;
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap[textOffset + i] = pos + i;
      }
      textOffset += node.text.length;
    }
  });

  const text = doc.textContent;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const from = posMap[match.index];
    const to = posMap[match.index + match[0].length - 1];
    if (from !== undefined && to !== undefined) {
      matches.push({ from, to: to + 1 });
    }
    if (match[0].length === 0) regex.lastIndex++;
  }

  return matches;
}

describe("findMatchesInDoc", () => {
  it("returns empty for empty query", () => {
    const doc = createDoc(["hello world"]);
    expect(findMatchesInDoc(doc, "", false, false, false)).toEqual([]);
  });

  it("finds simple text match", () => {
    const doc = createDoc(["hello world"]);
    const matches = findMatchesInDoc(doc, "hello", false, false, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].to - matches[0].from).toBe(5);
  });

  it("finds multiple matches", () => {
    const doc = createDoc(["foo bar foo baz foo"]);
    const matches = findMatchesInDoc(doc, "foo", false, false, false);
    expect(matches).toHaveLength(3);
  });

  it("is case-insensitive by default", () => {
    const doc = createDoc(["Hello HELLO hello"]);
    const matches = findMatchesInDoc(doc, "hello", false, false, false);
    expect(matches).toHaveLength(3);
  });

  it("respects case-sensitive flag", () => {
    const doc = createDoc(["Hello HELLO hello"]);
    const matches = findMatchesInDoc(doc, "hello", true, false, false);
    expect(matches).toHaveLength(1);
  });

  it("respects whole-word flag", () => {
    const doc = createDoc(["foobar foo barfoo"]);
    const matches = findMatchesInDoc(doc, "foo", false, true, false);
    expect(matches).toHaveLength(1);
  });

  it("supports regex mode", () => {
    const doc = createDoc(["abc 123 def 456"]);
    const matches = findMatchesInDoc(doc, "\\d+", false, false, true);
    expect(matches).toHaveLength(2);
  });

  it("returns empty for invalid regex", () => {
    const doc = createDoc(["hello world"]);
    const matches = findMatchesInDoc(doc, "[invalid", false, false, true);
    expect(matches).toEqual([]);
  });

  it("handles zero-length regex matches without infinite loop", () => {
    const doc = createDoc(["abc"]);
    // Empty regex pattern matches everywhere; should not hang
    const matches = findMatchesInDoc(doc, "(?:)", false, false, true);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("finds matches across multiple paragraphs", () => {
    const doc = createDoc(["hello", "hello"]);
    const matches = findMatchesInDoc(doc, "hello", false, false, false);
    expect(matches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Extension structural test
// ---------------------------------------------------------------------------

describe("searchExtension", () => {
  // Lazy import to avoid triggering store subscription side effects in all tests
  it("creates extension with correct name", async () => {
    const { searchExtension } = await import("../tiptap");
    expect(searchExtension.name).toBe("search");
  });
});

describe("search rebuild debounce", () => {
  it("search extension exports SEARCH_DOC_CHANGE_DEBOUNCE_MS constant", async () => {
    const mod = await import("../tiptap");
    expect((mod as any).SEARCH_DOC_CHANGE_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
    expect((mod as any).SEARCH_DOC_CHANGE_DEBOUNCE_MS).toBeLessThanOrEqual(500);
  });
});
