import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/plugins/graphviz", () => ({
  renderGraphviz: vi.fn(),
}));

vi.mock("@/plugins/graphviz/graphvizExport", () => ({
  setupGraphvizExport: vi.fn(),
}));

vi.mock("@/plugins/mermaid/mermaidPanZoom", () => ({
  setupMermaidPanZoom: vi.fn(),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeSvg: (svg: string) => svg,
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

import { renderGraphviz } from "@/plugins/graphviz";
import { setupGraphvizExport } from "@/plugins/graphviz/graphvizExport";
import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { diagramWarn } from "@/utils/debug";
import {
  updateGraphvizLivePreview,
  createGraphvizPreviewWidget,
} from "./renderGraphvizPreview";

describe("updateGraphvizLivePreview", () => {
  beforeEach(() => {
    vi.mocked(renderGraphviz).mockReset();
  });

  it("renders valid DOT SVG into the element", async () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce("<svg>diagram</svg>");

    const element = document.createElement("div");
    const token = 1;
    await updateGraphvizLivePreview(element, "digraph { a -> b }", token, () => token);

    expect(element.textContent).toContain("diagram");
  });

  it("shows error for invalid DOT syntax", async () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce(null);

    const element = document.createElement("div");
    const token = 1;
    await updateGraphvizLivePreview(element, "digraph {", token, () => token);

    expect(element.querySelector(".code-block-live-preview-error")).not.toBeNull();
  });

  it("skips update when token is stale", async () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce("<svg>diagram</svg>");

    const element = document.createElement("div");
    await updateGraphvizLivePreview(element, "digraph { a }", 1, () => 2);

    expect(element.textContent).toBe("");
  });

  it("skips error display when token is stale on null result", async () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce(null);

    const element = document.createElement("div");
    await updateGraphvizLivePreview(element, "bad", 1, () => 2);

    expect(element.querySelector(".code-block-live-preview-error")).toBeNull();
  });
});

describe("createGraphvizPreviewWidget", () => {
  beforeEach(() => {
    capturedFactory = null;
    vi.mocked(renderGraphviz).mockReset();
    vi.mocked(diagramWarn).mockClear();
    vi.mocked(setupMermaidPanZoom).mockClear();
    vi.mocked(setupGraphvizExport).mockClear();
  });

  it("creates placeholder element with loading state", () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce("<svg>ok</svg>");

    const cache = new Map();
    createGraphvizPreviewWidget(10, "digraph { a }", "key", cache, vi.fn());

    expect(capturedFactory).not.toBeNull();
    const element = capturedFactory!(null);
    expect(element.className).toContain("graphviz-preview");
    expect(element.className).toContain("graphviz-loading");
    expect(element.textContent).not.toBe("");
  });

  it("renders diagram, caches it, and wires pan-zoom + export on success", async () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce("<svg>result</svg>");

    const cache = new Map();
    createGraphvizPreviewWidget(10, "digraph { a -> b }", "key", cache, vi.fn());

    const element = capturedFactory!(null);

    await vi.waitFor(() => {
      expect(element.className).toBe("code-block-preview graphviz-preview");
    });

    expect(element.textContent).toContain("result");
    expect(cache.get("key")).toEqual({ rendered: "<svg>result</svg>" });
    expect(setupMermaidPanZoom).toHaveBeenCalledWith(element);
    expect(setupGraphvizExport).toHaveBeenCalledWith(element, "digraph { a -> b }");
  });

  it("shows error state when renderGraphviz returns null", async () => {
    vi.mocked(renderGraphviz).mockResolvedValueOnce(null);

    const cache = new Map();
    createGraphvizPreviewWidget(10, "digraph {", "key", cache, vi.fn());

    const element = capturedFactory!(null);

    await vi.waitFor(() => {
      expect(element.className).toContain("graphviz-error");
    });
    expect(cache.has("key")).toBe(false);
    expect(setupMermaidPanZoom).not.toHaveBeenCalled();
  });

  it("shows error state and warns when renderGraphviz rejects", async () => {
    vi.mocked(renderGraphviz).mockRejectedValueOnce(new Error("wasm error"));

    const cache = new Map();
    createGraphvizPreviewWidget(10, "bad content", "key", cache, vi.fn());

    const element = capturedFactory!(null);

    await vi.waitFor(() => {
      expect(element.className).toContain("graphviz-error");
    });
    expect(diagramWarn).toHaveBeenCalled();
    expect(cache.has("key")).toBe(false);
  });

  it("deduplicates concurrent renders of the same source via a shared cached promise", async () => {
    // Audit finding: identical DOT blocks each launched their own WASM
    // render. The pending promise must be stored in the cache (LaTeX renderer
    // pattern) so a second widget for the same cacheKey reuses it.
    let resolveRender!: (svg: string | null) => void;
    vi.mocked(renderGraphviz).mockImplementation(
      () => new Promise((resolve) => { resolveRender = resolve; }),
    );

    const cache = new Map();
    createGraphvizPreviewWidget(10, "digraph { a }", "key", cache, vi.fn());
    const first = capturedFactory!(null);
    createGraphvizPreviewWidget(20, "digraph { a }", "key", cache, vi.fn());
    const second = capturedFactory!(null);

    expect(renderGraphviz).toHaveBeenCalledTimes(1);

    resolveRender("<svg>shared</svg>");
    await vi.waitFor(() => {
      expect(first.textContent).toContain("shared");
      expect(second.textContent).toContain("shared");
    });
    expect(cache.get("key")).toEqual({ rendered: "<svg>shared</svg>" });
  });

  it("does not repopulate the cache with a stale themed SVG after a theme change cleared it", async () => {
    // Audit finding: a render started under theme A could resolve after a
    // theme change already cleared the cache, re-inserting theme-A output.
    document.documentElement.style.setProperty("--text-color", "#111111");
    let resolveRender!: (svg: string | null) => void;
    vi.mocked(renderGraphviz).mockImplementation(
      () => new Promise((resolve) => { resolveRender = resolve; }),
    );

    const cache = new Map();
    createGraphvizPreviewWidget(10, "digraph { a }", "key", cache, vi.fn());
    const element = capturedFactory!(null);

    // Theme observer behavior: tokens change AND the preview cache is cleared.
    document.documentElement.style.setProperty("--text-color", "#eeeeee");
    cache.clear();

    resolveRender("<svg>stale-theme</svg>");
    await new Promise((r) => setTimeout(r, 0));

    expect(cache.has("key")).toBe(false);
    expect(element.innerHTML).not.toContain("stale-theme");
    expect(setupMermaidPanZoom).not.toHaveBeenCalled();

    document.documentElement.style.removeProperty("--text-color");
  });

  it("logs non-Error rejections as strings", async () => {
    vi.mocked(renderGraphviz).mockRejectedValueOnce("string error");

    const cache = new Map();
    createGraphvizPreviewWidget(10, "bad", "key", cache, vi.fn());

    capturedFactory!(null);

    await vi.waitFor(() => {
      expect(diagramWarn).toHaveBeenCalledWith(
        "Graphviz preview render failed:",
        "string error",
      );
    });
  });
});
