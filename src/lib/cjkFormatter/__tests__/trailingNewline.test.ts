// @vitest-environment node
/**
 * WI-CJKF2.4 — a formatted file kept its final newline.
 *
 * `formatMarkdown` ended in `out.trimEnd()`, and nothing downstream restored
 * the newline: `saveToPath` writes what the buffer holds. So every "Format CJK
 * File" stripped the POSIX final newline and added
 * `\ No newline at end of file` to the user's next git diff — on a tool whose
 * users keep their documents in git.
 *
 * The trim itself is right (a document should not end in blank lines); what
 * was missing is putting the single terminator back.
 *
 * @coordinates-with ../formatter.ts — the final cleanup step
 * @module lib/cjkFormatter/__tests__/trailingNewline.test
 */
import { describe, it, expect } from "vitest";
import { formatMarkdown } from "../formatter";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const fmt = (s: string) => formatMarkdown(s, C, { preserveTwoSpaceHardBreaks: true });

describe("the document's final newline is preserved", () => {
  it("keeps a single trailing LF", () => {
    expect(fmt("中文English\n")).toBe("中文 English\n");
  });

  it("collapses several trailing newlines to one", () => {
    expect(fmt("中文English\n\n\n")).toBe("中文 English\n");
  });

  it("adds none when the input had none", () => {
    expect(fmt("中文English")).toBe("中文 English");
  });

  it("keeps a trailing CRLF as a CRLF", () => {
    expect(fmt("中文English\r\n")).toBe("中文 English\r\n");
  });

  it("collapses several trailing CRLFs to one", () => {
    expect(fmt("中文English\r\n\r\n")).toBe("中文 English\r\n");
  });

  it("strips trailing spaces before the newline", () => {
    expect(fmt("中文English   \n")).toBe("中文 English\n");
  });

  it("leaves an empty document empty", () => {
    expect(fmt("")).toBe("");
  });

  it("leaves a whitespace-only document empty, with no newline invented", () => {
    expect(fmt("   \n\n   ")).toBe("");
  });

  it("keeps the newline after a fenced block", () => {
    expect(fmt("```js\nlet 中文a=1\n```\n")).toBe("```js\nlet 中文a=1\n```\n");
  });

  it("keeps the newline after a table", () => {
    expect(fmt("| 中文English |\n| --- |\n| 值English |\n")).toBe(
      "| 中文 English |\n| --- |\n| 值 English |\n"
    );
  });

  it("is idempotent", () => {
    for (const input of ["中文English\n", "中文English\n\n\n", "中文English", "中文English\r\n"]) {
      const once = fmt(input);
      expect(fmt(once)).toBe(once);
    }
  });
});
