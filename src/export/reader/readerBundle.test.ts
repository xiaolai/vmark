/**
 * Tests for readerBundle — the reader CSS/JS assets that htmlExport.ts
 * embeds into exported HTML. The strings are load-bearing in two ways:
 * 1. Written verbatim to assets/vmark-reader.{css,js} (htmlExport.ts).
 * 2. Inlined into <style>/<script> blocks of standalone.html
 *    (htmlTemplates.ts) — so they must not contain sequences that
 *    prematurely close those blocks (`</style>`, `</script>`, `<!--`).
 *
 * Vitest's transformer returns an empty string for `?raw` imports of .css
 * files (a Vite/vitest quirk also documented in
 * src/export/__tests__/pdfHtmlTemplate.test.ts; the production Vite build
 * loads them correctly). To test the real behavior, the CSS `?raw` import
 * is mocked with the actual on-disk file content — mocking the build-time
 * asset loader boundary, not the module's logic. The `.js?raw` import works
 * natively in Vitest and is left unmocked.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest runs with cwd at the project root; import.meta.url is not a
// file:// URL under the jsdom environment, so resolve from cwd instead.
const ASSET_DIR = "src/export/reader";

const cssOnDisk = vi.hoisted(async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve: resolvePath } = await import("node:path");
  return readFile(
    resolvePath(process.cwd(), "src/export/reader/vmark-reader.css"),
    "utf8"
  );
});

vi.mock("./vmark-reader.css?raw", async () => ({ default: await cssOnDisk }));

import { getReaderCSS, getReaderJS } from "./readerBundle";

describe("getReaderCSS", () => {
  it("returns the reader stylesheet, not an empty string", () => {
    // Empty output would silently ship exported HTML with an unstyled
    // reader panel (e.g. after a rename/move breaks the ?raw import).
    expect(getReaderCSS().length).toBeGreaterThan(0);
  });

  it("contains the reader UI selectors the script creates", () => {
    const css = getReaderCSS();
    expect(css).toContain(".vmark-reader-toggle");
    expect(css).toContain(".vmark-reader-panel");
  });

  it("styles the dark theme via the .dark-theme selector", () => {
    // Exported HTML toggles .dark-theme on <html>; reader UI must follow.
    expect(getReaderCSS()).toContain(".dark-theme");
  });

  it("is safe to inline inside a <style> block", () => {
    // A literal `</style>` would close the standalone.html style block
    // early and dump the rest of the CSS as page text.
    expect(getReaderCSS()).not.toMatch(/<\/style/i);
  });
});

describe("getReaderJS", () => {
  it("returns the on-disk script verbatim", () => {
    // htmlExport.ts writes this string byte-for-byte as
    // assets/vmark-reader.js — any transformation would corrupt the asset.
    const onDisk = readFileSync(
      resolve(process.cwd(), ASSET_DIR, "vmark-reader.js"),
      "utf8"
    );
    expect(getReaderJS()).toBe(onDisk);
  });

  it("is a self-contained strict-mode IIFE", () => {
    // The script runs in exported HTML with no bundler — it must not
    // leak globals or depend on module semantics.
    const js = getReaderJS();
    expect(js).toContain("(function() {");
    expect(js).toContain("'use strict'");
  });

  it("persists reader settings via localStorage", () => {
    const js = getReaderJS();
    expect(js).toContain("localStorage.getItem");
    expect(js).toContain("localStorage.setItem");
  });

  it("is safe to inline inside a <script> block", () => {
    // `</script>` would terminate the inline script early; `<!--` opens
    // the HTML script-data escaped state and can swallow following markup.
    const js = getReaderJS();
    expect(js).not.toMatch(/<\/script/i);
    expect(js).not.toContain("<!--");
  });

  it("returns identical content on repeated calls", () => {
    expect(getReaderJS()).toBe(getReaderJS());
    expect(getReaderCSS()).toBe(getReaderCSS());
  });
});
