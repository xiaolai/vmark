/**
 * fix(#1343) — the print catch must tell the truth about what failed.
 *
 * On Linux the print helper now settles the sink from the print operation's
 * `finished`/`failed` signals, so a CONFIRMED job that later fails rejects
 * `print_document` — a path that used to settle Ok silently. The old catch
 * mapped every rejection to the static "Failed to open print dialog", which
 * is factually wrong once a failure can arrive after the dialog opened fine.
 * The catch now uses the two-line `toast.errorDetail` (WI-UI4.4) with the
 * neutral "Print failed" headline, handing the RAW rejection over —
 * errorDetail owns the normalization (commandErrorMessage), so a typed
 * CommandError renders its localized message rather than "[object Object]".
 *
 * @module export/__tests__/printFailureToast.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockInvoke, mockToastError, mockToastErrorDetail } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockToastError: vi.fn(),
  mockToastErrorDetail: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("../resourceResolver", () => ({
  resolveResources: (html: string) =>
    Promise.resolve({ html, report: { resources: [], resolved: [], missing: [], totalSize: 0 } }),
  getDocumentBaseDir: () => Promise.resolve(null),
}));

vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    error: mockToastError,
    errorDetail: mockToastErrorDetail,
    success: vi.fn(),
    warning: vi.fn(),
  },
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
function installLiveEditor(innerHTML: string): void {
  const el = document.createElement("div");
  el.className = "ProseMirror";
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
}

describe("exportToPdf — print failure surfaces the real error (issue #1343)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    mockInvoke.mockResolvedValue(undefined);
  });

  it("hands a print_document rejection to errorDetail RAW, under the printFailed headline", async () => {
    installLiveEditor("<p>hi</p>");
    // A CommandError rejection as Tauri delivers it: a plain object. The
    // catch must not stringify it (that renders "[object Object]") and must
    // not claim the dialog failed to open — the job can fail after it did.
    const rejection = {
      code: "io",
      message: "PDF export failed at print: lp: printer unreachable",
      i18nKey: "errors.pdf.comFailed",
    };
    mockInvoke.mockRejectedValueOnce(rejection);

    await exportToPdf({ markdown: "hi" });

    expect(mockToastErrorDetail).toHaveBeenCalledTimes(1);
    expect(mockToastErrorDetail).toHaveBeenCalledWith("dialog:toast.printFailed", rejection);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows no error toast when printing succeeds", async () => {
    installLiveEditor("<p>hi</p>");

    await exportToPdf({ markdown: "hi" });

    expect(mockToastErrorDetail).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
