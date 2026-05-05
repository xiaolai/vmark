import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

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

import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { setupMermaidExport } from "@/plugins/mermaid/mermaidExport";
import { setupSvgExport } from "@/plugins/svg/svgExport";
import {
  isLatexLanguage,
  installDoubleClickHandler,
  createPreviewElement,
  createPreviewPlaceholder,
  createLivePreview,
  createEditHeader,
} from "./previewHelpers";

describe("isLatexLanguage", () => {
  it("returns true for 'latex'", () => {
    expect(isLatexLanguage("latex")).toBe(true);
  });

  it("returns true for '$$math$$' sentinel", () => {
    expect(isLatexLanguage("$$math$$")).toBe(true);
  });

  it("returns false for other languages", () => {
    expect(isLatexLanguage("mermaid")).toBe(false);
    expect(isLatexLanguage("svg")).toBe(false);
    expect(isLatexLanguage("markmap")).toBe(false);
    expect(isLatexLanguage("javascript")).toBe(false);
    expect(isLatexLanguage("")).toBe(false);
  });
});

describe("installDoubleClickHandler", () => {
  it("does nothing when onDoubleClick is undefined", () => {
    const el = document.createElement("div");
    const addSpy = vi.spyOn(el, "addEventListener");
    installDoubleClickHandler(el, undefined);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("prevents default on mousedown", () => {
    const el = document.createElement("div");
    const handler = vi.fn();
    installDoubleClickHandler(el, handler);

    const mousedown = new MouseEvent("mousedown");
    const preventSpy = vi.spyOn(mousedown, "preventDefault");
    el.dispatchEvent(mousedown);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("calls onDoubleClick and prevents default on dblclick", () => {
    const el = document.createElement("div");
    const handler = vi.fn();
    installDoubleClickHandler(el, handler);

    const dblclick = new MouseEvent("dblclick", { bubbles: true });
    const preventSpy = vi.spyOn(dblclick, "preventDefault");
    el.dispatchEvent(dblclick);
    expect(preventSpy).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("createPreviewElement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(setupMermaidPanZoom).mockClear();
    vi.mocked(setupMermaidExport).mockClear();
    vi.mocked(setupSvgExport).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates element with latex-preview class for latex language", () => {
    const el = createPreviewElement("latex", "<span>rendered</span>");
    expect(el.className).toBe("code-block-preview latex-preview");
    expect(el.innerHTML).toBe("<span>rendered</span>");
  });

  it("creates element with latex-preview class for $$math$$ language", () => {
    const el = createPreviewElement("$$math$$", "<span>math</span>");
    expect(el.className).toBe("code-block-preview latex-preview");
  });

  it("creates element with mermaid-preview class for svg language", () => {
    const el = createPreviewElement("svg", "<svg></svg>");
    expect(el.className).toBe("code-block-preview mermaid-preview");
  });

  it("creates element with mermaid-preview class for mermaid language", () => {
    const el = createPreviewElement("mermaid", "<svg></svg>");
    expect(el.className).toBe("code-block-preview mermaid-preview");
  });

  it("sets up pan-zoom for mermaid content after requestAnimationFrame", async () => {
    const el = createPreviewElement("mermaid", "<svg></svg>", undefined, "graph TD");
    await vi.advanceTimersByTimeAsync(16);
    expect(setupMermaidPanZoom).toHaveBeenCalledWith(el);
    expect(setupMermaidExport).toHaveBeenCalledWith(el, "graph TD");
  });

  it("sets up svg export for svg content after requestAnimationFrame", async () => {
    const el = createPreviewElement("svg", "<svg></svg>", undefined, "<svg>source</svg>");
    await vi.advanceTimersByTimeAsync(16);
    expect(setupMermaidPanZoom).toHaveBeenCalledWith(el);
    expect(setupSvgExport).toHaveBeenCalledWith(el, "<svg>source</svg>");
  });

  it("does not set up pan-zoom for mermaid without sourceContent", async () => {
    createPreviewElement("mermaid", "<svg></svg>");
    await vi.advanceTimersByTimeAsync(16);
    expect(setupMermaidPanZoom).toHaveBeenCalled();
    expect(setupMermaidExport).not.toHaveBeenCalled();
  });

  it("does not set up pan-zoom for latex content", async () => {
    createPreviewElement("latex", "<span>math</span>");
    await vi.advanceTimersByTimeAsync(16);
    expect(setupMermaidPanZoom).not.toHaveBeenCalled();
  });

  it("installs double-click handler when provided", () => {
    const handler = vi.fn();
    const el = createPreviewElement("latex", "<span>math</span>", handler);
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  describe("yaml/yml workflow cache-hit class", () => {
    it("yaml language produces .workflow-preview class (not .yaml-preview)", () => {
      // Cache-hit path: a workflow YAML fence already rendered once;
      // the cached Mermaid SVG comes back here with language="yaml".
      // Without the workflow branch, this fell through to
      // "yaml-preview" + sanitizeKatex, which strips the SVG and
      // bypasses .workflow-preview CSS sizing — visible bug after
      // F6 source-mode round-trip.
      const el = createPreviewElement(
        "yaml",
        "<svg viewBox='0 0 100 100'><rect/></svg>",
      );
      expect(el.className).toContain("workflow-preview");
      expect(el.className).not.toContain("yaml-preview");
      expect(el.innerHTML).toContain("<svg");
    });

    it("yml language also routes to .workflow-preview", () => {
      const el = createPreviewElement(
        "yml",
        "<svg viewBox='0 0 100 100'><rect/></svg>",
      );
      expect(el.className).toContain("workflow-preview");
    });
  });
});

describe("createPreviewPlaceholder", () => {
  it("creates placeholder with correct class and text for latex", () => {
    const el = createPreviewPlaceholder("latex", "Empty math block");
    expect(el.className).toBe("code-block-preview latex-preview code-block-preview-placeholder");
    expect(el.textContent).toBe("Empty math block");
  });

  it("uses latex class for $$math$$ language", () => {
    const el = createPreviewPlaceholder("$$math$$", "Empty");
    expect(el.className).toContain("latex-preview");
  });

  it("uses mermaid class for mermaid language", () => {
    const el = createPreviewPlaceholder("mermaid", "Empty diagram");
    expect(el.className).toContain("mermaid-preview");
  });

  it("installs double-click handler when provided", () => {
    const handler = vi.fn();
    const el = createPreviewPlaceholder("latex", "Empty", handler);
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not install handler when not provided", () => {
    const el = createPreviewPlaceholder("latex", "Empty");
    // Just verify it creates without error
    expect(el.textContent).toBe("Empty");
  });
});

describe("createLivePreview", () => {
  it("creates live preview with latex class for latex language", () => {
    const el = createLivePreview("latex");
    expect(el.className).toBe("code-block-live-preview latex-live-preview");
    expect(el.innerHTML).toContain("Rendering...");
  });

  it("creates live preview with latex class for $$math$$", () => {
    const el = createLivePreview("$$math$$");
    expect(el.className).toContain("latex-live-preview");
  });

  it("creates live preview with mermaid class for svg", () => {
    const el = createLivePreview("svg");
    expect(el.className).toContain("mermaid-live-preview");
  });

  it("creates live preview with markmap class for markmap", () => {
    const el = createLivePreview("markmap");
    expect(el.className).toContain("markmap-live-preview");
  });

  it("creates live preview with language class for mermaid", () => {
    const el = createLivePreview("mermaid");
    expect(el.className).toContain("mermaid-live-preview");
  });
});

describe("createEditHeader", () => {
  it("creates header with correct title for mermaid", () => {
    const header = createEditHeader("mermaid", vi.fn(), vi.fn());
    const title = header.querySelector(".code-block-edit-title");
    expect(title?.textContent).toBe("Mermaid");
  });

  it("creates header with correct title for markmap", () => {
    const header = createEditHeader("markmap", vi.fn(), vi.fn());
    const title = header.querySelector(".code-block-edit-title");
    expect(title?.textContent).toBe("Markmap");
  });

  it("creates header with correct title for svg", () => {
    const header = createEditHeader("svg", vi.fn(), vi.fn());
    const title = header.querySelector(".code-block-edit-title");
    expect(title?.textContent).toBe("SVG");
  });

  it("creates header with correct title for latex", () => {
    const header = createEditHeader("latex", vi.fn(), vi.fn());
    const title = header.querySelector(".code-block-edit-title");
    expect(title?.textContent).toBe("LaTeX");
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    const header = createEditHeader("latex", onCancel, vi.fn());
    const cancelBtn = header.querySelector(".code-block-edit-cancel") as HTMLButtonElement;
    expect(cancelBtn).toBeDefined();

    const clickEvent = new MouseEvent("click", { bubbles: true });
    vi.spyOn(clickEvent, "preventDefault");
    vi.spyOn(clickEvent, "stopPropagation");
    cancelBtn.dispatchEvent(clickEvent);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onSave when save button is clicked", () => {
    const onSave = vi.fn();
    const header = createEditHeader("latex", vi.fn(), onSave);
    const saveBtn = header.querySelector(".code-block-edit-save") as HTMLButtonElement;
    expect(saveBtn).toBeDefined();

    const clickEvent = new MouseEvent("click", { bubbles: true });
    saveBtn.dispatchEvent(clickEvent);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("prevents default on cancel button mousedown", () => {
    const header = createEditHeader("latex", vi.fn(), vi.fn());
    const cancelBtn = header.querySelector(".code-block-edit-cancel") as HTMLButtonElement;

    const mousedown = new MouseEvent("mousedown", { bubbles: true });
    const preventSpy = vi.spyOn(mousedown, "preventDefault");
    const stopSpy = vi.spyOn(mousedown, "stopPropagation");
    cancelBtn.dispatchEvent(mousedown);
    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });

  it("prevents default on save button mousedown", () => {
    const header = createEditHeader("latex", vi.fn(), vi.fn());
    const saveBtn = header.querySelector(".code-block-edit-save") as HTMLButtonElement;

    const mousedown = new MouseEvent("mousedown", { bubbles: true });
    const preventSpy = vi.spyOn(mousedown, "preventDefault");
    saveBtn.dispatchEvent(mousedown);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("does not include copy button when onCopy is not provided", () => {
    const header = createEditHeader("latex", vi.fn(), vi.fn());
    const copyBtn = header.querySelector(".code-block-edit-copy");
    expect(copyBtn).toBeNull();
  });

  it("includes copy button when onCopy is provided", () => {
    const onCopy = vi.fn();
    const header = createEditHeader("mermaid", vi.fn(), vi.fn(), onCopy);
    const copyBtn = header.querySelector(".code-block-edit-copy") as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
  });

  it("calls onCopy when copy button is clicked", () => {
    const onCopy = vi.fn();
    const header = createEditHeader("mermaid", vi.fn(), vi.fn(), onCopy);
    const copyBtn = header.querySelector(".code-block-edit-copy") as HTMLButtonElement;

    const clickEvent = new MouseEvent("click", { bubbles: true });
    copyBtn.dispatchEvent(clickEvent);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("shows checkmark feedback after copy click", () => {
    vi.useFakeTimers();
    const onCopy = vi.fn();
    const header = createEditHeader("mermaid", vi.fn(), vi.fn(), onCopy);
    const copyBtn = header.querySelector(".code-block-edit-copy") as HTMLButtonElement;

    const clickEvent = new MouseEvent("click", { bubbles: true });
    copyBtn.dispatchEvent(clickEvent);

    // After click, should have success class
    expect(copyBtn.classList.contains("code-block-edit-btn--success")).toBe(true);
    // Checkmark SVG should be present
    expect(copyBtn.innerHTML).toContain("polyline");

    // After 1500ms, should revert
    vi.advanceTimersByTime(1500);
    expect(copyBtn.classList.contains("code-block-edit-btn--success")).toBe(false);
    // Rect SVG (copy icon) should be back
    expect(copyBtn.innerHTML).toContain("rect");

    vi.useRealTimers();
  });

  it("prevents default on copy button mousedown", () => {
    const onCopy = vi.fn();
    const header = createEditHeader("mermaid", vi.fn(), vi.fn(), onCopy);
    const copyBtn = header.querySelector(".code-block-edit-copy") as HTMLButtonElement;

    const mousedown = new MouseEvent("mousedown", { bubbles: true });
    const preventSpy = vi.spyOn(mousedown, "preventDefault");
    copyBtn.dispatchEvent(mousedown);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("has correct structure: header > title + actions", () => {
    const header = createEditHeader("latex", vi.fn(), vi.fn());
    expect(header.className).toBe("code-block-edit-header");
    expect(header.children.length).toBe(2);
    expect(header.children[0].className).toBe("code-block-edit-title");
    expect(header.children[1].className).toBe("code-block-edit-actions");
  });
});
