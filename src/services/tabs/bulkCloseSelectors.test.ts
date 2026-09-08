// @vitest-environment node
// WI-FL5.8 — bulkCloseSelectors: which tabs each bulk-close action targets
// (ledger F7, tab-context-menu). Pinned tabs are excluded from EVERY selector:
// `closeTab` refuses them, so including one would silently no-op.
import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabStore";
import { closeAllUnpinnedIds, closeOthersIds, closeToRightIds } from "./bulkCloseSelectors";

function doc(id: string, isPinned = false): Tab {
  return { kind: "document", id, title: id, isPinned, filePath: `/ws/${id}.md`, formatId: "markdown" };
}

function browser(id: string, isPinned = false): Tab {
  return {
    kind: "browser",
    id,
    title: id,
    isPinned,
    automationMode: "human",
    persistPolicy: "restore-human",
    url: `https://${id}.example`,
    generation: 0,
  };
}

// Strip order: pinned zone on the left, then documents and a browser tab.
const STRIP: Tab[] = [doc("p1", true), doc("p2", true), doc("a"), browser("web"), doc("b"), doc("c")];
const ids = (tabs: Tab[]) => tabs.map((t) => t.id);

describe("closeOthersIds", () => {
  it("targets every unpinned tab except the clicked one, in strip order", () => {
    expect(closeOthersIds(STRIP, "b")).toEqual(["a", "web", "c"]);
  });

  it("never targets a pinned tab, even when the clicked tab is itself pinned", () => {
    expect(closeOthersIds(STRIP, "p1")).toEqual(["a", "web", "b", "c"]);
  });

  it("is empty when the clicked tab is the only unpinned one", () => {
    expect(closeOthersIds([doc("p1", true), doc("solo")], "solo")).toEqual([]);
  });

  it("an unknown clicked id excludes nothing", () => {
    expect(closeOthersIds(STRIP, "ghost")).toEqual(["a", "web", "b", "c"]);
  });
});

describe("closeToRightIds", () => {
  it("targets the unpinned tabs strictly after the clicked index", () => {
    expect(closeToRightIds(STRIP, ids(STRIP).indexOf("a"))).toEqual(["web", "b", "c"]);
  });

  it("skips a pinned tab to the right", () => {
    const strip = [doc("a"), doc("p", true), doc("b")];
    expect(closeToRightIds(strip, 0)).toEqual(["b"]);
  });

  it("is empty for the last tab", () => {
    expect(closeToRightIds(STRIP, STRIP.length - 1)).toEqual([]);
  });

  it("from inside the pinned zone, targets every unpinned tab to the right", () => {
    expect(closeToRightIds(STRIP, 0)).toEqual(["a", "web", "b", "c"]);
  });
});

describe("closeAllUnpinnedIds", () => {
  it("targets every unpinned tab, the clicked one included, and no pinned tab", () => {
    expect(closeAllUnpinnedIds(STRIP)).toEqual(["a", "web", "b", "c"]);
  });

  it("is empty when everything is pinned, and for an empty strip", () => {
    expect(closeAllUnpinnedIds([doc("p1", true), browser("pw", true)])).toEqual([]);
    expect(closeAllUnpinnedIds([])).toEqual([]);
  });
});

describe("the three selectors agree on the pinned rule", () => {
  it("no selector ever returns a pinned id", () => {
    const pinned = new Set(STRIP.filter((t) => t.isPinned).map((t) => t.id));
    const everything = [
      ...STRIP.flatMap((t) => closeOthersIds(STRIP, t.id)),
      ...STRIP.flatMap((_t, i) => closeToRightIds(STRIP, i)),
      ...closeAllUnpinnedIds(STRIP),
    ];
    expect(everything.filter((id) => pinned.has(id))).toEqual([]);
  });

  it("selectors do not mutate the strip", () => {
    const copy = STRIP.map((t) => ({ ...t }));
    closeOthersIds(STRIP, "a");
    closeToRightIds(STRIP, 1);
    closeAllUnpinnedIds(STRIP);
    expect(STRIP).toEqual(copy);
  });
});
