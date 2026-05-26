import { describe, it, expect } from "vitest";
import { extractFootnoteIds, findFootnoteDefinition, isValidFootnoteId } from "./operations";

describe("extractFootnoteIds", () => {
  it("returns empty array when no refs exist", () => {
    expect(extractFootnoteIds("plain text with [link](url)")).toEqual([]);
  });
  it("extracts a single footnote id", () => {
    expect(extractFootnoteIds("see [^foo] for details")).toEqual(["foo"]);
  });
  it("extracts multiple ids, preserving order and duplicates", () => {
    expect(extractFootnoteIds("a[^x] b[^y] c[^x]")).toEqual(["x", "y", "x"]);
  });
  it("ignores malformed refs with whitespace inside brackets", () => {
    expect(extractFootnoteIds("[^bad ref]")).toEqual([]);
  });
});

describe("findFootnoteDefinition", () => {
  const doc = [
    "para",
    "[^one]: body of one",
    "[^two]: body of two",
    "[^three]: ",
    "not a def line",
  ].join("\n");

  it("returns the body for an existing def", () => {
    expect(findFootnoteDefinition(doc, "one")).toBe("body of one");
    expect(findFootnoteDefinition(doc, "two")).toBe("body of two");
  });
  it("returns the empty string for a defined-but-empty body", () => {
    expect(findFootnoteDefinition(doc, "three")).toBe("");
  });
  it("returns null when id is absent", () => {
    expect(findFootnoteDefinition(doc, "missing")).toBeNull();
  });
  it("handles CRLF line endings", () => {
    const crlf = "[^id]: hello\r\nrest";
    expect(findFootnoteDefinition(crlf, "id")).toBe("hello");
  });
});

describe("isValidFootnoteId", () => {
  it.each([
    ["foo", true],
    ["foo-bar", true],
    ["1", true],
    ["", false],
    ["has space", false],
    ["has\ttab", false],
    ["has]bracket", false],
  ])("isValidFootnoteId(%j) -> %s", (input, expected) => {
    expect(isValidFootnoteId(input)).toBe(expected);
  });
});
