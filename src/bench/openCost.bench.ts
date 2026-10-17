/**
 * Open-cost benchmark (#1565)
 *
 * What opening an image-heavy CJK document costs before the first paint, in
 * the two stages the main thread spends it on: the markdown parse, and the
 * load write into a WYSIWYG editor built from the production extension list
 * (decorations, node views, plugin state). The document is shaped like the
 * #1565 fixture — 340 headings, long CJK paragraphs, 154 code blocks, image
 * lines — and generated, so the bench needs no file.
 *
 * Manual before/after tracking only: CI asserts each mechanism with a
 * deterministic test instead (the open-cost plan's D3). Jsdom does no layout,
 * so this measures the JavaScript side of the load, not the first paint.
 *
 * Run:
 *   pnpm vitest bench src/bench/openCost.bench.ts
 */

import { Editor } from "@tiptap/core";
import { bench, describe } from "vitest";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { setContentWithoutHistory } from "@/components/Editor/tiptapContentLoad";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { useSettingsStore } from "@/stores/settingsStore";

const HEADINGS = 340;
const CODE_BLOCKS = 154;

/** A document with the fixture's proportions: per heading, CJK prose, and now and then code or an image. */
function cjkHeavyMarkdown(): string {
  const prose =
    "这是一个包含大量中文字符的段落，用来模拟长篇的技术文档。其中夹杂着 English words、数字 123 和标点符号，" +
    "每一段都足够长，使排版和装饰的成本接近真实文件。日本語のかな文字も少し含まれています。";
  const blocks: string[] = [];
  for (let i = 0; i < HEADINGS; i++) {
    blocks.push(`## 第 ${i + 1} 节 标题`);
    blocks.push(`${prose}${prose}`, prose);
    if (i % 2 === 0 && i / 2 < CODE_BLOCKS) blocks.push("```js\nconst 值 = compute(1, 2);\nconsole.log(值);\n```");
    if (i % 3 === 0) blocks.push(`![图 ${i}](images/figure-${i}.png)`);
  }
  return blocks.join("\n\n");
}

const markdown = cjkHeavyMarkdown();

function setSpacing(value: "0" | "0.05") {
  useSettingsStore.setState((state) => ({ appearance: { ...state.appearance, cjkLetterSpacing: value } }));
}

function openOnce() {
  const editor = new Editor({ element: document.createElement("div"), extensions: createTiptapExtensions({ tabId: "bench" }) });
  setContentWithoutHistory(editor, parseMarkdown(editor.schema, markdown));
  editor.destroy();
}

describe(`open cost (${(markdown.length / 1024).toFixed(0)} KB, ${HEADINGS} headings)`, () => {
  const schema = new Editor({ extensions: createTiptapExtensions({ tabId: "bench" }) }).schema;

  bench("parse markdown → ProseMirror", () => {
    parseMarkdown(schema, markdown);
  }, { iterations: 5, warmupIterations: 1 });

  bench("mount + parse + load, CJK spacing off (the default)", () => {
    setSpacing("0");
    openOnce();
  }, { iterations: 5, warmupIterations: 1 });

  bench("mount + parse + load, CJK spacing on", () => {
    setSpacing("0.05");
    openOnce();
  }, { iterations: 5, warmupIterations: 1, teardown: () => setSpacing("0") });
});
