// WI-1.3 — BrowserSurface: wires the native browser commands into a React tab
// WI-S1.2 — writes nav state (urlInput/loading/history) into browserUiStore
// WI-S1.4 — the top nav chrome is GONE (moved to the bottom bar); the surface is
//           now viewport + full-cover overlays (crash / dialog) only
// WI-S0.3b — bounds are re-reported when the layout MOVES the rect, not only on resize
// WI-S0.9 — a failed create/load is shown, with its cause and a retry, not swallowed
// WI-S0.10 — a stale deferred destroy cannot tear down a newer mount's webview
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

// Capturing event mock (overrides the global no-op) so tests can emit the
// native nav-delegate events the surface now listens for.
const eventListeners = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: (e: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return Promise.resolve(() => eventListeners.delete(name));
  },
  emit: vi.fn(),
}));
async function emitNav(name: string, payload: unknown) {
  await act(async () => {
    eventListeners.get(name)?.({ payload });
    await Promise.resolve();
  });
}

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
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useUIStore } from "@/stores/uiStore";

function seedBrowserTab(url: string): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", url, "Example");
}

beforeEach(() => {
  invoke.mockClear();
  eventListeners.clear();
  useBrowserUiStore.setState({ entries: {} });
  cleanup();
});

describe("BrowserSurface", () => {
  it("creates the native webview on mount with the tab's URL", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() =>
      // No windowLabel: the driver derives the window from the invoking
      // WebviewWindow (a caller cannot assert a label).
      expect(invoke).toHaveBeenCalledWith("browser_create", {
        tabId: id,
        url: "https://example.com/",
      }),
    );
  });

  // The nav chrome (back/forward/reload/stop + address bar + omnibox submit) moved
  // to the bottom StatusBar in WI-S1.4 and is tested in BrowserOmnibox.test.tsx,
  // browserNavigation.test.ts, and omnibox.test.ts. BrowserSurface now owns only
  // the native-view lifecycle, bounds, nav-event → store wiring, and overlays.

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

  // WI-S0.3b — ResizeObserver fires on SIZE. A panel that moves the browser rect
  // without resizing it (a terminal switching sides, a bar appearing above it) changes
  // x/y silently, and the native view is left behind, painting over unrelated UI.
  it("re-reports bounds when the layout shifts, even with no resize", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    invoke.mockClear();

    // No ResizeObserver callback — only a layout-state change.
    await act(async () => {
      useUIStore.setState({ terminalVisible: true });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_set_bounds",
        expect.objectContaining({ tabId: id }),
      ),
    );
  });

  it("destroys the native webview on unmount", async () => {
    const id = seedBrowserTab("https://example.com/");
    const { unmount } = render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    invoke.mockClear();
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId: id }));
  });

  it("destroys only after create settles, so a rapid unmount cannot orphan the webview", async () => {
    // Hold browser_create pending, unmount, then let create resolve. If destroy
    // ran before create registered the native view, the view would be orphaned.
    let resolveCreate: () => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create"
        ? new Promise<void>((r) => {
            resolveCreate = () => r();
          })
        : Promise.resolve(undefined),
    );
    const id = seedBrowserTab("https://example.com/");
    const { unmount } = render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    invoke.mockClear();

    unmount();
    await Promise.resolve();
    // create is still pending → destroy must be deferred, not fired against a
    // not-yet-registered webview.
    expect(invoke).not.toHaveBeenCalledWith("browser_destroy", expect.anything());

    resolveCreate();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId: id }));
    invoke.mockImplementation(() => Promise.resolve(undefined)); // restore default
  });

  // WI-S0.10 — a rapid switch away and back remounts the surface. The first mount's
  // destroy is deferred until its create settles; if it fires after the SECOND mount
  // created a new native view for the same tab id, it would tear down the live one and
  // leave a browser tab showing nothing.
  it("a stale deferred destroy does not tear down a newer mount's webview", async () => {
    let resolveCreate: () => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create"
        ? new Promise<void>((r) => {
            resolveCreate = () => r();
          })
        : Promise.resolve(undefined),
    );
    const id = seedBrowserTab("https://example.com/");

    // Mount, switch away (unmount with create still in flight), switch back.
    const first = render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    first.unmount();
    render(<BrowserSurface tabId={id} />);

    invoke.mockClear();
    // The first mount's create now settles, releasing its deferred destroy.
    resolveCreate();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // That destroy belongs to a mount that no longer owns the tab — it must not fire.
    expect(invoke).not.toHaveBeenCalledWith("browser_destroy", { tabId: id });
    invoke.mockImplementation(() => Promise.resolve(undefined));
  });

  // WI-S0.9 — every browser command used to `.catch(() => {})`. A failed load was
  // indistinguishable from a slow one: a blank rect and a spinner, forever.
  it("shows what went wrong when a load fails, and offers a retry", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://load-failed")).toBe(true));

    await emitNav("browser://load-failed", {
      tabId: id,
      message: "A server with the specified hostname could not be found.",
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be found/i);
    // ...and the spinner is not still turning over a page that will never arrive.
    expect(useBrowserUiStore.getState().entries[id]?.loading).toBe(false);

    invoke.mockClear();
    await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(invoke).toHaveBeenCalledWith("browser_navigate", expect.objectContaining({ tabId: id }));
  });

  it("reports a create that never produced a native view", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create" ? Promise.reject(new Error("no contentView")) : Promise.resolve(),
    );
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);

    // A failed create leaves NO native view — the tab would otherwise sit blank forever.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no contentView/i);
    invoke.mockImplementation(() => Promise.resolve(undefined));
  });

  it("a fresh navigation clears the previous failure", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://load-failed")).toBe(true));
    await emitNav("browser://load-failed", { tabId: id, message: "offline" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await emitNav("browser://navigated", { tabId: id, url: "https://ok.com/", generation: 2 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("writes the omnibox state when the native page navigates (delegate event)", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://loaded")).toBe(true));
    // The WKWebView followed a redirect / AI-driven click to a new URL.
    await emitNav("browser://loaded", {
      tabId: id,
      url: "https://www.iana.org/help/example-domains",
      title: "Example Domains",
    });
    // The omnibox reads urlInput from browserUiStore (the chrome moved to the bar).
    expect(useBrowserUiStore.getState().entries[id]?.urlInput).toBe(
      "https://www.iana.org/help/example-domains",
    );
    expect(useTabStore.getState().findTabById(id)).toMatchObject({
      url: "https://www.iana.org/help/example-domains",
    });
  });

  it("ignores nav events addressed to a different tab", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://navigated")).toBe(true));
    await emitNav("browser://navigated", { tabId: "some-other-tab", url: "https://evil/" });
    expect(useBrowserUiStore.getState().entries[id]?.urlInput).toBe("https://example.com/");
  });

  // WI-SOC.1b — hiding the native view leaves a BLANK rect. An overlay with a
  // translucent backdrop (or a small popup beside it) would composite over that hole.
  // The placeholder is what makes hide-only freeze correct without a page snapshot.
  it("paints an opaque placeholder over the rect while the native view is frozen", async () => {
    const id = seedBrowserTab("https://example.com/");
    const { container } = render(<BrowserSurface tabId={id} />);
    expect(container.querySelector(".browser-frozen")).toBeNull();

    act(() => {
      useBrowserUiStore.getState().setFrozen(id, true);
    });
    expect(container.querySelector(".browser-frozen")).not.toBeNull();

    act(() => {
      useBrowserUiStore.getState().setFrozen(id, false);
    });
    expect(container.querySelector(".browser-frozen")).toBeNull();
  });

  it("shows a manual crash overlay and reloads on click (freezing then thawing the view)", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://crashed")).toBe(true));
    await emitNav("browser://crashed", { tabId: id, action: "manual" });
    // Overlay is shown and the native view was frozen so it's visible.
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("browser_freeze", { tabId: id });

    invoke.mockClear();
    await userEvent.click(within(alert).getByRole("button", { name: /reload/i }));
    // Reload thaws the view and re-navigates (via the browserNavigation service).
    expect(invoke).toHaveBeenCalledWith("browser_thaw", { tabId: id });
    expect(invoke).toHaveBeenCalledWith("browser_navigate", expect.objectContaining({ tabId: id }));
  });

  it("shows a confirm dialog, freezes the view, and answers OK", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://dialog")).toBe(true));
    await emitNav("browser://dialog", { tabId: id, kind: "confirm", message: "Delete?", id: 42 });
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Delete?");
    expect(invoke).toHaveBeenCalledWith("browser_freeze", { tabId: id });

    invoke.mockClear();
    await userEvent.click(within(dlg).getByRole("button", { name: /^ok$/i }));
    // Answering resumes the page (id + accepted) and thaws the view.
    expect(invoke).toHaveBeenCalledWith("browser_dialog_respond", { id: 42, accepted: true });
    expect(invoke).toHaveBeenCalledWith("browser_thaw", { tabId: id });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("answers Cancel with accepted=false", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://dialog")).toBe(true));
    await emitNav("browser://dialog", { tabId: id, kind: "confirm", message: "Sure?", id: 9 });
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /cancel/i }));
    expect(invoke).toHaveBeenCalledWith("browser_dialog_respond", { id: 9, accepted: false });
  });

  it("shows an alert dialog with only an OK button (no respond call)", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://dialog")).toBe(true));
    await emitNav("browser://dialog", { tabId: id, kind: "alert", message: "Heads up" });
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    invoke.mockClear();
    await userEvent.click(within(dlg).getByRole("button", { name: /^ok$/i }));
    // Alert has no id → no respond call, just dismiss + thaw.
    expect(invoke).not.toHaveBeenCalledWith("browser_dialog_respond", expect.anything());
    expect(invoke).toHaveBeenCalledWith("browser_thaw", { tabId: id });
  });

  it("clears the crash overlay when a clean load recovers the process", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://crashed")).toBe(true));
    await emitNav("browser://crashed", { tabId: id, action: "auto-reload" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The auto-reload succeeded → a loaded event arrives and the overlay clears.
    await emitNav("browser://loaded", { tabId: id, url: "https://example.com/", title: "Example" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("browser_thaw", { tabId: id });
  });
});
