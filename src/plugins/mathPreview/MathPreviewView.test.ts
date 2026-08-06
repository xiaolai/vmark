import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MathPreviewView, getMathPreviewView } from "./MathPreviewView";

// Mock KaTeX loader — allow per-test override via mockLoadKatex
const mockLoadKatex = vi.fn(() =>
  Promise.resolve({
    default: {
      render: vi.fn((content: string, element: HTMLElement, options: { throwOnError?: boolean }) => {
        if (options?.throwOnError && content === "\\invalid") {
          throw new Error("Unknown macro: \\invalid");
        }
        element.innerHTML = `<span class="katex">${content}</span>`;
      }),
    },
  })
);

vi.mock("@/plugins/latex/katexLoader", () => ({
  loadKatex: (...args: unknown[]) => mockLoadKatex(...args),
}));

// Mock popup position utils
vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 100, left: 200 })),
  getBoundaryRects: vi.fn(() => ({ top: 0, left: 0, bottom: 800, right: 1200 })),
  getViewportBounds: vi.fn(() => ({ top: 0, left: 0, bottom: 800, right: 1200 })),
}));

// Mock sourcePopup utils — allow per-test override of getPopupHostForDom
const mockGetPopupHostForDom = vi.fn(() => null);
vi.mock("@/plugins/shared/popupHostDom", () => ({
  getPopupHostForDom: (...args: unknown[]) => mockGetPopupHostForDom(...args),
  toHostCoordsForDom: vi.fn((_host: unknown, pos: { top: number; left: number }) => pos),
}));

// Mock latexErrorParser
vi.mock("@/plugins/latex/latexErrorParser", () => ({
  parseLatexError: vi.fn((_e: unknown, _content: string) => ({
    message: "Invalid LaTeX",
    hint: "some hint",
  })),
}));

// Mock renderWarn
vi.mock("@/utils/debug", () => ({
  renderWarn: vi.fn(),
}));

describe("MathPreviewView", () => {
  let view: MathPreviewView;

  beforeEach(() => {
    view = new MathPreviewView();
  });

  afterEach(() => {
    view.destroy();
    // Clean up any leftover popup containers from tests
    document.querySelectorAll(".math-preview-popup").forEach((el) => el.remove());
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("creates container with correct structure", () => {
      // Access internal container via show() side effect
      const anchorRect = { top: 50, left: 100, bottom: 70, right: 200 };
      view.show("x+y", anchorRect);

      const container = document.querySelector(".math-preview-popup");
      expect(container).not.toBeNull();
      expect(container?.querySelector(".math-preview-content")).not.toBeNull();
      expect(container?.querySelector(".math-preview-error")).not.toBeNull();
    });
  });

  describe("show", () => {
    it("makes popup visible", () => {
      expect(view.isVisible()).toBe(false);

      view.show("x+y", { top: 50, left: 100, bottom: 70, right: 200 });

      expect(view.isVisible()).toBe(true);
    });

    it("appends container to document.body by default", () => {
      view.show("x+y", { top: 50, left: 100, bottom: 70, right: 200 });

      const container = document.body.querySelector(".math-preview-popup");
      expect(container).not.toBeNull();
    });

    it("sets container display to block", () => {
      view.show("x+y", { top: 50, left: 100, bottom: 70, right: 200 });

      const container = document.querySelector(".math-preview-popup") as HTMLElement;
      expect(container.style.display).toBe("block");
    });
  });

  describe("hide", () => {
    it("hides the popup", () => {
      view.show("x+y", { top: 50, left: 100, bottom: 70, right: 200 });
      expect(view.isVisible()).toBe(true);

      view.hide();

      expect(view.isVisible()).toBe(false);
    });

    it("sets container display to none", () => {
      view.show("x+y", { top: 50, left: 100, bottom: 70, right: 200 });
      view.hide();

      const container = document.querySelector(".math-preview-popup") as HTMLElement;
      expect(container.style.display).toBe("none");
    });
  });

  describe("isVisible", () => {
    it("returns false initially", () => {
      expect(view.isVisible()).toBe(false);
    });

    it("returns true after show", () => {
      view.show("x", { top: 0, left: 0, bottom: 0, right: 0 });
      expect(view.isVisible()).toBe(true);
    });

    it("returns false after hide", () => {
      view.show("x", { top: 0, left: 0, bottom: 0, right: 0 });
      view.hide();
      expect(view.isVisible()).toBe(false);
    });
  });

  describe("updateContent", () => {
    it("updates rendered content", async () => {
      view.show("x", { top: 0, left: 0, bottom: 0, right: 0 });

      view.updateContent("y+z");

      // Wait for async rendering
      await vi.waitFor(() => {
        const content = document.querySelector(".math-preview-content");
        return content?.innerHTML.includes("y+z");
      });

      const content = document.querySelector(".math-preview-content");
      expect(content?.innerHTML).toContain("y+z");
    });
  });

  describe("renderPreview", () => {
    it("renders empty state for whitespace-only content", async () => {
      view.show("   ", { top: 0, left: 0, bottom: 0, right: 0 });

      const content = document.querySelector(".math-preview-content");
      expect(content?.classList.contains("math-preview-empty")).toBe(true);
      expect(content?.textContent).toBe("");
    });

    it("renders KaTeX for valid content", async () => {
      view.show("x^2", { top: 0, left: 0, bottom: 0, right: 0 });

      await vi.waitFor(() => {
        const content = document.querySelector(".math-preview-content");
        return content?.innerHTML.includes("katex");
      });

      const content = document.querySelector(".math-preview-content");
      expect(content?.innerHTML).toContain("katex");
    });

    it("shows error for invalid LaTeX", async () => {
      view.show("\\invalid", { top: 0, left: 0, bottom: 0, right: 0 });

      await vi.waitFor(() => {
        const error = document.querySelector(".math-preview-error");
        return (error?.textContent?.length ?? 0) > 0;
      });

      const error = document.querySelector(".math-preview-error");
      expect(error?.textContent).toContain("Invalid LaTeX");

      const content = document.querySelector(".math-preview-content");
      expect(content?.classList.contains("math-preview-error-state")).toBe(true);
    });

    it("increments render token on each call to prevent stale updates", () => {
      // renderPreview increments renderToken (line 134). Multiple rapid calls
      // ensure only the last one renders. We verify by calling updateContent
      // multiple times — only the last content should be visible.
      view.show("first", { top: 0, left: 0, bottom: 0, right: 0 });
      view.updateContent("second");
      view.updateContent("third");

      // The synchronous part of renderPreview sets textContent to trimmed input
      const content = document.querySelector(".math-preview-content");
      expect(content?.textContent).toBe("third");
    });
  });

  describe("destroy", () => {
    it("removes container from DOM", () => {
      view.show("x", { top: 0, left: 0, bottom: 0, right: 0 });
      expect(document.querySelector(".math-preview-popup")).not.toBeNull();

      view.destroy();

      expect(document.querySelector(".math-preview-popup")).toBeNull();
    });
  });

  describe("getMathPreviewView singleton", () => {
    afterEach(() => {
      // Reset module to clear singleton
      vi.resetModules();
    });

    it("returns same instance on multiple calls", async () => {
      const { getMathPreviewView: getView1 } = await import("./MathPreviewView");
      const { getMathPreviewView: getView2 } = await import("./MathPreviewView");

      const instance1 = getView1();
      const instance2 = getView2();

      expect(instance1).toBe(instance2);
    });

    it("returns a MathPreviewView instance", () => {
      const instance = getMathPreviewView();
      expect(instance).toBeInstanceOf(MathPreviewView);
    });
  });

  describe("renderPreview — loadKatex rejection (.catch handler, lines 152–158)", () => {
    it("shows error state when loadKatex rejects with Error", async () => {
      mockLoadKatex.mockRejectedValue(new Error("Failed to load KaTeX"));

      view.show("x^2", { top: 0, left: 0, bottom: 0, right: 0 });

      // Wait for the rejection to propagate
      await new Promise((r) => setTimeout(r, 50));

      const content = document.querySelector(".math-preview-content");
      expect(content?.classList.contains("math-preview-error-state")).toBe(true);
      expect(content?.textContent).toBe("x^2");

      const error = document.querySelector(".math-preview-error");
      expect(error?.textContent).toBe("Preview failed");

      // Reset to default behavior
      mockLoadKatex.mockResolvedValue({
        default: {
          render: vi.fn((_c: string, el: HTMLElement) => {
            el.innerHTML = '<span class="katex">ok</span>';
          }),
        },
      });
    });

    it("shows error state when loadKatex rejects with non-Error", async () => {
      mockLoadKatex.mockRejectedValue("string rejection");

      view.show("y^2", { top: 0, left: 0, bottom: 0, right: 0 });

      await new Promise((r) => setTimeout(r, 50));

      const content = document.querySelector(".math-preview-content");
      expect(content?.classList.contains("math-preview-error-state")).toBe(true);

      const error = document.querySelector(".math-preview-error");
      expect(error?.textContent).toBe("Preview failed");

      // Reset
      mockLoadKatex.mockResolvedValue({
        default: {
          render: vi.fn((_c: string, el: HTMLElement) => {
            el.innerHTML = '<span class="katex">ok</span>';
          }),
        },
      });
    });

    it("ignores stale rejection when renderToken has advanced", async () => {
      // First call rejects slowly
      let rejectFirst: ((e: unknown) => void) | undefined;
      mockLoadKatex.mockReturnValueOnce(
        new Promise((_resolve, reject) => { rejectFirst = reject; })
      );

      view.show("first", { top: 0, left: 0, bottom: 0, right: 0 });

      // Second call succeeds immediately (advances renderToken)
      mockLoadKatex.mockResolvedValueOnce({
        default: {
          render: vi.fn((_c: string, el: HTMLElement) => {
            el.innerHTML = '<span class="katex">second</span>';
          }),
        },
      });
      view.updateContent("second");

      // Now reject the first call — should be ignored (stale token)
      rejectFirst!(new Error("stale"));
      await Promise.resolve();

      await vi.waitFor(() => {
        const content = document.querySelector(".math-preview-content");
        return content?.innerHTML.includes("second");
      });

      const error = document.querySelector(".math-preview-error");
      expect(error?.textContent).toBe("");
    });
  });

  describe("show — mounting inside editor container (host !== body, line 96–100)", () => {
    it("uses absolute positioning and host-relative coords when popup host exists", () => {
      const host = document.createElement("div");
      host.className = "editor-container";
      host.style.position = "relative";
      document.body.appendChild(host);

      // Make getPopupHostForDom return the host container
      mockGetPopupHostForDom.mockReturnValue(host);

      const editorDom = document.createElement("div");
      host.appendChild(editorDom);

      view.show("x^2", { top: 50, left: 100, bottom: 70, right: 200 }, editorDom);

      // Container should be appended to host, not body
      expect(host.querySelector(".math-preview-popup")).not.toBeNull();
      const container = host.querySelector(".math-preview-popup") as HTMLElement;
      expect(container.style.position).toBe("absolute");

      host.remove();
      mockGetPopupHostForDom.mockReturnValue(null);
    });

    it("uses fixed positioning when mounted in body (no editor container)", () => {
      view.show("x^2", { top: 50, left: 100, bottom: 70, right: 200 });

      const container = document.querySelector(".math-preview-popup") as HTMLElement;
      expect(container.style.position).toBe("fixed");
    });
  });

  describe("renderPreview — KaTeX error with hint (line 149 hint branch)", () => {
    it("shows error message with hint when parseLatexError returns hint", async () => {
      // Restore loadKatex to default behavior that throws on \invalid
      mockLoadKatex.mockImplementation(() =>
        Promise.resolve({
          default: {
            render: vi.fn((content: string, _element: HTMLElement, options: { throwOnError?: boolean }) => {
              if (options?.throwOnError && content === "\\invalid") {
                throw new Error("Unknown macro: \\invalid");
              }
            }),
          },
        })
      );

      view.show("\\invalid", { top: 0, left: 0, bottom: 0, right: 0 });

      await new Promise((r) => setTimeout(r, 50));

      const error = document.querySelector(".math-preview-error");
      // parseLatexError mock returns { message: "Invalid LaTeX", hint: "some hint" }
      expect(error?.textContent).toContain("Invalid LaTeX");
      expect(error?.textContent).toContain("some hint");
    });
  });
});
