// WI: issue #1182 — fit-to-width tables must distribute column widths by content
/**
 * Fit-to-width table layout regression tests (issue #1182)
 *
 * Fit-to-width mode pins the table to the editor width. It must do so with
 * the browser's AUTO table layout, which distributes column widths
 * proportionally to content. `table-layout: fixed` without a <colgroup>
 * divides columns EQUALLY regardless of content — short columns waste
 * space while long columns wrap into tall cells (the #1182 complaint).
 *
 * Under auto layout a cell's min-content width is set by its longest
 * unbreakable token (e.g. a URL), which could push the table past 100%.
 * `overflow-wrap: anywhere` is the spec-guaranteed way to let such tokens
 * break during intrinsic sizing (`overflow-wrap: break-word` does NOT
 * participate in min-content sizing), so the cells must carry it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const css = readFileSync("src/components/Editor/editor.css", "utf8");

/** Extract the declaration body of the rule for a given selector. */
function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule for "${selector}" must exist`).not.toBeNull();
  return match![1];
}

const FIT_TABLE_SELECTORS = [
  // Global setting (Settings → Markdown → table fit to width)
  ".table-fit-to-width .tiptap-editor .table-scroll-wrapper table",
  // Per-table context-menu toggle
  ".tiptap-editor .table-scroll-wrapper.table-fit-to-width table",
];

const FIT_CELL_SELECTORS = [
  ".table-fit-to-width .tiptap-editor .table-scroll-wrapper td,\n.table-fit-to-width .tiptap-editor .table-scroll-wrapper th",
  ".tiptap-editor .table-scroll-wrapper.table-fit-to-width td,\n.tiptap-editor .table-scroll-wrapper.table-fit-to-width th",
];

describe("fit-to-width table layout (issue #1182)", () => {
  it("never uses the equal-split fixed table layout anywhere in editor.css", () => {
    expect(css).not.toContain("table-layout: fixed");
  });

  it.each(FIT_TABLE_SELECTORS)("%s fills the editor width with auto layout", (selector) => {
    const body = declarationsOf(selector);
    expect(body).toContain("width: 100%");
    expect(body).toContain("table-layout: auto");
  });

  it.each(FIT_CELL_SELECTORS)(
    "cells break long tokens during intrinsic sizing (%s)",
    (selector) => {
      const body = declarationsOf(selector);
      expect(body).toContain("overflow-wrap: anywhere");
    },
  );
});
