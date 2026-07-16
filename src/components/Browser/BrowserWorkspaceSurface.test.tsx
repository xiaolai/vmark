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

function reset() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

beforeEach(() => {
  paneCtx.value = null;
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
