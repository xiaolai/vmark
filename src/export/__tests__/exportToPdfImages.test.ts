/**
 * fix(#999) — proves the print/PDF path inlines local images before handing
 * HTML to the off-screen WKWebView (which has no Tauri asset:// handler).
 *
 * The browser-print path (`exportToPdf` → `exportToPdfBrowser`) used to send
 * the live editor HTML verbatim. Local images in that HTML carry asset:// URLs
 * that only resolve inside VMark's main webview, so the exported PDF showed
 * "image not found". This suite verifies that:
 *   - local image src values (asset:// / relative / absolute) are run through
 *     `resolveResources` in "single" mode (data-URI inlining),
 *   - resolution uses the source document's directory as the base dir,
 *   - the *resolved* HTML — not the raw live HTML — is what reaches the
 *     `print_document` Rust command,
 *   - remote http(s) URLs are left untouched (handled by resolveResources).
 *
 * @module export/__tests__/exportToPdfImages.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockInvoke,
  mockResolveResources,
  mockGetDocumentBaseDir,
  mockToastError,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockResolveResources: vi.fn(),
  mockGetDocumentBaseDir: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// resolveResources / getDocumentBaseDir are dynamically imported inside
// exportToPdfBrowser; mock the module so we can assert the call and control
// the resolved HTML without exercising the real Tauri fs/path layer.
vi.mock("../resourceResolver", () => ({
  resolveResources: (...args: unknown[]) => mockResolveResources(...args),
  getDocumentBaseDir: (...args: unknown[]) => mockGetDocumentBaseDir(...args),
}));

vi.mock("@/utils/shortcutMatch", () => ({
  isMacPlatform: () => true,
}));

vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: mockToastError, success: vi.fn(), warning: vi.fn() },
}));

vi.mock("../themeSnapshot", () => ({
  captureThemeCSS: () => "",
  isDarkTheme: () => false,
}));

vi.mock("../htmlExportStyles", () => ({
  getEditorContentCSS: () => "",
}));

vi.mock("../pdfHtmlTemplate", () => ({
  getKatexCSS: () => "",
  getForceLightThemeCSS: () => "",
  getSharedContentCSS: () => "",
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

import { exportToPdf } from "../useExportOperations";

/** Install a fake live `.ProseMirror` element so the WYSIWYG branch is taken. */
function installLiveEditor(innerHTML: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "ProseMirror";
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
  return el;
}

describe("exportToPdf — local image inlining (issue #999)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    mockInvoke.mockResolvedValue(undefined);
    mockGetDocumentBaseDir.mockResolvedValue("/docs/my-notes");
    // Default: echo input so each test can assert on what was passed in.
    mockResolveResources.mockImplementation((html: string) =>
      Promise.resolve({ html, report: { resources: [], resolved: [], missing: [], totalSize: 0 } }),
    );
  });

  it("resolves the live HTML through resolveResources in single (data-URI) mode", async () => {
    installLiveEditor('<p><img src="asset://localhost/docs/my-notes/img/cat.png"></p>');

    await exportToPdf({
      markdown: "![cat](img/cat.png)",
      sourceFilePath: "/docs/my-notes/note.md",
    });

    expect(mockResolveResources).toHaveBeenCalledTimes(1);
    const [htmlArg, opts] = mockResolveResources.mock.calls[0];
    expect(htmlArg).toContain('asset://localhost/docs/my-notes/img/cat.png');
    expect(opts).toEqual({ baseDir: "/docs/my-notes", mode: "single" });
  });

  it("derives the base dir from the source document path", async () => {
    installLiveEditor("<p>hi</p>");

    await exportToPdf({
      markdown: "hi",
      sourceFilePath: "/docs/my-notes/note.md",
    });

    expect(mockGetDocumentBaseDir).toHaveBeenCalledWith("/docs/my-notes/note.md");
  });

  it("falls back to a null base dir when the document is unsaved", async () => {
    installLiveEditor("<p>hi</p>");

    await exportToPdf({ markdown: "hi" });

    expect(mockGetDocumentBaseDir).toHaveBeenCalledWith(null);
  });

  it("sends the RESOLVED html (not the raw asset:// html) to print_document", async () => {
    installLiveEditor('<p><img src="asset://localhost/docs/my-notes/img/cat.png"></p>');
    mockResolveResources.mockResolvedValueOnce({
      html: '<p><img src="data:image/png;base64,AAAA"></p>',
      report: { resources: [], resolved: [], missing: [], totalSize: 0 },
    });

    await exportToPdf({
      markdown: "![cat](img/cat.png)",
      sourceFilePath: "/docs/my-notes/note.md",
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [command, payload] = mockInvoke.mock.calls[0];
    expect(command).toBe("print_document");
    const sentHtml = (payload as { html: string }).html;
    expect(sentHtml).toContain("data:image/png;base64,AAAA");
    // The raw asset:// URL must NOT survive into the print document.
    expect(sentHtml).not.toContain("asset://");
  });

  it("leaves remote http(s) image URLs untouched (passthrough via resolveResources)", async () => {
    installLiveEditor('<p><img src="https://example.com/remote.png"></p>');

    await exportToPdf({
      markdown: "![remote](https://example.com/remote.png)",
      sourceFilePath: "/docs/my-notes/note.md",
    });

    // resolveResources returns input unchanged for remote URLs (default mock),
    // and that unchanged HTML reaches print_document.
    const [, payload] = mockInvoke.mock.calls[0];
    expect((payload as { html: string }).html).toContain("https://example.com/remote.png");
  });

  it("does not call print_document for empty content", async () => {
    await exportToPdf({ markdown: "   \n\t" });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockResolveResources).not.toHaveBeenCalled();
  });
});
