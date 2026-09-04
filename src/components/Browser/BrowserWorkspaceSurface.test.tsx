import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserWorkspaceSurface } from "./BrowserWorkspaceSurface";
import { useTabStore } from "@/stores/tabStore";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));

const paneCtx = vi.hoisted(() => ({ value: null as { tabId: string } | null }));
vi.mock("@/contexts/PaneContext", () => ({ usePaneContext: () => paneCtx.value }));

vi.mock("./BrowserSurface", () => ({
  BrowserSurface: ({ tabId }: { tabId: string }) => <div data-testid="surface">{tabId}</div>,
}));

vi.mock("./BrowserChrome", () => ({
  BrowserChrome: ({ activePageId }: { activePageId?: string | null }) => (
    <div data-testid="chrome">{activePageId}</div>
  ),
}));

// #1296 — where the browser's chrome lives is a platform fact: macOS puts it in
// the app's own title-bar strip, and off macOS there is no such strip, so it
// belongs at the top of the pane like every other desktop browser.
const platform = vi.hoisted(() => ({ overlayTitleBar: false }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  usesOverlayTitleBar: () => platform.overlayTitleBar,
}));

function reset() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
  });
}

beforeEach(() => {
  paneCtx.value = null;
  platform.overlayTitleBar = false;
  reset();
});

describe("BrowserWorkspaceSurface", () => {
  it("mounts the surface for the active browser page", () => {
    const a = useTabStore.getState().createBrowserPage("main", "https://a.example/");
    render(<BrowserWorkspaceSurface />);
    expect(screen.getByTestId("surface")).toHaveTextContent(a);
  });

  it("renders nothing when there is no active browser page", () => {
    render(<BrowserWorkspaceSurface />);
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("renders nothing when the active tab is a document (stale/no browser page)", () => {
    useTabStore.getState().createBrowserPage("main", "https://a.example/");
    useTabStore.getState().setActiveTab("main", null);
    render(<BrowserWorkspaceSurface />);
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("prefers the pane's tab over the window active tab (split view)", () => {
    const a = useTabStore.getState().createBrowserPage("main", "https://a.example/");
    const b = useTabStore.getState().createBrowserPage("main", "https://b.example/"); // window-active
    paneCtx.value = { tabId: a }; // focused pane shows A
    render(<BrowserWorkspaceSurface />);
    expect(screen.getByTestId("surface")).toHaveTextContent(a);
    expect(screen.getByTestId("surface")).not.toHaveTextContent(b);
  });
});

// #1296 — the address bar has to live somewhere. On macOS that is the app's own
// title-bar strip; off macOS the app draws no strip at all, so the chrome goes
// where every desktop browser puts it: inside the window, above the page.
describe("BrowserWorkspaceSurface — chrome placement", () => {
  it("mounts the chrome above the page off macOS", () => {
    useTabStore.getState().createBrowserPage("main", "https://a.example/");
    render(<BrowserWorkspaceSurface />);

    const chrome = screen.getByTestId("chrome");
    const surface = screen.getByTestId("surface");
    expect(chrome).toBeInTheDocument();
    // Order is the whole point: the native webview is positioned from the
    // viewport's client rect, so chrome BELOW it would sit under the page.
    expect(chrome.compareDocumentPosition(surface) & Node.DOCUMENT_POSITION_FOLLOWING).
      toBeTruthy();
  });

  it("leaves the chrome to the title bar on macOS", () => {
    platform.overlayTitleBar = true;
    useTabStore.getState().createBrowserPage("main", "https://a.example/");
    render(<BrowserWorkspaceSurface />);

    // Two address bars is worse than the one this fixes.
    expect(screen.queryByTestId("chrome")).not.toBeInTheDocument();
    expect(screen.getByTestId("surface")).toBeInTheDocument();
  });

  it("gives the chrome the page THIS pane shows, not the window's", () => {
    const a = useTabStore.getState().createBrowserPage("main", "https://a.example/");
    useTabStore.getState().createBrowserPage("main", "https://b.example/"); // window-active
    paneCtx.value = { tabId: a };
    render(<BrowserWorkspaceSurface />);

    expect(screen.getByTestId("chrome")).toHaveTextContent(a);
  });

  it("renders no chrome when the pane has no page to address", () => {
    render(<BrowserWorkspaceSurface />);
    expect(screen.queryByTestId("chrome")).not.toBeInTheDocument();
  });
});
