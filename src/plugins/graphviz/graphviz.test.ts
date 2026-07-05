/**
 * Tests for the Graphviz plugin.
 *
 * Mocks @viz-js/viz so no WASM loads in tests. Covers: render wiring
 * (source → viz.render call), instance caching, theme-dependent default
 * attributes, export rendering, error paths, and language detection.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const mockRender = vi.fn();
const mockInstance = vi.fn();
const mockDiagramWarn = vi.fn();

vi.mock("@viz-js/viz", () => ({
  instance: (...args: unknown[]) => mockInstance(...args),
}));

vi.mock("@/utils/debug", () => ({
  diagramWarn: (...args: unknown[]) => mockDiagramWarn(...args),
}));

// CSS import in plugin.ts — vitest handles via css: false, no mock needed.

type PluginModule = typeof import("./plugin");

/** Fresh module instance per test so the cached viz promise resets. */
async function loadPlugin(): Promise<PluginModule> {
  vi.resetModules();
  return await import("./plugin");
}

function successResult(output = "<svg>ok</svg>") {
  return { status: "success" as const, output, errors: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.className = "";
  mockInstance.mockResolvedValue({ render: mockRender });
  mockRender.mockReturnValue(successResult());
});

describe("isGraphvizLanguage", () => {
  it("recognizes 'dot' and 'graphviz'", async () => {
    const { isGraphvizLanguage } = await loadPlugin();
    expect(isGraphvizLanguage("dot")).toBe(true);
    expect(isGraphvizLanguage("graphviz")).toBe(true);
  });

  it("rejects other languages", async () => {
    const { isGraphvizLanguage } = await loadPlugin();
    expect(isGraphvizLanguage("mermaid")).toBe(false);
    expect(isGraphvizLanguage("")).toBe(false);
    expect(isGraphvizLanguage("dotfile")).toBe(false);
  });
});

describe("renderGraphviz", () => {
  it("renders DOT source to SVG via viz.render", async () => {
    const { renderGraphviz } = await loadPlugin();
    const svg = await renderGraphviz("digraph { a -> b }");

    expect(svg).toBe("<svg>ok</svg>");
    expect(mockRender).toHaveBeenCalledWith(
      "digraph { a -> b }",
      expect.objectContaining({ format: "svg", engine: "dot" }),
    );
  });

  it("always requests a transparent background (graph default attribute)", async () => {
    const { renderGraphviz } = await loadPlugin();
    await renderGraphviz("digraph { a }");

    const options = mockRender.mock.calls[0][1];
    expect(options.graphAttributes).toMatchObject({ bgcolor: "transparent" });
  });

  it("caches the viz instance across renders", async () => {
    const { renderGraphviz } = await loadPlugin();
    await renderGraphviz("digraph { a }");
    await renderGraphviz("digraph { b }");

    expect(mockInstance).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight instance load between concurrent renders", async () => {
    const { renderGraphviz } = await loadPlugin();
    const [a, b] = await Promise.all([
      renderGraphviz("digraph { a }"),
      renderGraphviz("digraph { b }"),
    ]);

    expect(a).toBe("<svg>ok</svg>");
    expect(b).toBe("<svg>ok</svg>");
    expect(mockInstance).toHaveBeenCalledTimes(1);
  });

  it("returns null and warns on a failure result", async () => {
    mockRender.mockReturnValue({
      status: "failure",
      output: undefined,
      errors: [{ level: "error", message: "syntax error in line 1" }],
    });

    const { renderGraphviz } = await loadPlugin();
    const svg = await renderGraphviz("digraph {");

    expect(svg).toBeNull();
    expect(mockDiagramWarn).toHaveBeenCalledWith(
      "Failed to render Graphviz diagram:",
      expect.stringContaining("syntax error in line 1"),
    );
  });

  it("returns null and warns when viz.render throws", async () => {
    mockRender.mockImplementation(() => {
      throw new Error("wasm blew up");
    });

    const { renderGraphviz } = await loadPlugin();
    const svg = await renderGraphviz("digraph { a }");

    expect(svg).toBeNull();
    expect(mockDiagramWarn).toHaveBeenCalled();
  });

  it("returns null and warns when the module fails to load", async () => {
    mockInstance.mockRejectedValue(new Error("network down"));

    const { renderGraphviz } = await loadPlugin();
    const svg = await renderGraphviz("digraph { a }");

    expect(svg).toBeNull();
    expect(mockDiagramWarn).toHaveBeenCalled();
  });

  it("retries the WASM load after a failed first attempt (no cached rejection)", async () => {
    mockInstance.mockRejectedValueOnce(new Error("network down"));

    const { renderGraphviz } = await loadPlugin();
    expect(await renderGraphviz("digraph { a }")).toBeNull();

    // The failed load must not brick Graphviz for the session.
    expect(await renderGraphviz("digraph { a }")).toBe("<svg>ok</svg>");
    expect(mockInstance).toHaveBeenCalledTimes(2);
  });

  it("handles empty source like any other input (delegates to viz)", async () => {
    const { renderGraphviz } = await loadPlugin();
    await renderGraphviz("");
    expect(mockRender).toHaveBeenCalledWith("", expect.any(Object));
  });

  describe("theme handling (token-driven)", () => {
    it("derives default colors from design tokens (fallbacks in test env)", async () => {
      const { renderGraphviz } = await loadPlugin();
      await renderGraphviz("digraph { a }");

      const options = mockRender.mock.calls[0][1];
      // Fallback token values (light defaults) — see diagramThemeTokens.ts
      expect(options.graphAttributes).toMatchObject({
        bgcolor: "transparent",
        color: "#d5d4d4",
        fontcolor: "#1a1a1a",
      });
      expect(options.nodeAttributes).toMatchObject({
        color: "#1a1a1a",
        fontcolor: "#1a1a1a",
      });
      expect(options.edgeAttributes).toMatchObject({
        color: "#666666",
        fontcolor: "#666666",
      });
    });

    it("uses the current theme's tokens, not a light/dark binary", async () => {
      document.documentElement.style.setProperty("--text-color", "#5b4636");
      document.documentElement.style.setProperty("--text-secondary", "#8a7057");
      document.documentElement.style.setProperty("--border-color", "#d8c9a8");

      const { renderGraphviz } = await loadPlugin();
      await renderGraphviz("digraph { a }");

      const options = mockRender.mock.calls[0][1];
      expect(options.nodeAttributes).toMatchObject({ color: "#5b4636", fontcolor: "#5b4636" });
      expect(options.edgeAttributes).toMatchObject({ color: "#8a7057", fontcolor: "#8a7057" });
      expect(options.graphAttributes).toMatchObject({ color: "#d8c9a8" });

      document.documentElement.style.removeProperty("--text-color");
      document.documentElement.style.removeProperty("--text-secondary");
      document.documentElement.style.removeProperty("--border-color");
    });

    it("re-reads tokens on every render (no capture at module load)", async () => {
      const { renderGraphviz } = await loadPlugin();
      await renderGraphviz("digraph { a }");
      document.documentElement.style.setProperty("--text-color", "#f3f4f6");
      await renderGraphviz("digraph { a }");
      document.documentElement.style.removeProperty("--text-color");

      expect(mockRender.mock.calls[0][1].nodeAttributes.fontcolor).toBe("#1a1a1a");
      expect(mockRender.mock.calls[1][1].nodeAttributes.fontcolor).toBe("#f3f4f6");
    });
  });
});

describe("renderGraphvizForExport", () => {
  it("renders with light attributes for the light theme regardless of app theme", async () => {
    document.documentElement.classList.add("dark-theme");

    const { renderGraphvizForExport } = await loadPlugin();
    const svg = await renderGraphvizForExport("digraph { a }", "light");

    expect(svg).toBe("<svg>ok</svg>");
    const options = mockRender.mock.calls[0][1];
    expect(options.nodeAttributes).toBeUndefined();
  });

  it("renders with dark attributes for the dark theme regardless of app theme", async () => {
    const { renderGraphvizForExport } = await loadPlugin();
    await renderGraphvizForExport("digraph { a }", "dark");

    const options = mockRender.mock.calls[0][1];
    expect(options.nodeAttributes).toBeDefined();
    expect(options.edgeAttributes).toBeDefined();
  });

  it("returns null on render failure", async () => {
    mockRender.mockReturnValue({ status: "failure", output: undefined, errors: [] });

    const { renderGraphvizForExport } = await loadPlugin();
    expect(await renderGraphvizForExport("digraph {", "light")).toBeNull();
  });
});
