// WI-1.3 — BrowserSurface: wires the native browser commands into a React tab
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

// Capture the ResizeObserver callback so tests can trigger a resize.
let resizeCb: ResizeObserverCallback | null = null;
beforeEach(() => {
  resizeCb = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        resizeCb = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

import { BrowserSurface } from "./BrowserSurface";
import { useTabStore } from "@/stores/tabStore";

function seedBrowserTab(url: string): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", url, "Example");
}

beforeEach(() => {
  invoke.mockClear();
  cleanup();
});

describe("BrowserSurface", () => {
  it("creates the native webview on mount with the tab's URL", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_create", {
        tabId: id,
        windowLabel: "main",
        url: "https://example.com/",
      }),
    );
  });

  it("shows the current URL in the address bar", () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    expect(screen.getByRole("textbox")).toHaveValue("https://example.com/");
  });

  it("navigates when the address bar is submitted", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    const bar = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(bar);
    await user.type(bar, "https://example.org/{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", {
        tabId: id,
        url: "https://example.org/",
      }),
    );
  });

  it("reports the reserved rect bounds to Rust on resize", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    invoke.mockClear();
    // Trigger the captured ResizeObserver callback.
    expect(resizeCb).toBeTypeOf("function");
    resizeCb!([], {} as ResizeObserver);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_set_bounds",
        expect.objectContaining({ tabId: id }),
      ),
    );
    const call = invoke.mock.calls.find((c) => c[0] === "browser_set_bounds");
    expect(call?.[1]).toMatchObject({
      tabId: id,
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it("destroys the native webview on unmount", async () => {
    const id = seedBrowserTab("https://example.com/");
    const { unmount } = render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    invoke.mockClear();
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId: id }));
  });
});
