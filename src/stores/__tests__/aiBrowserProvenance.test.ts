// WI-N1.1 — AI browser provenance, mode-aware deduplication, and restore safety
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore } from "../tabStore";
import { isBrowserTab } from "../tabStoreTypes";
import { migratePersistedTabs, serializeSessionTabs } from "@/services/persistence/sessionTabs";
import type { Tab } from "../tabStoreTypes";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
});

describe("browser automation provenance", () => {
  it("defaults user-created tabs to human mode", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://example.com/");
    const tab = useTabStore.getState().findTabById(id);
    expect(tab && isBrowserTab(tab) ? tab.automationMode : undefined).toBe("human");
  });

  it("does not deduplicate an AI sandbox tab into a human tab", () => {
    const human = useTabStore.getState().createBrowserTab("main", "https://example.com/");
    const sandbox = useTabStore
      .getState()
      .createBrowserTab("main", "https://example.com/", undefined, "ai-sandbox");

    expect(sandbox).not.toBe(human);
    expect(useTabStore.getState().getTabsByWindow("main")).toHaveLength(2);
  });

  it("deduplicates only same-url same-mode tabs", () => {
    const first = useTabStore
      .getState()
      .createBrowserTab("main", "https://example.com/", undefined, "ai-sandbox");
    const second = useTabStore
      .getState()
      .createBrowserTab("main", "https://example.com:443/#x", undefined, "ai-sandbox");

    expect(second).toBe(first);
  });

  it("drops transient AI records during restore and defaults legacy records to human", () => {
    const parsed = migratePersistedTabs({
      version: 1,
      tabs: [
        { kind: "browser", url: "https://human.example/", title: "Human", automationMode: "human" },
        { kind: "browser", url: "https://ai.example/", title: "AI", automationMode: "ai-sandbox" },
      ],
    }, []);

    expect(parsed).toEqual([
      {
        kind: "browser",
        url: "https://human.example/",
        title: "Human",
      },
    ]);
  });

  it("does not serialize AI tabs into workspace session state", () => {
    const tabs: Tab[] = [
      {
        kind: "browser",
        id: "human",
        url: "https://human.example/",
        title: "Human",
        isPinned: false,
        automationMode: "human",
      },
      {
        kind: "browser",
        id: "ai",
        url: "https://ai.example/",
        title: "AI",
        isPinned: false,
        automationMode: "ai-sandbox",
      },
    ];

    expect(serializeSessionTabs(tabs).tabs).toEqual([
      {
        kind: "browser",
        url: "https://human.example/",
        title: "Human",
      },
    ]);
  });
});
