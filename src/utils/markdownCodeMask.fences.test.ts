// @vitest-environment node
// CommonMark fence-grammar strictness tests for buildCodeMask, split
// from markdownCodeMask.test.ts (file-size limit). These pin the
// closer and info-string rules its consumers (link detection, CJK
// formatting, paste cleaning) rely on.

import { describe, it, expect } from "vitest";
import { buildCodeMask } from "./markdownCodeMask";

describe("buildCodeMask — CommonMark closer strictness", () => {
  it("a closer with trailing text does not close the fence", () => {
    // CommonMark: a closing fence may carry only trailing whitespace.
    // "``` x" is CONTENT, so the lines after it are still code — the
    // old regex accepted it as a closer and under-masked them.
    const md = ["```", "code", "``` x", "\\( still code \\)", "```", "after"].join("\n");
    const mask = buildCodeMask(md);
    const idx = md.indexOf("\\( still code");
    expect(mask[idx]).toBe(1);
    expect(mask[md.indexOf("after")]).toBe(0);
  });

  it("a closer with trailing whitespace still closes", () => {
    const md = ["```", "code", "```  ", "after"].join("\n");
    const mask = buildCodeMask(md);
    expect(mask[md.indexOf("after")]).toBe(0);
  });

  it("a CRLF closer still closes", () => {
    const md = "```\r\ncode\r\n```\r\nafter";
    const mask = buildCodeMask(md);
    expect(mask[md.indexOf("after")]).toBe(0);
  });
});

describe("buildCodeMask — backtick info strings", () => {
  it("a ```info` line with a backtick in the info is prose, not an opener", () => {
    // CommonMark bans backticks in a backtick fence's info string;
    // accepting it would mis-mask everything after the line.
    const md = ["```foo`", "not code \\( x \\)", "text"].join("\n");
    const mask = buildCodeMask(md);
    expect(mask[md.indexOf("not code")]).toBe(0);
  });

  it("a tilde fence may carry anything in its info string", () => {
    const md = ["~~~foo`bar", "code", "~~~"].join("\n");
    const mask = buildCodeMask(md);
    expect(mask[md.indexOf("code")]).toBe(1);
  });
});
