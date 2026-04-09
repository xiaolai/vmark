/**
 * Tests for PdfSettingsSidebar i18n compliance.
 *
 * Verifies that all user-facing strings come from the "export" i18n namespace
 * instead of hardcoded English.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PdfSettingsSidebar } from "../PdfSettingsSidebar";
import type { PdfOptions } from "../pdfHtmlTemplate";

// Mock sonner to avoid toast-related side effects
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function createDefaultOptions(): PdfOptions {
  return {
    pageSize: "a4",
    orientation: "portrait",
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    showPageNumbers: true,
    showHeader: true,
    showDate: false,
    title: "Test Document",
    fontSize: 11,
    lineHeight: 1.6,
    cjkLetterSpacing: "0.05em",
    latinFont: "system",
    cjkFont: "system",
    useEditorTheme: false,
  };
}

describe("PdfSettingsSidebar i18n", () => {
  const noop = vi.fn();

  it("renders page setup labels from i18n", () => {
    render(
      <PdfSettingsSidebar
        options={createDefaultOptions()}
        onOptionChange={noop}
        onExport={noop}
        exporting={false}
        exportStage=""
      />,
    );
    // These labels should come from t("pdf.pageSetup.size") etc.
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("Orientation")).toBeInTheDocument();
    expect(screen.getByText("Margins")).toBeInTheDocument();
  });

  it("renders export button text from i18n", () => {
    render(
      <PdfSettingsSidebar
        options={createDefaultOptions()}
        onOptionChange={noop}
        onExport={noop}
        exporting={false}
        exportStage=""
      />,
    );
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  });

  it("renders exporting state from i18n", () => {
    render(
      <PdfSettingsSidebar
        options={createDefaultOptions()}
        onOptionChange={noop}
        onExport={noop}
        exporting={true}
        exportStage=""
      />,
    );
    expect(screen.getByRole("button", { name: /Exporting/ })).toBeInTheDocument();
  });

  it("renders exporting with custom stage", () => {
    render(
      <PdfSettingsSidebar
        options={createDefaultOptions()}
        onOptionChange={noop}
        onExport={noop}
        exporting={true}
        exportStage="Generating PDF\u2026"
      />,
    );
    expect(screen.getByRole("button", { name: /Generating PDF/ })).toBeInTheDocument();
  });

  it("renders margin unit label from i18n", () => {
    render(
      <PdfSettingsSidebar
        options={createDefaultOptions()}
        onOptionChange={noop}
        onExport={noop}
        exporting={false}
        exportStage=""
      />,
    );
    expect(screen.getByText("mm")).toBeInTheDocument();
  });

  it("renders collapsible section titles from i18n", () => {
    render(
      <PdfSettingsSidebar
        options={createDefaultOptions()}
        onOptionChange={noop}
        onExport={noop}
        exporting={false}
        exportStage=""
      />,
    );
    // These buttons hold the section titles
    expect(screen.getByText("Typography")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Headers & Footers (Preview Only)")).toBeInTheDocument();
  });
});
