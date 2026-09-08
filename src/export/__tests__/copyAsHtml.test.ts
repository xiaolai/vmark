// Audit 20260907 (#347) — copyAsHtml accepted empty/whitespace markdown and
// reported a successful copy, where both export operations refuse with the
// same "No content" toast.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockWriteText, mockRender, mockToastError, mockToastSuccess, mockResolve, mockBaseDir } =
  vi.hoisted(() => ({
    mockWriteText: vi.fn(),
    mockRender: vi.fn(),
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockResolve: vi.fn(),
    mockBaseDir: vi.fn(),
  }));

vi.mock("../resourceResolver", () => ({
  resolveResources: (...args: unknown[]) => mockResolve(...args),
  getDocumentBaseDir: (...args: unknown[]) => mockBaseDir(...args),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => mockWriteText(...args),
}));
vi.mock("../renderMarkdownToHtml", () => ({
  renderMarkdownToHtml: (...args: unknown[]) => mockRender(...args),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: mockToastError, success: mockToastSuccess, warning: vi.fn() },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { copyAsHtml } from "../useExportOperations";

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteText.mockResolvedValue(undefined);
  mockRender.mockResolvedValue("<h1>hi</h1>");
  mockBaseDir.mockResolvedValue("/docs");
  mockResolve.mockImplementation((html: string) =>
    Promise.resolve({ html, report: { resources: [], resolved: [], missing: [], totalSize: 0 } }),
  );
});

describe("copyAsHtml — empty content is refused like every export (#347)", () => {
  it.each(["", "   ", "\n\t\n"])("%j copies nothing and says so", async (markdown) => {
    await expect(copyAsHtml(markdown)).resolves.toBe(false);
    expect(mockRender).not.toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith("dialog:toast.exportNoContent");
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("real content is rendered and copied", async () => {
    await expect(copyAsHtml("# hi")).resolves.toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith("<h1>hi</h1>");
    expect(mockToastSuccess).toHaveBeenCalledWith("dialog:toast.htmlCopied");
  });
});

// Audit R2 (#703/#704): what reached the clipboard was the raw ProseMirror
// render — editor artifacts included, and image URLs (`asset://`, or a path
// relative to a document the receiving app has never seen) that resolve
// nowhere outside VMark.
describe("copyAsHtml — the clipboard gets a real export body", () => {
  it("sanitizes the markup and embeds local images against the source path", async () => {
    mockRender.mockResolvedValue(
      '<p contenteditable="true">hi<br class="ProseMirror-trailingBreak"></p>',
    );
    mockResolve.mockResolvedValue({
      html: "<p>hi<img src=\"data:image/png;base64,AA\"></p>",
      report: { resources: [], resolved: [], missing: [], totalSize: 0 },
    });

    await expect(copyAsHtml("# hi", "/docs/note.md")).resolves.toBe(true);

    expect(mockBaseDir).toHaveBeenCalledWith("/docs/note.md");
    const sanitized = mockResolve.mock.calls[0][0] as string;
    expect(sanitized).not.toContain("contenteditable");
    expect(sanitized).not.toContain("ProseMirror-trailingBreak");
    expect(mockResolve.mock.calls[0][1]).toEqual({ baseDir: "/docs", mode: "single" });
    expect(mockWriteText).toHaveBeenCalledWith('<p>hi<img src="data:image/png;base64,AA"></p>');
  });

  it("an unsaved buffer resolves against no base dir rather than refusing", async () => {
    await expect(copyAsHtml("# hi")).resolves.toBe(true);
    expect(mockBaseDir).toHaveBeenCalledWith(null);
  });
});
