/**
 * Tests for PdfExportContent.
 *
 * Verifies i18n compliance for the settings-only panel and the post-export
 * "open in default viewer" behavior (Preview.app on macOS).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  invokeMock,
  saveMock,
  openPathMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  saveMock: vi.fn(),
  openPathMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
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
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      appearance: { latinFont: "system", cjkFont: "system" },
    }),
  },
}));

// captureThemeCSS + isDarkTheme both touch document.styleSheets — stub them
vi.mock("../themeSnapshot", () => ({
  captureThemeCSS: () => "",
  isDarkTheme: () => false,
}));

vi.mock("../htmlExportStyles", () => ({
  getEditorContentCSS: () => "",
}));

describe("PdfExportContent", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveMock.mockReset();
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
    saveMock.mockResolvedValue("/tmp/out.pdf");
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

  it("seeds the save dialog with the source filename (sans extension)", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue(null); // cancel — we only assert the defaultPath

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="report.v2.md"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "report.v2.pdf" }),
    );
  });

  it("falls back to the i18n default title when no defaultName is provided", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue(null);

    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName={undefined}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Document.pdf" }),
    );
  });

  it("does not call openPath when the user cancels the save dialog", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue(null);

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
    saveMock.mockResolvedValue("/tmp/out.pdf");
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
    saveMock.mockResolvedValue("/tmp/out.pdf");
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
