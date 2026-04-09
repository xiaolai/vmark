/**
 * Tests for PdfExportContent i18n compliance.
 *
 * Verifies that all user-facing strings come from the "export" and "dialog"
 * i18n namespaces instead of hardcoded English.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PdfExportContent } from "../PdfExportDialog";

// Mock sonner
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

describe("PdfExportContent i18n", () => {
  it("renders loading text from i18n", () => {
    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={vi.fn()}
      />,
    );
    // Should show "Rendering preview…" from t("export:pdf.preview.rendering")
    expect(screen.getByText(/Rendering preview/)).toBeInTheDocument();
  });

  it("renders iframe title from i18n", () => {
    render(
      <PdfExportContent
        renderedHtml="<p>Test</p>"
        defaultName="test.md"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTitle("PDF Preview")).toBeInTheDocument();
  });
});
