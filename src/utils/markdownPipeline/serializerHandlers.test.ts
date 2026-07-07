/**
 * Tests for the custom image/link to-markdown handlers.
 *
 * Escaping: destinations that a raw `(…)` position cannot represent
 * (whitespace, control chars, unbalanced parens, leading `<`, empty) switch
 * to the `<…>` literal form; `"` in titles and `[`/`]` in alt text are
 * backslash-escaped. Every escaped form must re-parse to the original
 * values. Also covers the upstream `peek` contract.
 */
import { describe, it, expect } from "vitest";
import type { Link, Paragraph, Root } from "mdast";
import { handleImage, handleLink } from "./serializerHandlers";
import { serializeMdastToMarkdown } from "./serializer";
import { parseMarkdownToMdast } from "./parser";

function rootWith(...children: Paragraph["children"]): Root {
  return {
    type: "root",
    children: [{ type: "paragraph", children }],
  };
}

function link(url: string, text: string, title?: string): Link {
  return { type: "link", url, title, children: [{ type: "text", value: text }] };
}

/** First link node of the first paragraph after re-parsing `markdown`. */
function reparseFirstLink(markdown: string): Link {
  const tree = parseMarkdownToMdast(markdown);
  const para = tree.children[0] as Paragraph;
  const found = para.children.find((c) => c.type === "link");
  if (!found) throw new Error(`no link in: ${markdown}`);
  return found as Link;
}

describe("link destinations and titles", () => {
  it("escapes double quotes in titles and round-trips them", () => {
    const md = serializeMdastToMarkdown(
      rootWith(link("https://example.com/", "x", 'a " b')),
    );
    expect(md.trim()).toBe('[x](https://example.com/ "a \\" b")');
    expect(reparseFirstLink(md).title).toBe('a " b');
  });

  it("keeps balanced parentheses in a raw destination", () => {
    const md = serializeMdastToMarkdown(
      rootWith(link("https://en.wikipedia.org/wiki/Foo_(bar)", "x")),
    );
    expect(md.trim()).toBe("[x](https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(reparseFirstLink(md).url).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("switches to angle brackets for unbalanced parentheses", () => {
    const md = serializeMdastToMarkdown(rootWith(link("https://e.com/a)b", "x")));
    expect(md.trim()).toBe("[x](<https://e.com/a)b>)");
    expect(reparseFirstLink(md).url).toBe("https://e.com/a)b");
  });

  it("emits <> for an empty destination", () => {
    const md = serializeMdastToMarkdown(rootWith(link("", "x")));
    expect(md.trim()).toBe("[x](<>)");
    expect(reparseFirstLink(md).url).toBe("");
  });

  it("escapes angle brackets inside a bracketed destination", () => {
    const md = serializeMdastToMarkdown(rootWith(link("<weird>/path x", "t")));
    expect(md.trim()).toBe("[t](<\\<weird\\>/path x>)");
    expect(reparseFirstLink(md).url).toBe("<weird>/path x");
  });

  it("percent-encodes newlines in destinations", () => {
    const md = serializeMdastToMarkdown(rootWith(link("https://e.com/a\nb", "x")));
    expect(md.trim()).toBe("[x](<https://e.com/a%0Ab>)");
  });
});

describe("image alt text and titles", () => {
  it("escapes square brackets in alt text and round-trips them", () => {
    const md = serializeMdastToMarkdown(
      rootWith({ type: "image", url: "https://e.com/i.png", alt: "a]b[c" }),
    );
    expect(md.trim()).toBe("![a\\]b\\[c](https://e.com/i.png)");
    const tree = parseMarkdownToMdast(md);
    const para = tree.children[0] as Paragraph;
    const image = para.children.find((c) => c.type === "image");
    expect(image && "alt" in image ? image.alt : null).toBe("a]b[c");
  });

  it("escapes double quotes in image titles", () => {
    const md = serializeMdastToMarkdown(
      rootWith({ type: "image", url: "i.png", alt: "a", title: 'say "hi"' }),
    );
    expect(md.trim()).toBe('![a](i.png "say \\"hi\\"")');
  });
});

describe("peek contract", () => {
  it("image lookahead sees !", () => {
    expect(handleImage.peek()).toBe("!");
  });

  it("link lookahead sees < for autolinks and [ otherwise", () => {
    expect(handleLink.peek(link("https://e.com/", "https://e.com/"))).toBe("<");
    expect(handleLink.peek(link("https://e.com/", "Example"))).toBe("[");
    expect(handleLink.peek(link("https://e.com/", "https://e.com/", "T"))).toBe("[");
  });
});
