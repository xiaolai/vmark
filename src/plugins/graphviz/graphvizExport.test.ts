/**
 * Tests for Graphviz Export
 *
 * Covers the setupGraphvizExport function which renders the diagram SVG
 * with an explicit theme, converts to PNG, and saves via Tauri dialog.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mockSave = vi.fn();
const mockWriteFile = vi.fn();
const mockRenderGraphvizForExport = vi.fn();
const mockSvgToPngBytes = vi.fn();
const mockDiagramWarn = vi.fn();
const mockSetupDiagramExport = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => mockSave(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock("./index", () => ({
  renderGraphvizForExport: (...args: unknown[]) =>
    mockRenderGraphvizForExport(...args),
}));

vi.mock("@/utils/svgToPng", () => ({
  svgToPngBytes: (...args: unknown[]) => mockSvgToPngBytes(...args),
}));

vi.mock("@/utils/debug", () => ({
  diagramWarn: (...args: unknown[]) => mockDiagramWarn(...args),
}));

vi.mock("@/plugins/shared/diagramExport", () => ({
  setupDiagramExport: (...args: unknown[]) => mockSetupDiagramExport(...args),
  LIGHT_BG: "#ffffff",
  DARK_BG: "#1e1e1e",
}));

import { setupGraphvizExport } from "./graphvizExport";

let container: HTMLElement;
let capturedDoExport: ((theme: "light" | "dark") => Promise<void>) | null;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  capturedDoExport = null;

  mockSetupDiagramExport.mockImplementation(
    (_container: HTMLElement, doExport: (theme: "light" | "dark") => Promise<void>) => {
      capturedDoExport = doExport;
      return { destroy: vi.fn() };
    },
  );
});

afterEach(() => {
  capturedDoExport = null;
});

describe("setupGraphvizExport", () => {
  it("calls setupDiagramExport with container and callback", () => {
    setupGraphvizExport(container, "digraph { a -> b }");

    expect(mockSetupDiagramExport).toHaveBeenCalledWith(
      container,
      expect.any(Function),
    );
  });

  it("returns the ExportInstance from setupDiagramExport", () => {
    const mockDestroy = vi.fn();
    mockSetupDiagramExport.mockReturnValue({ destroy: mockDestroy });

    const instance = setupGraphvizExport(container, "digraph { a -> b }");
    expect(instance.destroy).toBe(mockDestroy);
  });
});

describe("export callback - light theme", () => {
  it("renders SVG, converts to PNG, and saves file", async () => {
    const svgString = "<svg>graphviz</svg>";
    const pngData = new Uint8Array([137, 80, 78, 71]);
    mockRenderGraphvizForExport.mockResolvedValue(svgString);
    mockSvgToPngBytes.mockResolvedValue(pngData);
    mockSave.mockResolvedValue("/output/diagram.png");
    mockWriteFile.mockResolvedValue(undefined);

    setupGraphvizExport(container, "digraph { a -> b }");
    await capturedDoExport!("light");

    expect(mockRenderGraphvizForExport).toHaveBeenCalledWith(
      "digraph { a -> b }",
      "light",
    );
    expect(mockSvgToPngBytes).toHaveBeenCalledWith(svgString, 2, "#ffffff");
    expect(mockSave).toHaveBeenCalledWith({
      defaultPath: "diagram.png",
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });
    expect(mockWriteFile).toHaveBeenCalledWith("/output/diagram.png", pngData);
  });
});

describe("export callback - dark theme", () => {
  it("uses dark background color", async () => {
    mockRenderGraphvizForExport.mockResolvedValue("<svg>dark</svg>");
    mockSvgToPngBytes.mockResolvedValue(new Uint8Array([1]));
    mockSave.mockResolvedValue("/output/diagram.png");
    mockWriteFile.mockResolvedValue(undefined);

    setupGraphvizExport(container, "digraph { x -> y }");
    await capturedDoExport!("dark");

    expect(mockRenderGraphvizForExport).toHaveBeenCalledWith(
      "digraph { x -> y }",
      "dark",
    );
    expect(mockSvgToPngBytes).toHaveBeenCalledWith("<svg>dark</svg>", 2, "#1e1e1e");
  });
});

describe("error paths", () => {
  it("returns early when render returns no SVG", async () => {
    mockRenderGraphvizForExport.mockResolvedValue(null);

    setupGraphvizExport(container, "digraph {");
    await capturedDoExport!("light");

    expect(mockDiagramWarn).toHaveBeenCalledWith("render returned no SVG");
    expect(mockSvgToPngBytes).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns early when SVG to PNG conversion fails", async () => {
    mockRenderGraphvizForExport.mockResolvedValue("<svg>test</svg>");
    mockSvgToPngBytes.mockRejectedValue(new Error("Canvas error"));

    setupGraphvizExport(container, "digraph { a }");
    await capturedDoExport!("light");

    expect(mockDiagramWarn).toHaveBeenCalledWith(
      expect.stringContaining("PNG conversion failed"),
      expect.any(Error),
    );
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns early when user cancels save dialog", async () => {
    mockRenderGraphvizForExport.mockResolvedValue("<svg>test</svg>");
    mockSvgToPngBytes.mockResolvedValue(new Uint8Array([1]));
    mockSave.mockResolvedValue(null);

    setupGraphvizExport(container, "digraph { a }");
    await capturedDoExport!("light");

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("logs warning when file write fails", async () => {
    mockRenderGraphvizForExport.mockResolvedValue("<svg>test</svg>");
    mockSvgToPngBytes.mockResolvedValue(new Uint8Array([1]));
    mockSave.mockResolvedValue("/output/diagram.png");
    mockWriteFile.mockRejectedValue(new Error("Permission denied"));

    setupGraphvizExport(container, "digraph { a }");
    await capturedDoExport!("light");

    expect(mockDiagramWarn).toHaveBeenCalledWith(
      "failed to write file",
      expect.any(Error),
    );
  });
});

describe("edge cases", () => {
  it("passes the exact DOT source through to the renderer", async () => {
    const source = 'digraph G { a [label="A (α) & <b>"]; a -> b }';
    mockRenderGraphvizForExport.mockResolvedValue("<svg>special</svg>");
    mockSvgToPngBytes.mockResolvedValue(new Uint8Array([1]));
    mockSave.mockResolvedValue("/out.png");
    mockWriteFile.mockResolvedValue(undefined);

    setupGraphvizExport(container, source);
    await capturedDoExport!("dark");

    expect(mockRenderGraphvizForExport).toHaveBeenCalledWith(source, "dark");
  });
});
