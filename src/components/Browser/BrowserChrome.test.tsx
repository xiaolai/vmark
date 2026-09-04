import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserChrome } from "./BrowserChrome";
import { useTabStore } from "@/stores/tabStore";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/components/Browser/BrowserOmnibox", () => ({
  BrowserOmnibox: ({ tabId }: { tabId: string }) => <div data-testid="omnibox">{tabId}</div>,
}));
vi.mock("@/services/tabs/tabOperations", () => ({
  closeTabWithDirtyCheck: vi.fn(() => Promise.resolve(true)),
}));

describe("BrowserChrome", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: {},
      activeTabId: {},
      untitledCounter: 0,
    });
  });

  it("renders webpage tabs and the address bar in the workspace", () => {
    const first = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example", "Two");

    render(<BrowserChrome />);

    expect(screen.getByRole("tablist", { name: "Webpages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /One/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Two/ })).toHaveAttribute("aria-selected", "true");
    // Off macOS this placement IS the browser's only chrome, so it carries the
    // omnibox too — the title-bar strip it used to live in is not rendered there
    // (#1296). The two placements are mutually exclusive by platform, so this
    // cannot double up with the title bar's copy.
    expect(screen.getByTestId("omnibox")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: /One/ }), { key: "Enter" });
    expect(useTabStore.getState().activeTabId.main).toBe(first);

    fireEvent.click(screen.getByRole("tab", { name: /One/ }));
    expect(useTabStore.getState().activeTabId.main).toBe(first);
  });

  it("addresses the window's active page when the caller names none", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    const two = useTabStore.getState().createBrowserPage("main", "https://two.example", "Two");

    render(<BrowserChrome />);

    expect(screen.getByTestId("omnibox")).toHaveTextContent(two);
  });

  it("addresses the page it is GIVEN — the pane's, not the window's (split view)", () => {
    const one = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example", "Two"); // window-active

    render(<BrowserChrome activePageId={one} />);

    // A pane showing page One must not hand its address bar to page Two: the
    // omnibox drives navigation, so aiming it elsewhere would navigate a page
    // the user cannot see.
    expect(screen.getByTestId("omnibox")).toHaveTextContent(one);
  });

  it("renders nothing when the window has no browser page at all", () => {
    render(<BrowserChrome />);

    expect(screen.queryByRole("tablist", { name: "Webpages" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("omnibox")).not.toBeInTheDocument();
  });

  it("renders nothing for an id that was never a page", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");

    render(<BrowserChrome activePageId="tab-does-not-exist" />);

    // Binding the omnibox to a dead id would point navigation at nothing while
    // the chrome looked normal — no tab selected, submit silently misfiring.
    expect(screen.queryByTestId("omnibox")).not.toBeInTheDocument();
  });

  it("drops the chrome when the page it addresses is CLOSED", () => {
    // The reactive path, not a synthetic bad id: the page exists, the chrome
    // renders, then the page goes away underneath it. This is how a stale id
    // actually arises in the app.
    const one = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example", "Two");

    const { rerender } = render(<BrowserChrome activePageId={one} />);
    expect(screen.getByTestId("omnibox")).toHaveTextContent(one);

    useTabStore.getState().closeTab("main", one);
    rerender(<BrowserChrome activePageId={one} />);

    expect(screen.queryByTestId("omnibox")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Webpages" })).not.toBeInTheDocument();
  });

  it("renders nothing for a DOCUMENT tab id", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    const doc = useTabStore.getState().createTab("main");

    render(<BrowserChrome activePageId={doc} />);

    expect(screen.queryByTestId("omnibox")).not.toBeInTheDocument();
  });

  it("the close button is a sibling of its tab, so Enter on it never reaches the tab (#163)", () => {
    const first = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example", "Two"); // Two is active
    render(<BrowserChrome />);

    const oneTab = screen.getByRole("tab", { name: /One/ });
    const closeBtn = screen.getByRole("button", { name: "Close One" });
    // Not nested: a keydown on the close control has no tab above it to bubble into.
    expect(oneTab.contains(closeBtn)).toBe(false);
    fireEvent.keyDown(closeBtn, { key: "Enter" });
    expect(useTabStore.getState().activeTabId.main).not.toBe(first);
  });

  it("creates a fresh webpage when the top plus button is clicked", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    render(<BrowserChrome />);

    fireEvent.click(screen.getByRole("button", { name: "New webpage" }));

    expect(useTabStore.getState().tabs.main).toHaveLength(2);
    expect(useTabStore.getState().activeTabId.main).toBe(useTabStore.getState().tabs.main?.[1].id);
  });

  it("renders webpage tabs and navigation together in the title bar", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    render(<BrowserChrome placement="titlebar" />);

    expect(screen.getByRole("tablist", { name: "Webpages" })).toBeInTheDocument();
    expect(screen.getByTestId("omnibox")).toHaveTextContent("tab-");
    expect(document.querySelector(".browser-titlebar-navigation")).toBeInTheDocument();
    expect(document.querySelector(".browser-titlebar-drag-space")).toHaveAttribute(
      "data-tauri-drag-region",
    );
  });

  it("uses the webpage title instead of its URL for the tab label", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example");
    render(<BrowserChrome />);

    expect(screen.getByRole("tab", { name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "New webpage" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /two\.example/ })).not.toBeInTheDocument();
  });
});

// WI-NB5.1 — the "AI is controlling" indicator + chrome-interaction reclaim.
// The chrome is the one place React CAN see human input (the page itself is a
// native sibling view), so any interaction here while the AI holds the lease is
// a takeover.
describe("AI lease indicator (WI-NB5.1)", () => {
  async function leaseStore() {
    const { useBrowserLeaseStore } = await import("@/services/browser/lease");
    return useBrowserLeaseStore;
  }

  beforeEach(async () => {
    (await leaseStore()).setState({ leases: {}, inflightCancel: {} });
  });

  it("shows a takeover button while the AI holds the active page's lease", async () => {
    const store = await leaseStore();
    const id = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    store.getState().acquireForAi(id);

    render(<BrowserChrome />);
    const takeover = screen.getByRole("button", { name: /AI is controlling/i });
    expect(takeover).toBeInTheDocument();

    fireEvent.click(takeover);
    expect(store.getState().currentHolder(id)).toBe("human");
  });

  it("renders no indicator when nobody holds a lease", () => {
    useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    render(<BrowserChrome />);
    expect(screen.queryByRole("button", { name: /AI is controlling/i })).toBeNull();
  });

  it("any chrome interaction reclaims an AI-held lease (capture phase)", async () => {
    const store = await leaseStore();
    const id = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    store.getState().acquireForAi(id);

    render(<BrowserChrome />);
    fireEvent.mouseDown(screen.getByTestId("omnibox"));
    expect(store.getState().currentHolder(id)).toBe("human");
  });
});
