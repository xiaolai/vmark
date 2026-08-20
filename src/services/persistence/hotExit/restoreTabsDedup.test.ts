// @vitest-environment node
/**
 * Restore-time dedup, and the blind spot that made untitled tabs exempt.
 *
 * The function keyed on `file_path` and short-circuited on `null` with the note
 * "untitled tabs are never duplicates". That is true of the collision it was
 * originally written for — `tabStore.createTab` dedups by normalized path, so
 * two records for one FILE collapse into one tab and the second restore
 * overwrites the first's content — and untitled tabs cannot collide that way,
 * because `createTab(label, null)` always makes a new tab.
 *
 * But "cannot collide" is not "cannot be duplicated". Path was only ever a
 * PROXY for identity, and it is a proxy that does not exist for an untitled
 * tab, so a repeated record of one unsaved document was restored twice — once
 * per copy, every recovery. `id` is the actual identity and every persisted tab
 * has one.
 *
 * The dangerous direction here is over-dedup, not under-dedup: collapsing two
 * genuinely different unsaved drafts would DESTROY one of the user's
 * documents, which is far worse than showing a duplicate. Hence identity, never
 * content — the "two distinct untitled tabs" case below is the guard on that.
 */
import { describe, it, expect } from "vitest";
import { deduplicateTabs } from "./restoreTabsHelpers";
import type { TabState } from "./types";

const tab = (over: Partial<TabState> & { id: string }): TabState => ({
  file_path: null,
  title: "Untitled",
  is_pinned: false,
  format_id: "markdown",
  document: { content: "", saved_content: "", is_dirty: false } as TabState["document"],
  ...over,
});

describe("deduplicateTabs", () => {
  it("collapses a repeated record of the SAME untitled tab", () => {
    const draft = tab({ id: "t1", document: { content: "draft", saved_content: "", is_dirty: true } as TabState["document"] });
    const { kept, duplicateToRetained } = deduplicateTabs([draft, { ...draft }]);

    expect(kept.map((t) => t.id)).toEqual(["t1"]);
    // the dropped copy still resolves, so an active-tab id pointing at it works
    expect(duplicateToRetained.get("t1")).toBe("t1");
  });

  it("keeps two DIFFERENT untitled tabs — identity, never content", () => {
    // Two unsaved drafts that happen to hold the same text are two documents.
    // Collapsing them would silently destroy the user's work.
    const a = tab({ id: "t1", document: { content: "same", saved_content: "", is_dirty: true } as TabState["document"] });
    const b = tab({ id: "t2", document: { content: "same", saved_content: "", is_dirty: true } as TabState["document"] });
    expect(deduplicateTabs([a, b]).kept.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("collapses a repeated record of the same file-backed tab", () => {
    const f = tab({ id: "f1", file_path: "/w/a.md", title: "a.md" });
    expect(deduplicateTabs([f, { ...f }]).kept.map((t) => t.id)).toEqual(["f1"]);
  });

  it("still collapses two DIFFERENT records that name the same file", () => {
    // The original behaviour: distinct ids, one path. createTab would dedup
    // them anyway and the second ingest would overwrite the first.
    //
    // The equivalence used here is one `normalizePath` actually specifies —
    // separator and drive-letter case. It does NOT resolve `.`/`..` segments,
    // and does not case-fold the path body, because that would wrongly merge
    // distinct files on case-sensitive volumes. An earlier draft of this test
    // assumed `/w/./a.md` collapsed; it does not, and the code is right.
    const first = tab({ id: "f1", file_path: "C:/w/a.md" });
    const second = tab({ id: "f2", file_path: "C:\\w\\a.md" });
    const { kept, duplicateToRetained } = deduplicateTabs([first, second]);
    expect(kept.map((t) => t.id)).toEqual(["f1"]);
    expect(duplicateToRetained.get("f2")).toBe("f1");
  });

  it("keeps distinct files", () => {
    const a = tab({ id: "f1", file_path: "/w/a.md" });
    const b = tab({ id: "f2", file_path: "/w/b.md" });
    expect(deduplicateTabs([a, b]).kept).toHaveLength(2);
  });

  it("passes an empty list through", () => {
    expect(deduplicateTabs([]).kept).toEqual([]);
  });
});
