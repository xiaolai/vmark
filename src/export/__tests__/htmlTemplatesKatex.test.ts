import { describe, it, expect, vi } from "vitest";

vi.mock("../pdfHtmlTemplate", () => ({
  getKatexCSS: () => "/* mocked-katex-css */",
}));

import { generateStandaloneHtml, generateIndexHtml } from "../htmlTemplates";

const baseOptions = {
  title: "Test",
  themeCSS: "",
  fontCSS: "",
  contentCSS: "",
  readerCSS: "",
  readerJS: "",
};

describe("generateStandaloneHtml KaTeX inlining", () => {
  it("does not include external CDN link", () => {
    const html = generateStandaloneHtml("<p>math</p>", baseOptions);
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it("inlines KaTeX CSS in a style tag", () => {
    const html = generateStandaloneHtml("<p>math</p>", baseOptions);
    expect(html).toContain("/* mocked-katex-css */");
    expect(html).toContain("<style>");
  });

  it("omits KaTeX CSS when includeKaTeX is false", () => {
    const html = generateStandaloneHtml("<p>no math</p>", {
      ...baseOptions,
      includeKaTeX: false,
    });
    expect(html).not.toContain("mocked-katex-css");
  });
});

describe("generateIndexHtml KaTeX (external assets variant)", () => {
  it("uses CDN link for KaTeX since assets are external", () => {
    const html = generateIndexHtml("<p>math</p>", baseOptions);
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain("katex");
  });

  it("omits KaTeX link when includeKaTeX is false", () => {
    const html = generateIndexHtml("<p>no math</p>", {
      ...baseOptions,
      includeKaTeX: false,
    });
    expect(html).not.toContain("katex");
  });
});
