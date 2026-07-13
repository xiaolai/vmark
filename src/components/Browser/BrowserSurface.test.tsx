// WI-1.3 — BrowserSurface: wires the native browser commands into a React tab
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

function seedBrowserTab(url: string): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", url, "Example");
}

beforeEach(() => {
  invoke.mockClear();
  eventListeners.clear();
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

  it("invokes browser_back and browser_forward from the history buttons", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    invoke.mockClear();
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByRole("button", { name: /forward/i }));
    expect(invoke).toHaveBeenCalledWith("browser_back", { tabId: id });
    expect(invoke).toHaveBeenCalledWith("browser_forward", { tabId: id });
  });

  it("shows a stop button while loading and invokes browser_stop", async () => {
    // Keep browser_create pending so `loading` stays true (the stop button shows
    // only while loading); everything else resolves normally.
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create" ? new Promise<void>(() => {}) : Promise.resolve(undefined),
    );
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    const stopBtn = await screen.findByRole("button", { name: /stop/i });
    await userEvent.click(stopBtn);
    expect(invoke).toHaveBeenCalledWith("browser_stop", { tabId: id });
    invoke.mockImplementation(() => Promise.resolve(undefined)); // restore default
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

  it("preserves the fragment when navigating to an in-page anchor", async () => {
    // The dedup canonicalizer drops `#frag`, but navigation must keep it so the
    // page scrolls to the anchor — otherwise `page#section` silently loads `page`.
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    const bar = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(bar);
    await user.type(bar, "https://example.org/docs#install{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", {
        tabId: id,
        url: "https://example.org/docs#install",
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

  it("updates the address bar when the native page navigates (delegate event)", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://loaded")).toBe(true));
    // The WKWebView followed a redirect / AI-driven click to a new URL.
    await emitNav("browser://loaded", {
      tabId: id,
      url: "https://www.iana.org/help/example-domains",
      title: "Example Domains",
    });
    expect(screen.getByRole("textbox")).toHaveValue("https://www.iana.org/help/example-domains");
    expect(useTabStore.getState().findTabById(id)).toMatchObject({
      url: "https://www.iana.org/help/example-domains",
    });
  });

  it("ignores nav events addressed to a different tab", async () => {
    const id = seedBrowserTab("https://example.com/");
    render(<BrowserSurface tabId={id} />);
    await waitFor(() => expect(eventListeners.has("browser://navigated")).toBe(true));
    await emitNav("browser://navigated", { tabId: "some-other-tab", url: "https://evil/" });
    expect(screen.getByRole("textbox")).toHaveValue("https://example.com/");
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
    // Scope to the overlay — the chrome also has a "Reload" button.
    await userEvent.click(within(alert).getByRole("button", { name: /reload/i }));
    // Reload thaws the view and re-navigates.
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
