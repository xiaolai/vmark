/**
 * Theme observer coalescing test (separate file: setupThemeObserver has a
 * module-level idempotency guard, so this file mocks the renderers before the
 * one-and-only observer for this module registry is installed).
 *
 * One mutation may flip BOTH the Mermaid token snapshot and the Markmap dark
 * flag. The observer must still invalidate/refresh exactly once — not once
 * per renderer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/plugins/mermaid", () => ({
  updateMermaidTheme: vi.fn(),
}));

vi.mock("@/plugins/markmap", () => ({
  updateMarkmapTheme: vi.fn(),
}));

import { updateMermaidTheme } from "@/plugins/mermaid";
import { updateMarkmapTheme } from "@/plugins/markmap";
import { diagramWarn } from "@/utils/debug";
import { setupThemeObserver } from "./themeObserver";
import { previewCache, activeEditorViews, SETTINGS_CHANGED } from "./pluginState";

vi.mock("@/utils/debug", () => ({
  diagramWarn: vi.fn(),
}));

function makeMockView() {
  const setMeta = vi.fn().mockReturnThis();
  const dispatch = vi.fn();
  return {
    view: { state: { tr: { setMeta } }, dispatch } as never,
    setMeta,
    dispatch,
  };
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  previewCache.clear();
  activeEditorViews.clear();
  vi.mocked(updateMermaidTheme).mockReset();
  vi.mocked(updateMarkmapTheme).mockReset();
  vi.mocked(diagramWarn).mockClear();
});

describe("themeObserver refresh coalescing", () => {
  it("refreshes exactly once when BOTH mermaid and markmap report a theme change", async () => {
    vi.mocked(updateMermaidTheme).mockResolvedValue(true);
    vi.mocked(updateMarkmapTheme).mockResolvedValue(true);
    setupThemeObserver();

    const { view, setMeta, dispatch } = makeMockView();
    activeEditorViews.add(view);
    previewCache.set("cached", { rendered: "<svg>old</svg>" });

    document.documentElement.classList.add("dark");

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    // Give any (buggy) second refresh a chance to land before asserting.
    await new Promise((r) => setTimeout(r, 10));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(setMeta).toHaveBeenCalledWith(SETTINGS_CHANGED, true);
    expect(previewCache.size).toBe(0);
  });

  it("still refreshes when one renderer rejects and the other reports a change", async () => {
    vi.mocked(updateMermaidTheme).mockRejectedValue(new Error("mermaid boom"));
    vi.mocked(updateMarkmapTheme).mockResolvedValue(true);
    setupThemeObserver();

    const { view, dispatch } = makeMockView();
    activeEditorViews.add(view);

    document.documentElement.classList.add("dark");

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(diagramWarn).toHaveBeenCalledWith("Mermaid theme update failed:", "mermaid boom");
  });

  it("warns (without refreshing) when markmap rejects and mermaid reports no change", async () => {
    vi.mocked(updateMermaidTheme).mockResolvedValue(false);
    vi.mocked(updateMarkmapTheme).mockRejectedValue(new Error("markmap boom"));
    setupThemeObserver();

    const { view, dispatch } = makeMockView();
    activeEditorViews.add(view);

    document.documentElement.classList.add("dark");

    await vi.waitFor(() =>
      expect(diagramWarn).toHaveBeenCalledWith("Markmap theme update failed:", "markmap boom"),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not refresh when neither renderer reports a change", async () => {
    vi.mocked(updateMermaidTheme).mockResolvedValue(false);
    vi.mocked(updateMarkmapTheme).mockResolvedValue(false);
    setupThemeObserver();

    const { view, dispatch } = makeMockView();
    activeEditorViews.add(view);
    previewCache.set("cached", { rendered: "<svg>fresh</svg>" });

    document.documentElement.classList.add("some-class");
    await new Promise((r) => setTimeout(r, 10));

    expect(dispatch).not.toHaveBeenCalled();
    expect(previewCache.size).toBe(1);
  });
});
