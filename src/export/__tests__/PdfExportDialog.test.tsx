/**
 * Tests for PdfExportContent.
 *
 * Verifies i18n compliance for the settings-only panel, the save-panel request
 * (`pick_export_target`, which Rust shows and records), and the post-export
 * "open in default viewer" behavior (Preview.app on macOS). The `.pdf` suffix
 * a bare typed name gains is added where the choice is recorded, and pinned in
 * `src-tauri/src/export_target/mod.test.rs`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  invokeMock,
  pickMock,
  openPathMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  pickMock: vi.fn(),
  openPathMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

// The save panel is Rust's (`pick_export_target`); every other command goes
// to `invokeMock`, which therefore sees only `export_pdf`.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) =>
    cmd === "pick_export_target" ? pickMock(args) : invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openPathMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

import { PdfExportContent } from "../PdfExportDialog";

// useSettingsStore.getState() must return a valid `appearance` shape
const appearance = vi.hoisted(() => ({
  latinFont: "system",
  cjkFont: "system",
  cjkLetterSpacing: "0",
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ appearance }),
  },
}));

/** The `--cjk-letter-spacing` the exported HTML declares. */
async function exportedCjkSpacing(): Promise<string | undefined> {
  const user = userEvent.setup();
  pickMock.mockResolvedValue("/tmp/out.pdf");
  invokeMock.mockResolvedValue(undefined);
  openPathMock.mockResolvedValue(undefined);
  render(<PdfExportContent renderedHtml="<p>中文</p>" defaultName="t" onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Export PDF" }));
  const call = invokeMock.mock.calls.find(([cmd]) => cmd === "export_pdf");
  const html = (call?.[1] as { html?: string } | undefined)?.html ?? "";
  return /--cjk-letter-spacing:\s*([^;]+);/.exec(html)?.[1]?.trim();
}

// The dialog seeds CJK spacing from Appearance like it seeds the fonts. It used
// to start at 0.05em whatever the setting said, and the setting is off by default.
describe("PdfExportContent CJK letter spacing seed", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    pickMock.mockReset();
    openPathMock.mockReset();
  });

  it("exports with no CJK spacing when the setting is off", async () => {
    appearance.cjkLetterSpacing = "0";
    expect(await exportedCjkSpacing()).toBe("0");
  });

  it("exports with the spacing the setting chose", async () => {
    appearance.cjkLetterSpacing = "0.12";
    expect(await exportedCjkSpacing()).toBe("0.12em");
    appearance.cjkLetterSpacing = "0";
  });
});

describe("PdfExportContent", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    pickMock.mockReset();
    openPathMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("renders the settings-only panel with an Export button", () => {
    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  });

  it("does not render any preview iframe", () => {
    const { container } = render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("opens the saved PDF in the default viewer after a successful export", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    pickMock.mockResolvedValue("/tmp/out.pdf");
    invokeMock.mockResolvedValue(undefined);
    openPathMock.mockResolvedValue(undefined);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "export_pdf",
      expect.objectContaining({ outputPath: "/tmp/out.pdf" }),
    );
    expect(openPathMock).toHaveBeenCalledWith("/tmp/out.pdf");
    expect(onClose).toHaveBeenCalled();
  });

  it("seeds the save dialog with the document title verbatim (already extension-free)", async () => {
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null); // cancel — we only assert the defaultPath

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="report.v2"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(pickMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "report.v2.pdf" }),
    );
  });

  it("preserves dot-containing titles (e.g. dated headings) in the save dialog", async () => {
    // Regression test for #837: a title like "# 2026.04.27 测试问题" was
    // being truncated to "2026.04" because the dialog stripped everything
    // after the last dot, mistaking the title for a filename with extension.
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="2026.04.27 测试问题"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(pickMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "2026.04.27 测试问题.pdf" }),
    );
  });

  it("does not double the .pdf extension when the title already ends in .pdf", async () => {
    // Edge case: an H1 like "# report.pdf" would otherwise seed
    // "report.pdf.pdf" in the save panel. Idempotent suffix handling keeps
    // it as a single ".pdf".
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="report.pdf"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(pickMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "report.pdf" }),
    );
  });

  it("matches the .pdf suffix case-insensitively", async () => {
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="REPORT.PDF"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(pickMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "REPORT.PDF" }),
    );
  });

  it("exports to exactly the path the save panel answered", async () => {
    // The answer is the RECORDED choice, already suffixed; any rewrite here
    // would make `export_pdf` refuse it as a path nobody chose.
    const user = userEvent.setup();
    pickMock.mockResolvedValue("/tmp/notes.pdf");
    invokeMock.mockResolvedValue(undefined);
    openPathMock.mockResolvedValue(undefined);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="notes"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(pickMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pdf", defaultPath: "notes.pdf" }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "export_pdf",
      expect.objectContaining({ outputPath: "/tmp/notes.pdf" }),
    );
    expect(openPathMock).toHaveBeenCalledWith("/tmp/notes.pdf");
  });

  it("does not pass filters to the save dialog (macOS Tahoe parity)", async () => {
    // Regression test for #837: filters trigger setAllowedFileTypes which
    // macOS 26 (Tahoe) deprecated, breaking paste and silently deleting
    // typed input in the save panel. Match the same convention as HTML and
    // Pandoc exports: no filters.
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="doc"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    const callArgs = pickMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("filters");
  });

  it("falls back to the i18n default title when no defaultName is provided", async () => {
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName={undefined}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(pickMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Document.pdf" }),
    );
  });

  it("does not call openPath when the user cancels the save dialog", async () => {
    const user = userEvent.setup();
    pickMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(invokeMock).not.toHaveBeenCalled();
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("still reports success when openPath fails (export already succeeded)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    pickMock.mockResolvedValue("/tmp/out.pdf");
    invokeMock.mockResolvedValue(undefined);
    openPathMock.mockRejectedValue(new Error("No default app"));

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(toastSuccessMock).toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("reports an error toast and does not open when export fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    pickMock.mockResolvedValue("/tmp/out.pdf");
    invokeMock.mockRejectedValue(new Error("boom"));

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(toastErrorMock).toHaveBeenCalled();
    expect(openPathMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
