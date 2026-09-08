// Audit 20260907 (#344/#345) — the print pipeline's building blocks, extracted
// from useExportOperations so each is testable on its own: inline the local
// images for a webview with no asset:// handler, wrap a body in the
// self-contained light-theme print document, and pick the editor whose HTML
// is printed live.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockResolveResources, mockGetDocumentBaseDir, mockToastWarning, mockRender } = vi.hoisted(() => ({
  mockResolveResources: vi.fn(),
  mockGetDocumentBaseDir: vi.fn(),
  mockToastWarning: vi.fn(),
  mockRender: vi.fn(),
}));

vi.mock("../resourceResolver", () => ({
  resolveResources: (...args: unknown[]) => mockResolveResources(...args),
  getDocumentBaseDir: (...args: unknown[]) => mockGetDocumentBaseDir(...args),
}));
vi.mock("../renderMarkdownToHtml", () => ({
  renderMarkdownToHtml: (...args: unknown[]) => mockRender(...args),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { warning: mockToastWarning, error: vi.fn(), success: vi.fn() },
}));
vi.mock("../themeSnapshot", () => ({
  captureThemeCSS: () => "/* theme-css */",
  isDarkTheme: () => false,
}));
vi.mock("../htmlExportStyles", () => ({
  getEditorContentCSS: () => "/* content-css */",
}));
// `expandDetails` is the REAL one: the shared print CSS this builder inlines
// styles `details[open]`, so what matters is that a collapsed element arrives
// at the page already open — not that a function was called.
vi.mock("../pdfHtmlTemplate", async () => {
  const actual = await vi.importActual<typeof import("../pdfHtmlTemplate")>("../pdfHtmlTemplate");
  return {
    getKatexCSS: () => "/* katex-css */",
    getForceLightThemeCSS: () => "/* light-css */",
    getSharedContentCSS: () => "/* shared-css */",
    expandDetails: actual.expandDetails,
  };
});
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { buildPrintHtml, prepareExportBody, renderPrintableHtml } from "../printDocument";

const report = (missing: unknown[] = []) => ({ resources: [], resolved: [], missing, totalSize: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDocumentBaseDir.mockResolvedValue("/docs");
  mockResolveResources.mockImplementation((html: string) => Promise.resolve({ html, report: report() }));
});

describe("prepareExportBody", () => {
  it("resolves against the document's directory in single (data-URI) mode", async () => {
    mockResolveResources.mockResolvedValueOnce({ html: "<p>resolved</p>", report: report() });
    const html = await prepareExportBody("<p>raw</p>", "/docs/note.md");
    expect(mockGetDocumentBaseDir).toHaveBeenCalledWith("/docs/note.md");
    expect(mockResolveResources).toHaveBeenCalledWith("<p>raw</p>", { baseDir: "/docs", mode: "single" });
    expect(html).toBe("<p>resolved</p>");
  });

  // Audit R2 (#690/#703): print, native PDF and copy-as-HTML all shipped raw
  // ProseMirror markup — only the folder export sanitized. It runs BEFORE
  // resolution, so an image inside a hidden preview placeholder is never
  // fetched (nor warned about) on its way to being deleted.
  it("strips editor artifacts BEFORE resources are resolved", async () => {
    await prepareExportBody(
      '<p>keep<br class="ProseMirror-trailingBreak"></p>' +
        '<div class="html-preview-block"><img src="asset://gone.png"></div>' +
        '<p contenteditable="true">text</p>',
      "/docs/note.md",
    );
    const sent = mockResolveResources.mock.calls[0][0] as string;
    expect(sent).not.toContain("ProseMirror-trailingBreak");
    expect(sent).not.toContain("html-preview-block");
    expect(sent).not.toContain("asset://gone.png");
    expect(sent).not.toContain("contenteditable");
    expect(sent).toContain("keep");
  });

  it("an unsaved document resolves against the null base dir", async () => {
    await prepareExportBody("<p>raw</p>", null);
    expect(mockGetDocumentBaseDir).toHaveBeenCalledWith(null);
  });

  it("raises one warning toast when images could not be embedded", async () => {
    mockResolveResources.mockResolvedValueOnce({
      html: "<p>x</p>",
      report: report([{ originalSrc: "a.png" }, { originalSrc: "b.png" }]),
    });
    await prepareExportBody("<p>x</p>", "/docs/note.md");
    expect(mockToastWarning).toHaveBeenCalledTimes(1);
  });
});

describe("renderPrintableHtml", () => {
  it("renders the markdown light-themed, then prepares its body", async () => {
    mockRender.mockResolvedValue("<p>rendered</p>");
    mockResolveResources.mockResolvedValueOnce({ html: "<p>inlined</p>", report: report() });
    const html = await renderPrintableHtml("# hi", "/docs/note.md");
    expect(mockRender).toHaveBeenCalledWith("# hi", true);
    expect(mockResolveResources).toHaveBeenCalledWith("<p>rendered</p>", { baseDir: "/docs", mode: "single" });
    expect(html).toBe("<p>inlined</p>");
  });
});

describe("buildPrintHtml", () => {
  it("wraps the body in a self-contained, light-theme document", async () => {
    const html = await buildPrintHtml("<p>body</p>");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    for (const marker of ["/* theme-css */", "/* light-css */", "/* content-css */", "/* shared-css */"]) {
      expect(html).toContain(marker);
    }
    expect(html).toContain("@page { margin: 1.5cm; }");
    expect(html).toContain('<div class="export-surface-editor tiptap-editor">');
    expect(html).toContain("<p>body</p>");
  });

  // Audit 20260907 round 2: the shared CSS above depends on `details[open]`,
  // and Chromium/WebKit hide a COLLAPSED element's contents with
  // content-visibility, which no display override reaches. This builder
  // composed the CSS without ever running the markup step it needs, so a
  // collapsed section printed with its body missing — and paper cannot be
  // clicked open.
  it("forces every details element open, so its body reaches the page", async () => {
    const html = await buildPrintHtml("<details><summary>More</summary><p>hidden body</p></details>");
    expect(html).toContain("<details open>");
    expect(html).toContain("hidden body");
  });

  it("leaves an already-open details element untouched", async () => {
    const html = await buildPrintHtml('<details open class="x"><summary>More</summary></details>');
    expect(html).toContain('<details open class="x">');
  });
});

// Audit 20260907 round 3 (#694): the KaTeX stylesheet embeds its woff2 faces as
// base64, so it is the biggest thing this document can hold — and every print
// carried it, math or not. The folder export already made this call the same
// way, through the same predicate.
describe("buildPrintHtml — KaTeX rides along only when there is math", () => {
  it.each([
    '<p>rendered <span class="katex">x</span></p>',
    '<div class="math-block">x</div>',
    '<span class="math-inline">x</span>',
  ])("includes it for %s", async (body) => {
    expect(await buildPrintHtml(body)).toContain("/* katex-css */");
  });

  it("leaves it out of a document with no math", async () => {
    const html = await buildPrintHtml("<p>plain body</p>");
    expect(html).not.toContain("/* katex-css */");
    // …and the rest of the document is unchanged.
    expect(html).toContain("<p>plain body</p>");
    expect(html).toContain("/* shared-css */");
  });
});
