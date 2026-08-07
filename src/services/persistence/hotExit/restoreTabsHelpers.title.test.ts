/**
 * Hot-exit restore and the tab-title invariant (#1224).
 *
 * A tab's title is the file's real name, extension included. Sessions written
 * BEFORE that change persisted the stripped spelling ("README"), and restore
 * applied it verbatim on top of the correct title `createTab` had just derived
 * from the path — so the old spelling came back on every restart, for as long
 * as the session file survived.
 *
 * Uses the real tab store: mocking it here would test the mock's idea of
 * restore, and store mocks are barred by `pnpm lint:mock-boundaries`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { restoreTabMetadata } from "./restoreTabsHelpers";
import type { TabState } from "./types";

const WINDOW = "main";

function persisted(overrides: Partial<TabState>): TabState {
  return {
    id: "old-id",
    file_path: null,
    title: "Untitled",
    is_pinned: false,
    document: { content: "", saved_content: "" },
    ...overrides,
  } as TabState;
}

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
});

describe("restoreTabMetadata — titles", () => {
  it("ignores a legacy extensionless title for a file-backed tab", () => {
    const id = useTabStore.getState().createTab(WINDOW, "/w/README.md");
    restoreTabMetadata(
      WINDOW,
      id,
      persisted({ file_path: "/w/README.md", title: "README" }),
    );
    expect(useTabStore.getState().findTabById(id)?.title).toBe("README.md");
  });

  it("still restores the persisted title for an untitled tab", () => {
    // Untitled tabs have no path to derive from — the persisted name (and its
    // number) is the only record of which scratch tab this was.
    const id = useTabStore.getState().createTab(WINDOW, null);
    restoreTabMetadata(WINDOW, id, persisted({ file_path: null, title: "Untitled-7" }));
    expect(useTabStore.getState().findTabById(id)?.title).toBe("Untitled-7");
  });

  it("restores the pin regardless of which branch the title took", () => {
    const id = useTabStore.getState().createTab(WINDOW, "/w/notes.md");
    restoreTabMetadata(
      WINDOW,
      id,
      persisted({ file_path: "/w/notes.md", title: "notes", is_pinned: true }),
    );
    const tab = useTabStore.getState().findTabById(id);
    expect(tab?.isPinned).toBe(true);
    expect(tab?.title).toBe("notes.md");
  });
});
