/**
 * WI-FL6.3 — the print flow branches on what the dialog reported.
 *
 * `print_document` resolves with `{ status }`: `completed` or `cancelled`
 * where the platform exposes the outcome (macOS from the print sheet's
 * delegate, Linux from the GTK dialog response and the job's `finished`
 * signal), `unknown` where it does not (Windows, whose `ShowPrintUI` returns
 * nothing once the UI is up). The frontend used to treat every `Ok` alike,
 * so it could neither confirm a print nor stay quiet about a cancel; now
 * only `completed` earns a toast, and nothing else does — a cancel must not
 * read as a failure, and `unknown` must not read as a success.
 *
 * @module export/__tests__/printOutcome.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockInvoke, mockToastError, mockToastErrorDetail, mockToastSuccess, mockPrintError } =
  vi.hoisted(() => ({
    mockInvoke: vi.fn(),
    mockToastError: vi.fn(),
    mockToastErrorDetail: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockPrintError: vi.fn(),
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
    success: mockToastSuccess,
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
  // The print document forces every <details> open in the MARKUP, because the
  // shared CSS above styles `details[open]` (see printDocument.test.ts).
  expandDetails: (html: string) => html,
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("@/utils/debug", () => ({
  exportWarn: vi.fn(),
  exportError: vi.fn(),
  pdfError: vi.fn(),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

import { exportToPdf } from "../useExportOperations";
import { readPrintStatus } from "../printOutcome";

/** Install a fake live `.ProseMirror` element so the WYSIWYG branch is taken. */
function installLiveEditor(innerHTML: string): void {
  const el = document.createElement("div");
  el.className = "ProseMirror";
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
}

function noToastAtAll(): void {
  expect(mockToastSuccess).not.toHaveBeenCalled();
  expect(mockToastError).not.toHaveBeenCalled();
  expect(mockToastErrorDetail).not.toHaveBeenCalled();
}

describe("readPrintStatus — the wire shape of a print outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["completed", "cancelled", "unknown"] as const)("reads %s verbatim", (status) => {
    expect(readPrintStatus({ status })).toBe(status);
    expect(mockPrintError).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a bare string", "completed"],
    ["an empty object", {}],
    ["an unmapped status", { status: "printed" }],
    ["a non-string status", { status: 1 }],
  ])("reads %s as unknown and logs it, rather than guessing", (_label, raw) => {
    expect(readPrintStatus(raw)).toBe("unknown");
    expect(mockPrintError).toHaveBeenCalledTimes(1);
  });
});

describe("exportToPdf — one toast per outcome (WI-FL6.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    installLiveEditor("<p>hi</p>");
  });

  it("completed: confirms the print, and only that", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "completed" });

    await exportToPdf({ markdown: "hi" });

    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith("dialog:toast.printCompleted");
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockToastErrorDetail).not.toHaveBeenCalled();
  });

  it("cancelled: says nothing — the user chose this, it is not a failure", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "cancelled" });

    await exportToPdf({ markdown: "hi" });

    noToastAtAll();
  });

  it("unknown (Windows): says nothing — a 'printed' toast would be a guess", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "unknown" });

    await exportToPdf({ markdown: "hi" });

    noToastAtAll();
  });

  it("a rejection is still the failure toast, never a success", async () => {
    const rejection = { code: "io", message: "lp: printer unreachable", i18nKey: "errors.pdf.comFailed" };
    mockInvoke.mockRejectedValueOnce(rejection);

    await exportToPdf({ markdown: "hi" });

    expect(mockToastErrorDetail).toHaveBeenCalledWith("dialog:toast.printFailed", rejection);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("a malformed outcome stays silent for the user and loud in the log", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "printed" });

    await exportToPdf({ markdown: "hi" });

    noToastAtAll();
    expect(mockPrintError).toHaveBeenCalledTimes(1);
  });
});
