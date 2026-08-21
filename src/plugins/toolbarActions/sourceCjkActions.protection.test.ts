// WI-CJKF1.1 — Source-mode "Format CJK Selection" must protect the same
// regions "Format CJK File" does.
//
// This file deliberately mocks NOTHING. The seams it depends on
// (`hostSettings`, `hostDocument`) carry working defaults that match the app,
// so the real formatter runs against real CodeMirror state. Its sibling
// `sourceCjkActions.test.ts` used to mock `@/lib/cjkFormatter` wholesale,
// which is exactly why the corruption below survived: a test that mocks its
// own subject cannot see the subject being wrong.
//
// The defect: `handleFormatCJK` called `formatSelection`, a bare `applyRules`
// pass with no protected-region parsing and no integrity check. Because
// `selectionBlockSpan` widens a selection to the whole top-level blocks it
// touches, a plain Cmd+A rewrote every fenced code block and the YAML
// frontmatter in the document. The `inCodeBlock` guard in
// `actionAvailability.ts` does not cover it — that keys on the CURSOR, which
// on a select-all sits in the trailing paragraph.

import { describe, it, expect, afterEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { handleFormatCJK, handleFormatCJKFile } from "./sourceCjkActions";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length) views.pop()?.destroy();
});

/** A view over `doc` with `[anchor, head]` selected. */
function view(doc: string, anchor = 0, head = anchor): EditorView {
  const parent = document.createElement("div");
  const v = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
    parent,
  });
  views.push(v);
  return v;
}

/** Run "Format CJK Selection" over the whole document and return the result. */
function formatAll(doc: string): string {
  const v = view(doc, 0, doc.length);
  expect(handleFormatCJK(v)).toBe(true);
  return v.state.doc.toString();
}

const FENCE = [
  "第一段English文字",
  "",
  "```python",
  `s = {'中文key': 1}  # 注释text`,
  "```",
  "",
  "第二段English文字",
].join("\n");

describe("handleFormatCJK — protected regions", () => {
  it("leaves a fenced code block byte-identical while formatting the prose around it", () => {
    const out = formatAll(FENCE);

    // The code survives EXACTLY: no curly quotes (which would break the Python
    // string literal), no inserted CJK/Latin space, no collapsed double space.
    expect(out).toContain(`s = {'中文key': 1}  # 注释text`);
    // …and the prose around it is still formatted.
    expect(out.startsWith("第一段 English 文字")).toBe(true);
    expect(out.endsWith("第二段 English 文字")).toBe(true);
  });

  it("agrees with Format CJK File on the same document", () => {
    const viaFile = view(FENCE, 0);
    expect(handleFormatCJKFile(viaFile)).toBe(true);
    expect(formatAll(FENCE)).toBe(viaFile.state.doc.toString());
  });

  it("leaves YAML frontmatter alone — a fullwidth colon breaks the key separator", () => {
    const out = formatAll("---\ntitle: 中文English\nslug: my-post\n---\n\n第一段English");
    expect(out).toContain("title: 中文English");
    expect(out).toContain("slug: my-post");
    expect(out).not.toContain("：");
  });

  it("leaves inline code alone — curly quotes would break the C string", () => {
    const src = `使用 \`printf("中文%d", 1)\` 函数English`;
    const out = formatAll(src);
    expect(out).toContain(`\`printf("中文%d", 1)\``);
  });

  it("leaves a bare URL alone", () => {
    const out = formatAll("参考链接English https://example.com/a_b?x=1&y=2 结束");
    expect(out).toContain("https://example.com/a_b?x=1&y=2");
  });

  it("leaves inline math alone", () => {
    const out = formatAll("公式English $E = mc^2$ 结束English");
    expect(out).toContain("$E = mc^2$");
  });

  it("protects a fence when the selection ENDS inside it", () => {
    const openerAt = FENCE.indexOf("```python");
    const out = (() => {
      const v = view(FENCE, 0, openerAt + 12);
      handleFormatCJK(v);
      return v.state.doc.toString();
    })();
    expect(out).toContain(`s = {'中文key': 1}  # 注释text`);
  });

  it("protects a fence when the selection STARTS inside it", () => {
    const bodyAt = FENCE.indexOf("s = {");
    const v = view(FENCE, bodyAt + 2, FENCE.length);
    handleFormatCJK(v);
    expect(v.state.doc.toString()).toContain(`s = {'中文key': 1}  # 注释text`);
  });

  it("protects BOTH fences when the selection spans two of them", () => {
    const doc = [
      "开头English",
      "",
      "```js",
      "const a = '中文x'",
      "```",
      "",
      "中间English",
      "",
      "~~~sh",
      "echo '中文y'",
      "~~~",
      "",
      "结尾English",
    ].join("\n");
    const out = formatAll(doc);
    expect(out).toContain("const a = '中文x'");
    expect(out).toContain("echo '中文y'");
    expect(out).toContain("开头 English");
    expect(out).toContain("结尾 English");
  });

  it("protects a document that is nothing but a fence", () => {
    const doc = "```python\ns = {'中文key': 1}\n```";
    expect(formatAll(doc)).toBe(doc);
  });

  it("gives the same result for a backwards drag", () => {
    const forwards = formatAll(FENCE);
    const v = view(FENCE, FENCE.length, 0);
    handleFormatCJK(v);
    expect(v.state.doc.toString()).toBe(forwards);
  });
});

describe("handleFormatCJK — boundaries", () => {
  it("still formats an ordinary paragraph selection", () => {
    expect(formatAll("中文段落English文字")).toBe("中文段落 English 文字");
  });

  it("widens a sub-word selection to the block, because spacing is a boundary property", () => {
    // Selecting only "brown" contains no CJK/Latin boundary at all; the action
    // names a REGION to fix, not the exact text to rewrite.
    const doc = "中文段落brown混排English文本";
    const v = view(doc, doc.indexOf("brown"), doc.indexOf("brown") + 5);
    handleFormatCJK(v);
    expect(v.state.doc.toString()).toBe("中文段落 brown 混排 English 文本");
  });

  it("returns true and changes nothing on an empty document", () => {
    const v = view("", 0, 0);
    expect(handleFormatCJK(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("");
  });

  it("does not throw with the selection at the last offset", () => {
    const doc = "中文English";
    const v = view(doc, doc.length, doc.length);
    expect(handleFormatCJK(v)).toBe(true);
  });

  it("preserves CRLF line endings through the replacement", () => {
    // CodeMirror normalises CR on insert, so the assertion is that the
    // formatter does not introduce a literal \r into the buffer either.
    const out = formatAll("中文English\n第二行English");
    expect(out).toBe("中文 English\n第二行 English");
  });

  it("treats a mid-document --- delimited block as frontmatter (over-protection, deliberate)", () => {
    // `findProtectedRegions` anchors frontmatter at offset 0 of the text it is
    // given, and a block span is a SLICE. So a `---`-delimited block that
    // happens to start a span is protected. That is the safe direction — it
    // formats less, never more — and it is pinned so the behaviour is a
    // decision rather than an accident.
    const doc = "前言English\n\n---\nkey: 中文English\n---\n\n后记English";
    const v = view(doc, doc.indexOf("key"), doc.indexOf("key") + 3);
    handleFormatCJK(v);
    expect(v.state.doc.toString()).toContain("key: 中文English");
  });
});
