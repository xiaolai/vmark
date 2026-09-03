// @vitest-environment node
// WI-NB6.1 — the executor's grammar: parse an `action:` step's text into a
// structured action. It must accept EXACTLY what recorder.ts emits (P-1
// round-trip) — click/type with a "name" (role) target, navigate to <url> —
// and reject anything it cannot execute deterministically so the runner pauses.
import { describe, it, expect } from "vitest";
import { parseAction, parseActionText } from "./stepGrammar";
import { expectBoundedTime } from "@/test/timeBudget";

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

// Audit 2026-09-03 W12 — robustness: an empty or unbalanced target is
// `malformed-target` (never an empty name that would match unlabeled controls),
// a quoted value may contain " into ", and the quoted-run scan is linear so a
// hostile 60 KB `\"` run cannot stall the UI thread.
describe("parseAction — malformed targets are rejected, never an empty name", () => {
  it.each([
    ['click ""', "empty name"],
    ['click "   "', "whitespace-only name"],
    ['click "a"b"', "unescaped inner quote"],
    ['click "unterminated', "unterminated quote"],
    ['click "a" (Button)', "role is not a lowercase ARIA token"],
    ['click "a" trailing', "junk after the target"],
    ['type {x} into ""', "empty type target"],
    ['type "v" into "a"b" (textbox)', "unescaped inner quote in a type target"],
  ])("%s → malformed-target (%s)", (text) => {
    const r = parseAction(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("malformed-target");
    expect(parseActionText(text)).toBeNull();
  });

  it("an escaped inner quote is a legitimate name", () => {
    expect(parseAction('click "Say \\"hi\\"" (button)')).toEqual({
      ok: true,
      action: { kind: "click", name: 'Say "hi"', role: "button" },
    });
  });

  it("a malformed type VALUE is reported as malformed-value", () => {
    const r = parseAction('type "unterminated into "F"');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("malformed-value");
  });

  it("a quoted value may itself contain ` into `", () => {
    expect(parseAction('type "go into town" into "Field" (textbox)')).toEqual({
      ok: true,
      action: { kind: "type", value: { kind: "literal", text: "go into town" }, name: "Field", role: "textbox" },
    });
  });

  it("free prose and unquoted names stay not-executable (the model handles them)", () => {
    for (const text of ["scroll down a bit", "click Publish", "navigate", ""]) {
      const r = parseAction(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not-executable");
    }
  });

  it("scans a 60 KB run of escaped quotes in bounded time", () => {
    const hostile = `click "${"\\\"".repeat(30_000)}`; // opening quote, then 30k escaped quotes, never closed
    const started = performance.now();
    const r = parseAction(hostile);
    const elapsed = performance.now() - started;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("malformed-target");
    expectBoundedTime(elapsed, { budgetMs: 200, livenessMs: 5_000, label: "parseAction hostile quotes" });
  });
});
