/**
 * Tests for the code-preview theme observer.
 *
 * The observer must invalidate cached diagram previews on ANY theme change —
 * not just dark-mode class flips. Theme switches rewrite the design-token CSS
 * variables on documentElement (style attribute), so the observer watches both
 * `class` and `style` and compares a token snapshot before invalidating.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupThemeObserver } from "./themeObserver";
import { previewCache, activeEditorViews, SETTINGS_CHANGED } from "./pluginState";

function makeMockView() {
  const setMeta = vi.fn().mockReturnThis();
  const dispatch = vi.fn();
  return {
    view: { state: { tr: { setMeta } }, dispatch } as never,
    setMeta,
    dispatch,
  };
}

function resetDom(): void {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
}

beforeEach(() => {
  resetDom();
  previewCache.clear();
  activeEditorViews.clear();
});

describe("themeObserver", () => {
  it("invalidates cached previews and re-dispatches when theme tokens change", async () => {
    setupThemeObserver();

    // Prime the snapshot with an initial (fallback-token) mutation.
    document.documentElement.setAttribute("style", "--bg-color: #eeeded");
    await vi.waitFor(() => expect(previewCache.size).toBe(0));

    previewCache.set("cached", { rendered: "<svg>old</svg>" });
    const { view, setMeta, dispatch } = makeMockView();
    activeEditorViews.add(view);

    // Simulate a theme switch (e.g. paper -> sepia): tokens change, no dark flip.
    document.documentElement.setAttribute(
      "style",
      "--bg-color: #f4ecd8; --text-color: #5b4636",
    );

    await vi.waitFor(() => expect(previewCache.size).toBe(0));
    expect(setMeta).toHaveBeenCalledWith(SETTINGS_CHANGED, true);
    expect(dispatch).toHaveBeenCalled();
  });

  it("does not invalidate when a mutation leaves the token snapshot unchanged", async () => {
    setupThemeObserver();

    // Prime with a known token state.
    document.documentElement.setAttribute("style", "--bg-color: #101418");
    await new Promise((r) => setTimeout(r, 0));

    previewCache.set("cached", { rendered: "<svg>fresh</svg>" });
    const { view, dispatch } = makeMockView();
    activeEditorViews.add(view);

    // Unrelated class churn — tokens identical, no invalidation.
    document.documentElement.classList.add("some-unrelated-class");
    await new Promise((r) => setTimeout(r, 10));

    expect(previewCache.size).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("still invalidates on dark-mode class flips (legacy path)", async () => {
    setupThemeObserver();

    document.documentElement.setAttribute("style", "--bg-color: #eeeded");
    await new Promise((r) => setTimeout(r, 0));

    previewCache.set("cached", { rendered: "<svg>light</svg>" });

    document.documentElement.classList.add("dark-theme", "dark");
    await vi.waitFor(() => expect(previewCache.size).toBe(0));
  });
});
