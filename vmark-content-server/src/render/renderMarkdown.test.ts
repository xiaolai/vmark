// S0.4 — Node-safe headless markdown render: parity + sanitization.
import { describe, it, expect } from "vitest";
import { renderMarkdown, sanitizeHtml } from "./renderMarkdown";

describe("renderMarkdown — core markdown + GFM", () => {
  it("renders headings and paragraphs", async () => {
    const html = await renderMarkdown("# Title\n\nHello world");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders GFM tables", async () => {
    const html = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders GFM task lists", async () => {
    const html = await renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("strips YAML frontmatter from rendered body", async () => {
    const html = await renderMarkdown("---\ntitle: X\ntags: [a]\n---\n\n# Body");
    expect(html).toContain("<h1>Body</h1>");
    expect(html).not.toContain("title: X");
  });
});

describe("renderMarkdown — VMark custom nodes (editor parity)", () => {
  it("renders ==highlight== as <mark>", async () => {
    const html = await renderMarkdown("==marked==");
    expect(html).toContain("<mark>marked</mark>");
  });

  it("renders ~sub~ and ^sup^", async () => {
    const html = await renderMarkdown("H~2~O and x^2^");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
  });

  it("renders <details> blocks", async () => {
    const html = await renderMarkdown("<details>\n<summary>More</summary>\n\nhidden\n\n</details>");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>More</summary>");
    expect(html).toContain("hidden");
  });
});

describe("renderMarkdown — alerts (D3.4 parity)", () => {
  it.each([
    ["NOTE", "note"],
    ["TIP", "tip"],
    ["IMPORTANT", "important"],
    ["WARNING", "warning"],
    ["CAUTION", "caution"],
  ])("renders [!%s] alert blockquote", async (marker, kind) => {
    const html = await renderMarkdown(`> [!${marker}]\n> body text`);
    expect(html).toContain(`markdown-alert-${kind}`);
    expect(html).toContain("body text");
    expect(html).not.toContain(`[!${marker}]`);
  });

  it("leaves ordinary blockquotes untouched", async () => {
    const html = await renderMarkdown("> just a quote");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("markdown-alert");
  });
});

describe("renderMarkdown — wiki-links", () => {
  it("renders unresolved wiki-link as missing", async () => {
    const html = await renderMarkdown("[[Some Page]]");
    expect(html).toContain("wiki-link--missing");
    expect(html).toContain('data-target="Some Page"');
  });

  it("uses the alias as link text", async () => {
    const html = await renderMarkdown("[[Page|Display]]");
    expect(html).toContain(">Display</a>");
    expect(html).toContain('data-target="Page"');
  });

  it("resolves via the provided resolver and carries an anchor", async () => {
    const html = await renderMarkdown("[[Target#Heading]]", {
      resolveWikiLink: (t) => ({ href: `/note/${t}.html`, exists: true }),
    });
    expect(html).toContain('href="/note/Target.html#Heading"');
    expect(html).toContain("wiki-link");
    expect(html).not.toContain("wiki-link--missing");
  });
});

describe("renderMarkdown — diagrams (client-render placeholders, WI-3.2)", () => {
  it("emits a <pre class=\"mermaid\"> placeholder preserving the source", async () => {
    const html = await renderMarkdown("```mermaid\nflowchart TD\n  A-->B\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD"); // diagram source preserved
    expect(html).not.toContain("language-mermaid"); // NOT a plain code fence
  });

  it("emits a markmap placeholder", async () => {
    const html = await renderMarkdown("```markmap\n# Root\n## Child\n```");
    expect(html).toContain('class="markmap"');
    expect(html).toContain("# Root");
  });

  it("leaves ordinary code fences as <pre><code class=\"language-…\">", async () => {
    const html = await renderMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain("language-ts");
    expect(html).toContain("const a = 1;");
  });
});

// M-3 — fidelity fixtures: one assertion family per markdown element so the
// served HTML's structure can't silently drift from the editor's semantics.
describe("renderMarkdown — element-catalog fidelity (M-3)", () => {
  it.each([
    ["heading", "## H2", "<h2>"],
    ["bullet list", "- one\n- two", "<ul>"],
    ["ordered list", "1. a\n2. b", "<ol>"],
    ["blockquote", "> quote", "<blockquote>"],
    ["emphasis", "*em* and **strong**", "<em>"],
    ["strong", "**strong**", "<strong>"],
    ["inline code", "`code`", "<code>"],
    ["thematic break", "a\n\n---\n\nb", "<hr>"],
    ["link", "[x](https://e.com)", 'href="https://e.com"'],
    ["strikethrough", "~~gone~~", "<del>"],
  ])("renders %s", async (_label, md, expected) => {
    expect(await renderMarkdown(md)).toContain(expected);
  });
});

describe("renderMarkdown — math (server-side KaTeX)", () => {
  it("renders inline and block math via KaTeX", async () => {
    const html = await renderMarkdown("Inline $x^2$ and\n\n$$\\frac{1}{2}$$");
    expect(html).toContain("katex");
  });
});

describe("sanitizeHtml — XSS corpus (D3.3, Node DOM)", () => {
  const payloads = [
    `<script>alert(1)</script>`,
    `<img src=x onerror="alert(1)">`,
    `<a href="javascript:alert(1)">x</a>`,
    `<iframe src="evil"></iframe>`,
    `<svg><script>alert(1)</script></svg>`,
    `<div onclick="steal()">x</div>`,
  ];
  it.each(payloads)("neutralizes: %s", (p) => {
    const out = sanitizeHtml(p);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out.toLowerCase()).not.toContain("<iframe");
  });

  it("strips script injected through markdown HTML passthrough", async () => {
    const html = await renderMarkdown("text\n\n<script>alert(1)</script>\n\nmore");
    expect(html).not.toContain("<script");
    expect(html).toContain("text");
    expect(html).toContain("more");
  });
});
