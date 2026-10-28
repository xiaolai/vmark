// @vitest-environment node
// A tab whose state cleanup fails must not abort the removal it is reacting to: the removal bus
// is synchronous, so a throw from this subscriber stopped `removeWindow` notifying — and cleaning
// up — every later tab, and stopped every later subscriber hearing of the failed one. The failure
// is still reported, once per tab.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { startTabStateCleanup } from "./tabCleanup";

const MAIN = "main";

function openTab(filePath: string): string {
  const tabId = useTabStore.getState().createTab(MAIN, filePath);
  useDocumentStore.getState().initDocument(tabId, "body", filePath);
  return tabId;
}

/** Make the revision step of cleanup throw for `failing` only. */
function failCleanupOf(failing: string): void {
  const clearRevision = useRevisionStore.getState().clearRevision;
  useRevisionStore.setState({
    clearRevision: (tabId: string) => {
      if (tabId === failing) throw new Error(`revision cleanup failed for ${tabId}`);
      clearRevision(tabId);
    },
  });
}

const report = vi.fn();
let stopCleanup: () => void;
let stopProbe: () => void;
let heard: string[];

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
  report.mockReset();
  heard = [];
  stopCleanup = startTabStateCleanup(report);
  // Subscribed AFTER cleanup, so it hears a removal only if cleanup did not abort the bus.
  stopProbe = onTabRemoved((_w, tabId) => heard.push(tabId));
});

afterEach(() => {
  stopProbe();
  stopCleanup();
});

describe("startTabStateCleanup — a failing cleanup", () => {
  it("does not stop removeWindow freeing the window's later tabs", () => {
    const first = openTab("/repo/一.md");
    const second = openTab("/repo/two.md");
    failCleanupOf(first);

    expect(() => useTabStore.getState().removeWindow(MAIN)).not.toThrow();

    expect(useDocumentStore.getState().getDocument(first)).toBeUndefined();
    expect(useDocumentStore.getState().getDocument(second)).toBeUndefined();
    expect(heard).toEqual([first, second]);
  });

  it("is reported once, naming the tab's failure", () => {
    const tabId = openTab("/repo/a.md");
    failCleanupOf(tabId);

    useTabStore.getState().closeTab(MAIN, tabId);

    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0]?.[0])).toContain(`revision cleanup failed for ${tabId}`);
  });

  it("reports nothing when every step succeeds", () => {
    useTabStore.getState().closeTab(MAIN, openTab("/repo/a.md"));
    expect(report).not.toHaveBeenCalled();
  });
});
