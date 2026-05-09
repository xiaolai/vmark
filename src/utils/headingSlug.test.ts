/**
 * Tests for headingSlug.ts — heading ID generation utilities.
 *
 * Covers: generateSlug, makeUniqueSlug, extractHeadingsWithIds,
 * findHeadingById, findHeadingByIdCM.
 */

import { describe, expect, it, vi } from "vitest";
import {
  generateSlug,
  makeUniqueSlug,
  extractHeadingsWithIds,
  findHeadingById,
  findHeadingByIdCM,
  navigateToHeadingById,
} from "./headingSlug";
import { Schema } from "@tiptap/pm/model";

vi.mock("@/utils/debug", () => ({
  linkPopupError: vi.fn(),
}));

// ---- generateSlug ----

describe("generateSlug", () => {
  it("converts simple text to lowercase slug", () => {
    expect(generateSlug("Hello World")).toBe("hello-world");
  });

  it("handles multiple spaces", () => {
    expect(generateSlug("Hello   World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(generateSlug("Hello! World?")).toBe("hello-world");
  });

  it("handles leading/trailing spaces", () => {
    expect(generateSlug("  Hello World  ")).toBe("hello-world");
  });

  it("collapses multiple hyphens", () => {
    expect(generateSlug("Hello -- World")).toBe("hello-world");
  });

  it("preserves existing hyphens", () => {
    expect(generateSlug("hello-world")).toBe("hello-world");
  });

  it("handles numbers", () => {
    expect(generateSlug("Chapter 1")).toBe("chapter-1");
  });

  it("handles CJK characters", () => {
    expect(generateSlug("\u4f60\u597d\u4e16\u754c")).toBe("\u4f60\u597d\u4e16\u754c");
  });

  it("handles mixed CJK and English", () => {
    expect(generateSlug("Hello \u4e16\u754c")).toBe("hello-\u4e16\u754c");
  });

  it("returns empty string for empty input", () => {
    expect(generateSlug("")).toBe("");
  });

  it("returns empty string for special chars only", () => {
    expect(generateSlug("!@#$%")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(generateSlug("   ")).toBe("");
  });

  // ---- Additional edge cases ----

  it("handles underscores (should preserve as \\w)", () => {
    expect(generateSlug("hello_world")).toBe("hello_world");
  });

  it("handles tab characters", () => {
    expect(generateSlug("hello\tworld")).toBe("hello-world");
  });

  it("handles mixed CJK scripts — only CJK Unified Ideographs are preserved", () => {
    // Hiragana (\u3040-\u309f) is outside the regex range \u4e00-\u9fff, so it's stripped
    expect(generateSlug("\u4f60\u597d\u3053\u3093\u306b\u3061\u306f")).toBe("\u4f60\u597d");
  });

  it("removes parentheses and brackets", () => {
    expect(generateSlug("Section (1) [a]")).toBe("section-1-a");
  });

  it("handles leading hyphens from special chars", () => {
    expect(generateSlug("!Hello")).toBe("hello");
  });

  it("handles trailing hyphens from special chars", () => {
    expect(generateSlug("Hello!")).toBe("hello");
  });

  it("handles single character", () => {
    expect(generateSlug("A")).toBe("a");
  });

  it("handles numbers only", () => {
    expect(generateSlug("123")).toBe("123");
  });

  it("handles emoji (removed as special chars)", () => {
    // Emoji outside CJK range are stripped
    const slug = generateSlug("Hello \u{1F600} World");
    expect(slug).toBe("hello-world");
  });

  it("handles backticks and code formatting chars", () => {
    expect(generateSlug("`code` block")).toBe("code-block");
  });

  it("handles dots and colons", () => {
    expect(generateSlug("v1.2.3: Release")).toBe("v123-release");
  });

  it.each([
    { input: "API Reference", expected: "api-reference" },
    { input: "Getting Started", expected: "getting-started" },
    { input: "FAQ", expected: "faq" },
    { input: "How-To Guide", expected: "how-to-guide" },
    { input: "\u5165\u95e8\u6307\u5357", expected: "\u5165\u95e8\u6307\u5357" },
  ])("slug for $input is $expected", ({ input, expected }) => {
    expect(generateSlug(input)).toBe(expected);
  });
});

// ---- makeUniqueSlug ----

describe("makeUniqueSlug", () => {
  it("returns slug unchanged if not in set", () => {
    const existing = new Set<string>();
    expect(makeUniqueSlug("hello", existing)).toBe("hello");
  });

  it("appends -1 for first collision", () => {
    const existing = new Set(["hello"]);
    expect(makeUniqueSlug("hello", existing)).toBe("hello-1");
  });

  it("increments counter for multiple collisions", () => {
    const existing = new Set(["hello", "hello-1", "hello-2"]);
    expect(makeUniqueSlug("hello", existing)).toBe("hello-3");
  });

  it("returns empty string for empty slug", () => {
    const existing = new Set<string>();
    expect(makeUniqueSlug("", existing)).toBe("");
  });

  it("returns empty string for empty slug even with items in set", () => {
    const existing = new Set(["something"]);
    expect(makeUniqueSlug("", existing)).toBe("");
  });

  it("handles CJK slug collision", () => {
    const existing = new Set(["\u4f60\u597d"]);
    expect(makeUniqueSlug("\u4f60\u597d", existing)).toBe("\u4f60\u597d-1");
  });

  it("handles many collisions", () => {
    const existing = new Set<string>();
    for (let i = 0; i <= 100; i++) {
      existing.add(i === 0 ? "item" : `item-${i}`);
    }
    expect(makeUniqueSlug("item", existing)).toBe("item-101");
  });

  it("does not modify the existing set", () => {
    const existing = new Set(["slug"]);
    makeUniqueSlug("slug", existing);
    expect(existing.size).toBe(1);
  });
});

// ---- ProseMirror-dependent tests ----

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      attrs: { level: { default: 1 } },
      group: "block",
      content: "inline*",
    },
  },
});

describe("extractHeadingsWithIds", () => {
  it("extracts headings with generated IDs", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("Introduction")]),
      schema.node("paragraph", null, [schema.text("Some text")]),
      schema.node("heading", { level: 2 }, [schema.text("Details")]),
    ]);

    const headings = extractHeadingsWithIds(doc);

    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatchObject({
      level: 1,
      text: "Introduction",
      id: "introduction",
    });
    expect(headings[1]).toMatchObject({
      level: 2,
      text: "Details",
      id: "details",
    });
  });

  it("generates unique IDs for duplicate headings", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, [schema.text("Section")]),
      schema.node("heading", { level: 2 }, [schema.text("Section")]),
      schema.node("heading", { level: 2 }, [schema.text("Section")]),
    ]);

    const headings = extractHeadingsWithIds(doc);

    expect(headings).toHaveLength(3);
    expect(headings[0].id).toBe("section");
    expect(headings[1].id).toBe("section-1");
    expect(headings[2].id).toBe("section-2");
  });

  it("includes document positions", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("First")]),
    ]);

    const headings = extractHeadingsWithIds(doc);

    expect(headings[0].pos).toBe(0);
  });

  it("handles document with no headings", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Just text")]),
    ]);

    const headings = extractHeadingsWithIds(doc);
    expect(headings).toHaveLength(0);
  });

  it("skips headings with empty text (produces empty slug)", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, []),
      schema.node("heading", { level: 2 }, [schema.text("Real Heading")]),
    ]);

    const headings = extractHeadingsWithIds(doc);
    // Empty heading has empty text -> empty slug -> empty id -> skipped
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Real Heading");
  });

  it("handles headings with special characters", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("What's New?")]),
    ]);

    const headings = extractHeadingsWithIds(doc);
    expect(headings[0].id).toBe("whats-new");
  });

  it("handles CJK headings", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("\u7b2c\u4e00\u7ae0")]),
    ]);

    const headings = extractHeadingsWithIds(doc);
    expect(headings[0].id).toBe("\u7b2c\u4e00\u7ae0");
  });
});

// ---- findHeadingById ----

describe("findHeadingById", () => {
  it("returns position for existing heading", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("Introduction")]),
      schema.node("paragraph", null, [schema.text("text")]),
      schema.node("heading", { level: 2 }, [schema.text("Details")]),
    ]);

    expect(findHeadingById(doc, "introduction")).toBe(0);
    expect(findHeadingById(doc, "details")).not.toBeNull();
  });

  it("returns null for non-existent heading", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("Title")]),
    ]);

    expect(findHeadingById(doc, "nonexistent")).toBeNull();
  });

  it("returns null for empty document (no headings)", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("no headings")]),
    ]);

    expect(findHeadingById(doc, "anything")).toBeNull();
  });

  it("finds duplicated heading by its unique ID", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, [schema.text("Section")]),
      schema.node("heading", { level: 2 }, [schema.text("Section")]),
    ]);

    expect(findHeadingById(doc, "section")).toBe(0);
    expect(findHeadingById(doc, "section-1")).not.toBeNull();
  });
});

// ---- findHeadingByIdCM ----

describe("findHeadingByIdCM", () => {
  function createMockDoc(lines: string[]) {
    return {
      lines: lines.length,
      line: (n: number) => {
        const text = lines[n - 1]; // 1-indexed
        let from = 0;
        for (let i = 0; i < n - 1; i++) {
          from += lines[i].length + 1; // +1 for \n
        }
        return { from, text };
      },
    };
  }

  it("finds heading by ID in CodeMirror doc", () => {
    const doc = createMockDoc([
      "# Introduction",
      "",
      "Some text",
      "",
      "## Details",
    ]);

    expect(findHeadingByIdCM(doc, "introduction")).toBe(0);
  });

  it("returns null for non-existent heading", () => {
    const doc = createMockDoc(["# Title", "", "text"]);
    expect(findHeadingByIdCM(doc, "nonexistent")).toBeNull();
  });

  it("returns null for document with no headings", () => {
    const doc = createMockDoc(["just text", "more text"]);
    expect(findHeadingByIdCM(doc, "anything")).toBeNull();
  });

  it("handles duplicate headings with unique IDs", () => {
    const doc = createMockDoc([
      "## Section",
      "text",
      "## Section",
    ]);

    expect(findHeadingByIdCM(doc, "section")).toBe(0);
    expect(findHeadingByIdCM(doc, "section-1")).not.toBeNull();
  });

  it("handles h1 through h6", () => {
    const doc = createMockDoc([
      "# H1",
      "## H2",
      "### H3",
      "#### H4",
      "##### H5",
      "###### H6",
    ]);

    expect(findHeadingByIdCM(doc, "h1")).toBe(0);
    expect(findHeadingByIdCM(doc, "h6")).not.toBeNull();
  });

  it("ignores lines that look like headings but aren't (7+ hashes)", () => {
    const doc = createMockDoc(["####### Not a heading"]);
    expect(findHeadingByIdCM(doc, "not-a-heading")).toBeNull();
  });

  it("ignores heading-like content without space after hash", () => {
    const doc = createMockDoc(["#NoSpace"]);
    expect(findHeadingByIdCM(doc, "nospace")).toBeNull();
  });

  it("handles CJK heading text", () => {
    const doc = createMockDoc(["# \u7b2c\u4e00\u7ae0"]);
    expect(findHeadingByIdCM(doc, "\u7b2c\u4e00\u7ae0")).toBe(0);
  });

  it("handles empty document", () => {
    const doc = createMockDoc([]);
    expect(findHeadingByIdCM(doc, "anything")).toBeNull();
  });

  it("returns correct position for heading not at start", () => {
    const doc = createMockDoc([
      "some text",      // 9 chars + \n = from 0
      "",               // 0 chars + \n = from 10
      "## Target",      // from 11
    ]);

    const pos = findHeadingByIdCM(doc, "target");
    expect(pos).toBe(11);
  });

  it("skips headings whose slug is empty (line 105)", () => {
    // Heading text that produces an empty slug (all special chars stripped)
    const doc = createMockDoc([
      "# !!!",          // generateSlug("!!!") = "", makeUniqueSlug("") = ""
      "## Real",
    ]);

    // Should skip the first heading and find the second
    const pos = findHeadingByIdCM(doc, "real");
    expect(pos).not.toBeNull();
  });
});

// ---- navigateToHeadingById ----

describe("navigateToHeadingById", () => {
  // Reuse the PM schema with a heading node so findHeadingById finds a real position.
  const navSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      heading: {
        group: "block",
        content: "inline*",
        attrs: { level: { default: 1 } },
      },
      text: { inline: true, group: "inline" },
    },
  });

  function buildView(targetText: string) {
    const doc = navSchema.node("doc", null, [
      navSchema.node("heading", { level: 1 }, [navSchema.text(targetText)]),
      navSchema.node("paragraph", null, [navSchema.text("body")]),
    ]);
    const dispatch = vi.fn();
    const focus = vi.fn();
    const tr = {
      setSelection: vi.fn().mockReturnThis(),
      scrollIntoView: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
    };
    // Capture the real PM resolver before we replace doc.resolve so the
    // success path still produces a real ResolvedPos.
    const realResolve = doc.resolve.bind(doc);
    const state = { doc, tr, _resolveShouldThrow: false };
    (state.doc as unknown as { resolve: (p: number) => unknown }).resolve = (
      pos: number,
    ) => {
      if (state._resolveShouldThrow) throw new Error("resolve failed");
      return realResolve(pos);
    };
    return {
      view: { state, dispatch, focus } as unknown as Parameters<typeof navigateToHeadingById>[0],
      state,
      dispatch,
      focus,
      tr,
    };
  }

  it("returns false when the heading is not found", () => {
    const { view, dispatch } = buildView("Some Heading");
    expect(navigateToHeadingById(view, "no-such-heading")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches a non-history selection and returns true on success", () => {
    const { view, dispatch, focus, tr } = buildView("Found Heading");
    expect(navigateToHeadingById(view, "found-heading")).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalled();
    expect(tr.setMeta).toHaveBeenCalledWith("addToHistory", false);
  });

  it("catches errors from doc.resolve and returns false (does not throw)", async () => {
    const { view, state, dispatch } = buildView("Boom");
    state._resolveShouldThrow = true;
    expect(navigateToHeadingById(view, "boom")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    const { linkPopupError } = await import("@/utils/debug");
    expect(linkPopupError).toHaveBeenCalledWith(
      "Fragment navigation error:",
      expect.any(Error),
    );
  });
});
