// @vitest-environment node
/**
 * WI-CJKF2.2 / WI-CJKF2.3 — two holes in protected-region detection that let
 * `formatMarkdown` (the SAFE entry point) rewrite source code.
 *
 * 2.2 — an UNCLOSED fence was not a region at all, because the detector's
 * pattern requires a matching closing fence. CommonMark closes an unterminated
 * fence at the end of the document, and a document being edited is unterminated
 * most of the time:
 *
 *     ```python
 *     s = {'中文key': 1}        ->    s = {'中文 key': 1}
 *
 * 2.3 — TOML frontmatter (`+++`) was not a region either, so a Hugo post lost
 * its straight quotes to smart-quote conversion and stopped parsing:
 *
 *     title = "中文English"     ->    title = “中文 English”
 *
 * @coordinates-with ../markdownParser.ts — findProtectedRegions
 * @module lib/cjkFormatter/__tests__/regionGaps.test
 */
import { describe, it, expect } from "vitest";
import { findProtectedRegions } from "../markdownParser";
import { formatMarkdown } from "../formatter";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const fmt = (s: string) => formatMarkdown(s, C, { preserveTwoSpaceHardBreaks: true });
const typesOf = (s: string) => findProtectedRegions(s).map((r) => r.type);
const textOf = (s: string) => findProtectedRegions(s).map((r) => s.slice(r.start, r.end));

describe("WI-CJKF2.2 — an unclosed fence runs to the end of the document", () => {
  it("protects a backtick fence with no closer", () => {
    const doc = "正文English\n\n```python\ns = {'中文key': 1}\n";
    expect(typesOf(doc)).toContain("fenced_code");
    // The final newline survives too (WI-CJKF2.4).
    expect(fmt(doc)).toBe("正文 English\n\n```python\ns = {'中文key': 1}\n");
  });

  it("protects a tilde fence with no closer", () => {
    const doc = "正文English\n\n~~~sh\necho '中文key'\n";
    expect(typesOf(doc)).toContain("fenced_code");
    expect(fmt(doc)).toContain("echo '中文key'");
  });

  it("protects an unclosed fence carrying an info string", () => {
    expect(typesOf("```python title=中文\nx = '中文a'\n")).toContain("fenced_code");
  });

  it("accepts a LONGER run as the closer", () => {
    const doc = "```js\nlet 中文a = 1\n````\n\n之后English";
    const regions = findProtectedRegions(doc);
    expect(regions.filter((r) => r.type === "fenced_code")).toHaveLength(1);
    expect(fmt(doc)).toContain("之后 English");
  });

  it("does not accept a shorter run as the closer", () => {
    // CommonMark: the closing fence must be at least as long as the opener.
    const doc = "````js\nlet 中文a = '中文b'\n```\n";
    expect(fmt(doc)).toContain("let 中文a = '中文b'");
    expect(fmt(doc)).toContain("```");
  });

  it("recognises a fence indented up to three spaces", () => {
    expect(typesOf("   ```js\nlet 中文a=1\n")).toContain("fenced_code");
  });

  it("does not treat four-space indentation as a fence", () => {
    // Four spaces is indented code, which has its own detector.
    const types = typesOf("正文\n\n    ```js\n    let a=1\n");
    expect(types).not.toContain("fenced_code");
    expect(types).toContain("indented_code");
  });

  it("pairs the first fence and runs the second to EOF", () => {
    const doc = "```js\nlet 中文a=1\n```\n\n中间English\n\n```py\nb = '中文c'\n";
    const regions = findProtectedRegions(doc);
    expect(regions.filter((r) => r.type === "fenced_code")).toHaveLength(2);
    const out = fmt(doc);
    expect(out).toContain("let 中文a=1");
    expect(out).toContain("b = '中文c'");
    expect(out).toContain("中间 English");
  });

  it("handles a bare opener as the final line", () => {
    expect(typesOf("正文English\n\n```")).toContain("fenced_code");
  });

  it("does not treat a fence inside inline code as an opener", () => {
    const doc = "中文English ``` 更多English";
    expect(typesOf(doc)).not.toContain("fenced_code");
  });

  it("changes nothing for a document with no fences", () => {
    expect(typesOf("中文English 普通段落")).toEqual([]);
  });

  it("is idempotent over an unclosed fence", () => {
    const doc = "正文English\n\n```python\ns = {'中文key': 1}\n";
    const once = fmt(doc);
    expect(fmt(once)).toBe(once);
  });

  it("KNOWN LIMIT: an unclosed fence inside a blockquote is not protected", () => {
    // Recorded rather than fixed (plan: out of scope). Pinned so a future
    // change that fixes it is a deliberate improvement, not a surprise.
    expect(typesOf("> ```js\n> let 中文a=1\n")).not.toContain("fenced_code");
  });
});

describe("WI-CJKF2.3 — TOML frontmatter is protected", () => {
  it("protects a +++ block at offset 0", () => {
    const doc = '+++\ntitle = "中文English"\n+++\n\n正文English';
    expect(typesOf(doc)).toContain("frontmatter");
    expect(fmt(doc)).toBe('+++\ntitle = "中文English"\n+++\n\n正文 English');
  });

  it("protects an empty TOML block", () => {
    expect(textOf("+++\n+++\n\n中文")).toContain("+++\n+++");
  });

  it("handles CRLF delimiters", () => {
    expect(typesOf('+++\r\ntitle = "中文English"\r\n+++\r\n\r\n正文')).toContain("frontmatter");
  });

  it("does not treat an unclosed +++ as frontmatter", () => {
    expect(typesOf('+++\ntitle = "中文English"\n\n正文English')).not.toContain("frontmatter");
  });

  it("does not protect a +++ line in the middle of a document", () => {
    const doc = '中文English\n\n+++\ntitle = "中文"\n+++\n';
    expect(typesOf(doc)).not.toContain("frontmatter");
  });

  it("leaves YAML frontmatter behaviour unchanged", () => {
    const doc = "---\ntitle: 中文English\n---\n\n正文English";
    expect(typesOf(doc)).toContain("frontmatter");
    expect(fmt(doc)).toBe("---\ntitle: 中文English\n---\n\n正文 English");
  });

  it("is idempotent", () => {
    const doc = '+++\ntitle = "中文English"\n+++\n\n正文English';
    const once = fmt(doc);
    expect(fmt(once)).toBe(once);
  });
});
