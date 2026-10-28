// @vitest-environment node
// The span serializer's block mapping, node type by node type, under the
// production schema: every top-level block the editor can hold gets the span
// of exactly its own text (re-parsing the slice alone gives the same block),
// only separators lie between spans, and a block the cosmetic pass edits keeps
// its span over the edited text.
import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { getProductionSchema } from "@/test/productionSchema";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { serializeWithSpans } from "./serializerSpans";

const schema = getProductionSchema();

/** One construct per top-level node type, written between two paragraphs. */
const BLOCKS: ReadonlyArray<readonly [string, string]> = [
  ["paragraph", "middle 中文 😀"],
  ["heading", "## Heading"],
  ["codeBlock", "```ts\nconst a = 1;\n```"],
  ["blockquote", "> quoted\n>\n> twice"],
  ["bulletList", "- a\n- [ ] task\n  - nested"],
  ["orderedList", "3. three\n4. four"],
  ["horizontalRule", "***"],
  ["alertBlock", "> [!NOTE]\n> Some note"],
  ["detailsBlock", "<details>\n<summary>Info</summary>\n\nBody\n\n</details>"],
  ["toc", "[TOC]"],
  ["link_definition", "[ref]: https://example.com \"Title\""],
  ["html_block", "<div class=\"x\">\n<p>raw</p>\n</div>"],
  ["footnote_definition", "[^1]: The note."],
  ["table", "| a | b |\n| - | - |\n| 1 | 2 |"],
  ["block_image", "![alt](image.png)"],
  ["block_video", "![](clip.mp4)"],
  ["block_audio", "![](sound.mp3)"],
  ["video_embed", "<iframe src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\"></iframe>"],
];

function topTypes(): string[] {
  return Object.entries(schema.nodes)
    .filter(([, type]) => schema.topNodeType.contentMatch.matchType(type))
    .map(([name]) => name);
}

/** The ok result for `markdown`, checked against production byte for byte. */
function spansOf(markdown: string) {
  const doc = parseMarkdown(schema, markdown);
  const out = serializeWithSpans(schema, doc, {});
  if (!out.ok) throw new Error(`no spans: ${out.reason}`);
  expect(out.markdown).toBe(serializeMarkdown(schema, doc, {}));
  expect(out.spans).toHaveLength(doc.childCount);
  return { doc, markdown: out.markdown, spans: out.spans };
}

/** A node's JSON without `sourceLine`, which records where it was parsed, not what it is. */
function withoutSourceLines(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSourceLines);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "sourceLine").map(([key, v]) => [key, withoutSourceLines(v)]),
  );
}

/** The slice alone parses to the same block, and serializes back to itself. */
function expectOwnText(block: PMNode, slice: string) {
  const alone = parseMarkdown(schema, slice);
  expect(alone.childCount).toBe(1);
  expect(withoutSourceLines(alone.firstChild?.toJSON())).toEqual(withoutSourceLines(block.toJSON()));
  expect(serializeMarkdown(schema, alone, {})).toBe(`${slice}\n`);
}

describe("serializeWithSpans block mapping", () => {
  it("the table covers every top-level node type but frontmatter", () => {
    const covered = new Set(BLOCKS.map(([type]) => type));
    expect(topTypes().filter((t) => t !== "frontmatter" && !covered.has(t))).toEqual([]);
  });

  it.each(BLOCKS)("%s: its span is exactly its own text", (type, construct) => {
    const { doc, markdown, spans } = spansOf(`before\n\n${construct}\n\nafter\n`);
    const types = Array.from({ length: doc.childCount }, (_, i) => doc.child(i).type.name);
    expect(types, "the construct is one block between the paragraphs").toEqual(["paragraph", type, "paragraph"]);
    for (let i = 0; i < doc.childCount; i++) {
      expectOwnText(doc.child(i), markdown.slice(spans[i].from, spans[i].to));
    }
    for (let i = 1; i < spans.length; i++) {
      expect(markdown.slice(spans[i - 1].to, spans[i].from)).toMatch(/^\n+$/);
    }
    expect(markdown.slice(spans[spans.length - 1].to)).toMatch(/^\n*$/);
  });

  it("frontmatter: the leading block's span is its fence and body", () => {
    const { doc, markdown, spans } = spansOf("---\ntitle: x\n---\n\nbody\n");
    expect(doc.firstChild?.type.name).toBe("frontmatter");
    expect(markdown.slice(spans[0].from, spans[0].to)).toBe("---\ntitle: x\n---");
    expect(markdown.slice(spans[1].from, spans[1].to)).toBe("body");
  });

  it("every construct in one document keeps its own span", () => {
    const { doc, markdown, spans } = spansOf(`${BLOCKS.map(([, c]) => c).join("\n\n")}\n`);
    for (let i = 0; i < doc.childCount; i++) {
      expectOwnText(doc.child(i), markdown.slice(spans[i].from, spans[i].to));
    }
  });

  it("a block the cosmetic pass edits keeps the edited text as its span", () => {
    const { markdown, spans } = spansOf("one \\[x\\] 中文\n\n## two \\[y\\]\n\n- three \\[z\\]\n");
    expect(spans.map((s) => markdown.slice(s.from, s.to))).toEqual(["one [x] 中文", "## two [y]", "- three [z]"]);
  });

  it("adjacent lists, whose joins alternate the marker, each keep their own span", () => {
    const item = (text: string) => schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
    const list = (text: string) => schema.nodes.bulletList.create(null, item(text));
    const doc = schema.nodes.doc.create(null, [list("a"), list("b"), list("c")]);
    const out = serializeWithSpans(schema, doc, {});
    if (!out.ok) throw new Error(out.reason);
    expect(out.markdown).toBe(serializeMarkdown(schema, doc, {}));
    expect(out.spans.map((s) => out.markdown.slice(s.from, s.to))).toEqual(["- a", "* b", "- c"]);
  });
});
