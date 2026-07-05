/**
 * Tests for mermaidPreviewRender — render dispatch logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/plugins/mermaid", () => ({
  renderMermaid: vi.fn(),
}));

vi.mock("@/plugins/markmap", () => ({
  renderMarkmapToElement: vi.fn(),
}));

vi.mock("@/plugins/shared/diagramCleanup", () => ({
  cleanupDescendants: vi.fn(),
}));

vi.mock("@/plugins/svg/svgRender", () => ({
  renderSvgBlock: vi.fn(),
}));

vi.mock("@/plugins/graphviz", () => ({
  renderGraphviz: vi.fn(),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeSvg: vi.fn((svg: string) => svg),
}));

import { renderPreview, type RenderContext } from "../mermaidPreviewRender";
import { renderMermaid } from "@/plugins/mermaid";
import { renderGraphviz } from "@/plugins/graphviz";
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { renderMarkmapToElement } from "@/plugins/markmap";

function createContext(overrides: Partial<RenderContext> = {}): RenderContext {
  const ctx: RenderContext = {
    preview: document.createElement("div"),
    error: document.createElement("div"),
    currentLanguage: "mermaid",
    renderToken: 0,
    getCurrentToken: () => ctx.renderToken,
    applyZoom: vi.fn(),
    ...overrides,
  };
  return ctx;
}

describe("renderPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears preview and adds empty class for empty content", () => {
    const ctx = createContext();
    ctx.preview.innerHTML = "<div>old</div>";

    const token = renderPreview("", ctx);

    expect(ctx.preview.innerHTML).toBe("");
    expect(ctx.preview.classList.contains("mermaid-preview-empty")).toBe(true);
    // Token advances even for empty renders so pending async output goes stale.
    expect(token).toBe(1);
  });

  it("clears preview and adds empty class for whitespace-only content", () => {
    const ctx = createContext();

    renderPreview("   \n  ", ctx);

    expect(ctx.preview.innerHTML).toBe("");
    expect(ctx.preview.classList.contains("mermaid-preview-empty")).toBe(true);
  });

  it("clears error text on each call", () => {
    const ctx = createContext();
    ctx.error.textContent = "old error";

    renderPreview("", ctx);

    expect(ctx.error.textContent).toBe("");
  });

  it("removes empty class when content is provided", () => {
    const ctx = createContext();
    ctx.preview.classList.add("mermaid-preview-empty");
    vi.mocked(renderMermaid).mockResolvedValue("<svg></svg>");

    renderPreview("graph TD; A-->B", ctx);

    expect(ctx.preview.classList.contains("mermaid-preview-empty")).toBe(false);
  });

  describe("SVG language", () => {
    it("renders SVG synchronously when renderSvgBlock returns content", () => {
      const ctx = createContext({ currentLanguage: "svg" });
      vi.mocked(renderSvgBlock).mockReturnValue("<svg><rect/></svg>");

      const token = renderPreview("<svg><rect/></svg>", ctx);

      expect(renderSvgBlock).toHaveBeenCalledWith("<svg><rect/></svg>");
      expect(ctx.preview.innerHTML).toContain("<svg>");
      expect(ctx.preview.innerHTML).toContain("rect");
      expect(ctx.error.textContent).toBe("");
      expect(ctx.applyZoom).toHaveBeenCalled();
      // Token advances for sync renders too — a pending async render must
      // not be able to overwrite this output.
      expect(token).toBe(1);
    });

    it("shows error for invalid SVG", () => {
      const ctx = createContext({ currentLanguage: "svg" });
      vi.mocked(renderSvgBlock).mockReturnValue(null);

      renderPreview("not svg", ctx);

      expect(ctx.preview.innerHTML).toBe("");
      expect(ctx.preview.classList.contains("mermaid-preview-error-state")).toBe(true);
      expect(ctx.error.textContent).toBe("Invalid SVG");
    });
  });

  describe("Markmap language", () => {
    it("creates SVG element and calls renderMarkmapToElement", () => {
      const ctx = createContext({ currentLanguage: "markmap" });
      vi.mocked(renderMarkmapToElement).mockResolvedValue({} as never);

      const token = renderPreview("# Hello", ctx);

      expect(renderMarkmapToElement).toHaveBeenCalled();
      const svgEl = ctx.preview.querySelector("svg");
      expect(svgEl).not.toBeNull();
      expect(token).toBe(1); // Token incremented for async render
    });

    it("shows error for null markmap result", async () => {
      const ctx = createContext({ currentLanguage: "markmap" });
      vi.mocked(renderMarkmapToElement).mockResolvedValue(null as never);

      renderPreview("# Hello", ctx);

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("Invalid markmap syntax");
      });
      expect(ctx.preview.classList.contains("mermaid-preview-error-state")).toBe(true);
    });

    it("shows error on markmap render failure", async () => {
      const ctx = createContext({ currentLanguage: "markmap" });
      vi.mocked(renderMarkmapToElement).mockRejectedValue(new Error("markmap failed"));

      renderPreview("# Hello", ctx);

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("Preview failed");
      });
      expect(ctx.preview.classList.contains("mermaid-preview-error-state")).toBe(true);
    });

    it("discards stale markmap render", async () => {
      let liveToken = 0;
      const ctx = createContext({
        currentLanguage: "markmap",
        getCurrentToken: () => liveToken,
      });
      vi.mocked(renderMarkmapToElement).mockResolvedValue({} as never);

      const token = renderPreview("# Hello", ctx);
      liveToken = token;

      // Simulate newer render (token advanced)
      liveToken = token + 1;

      await vi.waitFor(() => {
        // Stale render should not update error text
        expect(ctx.error.textContent).toBe("");
      });
    });

    it("discards stale markmap error", async () => {
      let liveToken = 0;
      const ctx = createContext({
        currentLanguage: "markmap",
        getCurrentToken: () => liveToken,
      });
      vi.mocked(renderMarkmapToElement).mockRejectedValue(new Error("fail"));

      const token = renderPreview("# Hello", ctx);
      liveToken = token;

      // Advance token so the error callback is stale
      liveToken = token + 1;

      await vi.waitFor(() => {
        // Should not set "Preview failed" because it's stale
        expect(ctx.error.textContent).toBe("");
      });
    });

    it("shows error on markmap render with non-Error rejection", async () => {
      const ctx = createContext({ currentLanguage: "markmap" });
      vi.mocked(renderMarkmapToElement).mockRejectedValue("string error");

      renderPreview("# Hello", ctx);

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("Preview failed");
      });
    });
  });

  describe.each(["dot", "graphviz"])("Graphviz language (%s)", (lang) => {
    it("increments render token and shows loading state", () => {
      vi.mocked(renderGraphviz).mockResolvedValue("<svg>gv</svg>");
      const ctx = createContext({ currentLanguage: lang });

      const token = renderPreview("digraph { a -> b }", ctx);

      expect(token).toBe(1);
      expect(ctx.preview.querySelector(".mermaid-preview-loading")).not.toBeNull();
      expect(renderGraphviz).toHaveBeenCalledWith("digraph { a -> b }");
    });

    it("renders graphviz SVG on success", async () => {
      vi.mocked(renderGraphviz).mockResolvedValue("<svg>gv</svg>");
      const ctx = createContext({ currentLanguage: lang });

      ctx.renderToken = renderPreview("digraph { a }", ctx);
      await vi.waitFor(() => {
        expect(ctx.preview.innerHTML).toContain("gv");
      });
      expect(ctx.error.textContent).toBe("");
      expect(ctx.applyZoom).toHaveBeenCalled();
    });

    it("shows error for null graphviz result", async () => {
      vi.mocked(renderGraphviz).mockResolvedValue(null);
      const ctx = createContext({ currentLanguage: lang });

      ctx.renderToken = renderPreview("digraph {", ctx);
      await vi.waitFor(() => {
        expect(ctx.preview.classList.contains("mermaid-preview-error-state")).toBe(true);
      });
      expect(ctx.error.textContent).not.toBe("");
    });

    it("shows error on graphviz render rejection", async () => {
      vi.mocked(renderGraphviz).mockRejectedValue(new Error("boom"));
      const ctx = createContext({ currentLanguage: lang });

      ctx.renderToken = renderPreview("digraph { a }", ctx);
      await vi.waitFor(() => {
        expect(ctx.preview.classList.contains("mermaid-preview-error-state")).toBe(true);
      });
    });

    it("discards stale graphviz render", async () => {
      vi.mocked(renderGraphviz).mockResolvedValue("<svg>stale</svg>");
      const ctx = createContext({ currentLanguage: lang, getCurrentToken: () => 99 });

      renderPreview("digraph { a }", ctx);
      await new Promise((r) => setTimeout(r, 0));

      expect(ctx.preview.innerHTML).not.toContain("stale");
    });
  });

  describe("Mermaid language", () => {
    it("increments render token for async render", () => {
      const ctx = createContext({ renderToken: 5 });
      vi.mocked(renderMermaid).mockResolvedValue("<svg></svg>");

      const token = renderPreview("graph TD; A-->B", ctx);

      expect(token).toBe(6);
    });

    it("shows loading state while rendering", () => {
      const ctx = createContext();
      vi.mocked(renderMermaid).mockResolvedValue("<svg></svg>");

      renderPreview("graph TD; A-->B", ctx);

      // Resolved via i18n key editor:preview.rendering — uses unicode ellipsis
      expect(ctx.preview.textContent).toContain("Rendering…");
    });

    it("renders mermaid SVG on success", async () => {
      const ctx = createContext();
      vi.mocked(renderMermaid).mockResolvedValue("<svg>diagram</svg>");

      renderPreview("graph TD; A-->B", ctx);

      await vi.waitFor(() => {
        expect(ctx.preview.innerHTML).toBe("<svg>diagram</svg>");
      });
      expect(ctx.applyZoom).toHaveBeenCalled();
    });

    it("shows error for null mermaid result", async () => {
      const ctx = createContext();
      vi.mocked(renderMermaid).mockResolvedValue(null);

      renderPreview("invalid mermaid", ctx);

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("Invalid mermaid syntax");
      });
      expect(ctx.preview.classList.contains("mermaid-preview-error-state")).toBe(true);
    });

    it("shows error on mermaid render failure", async () => {
      const ctx = createContext();
      vi.mocked(renderMermaid).mockRejectedValue(new Error("render failed"));

      renderPreview("graph TD; A-->B", ctx);

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("Preview failed");
      });
    });

    it("shows error on mermaid render failure with non-Error object", async () => {
      const ctx = createContext();
      vi.mocked(renderMermaid).mockRejectedValue("string error");

      renderPreview("graph TD; A-->B", ctx);

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("Preview failed");
      });
    });

    it("discards stale mermaid error", async () => {
      let liveToken = 0;
      const ctx = createContext({
        getCurrentToken: () => liveToken,
      });
      vi.mocked(renderMermaid).mockRejectedValue(new Error("fail"));

      const token = renderPreview("graph TD; A-->B", ctx);
      liveToken = token;

      // Advance token
      liveToken = token + 1;

      await vi.waitFor(() => {
        expect(ctx.error.textContent).toBe("");
      });
    });

    it("advances the token on an EMPTY request so a pending async render cannot paint over it", async () => {
      // Audit finding: the empty branch returned the old token, so a pending
      // mermaid render still saw currentToken === getCurrentToken() and
      // overwrote the newer empty state.
      let resolveRender!: (svg: string | null) => void;
      vi.mocked(renderMermaid).mockImplementation(
        () => new Promise((resolve) => { resolveRender = resolve; }),
      );
      const ctx = createContext();

      renderPreview("graph TD; A-->B", ctx); // async render pending
      const emptyToken = renderPreview("", ctx); // newer request: empty state

      expect(emptyToken).toBeGreaterThan(1);
      resolveRender("<svg>stale</svg>");
      await new Promise((r) => setTimeout(r, 0));

      expect(ctx.preview.innerHTML).toBe("");
      expect(ctx.preview.classList.contains("mermaid-preview-empty")).toBe(true);
    });

    it("advances the token on a SYNC SVG request so a pending async render cannot paint over it", async () => {
      let resolveRender!: (svg: string | null) => void;
      vi.mocked(renderMermaid).mockImplementation(
        () => new Promise((resolve) => { resolveRender = resolve; }),
      );
      vi.mocked(renderSvgBlock).mockReturnValue("<svg>fresh</svg>");
      const ctx = createContext({ currentLanguage: "mermaid" });

      renderPreview("graph TD; A-->B", ctx); // async render pending
      ctx.currentLanguage = "svg";
      renderPreview("<svg>fresh</svg>", ctx); // newer request: sync SVG

      expect(ctx.preview.innerHTML).toBe("<svg>fresh</svg>");
      resolveRender("<svg>stale</svg>");
      await new Promise((r) => setTimeout(r, 0));

      expect(ctx.preview.innerHTML).toBe("<svg>fresh</svg>");
    });

    it("discards stale render when getCurrentToken returns a newer token", async () => {
      // Simulate the class pattern: getCurrentToken reads live state
      let liveToken = 0;
      const ctx = createContext({
        getCurrentToken: () => liveToken,
      });
      vi.mocked(renderMermaid).mockResolvedValue("<svg>stale</svg>");

      const token1 = renderPreview("graph TD; A-->B", ctx);
      liveToken = token1;

      // Simulate a second render before the first resolves
      liveToken = token1 + 1; // Owner advances the token

      await vi.waitFor(() => {
        // The stale render should NOT have updated the preview
        expect(ctx.preview.innerHTML).not.toBe("<svg>stale</svg>");
      });
    });
  });
});
