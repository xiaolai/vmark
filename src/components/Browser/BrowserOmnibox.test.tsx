// WI-S1.3 — BrowserOmnibox: browser nav chrome rendered in the bottom StatusBar
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({
  submitOmnibox: vi.fn(),
  reloadBrowser: vi.fn(),
  backBrowser: vi.fn(),
  forwardBrowser: vi.fn(),
  stopBrowser: vi.fn(),
}));
vi.mock("@/services/browser/browserNavigation", () => nav);

import { BrowserOmnibox } from "./BrowserOmnibox";
import { useBrowserUiStore } from "@/stores/browserUiStore";

const TAB = "tab-1";

beforeEach(() => {
  cleanup();
  Object.values(nav).forEach((fn) => fn.mockClear());
  useBrowserUiStore.setState({ entries: {} });
  useBrowserUiStore.getState().ensureEntry(TAB, "https://example.com/");
  useBrowserUiStore.getState().setLoading(TAB, false);
});

describe("BrowserOmnibox", () => {
  it("shows the tab's current URL in the address bar", () => {
    render(<BrowserOmnibox tabId={TAB} />);
    expect(screen.getByRole("textbox")).toHaveValue("https://example.com/");
  });

  it("submits the omnibox on Enter", async () => {
    render(<BrowserOmnibox tabId={TAB} />);
    const bar = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(bar);
    await user.type(bar, "example.org{Enter}");
    expect(nav.submitOmnibox).toHaveBeenCalledWith(TAB, "example.org");
  });

  it("updates the stored urlInput as the user types", async () => {
    render(<BrowserOmnibox tabId={TAB} />);
    const bar = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(bar);
    await user.type(bar, "abc");
    expect(useBrowserUiStore.getState().entries[TAB].urlInput).toBe("abc");
  });

  it("invokes back / forward from the history buttons", async () => {
    // Both controls are disabled without history (WI-S1.6), so give the tab some.
    useBrowserUiStore.getState().setHistory(TAB, true, true);
    render(<BrowserOmnibox tabId={TAB} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /forward/i }));
    expect(nav.backBrowser).toHaveBeenCalledWith(TAB);
    expect(nav.forwardBrowser).toHaveBeenCalledWith(TAB);
  });

  it("shows a reload button when idle and reloads on click", async () => {
    render(<BrowserOmnibox tabId={TAB} />);
    await userEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(nav.reloadBrowser).toHaveBeenCalledWith(TAB);
  });

  it("shows a stop button while loading and stops on click", async () => {
    useBrowserUiStore.getState().setLoading(TAB, true);
    render(<BrowserOmnibox tabId={TAB} />);
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(nav.stopBrowser).toHaveBeenCalledWith(TAB);
  });

  // WI-S1.6 (Codex re-review D3#5): back/forward were always enabled, so a fresh
  // tab with no history offered two controls that silently did nothing.
  it("disables back/forward when the page has no history", () => {
    render(<BrowserOmnibox tabId={TAB} />);
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /forward/i })).toBeDisabled();
  });

  it("enables back/forward according to the webview's history state", () => {
    useBrowserUiStore.getState().setHistory(TAB, true, false);
    render(<BrowserOmnibox tabId={TAB} />);
    expect(screen.getByRole("button", { name: /back/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /forward/i })).toBeDisabled();
  });

  it("does not navigate history when a disabled control is clicked", async () => {
    render(<BrowserOmnibox tabId={TAB} />);
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(nav.backBrowser).not.toHaveBeenCalled();
  });
});
