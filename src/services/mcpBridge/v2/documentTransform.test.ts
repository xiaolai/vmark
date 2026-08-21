// @vitest-environment node
// WI-CJKF4.3 — the MCP `document.transform` kinds must protect the same
// regions the menu command does.
//
// `cjk-format` routes through `formatMarkdown` and was always safe.
// `cjk-spacing` and `cjk-punctuation` ran raw regexes over the WHOLE document,
// so an AI assistant calling either one rewrote fenced code, inline code,
// frontmatter and link URLs — the same corruption class as WI-CJKF1.1, reached
// through the tool surface instead of the keyboard.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/stores/settingsStore", async () => {
  const { DEFAULT_CJK_FORMATTING } = await import("@/lib/cjkFormatter/types");
  return { useSettingsStore: { getState: () => ({ cjkFormatting: DEFAULT_CJK_FORMATTING }) } };
});
vi.mock("@/plugins/toolbarActions/wysiwygAdapterUtils", () => ({
  shouldPreserveTwoSpaceBreaks: () => true,
}));

import { applyTransform, isTransformKind, TRANSFORM_KINDS } from "./documentTransform";

const FENCE = "正文English\n\n```js\nconst 中文a = 中文.b\n```\n\n结束English\n";

describe("every kind protects code fences", () => {
  it.each(TRANSFORM_KINDS)("%s", (kind) => {
    const out = applyTransform(kind, FENCE);
    expect(out).toContain("const 中文a = 中文.b");
  });
});

describe("every kind protects inline code", () => {
  it.each(TRANSFORM_KINDS)("%s", (kind) => {
    const out = applyTransform(kind, "使用 `中文.method(a,b)` 函数English\n");
    expect(out).toContain("`中文.method(a,b)`");
  });
});

describe("every kind protects frontmatter", () => {
  it.each(TRANSFORM_KINDS)("%s", (kind) => {
    const out = applyTransform(kind, "---\ntitle: 中文English\n---\n\n正文English\n");
    expect(out).toContain("title: 中文English");
  });
});

describe("every kind protects link URLs", () => {
  it.each(TRANSFORM_KINDS)("%s", (kind) => {
    const out = applyTransform(kind, "见[链接](https://a.com/中文,b) 内容English\n");
    expect(out).toContain("https://a.com/中文,b");
  });
});

describe("the transforms still do their jobs", () => {
  it("cjk-spacing adds a CJK/Latin space", () => {
    expect(applyTransform("cjk-spacing", "中文English文本")).toBe("中文 English 文本");
  });

  it("cjk-punctuation converts an adjacent mark", () => {
    expect(applyTransform("cjk-punctuation", "你好,世界")).toBe("你好，世界");
  });

  it("cjk-format runs the whole pipeline", () => {
    expect(applyTransform("cjk-format", "中文English,内容\n")).toBe("中文 English，内容\n");
  });
});

describe("edge cases", () => {
  it.each(TRANSFORM_KINDS)("%s handles empty content", (kind) => {
    expect(applyTransform(kind, "")).toBe("");
  });

  it.each(TRANSFORM_KINDS)("%s leaves pure-Latin content alone", (kind) => {
    const text = "Just some English prose, with punctuation.\n";
    expect(applyTransform(kind, text)).toBe(text);
  });

  it.each(TRANSFORM_KINDS)("%s is idempotent", (kind) => {
    const once = applyTransform(kind, FENCE);
    expect(applyTransform(kind, once)).toBe(once);
  });

  it("recognises exactly the declared kinds", () => {
    for (const kind of TRANSFORM_KINDS) expect(isTransformKind(kind)).toBe(true);
    expect(isTransformKind("cjk-nonsense")).toBe(false);
    expect(isTransformKind(42)).toBe(false);
  });
});
