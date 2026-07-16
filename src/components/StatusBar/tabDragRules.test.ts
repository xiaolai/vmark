import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabStore";
import {
  getLastPinnedIndex,
  normalizeInsertionIndex,
  planDocumentReorder,
  planReorder,
} from "./tabDragRules";

function createTab(id: string, isPinned = false): Tab {
  return {
    id,
    title: id,
    filePath: `${id}.md`,
    isPinned,
  };
}

function browserTab(id: string): Tab {
  return {
    kind: "browser",
    id,
    url: `https://${id}.example/`,
    title: id,
    isPinned: false,
    automationMode: "human",
    persistPolicy: "restore-human",
  };
}

describe("tabDragRules", () => {
  it("normalizes forward visual insertion index", () => {
    expect(normalizeInsertionIndex(0, 3, 4)).toBe(2);
  });

  it("normalizes backward visual insertion index", () => {
    expect(normalizeInsertionIndex(3, 1, 4)).toBe(1);
  });

  it("computes last pinned index", () => {
    const tabs = [createTab("a", true), createTab("b", true), createTab("c"), createTab("d")];
    expect(getLastPinnedIndex(tabs)).toBe(1);
  });

  it("blocks unpinned tab entering pinned zone", () => {
    const tabs = [createTab("a", true), createTab("b"), createTab("c")];
    const plan = planReorder(tabs, 2, 0);
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toBe("pinned-zone");
    expect(plan.toIndex).toBe(1);
  });

  it("allows unpinned tab reordering within unpinned zone", () => {
    const tabs = [createTab("a", true), createTab("b"), createTab("c")];
    const plan = planReorder(tabs, 2, 2);
    expect(plan.allowed).toBe(true);
    expect(plan.blockedReason).toBe("none");
    expect(plan.toIndex).toBe(2);
  });

  it("blocks pinned tab leaving pinned zone", () => {
    const tabs = [createTab("a", true), createTab("b", true), createTab("c")];
    const plan = planReorder(tabs, 0, 3);
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toBe("pinned-zone");
    expect(plan.toIndex).toBe(1);
  });

  it("rejects invalid from index", () => {
    const tabs = [createTab("a"), createTab("b")];
    const plan = planReorder(tabs, -1, 1);
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toBe("none");
  });

  it("clamps insertion index to bounds", () => {
    expect(normalizeInsertionIndex(0, -5, 2)).toBe(0);
    expect(normalizeInsertionIndex(0, 100, 2)).toBe(1);
  });
});

describe("planDocumentReorder (document-space drop → flat store index)", () => {
  it("matches flat behavior when there are no browser pages", () => {
    const flat = [createTab("d0"), createTab("d1"), createTab("d2")];
    // drag d0 to the end (document drop index 3)
    const plan = planDocumentReorder(flat, "d0", 3);
    expect(plan).toEqual({ allowed: true, blockedReason: "none", fromFlat: 0, toFlat: 2 });
  });

  it("translates the drop index across an interleaved browser page (drag to end)", () => {
    // flat: [B, d0, d1, d2] — browser page at flat 0, documents at 1..3
    const flat = [browserTab("B"), createTab("d0"), createTab("d1"), createTab("d2")];
    const plan = planDocumentReorder(flat, "d0", 3); // document space: move d0 after d2
    expect(plan.allowed).toBe(true);
    expect(plan.fromFlat).toBe(1);
    expect(plan.toFlat).toBe(3); // flat index of the third document
  });

  it("translates a drag-to-front across an interleaved browser page", () => {
    const flat = [browserTab("B"), createTab("d0"), createTab("d1"), createTab("d2")];
    const plan = planDocumentReorder(flat, "d2", 0); // move d2 before d0
    expect(plan.allowed).toBe(true);
    expect(plan.fromFlat).toBe(3);
    expect(plan.toFlat).toBe(1); // first document's flat slot (after the browser page)
  });

  it("clamps a drop past the trailing workspace/globe tab to the last document", () => {
    // flat: [d0, B, d1] — a browser page sits between the two documents
    const flat = [createTab("d0"), browserTab("B"), createTab("d1")];
    const plan = planDocumentReorder(flat, "d0", 2); // drop at/after the globe
    expect(plan.allowed).toBe(true);
    expect(plan.fromFlat).toBe(0);
    expect(plan.toFlat).toBe(2); // d1's flat slot — d0 lands after d1
  });

  it("rejects dragging a browser page (never reorderable from the strip)", () => {
    const flat = [browserTab("B"), createTab("d0")];
    const plan = planDocumentReorder(flat, "B", 1);
    expect(plan.allowed).toBe(false);
  });

  it("is a no-op when the document lands on its own position", () => {
    const flat = [browserTab("B"), createTab("d0"), createTab("d1")];
    const plan = planDocumentReorder(flat, "d1", 1); // d1 is already document index 1
    expect(plan.allowed).toBe(false);
    expect(plan.toFlat).toBe(plan.fromFlat);
  });

  it("propagates a pinned-zone block in document space", () => {
    // flat: [p0 (pinned doc), B, d1] — dragging d1 into the pinned zone
    const p0 = createTab("p0", true);
    const flat = [p0, browserTab("B"), createTab("d1")];
    const plan = planDocumentReorder(flat, "d1", 0);
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toBe("pinned-zone");
  });
});
