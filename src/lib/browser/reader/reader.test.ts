// WI-2.4 — generic page reader: DOM → clean markdown (fixture-tested)
import { describe, it, expect } from "vitest";
import { readPage } from "./reader";

const URL = "https://example.com/blog/post";

describe("readPage — title + byline", () => {
  it("extracts the title from <title>, stripping a site suffix", () => {
    const r = readPage(
      `<html><head><title>My Post — Example Blog</title></head><body><article><p>Body text here that is long enough to count.</p></article></body></html>`,
      URL,
    );
    expect(r.title).toBe("My Post");
  });

  it("prefers an <h1> inside the article when present", () => {
    const r = readPage(
      `<html><head><title>site</title></head><body><article><h1>Real Headline</h1><p>Some sufficiently long body paragraph text.</p></article></body></html>`,
      URL,
    );
    expect(r.title).toBe("Real Headline");
  });

  it("extracts a byline from rel=author", () => {
    const r = readPage(
      `<body><article><a rel="author" href="/u/jane">Jane Doe</a><p>A reasonably long paragraph of article body content.</p></article></body>`,
      URL,
    );
    expect(r.byline).toBe("Jane Doe");
  });

  it("returns null byline when none is present", () => {
    const r = readPage(`<body><article><p>Just body text, long enough here.</p></article></body>`, URL);
    expect(r.byline).toBeNull();
  });

  it("finds a byline in a header before boilerplate removal strips it", () => {
    const r = readPage(
      `<body><header><a rel="author" href="/u/sam">Sam Author</a></header><article><p>The body paragraph with enough length to score.</p></article></body>`,
      URL,
    );
    expect(r.byline).toBe("Sam Author");
    // The header itself must not leak into the content.
    expect(r.markdown).not.toContain("Sam Author");
  });
});

describe("readPage — main-content selection", () => {
  it("selects the article over surrounding nav/aside/footer boilerplate", () => {
    const html = `
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <aside>Related links and ads galore galore galore</aside>
        <article><p>The genuine article body paragraph that carries the real content of this page.</p></article>
        <footer>Copyright 2026</footer>
      </body>`;
    const r = readPage(html, URL);
    expect(r.markdown).toContain("genuine article body paragraph");
    expect(r.markdown).not.toContain("Home");
    expect(r.markdown).not.toContain("Copyright");
    expect(r.markdown).not.toContain("Related links");
  });

  it("falls back to the densest text container when there is no <article>/<main>", () => {
    const html = `
      <body>
        <div class="sidebar"><p>short</p></div>
        <div class="content"><p>This is the main content region with substantially more readable prose than the sidebar.</p><p>A second paragraph reinforcing the density of this container.</p></div>
      </body>`;
    const r = readPage(html, URL);
    expect(r.markdown).toContain("main content region");
    expect(r.markdown).toContain("second paragraph");
    expect(r.markdown).not.toContain("short");
  });
});

describe("readPage — markdown serialization", () => {
  const wrap = (inner: string) => `<body><article>${inner}<p>padding paragraph to ensure the container scores as content.</p></article></body>`;

  it("serializes headings, paragraphs, emphasis and strong", () => {
    const r = readPage(wrap(`<h2>Section</h2><p>Some <em>italic</em> and <strong>bold</strong> text.</p>`), URL);
    expect(r.markdown).toContain("## Section");
    expect(r.markdown).toContain("Some *italic* and **bold** text.");
  });

  it("resolves relative link and image URLs against the page URL", () => {
    const r = readPage(
      wrap(`<p>See <a href="/other">this</a>.</p><img src="../img/pic.png" alt="a pic">`),
      URL,
    );
    expect(r.markdown).toContain("[this](https://example.com/other)");
    expect(r.markdown).toContain("![a pic](https://example.com/img/pic.png)");
  });

  it("serializes unordered and ordered lists", () => {
    const r = readPage(wrap(`<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>`), URL);
    expect(r.markdown).toContain("- one");
    expect(r.markdown).toContain("- two");
    expect(r.markdown).toContain("1. first");
    expect(r.markdown).toContain("2. second");
  });

  it("serializes blockquotes, inline code, and fenced code blocks", () => {
    const r = readPage(
      wrap(`<blockquote>quoted line</blockquote><p>use <code>foo()</code> now</p><pre><code>const x = 1;</code></pre>`),
      URL,
    );
    expect(r.markdown).toContain("> quoted line");
    expect(r.markdown).toContain("use `foo()` now");
    expect(r.markdown).toMatch(/```\nconst x = 1;\n```/);
  });

  it("emits nothing for empty emphasis/strong and img without src", () => {
    const r = readPage(wrap(`<p>x<strong></strong><em></em></p><img alt="no src">`), URL);
    expect(r.markdown).not.toContain("**");
    expect(r.markdown).not.toContain("![no src]");
  });

  it("serializes <br> as a newline and <hr> as a rule", () => {
    const r = readPage(wrap(`<p>line one<br>line two</p><hr>`), URL);
    expect(r.markdown).toContain("line one\nline two");
    expect(r.markdown).toContain("---");
  });

  it("keeps a malformed href verbatim rather than throwing", () => {
    const r = readPage(wrap(`<p>a <a href="http://">bad link</a> here</p>`), URL);
    expect(r.markdown).toContain("[bad link](http://)");
  });

  it("drops script/style/noscript noise from the output", () => {
    const r = readPage(
      wrap(`<p>Visible text of the article.</p><script>evil()</script><style>.x{color:red}</style>`),
      URL,
    );
    expect(r.markdown).toContain("Visible text of the article.");
    expect(r.markdown).not.toContain("evil()");
    expect(r.markdown).not.toContain("color:red");
  });
});

describe("readPage — robustness", () => {
  it("handles empty / whitespace input without throwing", () => {
    expect(() => readPage("", URL)).not.toThrow();
    const r = readPage("", URL);
    expect(r.markdown).toBe("");
    expect(r.textLength).toBe(0);
  });

  it("carries the page url through and reports a text length", () => {
    const r = readPage(`<body><article><p>hello world text body content here</p></article></body>`, URL);
    expect(r.url).toBe(URL);
    expect(r.textLength).toBeGreaterThan(0);
  });
});
