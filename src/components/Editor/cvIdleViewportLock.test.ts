// WI: #1340 — toggling `.cv-idle` (content-visibility, #823) must not move
// what the reader sees. jsdom has no layout, so every rect is mocked: block
// rects are keyed on the container's live class list, which is exactly how a
// real engine behaves — the class flip changes the geometry the next
// getBoundingClientRect reports.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCvIdlePreservingViewport } from "./cvIdleViewportLock";

interface RectSpec {
  top: number;
  bottom: number;
}

function mockRect(el: Element, spec: () => RectSpec): void {
  el.getBoundingClientRect = () => {
    const { top, bottom } = spec();
    return {
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function buildEditorDom(blockCount: number) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const container = document.createElement("div");
  container.className = "tiptap-editor cv-idle";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  const blocks: HTMLElement[] = [];
  for (let i = 0; i < blockCount; i += 1) {
    const p = document.createElement("p");
    pm.appendChild(p);
    blocks.push(p);
  }
  container.appendChild(pm);
  scroller.appendChild(container);
  document.body.appendChild(scroller);

  const writes: number[] = [];
  let scrollTop = 500;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
      writes.push(v);
    },
  });
  mockRect(scroller, () => ({ top: 0, bottom: 800 }));
  return { scroller, container, blocks, writes };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("setCvIdlePreservingViewport", () => {
  it("compensates a downward shift when removing cv-idle (real heights exceed estimates)", () => {
    const { scroller, container, blocks } = buildEditorDom(1);
    // With cv-idle on, off-screen estimates keep the anchor at 10; removing
    // the class realizes true heights above it and pushes it down to 50.
    mockRect(blocks[0], () =>
      container.classList.contains("cv-idle") ? { top: 10, bottom: 40 } : { top: 50, bottom: 80 },
    );

    setCvIdlePreservingViewport(container, false);

    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(scroller.scrollTop).toBe(540);
  });

  it("compensates an upward shift with a negative delta", () => {
    const { scroller, container, blocks } = buildEditorDom(1);
    mockRect(blocks[0], () =>
      container.classList.contains("cv-idle") ? { top: 50, bottom: 80 } : { top: 10, bottom: 40 },
    );

    setCvIdlePreservingViewport(container, false);

    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(scroller.scrollTop).toBe(460);
  });

  it("compensates symmetrically when re-adding the class", () => {
    const { scroller, container, blocks } = buildEditorDom(1);
    container.classList.remove("cv-idle");
    mockRect(blocks[0], () =>
      container.classList.contains("cv-idle") ? { top: 10, bottom: 40 } : { top: 50, bottom: 80 },
    );

    setCvIdlePreservingViewport(container, true);

    expect(container.classList.contains("cv-idle")).toBe(true);
    expect(scroller.scrollTop).toBe(460);
  });

  it("anchors on the first block intersecting the viewport, skipping blocks fully above it", () => {
    const { scroller, container, blocks } = buildEditorDom(3);
    // Scroller top edge sits at 100 — anchor selection must compare against
    // the scroller's own rect, not viewport 0.
    mockRect(scroller, () => ({ top: 100, bottom: 900 }));
    // Fully above the viewport (bottom <= scroller top): never the anchor,
    // and its post-toggle shift must not leak into the compensation.
    mockRect(blocks[0], () =>
      container.classList.contains("cv-idle") ? { top: 20, bottom: 90 } : { top: 220, bottom: 290 },
    );
    // First block whose bottom clears the scroller top: the anchor.
    mockRect(blocks[1], () =>
      container.classList.contains("cv-idle") ? { top: 90, bottom: 150 } : { top: 115, bottom: 175 },
    );
    // Below the anchor: the early-exit loop must never measure it.
    const belowRect = vi.fn(() => ({ top: 150, bottom: 300 }));
    mockRect(blocks[2], belowRect);

    setCvIdlePreservingViewport(container, false);

    expect(scroller.scrollTop).toBe(525); // 500 + (115 - 90)
    expect(belowRect).not.toHaveBeenCalled();
  });

  it("leaves scrollTop untouched when the toggle does not move the anchor", () => {
    const { container, blocks, writes } = buildEditorDom(1);
    mockRect(blocks[0], () => ({ top: 10, bottom: 40 }));

    setCvIdlePreservingViewport(container, false);

    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(writes).toEqual([]);
  });

  it("still toggles the class when the document has no blocks", () => {
    const { container, writes } = buildEditorDom(0);

    setCvIdlePreservingViewport(container, false);

    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(writes).toEqual([]);
  });

  it("still toggles the class when every block sits above the viewport", () => {
    const { container, blocks, writes } = buildEditorDom(1);
    mockRect(blocks[0], () => ({ top: -90, bottom: -20 }));

    setCvIdlePreservingViewport(container, false);

    expect(container.classList.contains("cv-idle")).toBe(false);
    expect(writes).toEqual([]);
  });

  it("still toggles the class when detached from any scroll container", () => {
    const container = document.createElement("div");
    container.className = "tiptap-editor cv-idle";
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    pm.appendChild(document.createElement("p"));
    container.appendChild(pm);

    expect(() => setCvIdlePreservingViewport(container, false)).not.toThrow();
    expect(container.classList.contains("cv-idle")).toBe(false);
  });
});
