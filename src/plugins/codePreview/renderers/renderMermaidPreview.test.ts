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
import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { setupMermaidExport } from "@/plugins/mermaid/mermaidExport";
import { diagramWarn } from "@/utils/debug";
import { updateMermaidLivePreview, createMermaidPreviewWidget } from "./renderMermaidPreview";

describe("updateMermaidLivePreview", () => {
  beforeEach(() => {
    vi.mocked(renderMermaid).mockReset();
  });

  it("renders valid mermaid SVG into the element", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce("<svg>diagram</svg>");

    const element = document.createElement("div");
    const token = 1;
    await updateMermaidLivePreview(element, "graph TD; A-->B", token, () => token);

    expect(element.textContent).toContain("diagram");
  });

  it("shows error for invalid mermaid syntax", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce(null);

    const element = document.createElement("div");
    const token = 1;
    await updateMermaidLivePreview(element, "bad syntax", token, () => token);

    expect(element.textContent).toContain("Invalid syntax");
  });

  it("skips update when token is stale", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce("<svg>diagram</svg>");

    const element = document.createElement("div");
    const token = 1;
    await updateMermaidLivePreview(element, "graph TD", token, () => 2);

    // Element should NOT be updated because token changed
    expect(element.textContent).toBe("");
  });

  it("skips error display when token is stale on null result", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce(null);

    const element = document.createElement("div");
    const token = 1;
    await updateMermaidLivePreview(element, "bad", token, () => 2);

    expect(element.textContent).not.toContain("Invalid syntax");
  });
});

describe("createMermaidPreviewWidget", () => {
  beforeEach(() => {
    capturedFactory = null;
    vi.mocked(renderMermaid).mockReset();
    vi.mocked(diagramWarn).mockClear();
    vi.mocked(setupMermaidPanZoom).mockClear();
    vi.mocked(setupMermaidExport).mockClear();
  });

  it("creates placeholder element with correct class", () => {
    // Must provide a mock return so the .then() inside the factory doesn't throw
    vi.mocked(renderMermaid).mockResolvedValueOnce("<svg>ok</svg>");

    const cache = new Map();
    createMermaidPreviewWidget(10, "graph TD", "key", cache, vi.fn());

    expect(capturedFactory).not.toBeNull();
    const element = capturedFactory!(null);
    // Before the promise resolves, placeholder should have loading state
    expect(element.className).toContain("mermaid-preview");
    expect(element.className).toContain("mermaid-loading");
    expect(element.textContent).toBe("Rendering diagram...");
  });

  it("renders mermaid and updates element on success", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce("<svg>result</svg>");

    const cache = new Map();
    createMermaidPreviewWidget(10, "graph TD; A-->B", "key", cache, vi.fn());

    const element = capturedFactory!(null);

    await vi.waitFor(() => {
      expect(element.className).toBe("code-block-preview mermaid-preview");
    });

    expect(element.textContent).toContain("result");
    expect(cache.get("key")).toEqual({ rendered: "<svg>result</svg>" });
  });

  // Panzoom throws on elements that are not attached to the DOM, and
  // ProseMirror attaches a widget only AFTER its factory returns. The
  // cache-hit path (previewHelpers.createPreviewElement) already defers for
  // this reason; this path did not — see issue #1200.
  it("defers pan-zoom and export setup until after an animation frame", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce("<svg>result</svg>");
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });

    try {
      const cache = new Map();
      createMermaidPreviewWidget(10, "graph TD; A-->B", "key", cache, vi.fn());
      const element = capturedFactory!(null);

      await vi.waitFor(() => {
        expect(element.className).toBe("code-block-preview mermaid-preview");
      });

      // The SVG is painted immediately; only the enhancement is deferred.
      expect(element.textContent).toContain("result");
      expect(setupMermaidPanZoom).not.toHaveBeenCalled();
      expect(setupMermaidExport).not.toHaveBeenCalled();

      // ProseMirror attaches the widget, then the frame runs.
      document.body.appendChild(element);
      expect(frames).toHaveLength(1);
      frames[0]!(0);

      expect(setupMermaidPanZoom).toHaveBeenCalledWith(element);
      expect(setupMermaidExport).toHaveBeenCalledWith(element, "graph TD; A-->B");
      element.remove();
    } finally {
      rafSpy.mockRestore();
    }
  });

  // A widget can be replaced before its render promise settles. Calling
  // Panzoom on the orphan would throw inside the frame callback, where the
  // promise's .catch() can no longer see it — an unhandled error.
  it("skips enhancement when the element was detached before the frame ran", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce("<svg>result</svg>");
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });

    try {
      const cache = new Map();
      createMermaidPreviewWidget(10, "graph TD; A-->B", "key", cache, vi.fn());
      const element = capturedFactory!(null);

      await vi.waitFor(() => {
        expect(element.className).toBe("code-block-preview mermaid-preview");
      });

      // Never attached — the frame must be a no-op rather than throwing.
      expect(frames).toHaveLength(1);
      expect(() => frames[0]!(0)).not.toThrow();
      expect(setupMermaidPanZoom).not.toHaveBeenCalled();
      expect(setupMermaidExport).not.toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("shows error state when renderMermaid returns null", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce(null);

    const cache = new Map();
    createMermaidPreviewWidget(10, "bad", "key", cache, vi.fn());

    const element = capturedFactory!(null);

    await vi.waitFor(() => {
      expect(element.className).toContain("mermaid-error");
    });

    expect(element.textContent).toContain("Failed to render diagram");
  });

  it("does not set up pan-zoom on null render", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce(null);

    const cache = new Map();
    createMermaidPreviewWidget(10, "bad", "key", cache, vi.fn());

    capturedFactory!(null);

    await vi.waitFor(() => {
      expect(renderMermaid).toHaveBeenCalled();
    });

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(setupMermaidPanZoom).not.toHaveBeenCalled();
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

  it("logs non-Error objects in rejection path", async () => {
    vi.mocked(renderMermaid).mockRejectedValueOnce("string error");

    const cache = new Map();
    createMermaidPreviewWidget(10, "bad", "key", cache, vi.fn());

    capturedFactory!(null);

    await vi.waitFor(() => {
      expect(diagramWarn).toHaveBeenCalledWith(
        "Mermaid preview render failed:",
        "string error"
      );
    });
  });

  it("does not cache on render failure (null)", async () => {
    vi.mocked(renderMermaid).mockResolvedValueOnce(null);

    const cache = new Map();
    createMermaidPreviewWidget(10, "bad", "key", cache, vi.fn());

    capturedFactory!(null);

    await vi.waitFor(() => {
      expect(renderMermaid).toHaveBeenCalled();
    });

    expect(cache.has("key")).toBe(false);
  });

  it("does not cache on render rejection", async () => {
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("fail"));

    const cache = new Map();
    createMermaidPreviewWidget(10, "bad", "key", cache, vi.fn());

    capturedFactory!(null);

    await vi.waitFor(() => {
      expect(diagramWarn).toHaveBeenCalled();
    });

    expect(cache.has("key")).toBe(false);
  });
});
