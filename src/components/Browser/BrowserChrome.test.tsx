import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BrowserChrome } from "./BrowserChrome";
import { useTabStore } from "@/stores/tabStore";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/components/Browser/BrowserOmnibox", () => ({
  BrowserOmnibox: ({ tabId }: { tabId: string }) => <div data-testid="omnibox">{tabId}</div>,
}));
vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: vi.fn(() => Promise.resolve(true)),
}));

describe("BrowserChrome", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: {},
      activeTabId: {},
      untitledCounter: 0,
      closedTabs: {},
    });
  });

  it("renders webpage tabs without duplicating the title-bar navigation", () => {
    const first = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example", "Two");

    render(<BrowserChrome />);

    expect(screen.getByRole("tablist", { name: "Webpages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /One/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Two/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("omnibox")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: /One/ }), { key: "Enter" });
    expect(useTabStore.getState().activeTabId.main).toBe(first);

    fireEvent.click(screen.getByRole("tab", { name: /One/ }));
    expect(useTabStore.getState().activeTabId.main).toBe(first);
  });

  it("does not activate a page when Enter bubbles from its close button", () => {
    const first = useTabStore.getState().createBrowserTab("main", "https://one.example", "One");
    useTabStore.getState().createBrowserPage("main", "https://two.example", "Two"); // Two is active
    render(<BrowserChrome />);

    const oneTab = screen.getByRole("tab", { name: /One/ });
    const closeBtn = within(oneTab).getByRole("button");
    fireEvent.keyDown(closeBtn, { key: "Enter" });

    // The keydown bubbles to the tab, but the target guard must prevent it from
    // activating the very page it is about to close.
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
