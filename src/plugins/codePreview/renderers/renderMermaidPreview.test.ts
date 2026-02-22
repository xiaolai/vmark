import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRenderMermaid = vi.fn();
const mockSetupMermaidPanZoom = vi.fn();
const mockSetupMermaidExport = vi.fn();
const mockSanitizeSvg = vi.fn((s: string) => s);
const mockInstallDoubleClickHandler = vi.fn();
const mockDiagramWarn = vi.fn();

vi.mock("@/plugins/mermaid", () => ({
  renderMermaid: (...args: unknown[]) => mockRenderMermaid(...args),
}));
vi.mock("@/plugins/mermaid/mermaidPanZoom", () => ({
  setupMermaidPanZoom: (...args: unknown[]) => mockSetupMermaidPanZoom(...args),
}));
vi.mock("@/plugins/mermaid/mermaidExport", () => ({
  setupMermaidExport: (...args: unknown[]) => mockSetupMermaidExport(...args),
}));
vi.mock("@/utils/sanitize", () => ({
  sanitizeSvg: (s: string) => mockSanitizeSvg(s),
}));
vi.mock("../previewHelpers", () => ({
  installDoubleClickHandler: (...args: unknown[]) => mockInstallDoubleClickHandler(...args),
}));
vi.mock("@/utils/debug", () => ({
  diagramWarn: (...args: unknown[]) => mockDiagramWarn(...args),
}));

import { createMermaidPreviewWidget } from "./renderMermaidPreview";

describe("createMermaidPreviewWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error indicator when renderMermaid rejects", async () => {
    mockRenderMermaid.mockRejectedValue(new Error("Render failed"));

    const previewCache = new Map();
    const handleEnterEdit = vi.fn();

    const decoration = createMermaidPreviewWidget(
      1, "invalid content", "mermaid:invalid", previewCache, handleEnterEdit,
    );

    // Access widget factory via internal ProseMirror structure
    // Decoration.widget stores the factory as type.toDOM
    const widget = (decoration as Record<string, unknown>).type as { toDOM: (view: null) => HTMLElement };
    const placeholder = widget.toDOM(null);

    // Wait for the rejected promise to settle
    await vi.waitFor(() => {
      expect(mockDiagramWarn).toHaveBeenCalledWith(
        "Mermaid render failed:",
        "Render failed",
      );
    });

    expect(placeholder.className).toContain("mermaid-error");
    expect(placeholder.textContent).toContain("Failed to render diagram");
  });

  it("shows success state when renderMermaid resolves with SVG", async () => {
    mockRenderMermaid.mockResolvedValue("<svg>OK</svg>");

    const previewCache = new Map();
    const handleEnterEdit = vi.fn();

    const decoration = createMermaidPreviewWidget(
      1, "graph TD; A-->B", "mermaid:graph", previewCache, handleEnterEdit,
    );

    const widget = (decoration as Record<string, unknown>).type as { toDOM: (view: null) => HTMLElement };
    const placeholder = widget.toDOM(null);

    await vi.waitFor(() => {
      expect(mockSanitizeSvg).toHaveBeenCalledWith("<svg>OK</svg>");
    });

    expect(placeholder.className).toContain("mermaid-preview");
    expect(placeholder.className).not.toContain("mermaid-error");
    expect(previewCache.has("mermaid:graph")).toBe(true);
  });
});
