// @vitest-environment node
//
// Audit 20260907 round 3 (#697/#699). Two defects in one function's tail:
// the resource-warning toast counted warning CATEGORIES, so three missing
// images reported "1 resource could not be included"; and the empty-content
// guard was copied into all four public operations, which is how `copyAsHtml`
// came to have none at all until a fourth copy was added for it.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockExportHtml, mockSave, mockToast, mockRender, mockWriteText } = vi.hoisted(() => ({
  mockExportHtml: vi.fn(),
  mockSave: vi.fn(),
  mockToast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), errorDetail: vi.fn() },
  mockRender: vi.fn(),
  mockWriteText: vi.fn(),
}));

vi.mock("../htmlExport", () => ({ exportHtml: (...a: unknown[]) => mockExportHtml(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => mockSave(...a) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: (...a: unknown[]) => mockWriteText(...a) }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: mockToast }));
vi.mock("@/i18n", () => ({
  default: { t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) },
}));
vi.mock("../renderMarkdownToHtml", () => ({ renderMarkdownToHtml: (...a: unknown[]) => mockRender(...a) }));
vi.mock("../printDocument", () => ({
  buildPrintHtml: vi.fn(async () => "<html></html>"),
  prepareExportBody: vi.fn(async (html: string) => html),
  liveEditorElement: vi.fn(() => null),
  renderPrintableHtml: vi.fn(async () => "<p>rendered</p>"),
}));

import { copyAsHtml, exportToHtml, exportToPdf, exportToPdfNative } from "../useExportOperations";

const result = (over: Record<string, unknown> = {}) => ({
  success: true,
  warnings: [],
  missingCount: 0,
  resourceCount: 0,
  totalSize: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue("/out/Doc.html");
  mockRender.mockResolvedValue("<p>x</p>");
  mockExportHtml.mockResolvedValue(result());
});

describe("exportToHtml — what the resource warning counts", () => {
  it("reports the number of MISSING RESOURCES, not of warning categories", async () => {
    mockExportHtml.mockResolvedValue(
      result({ missingCount: 3, warnings: ["3 resource(s) not found"] }),
    );
    await exportToHtml({ markdown: "# hi" });
    expect(mockToast.warning).toHaveBeenCalledWith(
      'dialog:toast.exportHtmlResourceWarning:{"count":3}',
    );
    expect(mockToast.warning).toHaveBeenCalledTimes(1);
  });

  it("still warns when the only failure is an asset that would not embed", async () => {
    mockExportHtml.mockResolvedValue(
      result({ missingCount: 0, warnings: ["Failed to download font: x.woff2"] }),
    );
    await exportToHtml({ markdown: "# hi" });
    expect(mockToast.warning).toHaveBeenCalledWith("dialog:toast.exportHtmlAssetWarning");
  });

  it("says nothing when there is nothing to say", async () => {
    await exportToHtml({ markdown: "# hi" });
    expect(mockToast.warning).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });
});

describe("every public operation refuses empty content the same way", () => {
  it.each([
    ["exportToHtml", () => exportToHtml({ markdown: "   \n\t " })],
    ["exportToPdf", () => exportToPdf({ markdown: "   \n\t " })],
    ["exportToPdfNative", () => exportToPdfNative({ markdown: "   \n\t " })],
    ["copyAsHtml", () => copyAsHtml("   \n\t ")],
  ])("%s", async (_name, run) => {
    await run();
    expect(mockToast.error).toHaveBeenCalledWith("dialog:toast.exportNoContent");
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
  });
});
