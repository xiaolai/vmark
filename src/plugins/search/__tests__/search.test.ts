// @vitest-environment node
/**
 * Tests for search plugin — findMatchesInDoc, including the literal-query
 * escaping contract (module-private `escapeRegExp`), asserted through the real
 * implementation: a non-regex query containing regex metacharacters must match
 * itself literally.
 *
 * findMatches.ts imports no stores and no IME guard, so nothing is mocked.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";

import { findMatchesInDoc } from "../findMatches";

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

describe("findMatchesInDoc — a non-regex query is matched literally", () => {
  it.each([
    "hello.world",
    "a+b*c?",
    "foo[bar]",
    "(a|b)",
    "price: $10",
    "a{2}",
    "back\\slash",
    "^start",
  ])("finds '%s' only as literal text", (query) => {
    // The decoy would match if the metacharacters were left unescaped.
    const decoy = query === "^start" ? "xstart" : "zzz";
    const doc = createDoc([`${decoy} ${query} tail`]);
    const matches = findMatchesInDoc(doc, query, true, false, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].to - matches[0].from).toBe(query.length);
  });

  it("treats the same metacharacters as a pattern when regex mode is on", () => {
    const doc = createDoc(["helloXworld"]);
    expect(findMatchesInDoc(doc, "hello.world", true, false, true)).toHaveLength(1);
    expect(findMatchesInDoc(doc, "hello.world", true, false, false)).toHaveLength(0);
  });
});

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
