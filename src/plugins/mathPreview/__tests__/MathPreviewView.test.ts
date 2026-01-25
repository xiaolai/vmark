/**
 * Math Preview View Mounting Tests
 *
 * Tests for mounting MathPreviewView inside editor container.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock KaTeX loader
vi.mock("@/plugins/latex/katexLoader", () => ({
  loadKatex: vi.fn(() =>
    Promise.resolve({
      default: {
        render: vi.fn((latex: string, el: HTMLElement) => {
          el.innerHTML = `<span class="katex">${latex}</span>`;
        }),
      },
    })
  ),
}));

// Import after mocking
import { MathPreviewView, getMathPreviewView } from "../MathPreviewView";

// Helper to create mock DOMRect
const createMockRect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
  top: 100,
  left: 50,
  bottom: 120,
  right: 200,
  width: 150,
  height: 20,
  x: 50,
  y: 100,
  toJSON: () => ({}),
  ...overrides,
});

// Helper to create editor container
function createEditorContainer(): HTMLElement {
  const container = document.createElement("div");
  container.className = "editor-container";
  container.style.position = "relative";
  container.getBoundingClientRect = () =>
    createMockRect({ top: 100, left: 50, bottom: 600, right: 800, width: 750, height: 500 });

  const editorDom = document.createElement("div");
  editorDom.className = "ProseMirror";
  editorDom.getBoundingClientRect = () =>
    createMockRect({ top: 100, left: 50, bottom: 600, right: 800, width: 750, height: 500 });
  container.appendChild(editorDom);

  document.body.appendChild(container);
  return container;
}

describe("MathPreviewView mounting", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("mounts inside editor-container when editorDom provided", () => {
    const view = new MathPreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("x^2", anchorRect, editorDom);

    const popup = container.querySelector(".math-preview-popup");
    expect(popup).not.toBeNull();
    expect(container.contains(popup)).toBe(true);

    view.destroy();
  });

  it("falls back to document.body when no editorDom", () => {
    const view = new MathPreviewView();

    view.show("x^2", anchorRect);

    const popup = document.querySelector(".math-preview-popup");
    expect(popup).not.toBeNull();
    expect(document.body.contains(popup)).toBe(true);

    view.destroy();
  });

  it("uses absolute positioning when mounted in editor-container", () => {
    const view = new MathPreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("x^2", anchorRect, editorDom);

    const popup = container.querySelector(".math-preview-popup") as HTMLElement;
    expect(popup.style.position).toBe("absolute");

    view.destroy();
  });

  it("uses fixed positioning when mounted in document.body", () => {
    const view = new MathPreviewView();

    view.show("x^2", anchorRect);

    const popup = document.querySelector(".math-preview-popup") as HTMLElement;
    expect(popup.style.position).toBe("fixed");

    view.destroy();
  });

  it("cleans up properly on destroy", () => {
    const view = new MathPreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("x^2", anchorRect, editorDom);
    expect(container.querySelector(".math-preview-popup")).not.toBeNull();

    view.destroy();
    expect(container.querySelector(".math-preview-popup")).toBeNull();
  });
});

describe("getMathPreviewView singleton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the same instance", () => {
    const view1 = getMathPreviewView();
    const view2 = getMathPreviewView();
    expect(view1).toBe(view2);
  });
});
