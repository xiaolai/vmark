// @vitest-environment node
/**
 * WI-2 case 3 — the default (rail-off) branch of activateTabWithWorkspaceContext
 * is pane-aware through the centralized activation seam (tabActivationBus), so
 * the ADR-1 invariant (focused pane's tab === tabStore.activeTabId) holds after
 * the call even under a split.
 *
 * Decision D2 (.claude/tdd-guardian/decisions-20260803.md): focus follows a tab
 * already shown in the other pane; an unpaned document lands in the focused
 * pane; browser tabs never touch panes.
 *
 * Real Zustand stores throughout (WI-18 mock boundary: no @/stores mocks).
 * The rail-on ownership branches are covered by workspaceActivationApis.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { activateTabWithWorkspaceContext } from "./activateTabWithWorkspaceContext";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  // Default config: workspace rail OFF → the plain-activation default branch.
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: false },
  });
});

/** The tab the FOCUSED pane displays — the ADR-1 alias target. */
function focusedPaneTab(): string | null {
  const split = usePaneStore.getState().getSplit(W);
  return split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
}

describe("activateTabWithWorkspaceContext default branch under a split (WI-2 case 3)", () => {
  it("activating a background document converges the focused pane and the alias", () => {
    const a = useTabStore.getState().createTab(W, "/a.md");
    const b = useTabStore.getState().createTab(W, "/b.md");
    const c = useTabStore.getState().createTab(W, "/c.md");
    useTabStore.getState().setActiveTab(W, a);
    usePaneStore.getState().openSplit(W, b); // panes a/b, focus secondary

    const result = activateTabWithWorkspaceContext(W, c);

    expect(result.activated).toBe(true);
    expect(useTabStore.getState().activeTabId[W]).toBe(c);
    // RED today: the default branch writes the raw alias and no pane shows c.
    expect(focusedPaneTab()).toBe(c);
  });

  it("activating the non-focused pane's tab moves focus there (D2 focus-follows-tab)", () => {
    const a = useTabStore.getState().createTab(W, "/a.md");
    const b = useTabStore.getState().createTab(W, "/b.md");
    useTabStore.getState().setActiveTab(W, a);
    usePaneStore.getState().openSplit(W, b); // focus secondary (b)

    const result = activateTabWithWorkspaceContext(W, a);

    expect(result.activated).toBe(true);
    const split = usePaneStore.getState().getSplit(W);
    expect(split.focusedPane).toBe("primary");
    expect(split.primaryTabId).toBe(a); // both panes keep their documents
    expect(split.secondaryTabId).toBe(b);
    expect(useTabStore.getState().activeTabId[W]).toBe(a);
  });

  it("a browser tab activates in place without touching the panes", () => {
    const a = useTabStore.getState().createTab(W, "/a.md");
    const b = useTabStore.getState().createTab(W, "/b.md");
    const web = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useTabStore.getState().setActiveTab(W, a);
    usePaneStore.getState().openSplit(W, b);

    const result = activateTabWithWorkspaceContext(W, web);

    expect(result.activated).toBe(true);
    expect(useTabStore.getState().activeTabId[W]).toBe(web);
    const split = usePaneStore.getState().getSplit(W);
    expect(split.primaryTabId).toBe(a);
    expect(split.secondaryTabId).toBe(b);
  });
});
