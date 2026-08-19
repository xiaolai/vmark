// @vitest-environment node
// WI-NB6.1 — the executor's grammar: parse an `action:` step's text into a
// structured action. It must accept EXACTLY what recorder.ts emits (P-1
// round-trip) — click/type with a "name" (role) target, navigate to <url> —
// and reject anything it cannot execute deterministically so the runner pauses.
import { describe, it, expect } from "vitest";
import { parseActionText } from "./stepGrammar";

describe("parseActionText — click", () => {
  it("parses a name+role click", () => {
    expect(parseActionText('click "Publish" (button)')).toEqual({
      kind: "click",
      name: "Publish",
      role: "button",
    });
  });
  it("parses a name-only click", () => {
    expect(parseActionText('click "More"')).toEqual({ kind: "click", name: "More", role: undefined });
  });
  it("keeps CJK and punctuation inside the quotes", () => {
    expect(parseActionText('click "回复 & 提交" (button)')).toEqual({
      kind: "click",
      name: "回复 & 提交",
      role: "button",
    });
  });
});

describe("parseActionText — type", () => {
  it("parses a literal value into a name+role target", () => {
    expect(parseActionText('type "hello world" into "Title" (textbox)')).toEqual({
      kind: "type",
      value: { kind: "literal", text: "hello world" },
      name: "Title",
      role: "textbox",
    });
  });
  it("parses an input variable reference", () => {
    expect(parseActionText('type {article_path} into "Path"')).toEqual({
      kind: "type",
      value: { kind: "input", name: "article_path" },
      name: "Path",
      role: undefined,
    });
  });
  it("parses an empty-string clear", () => {
    expect(parseActionText('type "" into "Search" (searchbox)')).toEqual({
      kind: "type",
      value: { kind: "literal", text: "" },
      name: "Search",
      role: "searchbox",
    });
  });
});

describe("parseActionText — navigate", () => {
  it("parses a navigate target", () => {
    expect(parseActionText("navigate to https://x.example.com/a?b=c")).toEqual({
      kind: "navigate",
      url: "https://x.example.com/a?b=c",
    });
  });
});

describe("parseActionText — non-executable text pauses (returns null)", () => {
  it.each([
    ["navigate", "bare navigate with no url"],
    ["click", "click with no target"],
    ['type "x"', "type with no target"],
    ['type into "Name"', "type with no value"],
    ["scroll down a bit", "free prose"],
    ['click Publish', "unquoted name"],
    ["", "empty"],
  ])("%s → null (%s)", (text) => {
    expect(parseActionText(text)).toBeNull();
  });
});
