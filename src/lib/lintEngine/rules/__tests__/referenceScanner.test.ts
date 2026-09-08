// @vitest-environment node
//
// The reference vocabulary E01 and W03 share. They read the SAME shapes out of
// one document, and every past disagreement between them — an escaped bracket,
// an inline link counted as a shortcut — was one of the two carrying its own
// copy of this regex (audit 20260907 round 3).
import { describe, it, expect } from "vitest";
import { referenceTokens } from "../referenceScanner";

const scan = (line: string) =>
  [...referenceTokens(line)].map((t) => `${t.kind}:${t.label}@${t.index}${t.inlineLink ? "(url)" : ""}`);

describe("referenceTokens", () => {
  it("reads the three reference forms", () => {
    expect(scan("[a][b]")).toEqual(["full:b@0"]);
    expect(scan("[a][]")).toEqual(["collapsed:a@0"]);
    expect(scan("[a]")).toEqual(["shortcut:a@0"]);
  });

  it("reads image variants the same way", () => {
    expect(scan("![alt][b]")).toEqual(["full:b@0"]);
    expect(scan("![alt]")).toEqual(["shortcut:alt@0"]);
  });

  it("normalizes the label per CommonMark — case and inner whitespace", () => {
    expect(scan("[x][My  Ref]")).toEqual(["full:my ref@0"]);
  });

  it("keeps the label AS WRITTEN for the message", () => {
    expect([...referenceTokens("[x][My  Ref]")][0]?.raw).toBe("My  Ref");
  });

  it("marks an inline link, so a rule can refuse to count it as a shortcut", () => {
    expect(scan("[a](https://e.com)")).toEqual(["shortcut:a@0(url)"]);
    // A space breaks it: `[a] (url)` really is a shortcut followed by text.
    expect(scan("[a] (https://e.com)")).toEqual(["shortcut:a@0"]);
  });

  it("skips an ESCAPED opening bracket — `\\[a][b]` is literal text", () => {
    expect(scan("\\[a][b]")).toEqual([]);
    expect(scan("\\![a][b]")).toEqual(["full:b@1"]);
    // An even run of backslashes escapes the BACKSLASH, not the bracket.
    expect(scan("\\\\[a][b]")).toEqual(["full:b@2"]);
  });

  it("reports the index of the whole reference, not of the label", () => {
    expect(scan("see [a][b] here")).toEqual(["full:b@4"]);
  });

  it("finds every reference on a line", () => {
    expect(scan("[a][x] and [b][y]")).toEqual(["full:x@0", "full:y@11"]);
  });

  it("is reusable — a hoisted global regex must not carry lastIndex over", () => {
    expect(scan("[a][x]")).toEqual(["full:x@0"]);
    expect(scan("[a][x]")).toEqual(["full:x@0"]);
  });
});
