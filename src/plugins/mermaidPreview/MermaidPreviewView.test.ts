/**
 * Tests for MermaidPreviewView — floating Mermaid diagram preview.
 *
 * Covers:
 *   - Constructor, buildContainer elements
 *   - show/hide/isVisible lifecycle
 *   - updatePosition (no-op after drag)
 *   - updateContent (mermaid debounce, SVG immediate)
 *   - Zoom controls (in, out, clamping)
 *   - Drag and resize state
 *   - destroy cleanup
 *   - getMermaidPreviewView singleton
 */

vi.mock("@/plugins/shared/diagramCleanup", () => ({
  cleanupDescendants: vi.fn(),
}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 50, left: 100 })),
  getBoundaryRects: vi.fn(() => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  })),
  getViewportBounds: vi.fn(() => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  })),
}));

vi.mock("@/plugins/shared/popupHostDom", () => ({
  getPopupHostForDom: vi.fn(() => null),
  toHostCoordsForDom: vi.fn(
    (_host: unknown, pos: { top: number; left: number }) => pos
  ),
}));

const mockRenderPreview = vi.fn(() => 1);
vi.mock("./mermaidPreviewRender", () => ({
  renderPreview: (...args: unknown[]) => mockRenderPreview(...args),
}));

vi.mock("./mermaidPreviewDOM", () => ({
  buildContainer: vi.fn(() => {
    const container = document.createElement("div");
    container.className = "mermaid-preview";

    const header = document.createElement("div");
    header.className = "mermaid-preview-header";
    container.appendChild(header);

    const zoomControls = document.createElement("div");
    zoomControls.className = "mermaid-preview-zoom";
    const zoomIn = document.createElement("button");
    zoomIn.className = "mermaid-preview-zoom-btn";
    zoomIn.dataset.action = "in";
    const zoomOut = document.createElement("button");
    zoomOut.className = "mermaid-preview-zoom-btn";
    zoomOut.dataset.action = "out";
    const zoomValue = document.createElement("span");
    zoomValue.className = "mermaid-preview-zoom-value";
    zoomValue.textContent = "100%";
    zoomControls.appendChild(zoomOut);
    zoomControls.appendChild(zoomValue);
    zoomControls.appendChild(zoomIn);
    header.appendChild(zoomControls);

    const content = document.createElement("div");
    content.className = "mermaid-preview-content";
    container.appendChild(content);

    const error = document.createElement("div");
    error.className = "mermaid-preview-error";
    container.appendChild(error);

    // Resize handles
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = document.createElement("div");
      handle.className = "mermaid-preview-resize";
      handle.dataset.corner = corner;
      container.appendChild(handle);
    }

    return container;
  }),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MermaidPreviewView, getMermaidPreviewView } from "./MermaidPreviewView";

const ANCHOR = { top: 100, left: 200, bottom: 120, right: 250 };

describe("MermaidPreviewView", () => {
  let preview: MermaidPreviewView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    preview = new MermaidPreviewView();
  });

  afterEach(() => {
    preview.destroy();
    vi.useRealTimers();
  });

  it("starts hidden", () => {
    expect(preview.isVisible()).toBe(false);
  });

  it("becomes visible after show()", () => {
    preview.show("graph LR; A-->B", ANCHOR);
    expect(preview.isVisible()).toBe(true);
  });

  it("calls renderPreview on show", () => {
    preview.show("graph LR; A-->B", ANCHOR);
    expect(mockRenderPreview).toHaveBeenCalled();
  });

  it("hides and resets state", () => {
    preview.show("graph LR; A-->B", ANCHOR);
    preview.hide();
    expect(preview.isVisible()).toBe(false);
  });

  it("debounces mermaid updateContent", () => {
    preview.show("graph LR; A-->B", ANCHOR);
    mockRenderPreview.mockClear();

    preview.updateContent("graph LR; A-->C");
    expect(mockRenderPreview).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(mockRenderPreview).toHaveBeenCalled();
  });

  it("renders SVG content immediately without debounce", () => {
    preview.show("<svg></svg>", ANCHOR, undefined, "svg");
    mockRenderPreview.mockClear();

    preview.updateContent("<svg><rect/></svg>", "svg");
    // SVG should render immediately
    expect(mockRenderPreview).toHaveBeenCalled();
  });

  it("updatePosition is no-op after drag", () => {
    preview.show("graph LR; A-->B", ANCHOR);

    // Simulate drag via header mousedown + mousemove > 5px
    const header = document.querySelector(".mermaid-preview-header") as HTMLElement;
    const mousedown = new MouseEvent("mousedown", { clientX: 100, clientY: 100, bubbles: true });
    header.dispatchEvent(mousedown);

    const mousemove = new MouseEvent("mousemove", { clientX: 200, clientY: 200, bubbles: true });
    document.dispatchEvent(mousemove);

    const mouseup = new MouseEvent("mouseup", { bubbles: true });
    document.dispatchEvent(mouseup);

    // After dragging, updatePosition should be a no-op
    const container = document.querySelector(".mermaid-preview") as HTMLElement;
    const topBefore = container?.style.top;
    preview.updatePosition(ANCHOR);
    expect(container?.style.top).toBe(topBefore);
  });

  it("destroy removes event listeners", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    preview.destroy();
    // Should remove mousemove and mouseup for both drag and resize
    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("destroy clears debounce timer", () => {
    preview.show("graph LR; A-->B", ANCHOR);
    preview.updateContent("graph LR; A-->C");
    // Timer is pending — destroy should clear it
    preview.destroy();
    mockRenderPreview.mockClear();
    vi.advanceTimersByTime(500);
    expect(mockRenderPreview).not.toHaveBeenCalled();
  });

  it("zoom buttons change zoom level", () => {
    preview.show("graph LR; A-->B", ANCHOR);
    const zoomControls = document.querySelector(".mermaid-preview-zoom") as HTMLElement;
    const zoomIn = zoomControls.querySelector('[data-action="in"]') as HTMLElement;
    const zoomOut = zoomControls.querySelector('[data-action="out"]') as HTMLElement;
    const zoomValue = document.querySelector(".mermaid-preview-zoom-value") as HTMLElement;

    // Click zoom in
    zoomIn.click();
    expect(zoomValue.textContent).toBe("110%");

    // Click zoom out
    zoomOut.click();
    expect(zoomValue.textContent).toBe("100%");
  });
});

describe("getMermaidPreviewView", () => {
  it("returns singleton instance", () => {
    const a = getMermaidPreviewView();
    const b = getMermaidPreviewView();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: setupResizeHandlers onMouseDown guard (line 126)
// applyZoom with SVG (lines 231-249)
// destroy with bound handlers (lines 345-346)
// ---------------------------------------------------------------------------

describe("MermaidPreviewView — resize onMouseDown no-op on non-handle target", () => {
  let preview2: MermaidPreviewView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    preview2 = new MermaidPreviewView();
  });

  afterEach(() => {
    preview2.destroy();
    vi.useRealTimers();
  });

  it("returns early when mousedown target is not a resize handle (line 126)", () => {
    preview2.show("graph LR; A-->B", ANCHOR);
    const container = document.querySelector(".mermaid-preview") as HTMLElement;

    // Fire mousedown on a non-handle element (the container itself)
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    // target.closest('.mermaid-preview-resize') returns null for container
    container.dispatchEvent(event);

    // isResizing should remain false (early return fired)
    const internal = preview2 as unknown as { isResizing: boolean };
    expect(internal.isResizing).toBe(false);
  });

  it("actually begins resizing when mousedown fires on a resize handle", () => {
    preview2.show("graph LR; A-->B", ANCHOR);
    const handle = document.querySelector(".mermaid-preview-resize") as HTMLElement;
    expect(handle).not.toBeNull();

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 400,
    });
    handle.dispatchEvent(event);

    const internal = preview2 as unknown as { isResizing: boolean };
    expect(internal.isResizing).toBe(true);
  });

  it("boundResizeUp sets isResizing=false when called while resizing", () => {
    preview2.show("graph LR; A-->B", ANCHOR);
    const handle = document.querySelector(".mermaid-preview-resize") as HTMLElement;

    // Start resize
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const internal = preview2 as unknown as { isResizing: boolean };
    expect(internal.isResizing).toBe(true);

    // Fire mouseup to end resize
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(internal.isResizing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: drag/resize with empty style values (lines 93-94, 134-135)
// parseInt("") returns NaN, so the || 0 fallback is exercised
// ---------------------------------------------------------------------------

describe("MermaidPreviewView — drag with no initial style position", () => {
  let preview4: MermaidPreviewView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    preview4 = new MermaidPreviewView();
  });

  afterEach(() => {
    preview4.destroy();
    vi.useRealTimers();
  });

  it("drag start defaults left/top to 0 when style values are empty (lines 93-94)", () => {
    preview4.show("graph LR; A-->B", ANCHOR);
    const container = document.querySelector(".mermaid-preview") as HTMLElement;

    // Ensure container has no left/top style set (parseInt("") → NaN → || 0)
    container.style.left = "";
    container.style.top = "";

    const header = document.querySelector(".mermaid-preview-header") as HTMLElement;
    header.dispatchEvent(new MouseEvent("mousedown", { clientX: 50, clientY: 50, bubbles: true }));

    // Move to trigger drag
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 70, clientY: 70, bubbles: true }));

    // Container should be positioned relative to 0,0 start + delta
    expect(container.style.left).toBe("20px");
    expect(container.style.top).toBe("20px");

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  it("resize start defaults left/top to 0 when style values are empty (lines 134-135)", () => {
    preview4.show("graph LR; A-->B", ANCHOR);
    const container = document.querySelector(".mermaid-preview") as HTMLElement;

    // Clear style positions
    container.style.left = "";
    container.style.top = "";

    const handle = document.querySelector(".mermaid-preview-resize") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 300, bubbles: true, cancelable: true }));

    const internal = preview4 as unknown as { resizeStartLeft: number; resizeStartTop: number };
    expect(internal.resizeStartLeft).toBe(0);
    expect(internal.resizeStartTop).toBe(0);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: resize from "w" and "n" corners (lines 156, 165)
// ---------------------------------------------------------------------------

describe("MermaidPreviewView — resize from west and north corners", () => {
  let preview5: MermaidPreviewView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    preview5 = new MermaidPreviewView();
  });

  afterEach(() => {
    preview5.destroy();
    vi.useRealTimers();
  });

  it("resizes from west (w) corner adjusting left and width (line 156)", () => {
    preview5.show("graph LR; A-->B", ANCHOR);
    const container = document.querySelector(".mermaid-preview") as HTMLElement;

    // Find a resize handle and override its corner to "w"
    const handles = container.querySelectorAll(".mermaid-preview-resize");
    const handle = handles[0] as HTMLElement;
    handle.dataset.corner = "w";

    container.style.left = "100px";
    container.style.width = "400px";

    // Mock offsetWidth for resize calculations
    Object.defineProperty(container, "offsetWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 300, configurable: true });

    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 200, bubbles: true, cancelable: true }));

    // Drag left (decreasing clientX → expanding west)
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 200, bubbles: true }));

    // Width should increase (moved 50px left), left should decrease
    expect(parseInt(container.style.width)).toBeGreaterThanOrEqual(400);
    expect(parseInt(container.style.left)).toBeLessThanOrEqual(100);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  it("resizes from north (n) corner adjusting top and height (line 165)", () => {
    preview5.show("graph LR; A-->B", ANCHOR);
    const container = document.querySelector(".mermaid-preview") as HTMLElement;

    const handles = container.querySelectorAll(".mermaid-preview-resize");
    const handle = handles[0] as HTMLElement;
    handle.dataset.corner = "n";

    container.style.top = "200px";
    container.style.height = "400px";

    Object.defineProperty(container, "offsetWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 400, configurable: true });

    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true, cancelable: true }));

    // Drag up (decreasing clientY → expanding north)
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 150, bubbles: true }));

    // Height should increase, top should decrease
    expect(parseInt(container.style.height)).toBeGreaterThanOrEqual(400);
    expect(parseInt(container.style.top)).toBeLessThanOrEqual(200);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  it("resizes from nw corner adjusting both top/left and width/height", () => {
    preview5.show("graph LR; A-->B", ANCHOR);
    const container = document.querySelector(".mermaid-preview") as HTMLElement;

    const handles = container.querySelectorAll(".mermaid-preview-resize");
    const handle = handles[0] as HTMLElement;
    handle.dataset.corner = "nw";

    container.style.left = "100px";
    container.style.top = "100px";

    Object.defineProperty(container, "offsetWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 300, configurable: true });

    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, bubbles: true, cancelable: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50, bubbles: true }));

    // Both dimensions should change
    expect(parseInt(container.style.width)).toBeGreaterThanOrEqual(400);
    expect(parseInt(container.style.height)).toBeGreaterThanOrEqual(300);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: updatePosition with host === null (line 294)
// ---------------------------------------------------------------------------

describe("MermaidPreviewView — updatePosition host fallback (line 294)", () => {
  let preview6: MermaidPreviewView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    preview6 = new MermaidPreviewView();
  });

  afterEach(() => {
    preview6.destroy();
    vi.useRealTimers();
  });

  it("uses document.body when this.host is null (line 294)", () => {
    // Show without editorDom to leave host as document.body
    preview6.show("graph LR; A-->B", ANCHOR);

    // Force host to null after show to exercise the ?? fallback
    const internal = preview6 as unknown as { host: HTMLElement | null; hasDragged: boolean };
    internal.host = null;
    internal.hasDragged = false; // Ensure updatePosition doesn't short-circuit

    // This should use document.body fallback at line 294
    preview6.updatePosition(ANCHOR);

    // No error means the fallback worked
    expect(preview6.isVisible()).toBe(true);
  });
});

describe("MermaidPreviewView — applyZoom with SVG (lines 231-249)", () => {
  let preview3: MermaidPreviewView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    preview3 = new MermaidPreviewView();
  });

  afterEach(() => {
    preview3.destroy();
    vi.useRealTimers();
  });

  it("applyZoom reads SVG width/height attributes and applies zoom scale", () => {
    preview3.show("graph LR; A-->B", ANCHOR);
    const previewContent = document.querySelector(".mermaid-preview-content") as HTMLElement;

    // Inject an SVG with width/height attributes
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "400");
    svg.setAttribute("height", "300");
    previewContent.appendChild(svg);

    // Trigger applyZoom via zoom in button
    const zoomIn = document.querySelector('[data-action="in"]') as HTMLElement;
    zoomIn.click();

    // After zoom in (110%), width should be 400 * 1.1 = 440
    expect(parseFloat(svg.style.width)).toBeCloseTo(440, 0);
    expect(parseFloat(svg.style.height)).toBeCloseTo(330, 0);
  });

  it("applyZoom uses viewBox when width/height are 0 (lines 235-240)", () => {
    preview3.show("graph LR; A-->B", ANCHOR);
    const previewContent = document.querySelector(".mermaid-preview-content") as HTMLElement;

    // SVG with no width/height but with viewBox
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 600 200");
    // No width/height attributes — parseFloat returns NaN → treated as 0
    previewContent.appendChild(svg);

    const zoomIn = document.querySelector('[data-action="in"]') as HTMLElement;
    zoomIn.click();

    // viewBox dimensions: 600 x 200, zoom 110%
    expect(parseFloat(svg.style.width)).toBeCloseTo(660, 0);
    expect(parseFloat(svg.style.height)).toBeCloseTo(220, 0);
  });

  it("stores original dimensions on first applyZoom call (lines 244-247)", () => {
    preview3.show("graph LR; A-->B", ANCHOR);
    const previewContent = document.querySelector(".mermaid-preview-content") as HTMLElement;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "500");
    svg.setAttribute("height", "250");
    previewContent.appendChild(svg);

    // First zoom: stores originalWidth/originalHeight
    const zoomIn = document.querySelector('[data-action="in"]') as HTMLElement;
    zoomIn.click();

    expect(svg.dataset.originalWidth).toBe("500");
    expect(svg.dataset.originalHeight).toBe("250");

    // Second zoom: uses stored dimensions
    zoomIn.click();
    // Now at 120%, using stored 500 -> 500 * 1.2 = 600
    expect(svg.style.width).toBe("600px");
  });

  it("uses fallback dimensions (400/300) when SVG has no size info (line 249)", () => {
    preview3.show("graph LR; A-->B", ANCHOR);
    const previewContent = document.querySelector(".mermaid-preview-content") as HTMLElement;

    // SVG with neither width/height nor viewBox
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    previewContent.appendChild(svg);

    const zoomIn = document.querySelector('[data-action="in"]') as HTMLElement;
    zoomIn.click();

    // Fallback: 400 * 1.1 = 440, 300 * 1.1 = 330
    expect(parseFloat(svg.style.width)).toBeCloseTo(440, 0);
    expect(parseFloat(svg.style.height)).toBeCloseTo(330, 0);
  });
});

describe("MermaidPreviewView — destroy clears boundResizeMove/Up (lines 345-346)", () => {
  it("destroy sets boundResizeMove and boundResizeUp to null", () => {
    vi.useFakeTimers();
    const fresh = new MermaidPreviewView();
    // Both handlers should be set after construction
    const internal = fresh as unknown as {
      boundResizeMove: ((e: MouseEvent) => void) | null;
      boundResizeUp: (() => void) | null;
    };
    expect(internal.boundResizeMove).not.toBeNull();
    expect(internal.boundResizeUp).not.toBeNull();

    // destroy() should set both to null (lines 364-370)
    fresh.destroy();

    expect(internal.boundResizeMove).toBeNull();
    expect(internal.boundResizeUp).toBeNull();
    vi.useRealTimers();
  });
});
