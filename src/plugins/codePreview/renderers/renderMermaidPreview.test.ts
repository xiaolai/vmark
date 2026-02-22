import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/plugins/mermaid", () => ({
  renderMermaid: vi.fn(),
}));

vi.mock("@/plugins/mermaid/mermaidPanZoom", () => ({
  setupMermaidPanZoom: vi.fn(),
}));

vi.mock("@/plugins/mermaid/mermaidExport", () => ({
  setupMermaidExport: vi.fn(),
}));

vi.mock("@/plugins/svg/svgExport", () => ({
  setupSvgExport: vi.fn(),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeSvg: (svg: string) => svg,
  sanitizeKatex: (html: string) => html,
}));

vi.mock("@/utils/debug", () => ({
  diagramWarn: vi.fn(),
}));

// Mock Decoration.widget to capture and invoke the factory
let capturedFactory: ((view: unknown) => HTMLElement) | null = null;
vi.mock("@tiptap/pm/view", () => ({
  Decoration: {
    widget: vi.fn((_pos: number, factory: (view: unknown) => HTMLElement) => {
      capturedFactory = factory;
      return {};
    }),
  },
}));

import { renderMermaid } from "@/plugins/mermaid";
import { diagramWarn } from "@/utils/debug";
import { createMermaidPreviewWidget } from "./renderMermaidPreview";

describe("createMermaidPreviewWidget", () => {
  beforeEach(() => {
    capturedFactory = null;
    vi.mocked(renderMermaid).mockReset();
    vi.mocked(diagramWarn).mockClear();
  });

  it("shows error state when renderMermaid rejects", async () => {
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("parse error"));

    const cache = new Map();
    createMermaidPreviewWidget(10, "bad content", "key", cache, vi.fn());

    expect(capturedFactory).not.toBeNull();
    const element = capturedFactory!(null);

    await vi.waitFor(() => {
      expect(element.className).toContain("mermaid-error");
    });
    expect(diagramWarn).toHaveBeenCalled();
  });
});
