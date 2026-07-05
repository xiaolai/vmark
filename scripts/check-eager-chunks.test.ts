/**
 * Tests for the eager-chunk gate's HTML parsing (scripts/check-eager-chunks.mjs).
 *
 * The gate's whole value is that it NEVER silently stops matching: if Vite
 * reorders attributes or switches quote style in dist/index.html, the parser
 * must still find every modulepreload link and script src. These tests pin
 * that contract (Codex audit finding: the original regex only matched
 * double-quoted, rel-before-href markup).
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { collectEagerAssets, findOffenders, DENYLIST } from "./check-eager-chunks.mjs";

function assets(html: string): string[] {
  return collectEagerAssets(html) as string[];
}

describe("collectEagerAssets — modulepreload links", () => {
  it("matches the current Vite output shape (rel, crossorigin, href, double quotes)", () => {
    const html =
      '<link rel="modulepreload" crossorigin href="/assets/vendor-codemirror-abc.js">';
    expect(assets(html)).toEqual(["/assets/vendor-codemirror-abc.js"]);
  });

  it("matches when href comes before rel", () => {
    const html = '<link href="/assets/a.js" crossorigin rel="modulepreload">';
    expect(assets(html)).toEqual(["/assets/a.js"]);
  });

  it("matches single-quoted attributes", () => {
    const html = "<link rel='modulepreload' href='/assets/b.js'>";
    expect(assets(html)).toEqual(["/assets/b.js"]);
  });

  it("matches unquoted attribute values", () => {
    const html = "<link rel=modulepreload href=/assets/c.js>";
    expect(assets(html)).toEqual(["/assets/c.js"]);
  });

  it("matches with extra attributes interleaved", () => {
    const html =
      '<link data-x="1" rel="modulepreload" as="script" integrity="sha384-x" href="/assets/d.js" fetchpriority="high">';
    expect(assets(html)).toEqual(["/assets/d.js"]);
  });

  it("finds multiple links on a single line", () => {
    const html =
      '<link rel="modulepreload" href="/assets/a.js"><link href="/assets/b.js" rel="modulepreload">';
    expect(assets(html)).toEqual(["/assets/a.js", "/assets/b.js"]);
  });

  it("honors rel as a space-separated token list", () => {
    const html = '<link rel="preload modulepreload" href="/assets/e.js">';
    expect(assets(html)).toEqual(["/assets/e.js"]);
  });

  it("does NOT match rel=stylesheet links", () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/index.css">';
    expect(assets(html)).toEqual([]);
  });

  it("does NOT match rel values merely containing the substring", () => {
    // "notmodulepreload" is not the modulepreload token.
    const html = '<link rel="notmodulepreload" href="/assets/f.js">';
    expect(assets(html)).toEqual([]);
  });

  it("ignores modulepreload links without an href", () => {
    expect(assets('<link rel="modulepreload">')).toEqual([]);
  });
});

describe("collectEagerAssets — script tags", () => {
  it("matches <script type=module src> regardless of attribute order", () => {
    const html = '<script src="/assets/index-xyz.js" type="module" crossorigin></script>';
    expect(assets(html)).toEqual(["/assets/index-xyz.js"]);
  });

  it("matches single-quoted script src", () => {
    const html = "<script type='module' src='/assets/main.js'></script>";
    expect(assets(html)).toEqual(["/assets/main.js"]);
  });

  it("ignores inline scripts without src", () => {
    expect(assets('<script>const src = "/assets/fake.js";</script>')).toEqual([]);
  });
});

describe("findOffenders", () => {
  it("flags hrefs containing a denylisted chunk family", () => {
    const eager = [
      "/assets/vendor-codemirror-abc.js",
      "/assets/vendor-mermaid-def.js",
      "/assets/vendor-graphviz-ghi.js",
    ];
    expect(findOffenders(eager, DENYLIST)).toEqual([
      "/assets/vendor-mermaid-def.js",
      "/assets/vendor-graphviz-ghi.js",
    ]);
  });

  it("returns empty for a clean preload list", () => {
    expect(findOffenders(["/assets/vendor-codemirror-abc.js"], DENYLIST)).toEqual([]);
  });
});

describe("end-to-end over realistic index.html", () => {
  it("collects both preloads and the entry script from a Vite-shaped document", () => {
    const html = [
      "<!doctype html>",
      "<html><head>",
      '<script type="module" crossorigin src="/assets/index-B1.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-Q1.js">',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-codemirror-C1.js">',
      '<link rel="stylesheet" crossorigin href="/assets/index-S1.css">',
      "</head><body></body></html>",
    ].join("\n");
    expect(assets(html)).toEqual([
      "/assets/rolldown-runtime-Q1.js",
      "/assets/vendor-codemirror-C1.js",
      "/assets/index-B1.js",
    ]);
  });
});
