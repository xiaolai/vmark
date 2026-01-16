import { describe, expect, it } from "vitest";
import { generateSlug, makeUniqueSlug, extractHeadingsWithIds } from "./headingSlug";
import { Schema } from "@tiptap/pm/model";

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
    expect(generateSlug("你好世界")).toBe("你好世界");
  });

  it("handles mixed CJK and English", () => {
    expect(generateSlug("Hello 世界")).toBe("hello-世界");
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
});

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
});

describe("extractHeadingsWithIds", () => {
  // Create a minimal schema for testing
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
});
