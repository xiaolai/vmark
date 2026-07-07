/**
 * Direct unit tests for groupInlineItems — the recursive mark-factoring
 * pass of PM → MDAST serialization (#1102). Covers shared-mark runs,
 * attr-sensitive link merging, atom run-splitting, duplicate-mark
 * convergence, and tie-break nesting order.
 */
import { describe, it, expect } from "vitest";
import type { PhrasingContent } from "mdast";
import type { Mark } from "@tiptap/pm/model";
import { groupInlineItems, type InlineItem } from "../pmInlineConverters";
import { testSchema } from "../testSchema";

const bold = () => testSchema.marks.bold.create();
const italic = () => testSchema.marks.italic.create();
const linkTo = (href: string) => testSchema.marks.link.create({ href });

function text(value: string): PhrasingContent {
  return { type: "text", value };
}

function item(content: PhrasingContent, ...marks: Mark[]): InlineItem {
  return { content, marks };
}

describe("groupInlineItems", () => {
  it("returns [] for no items", () => {
    expect(groupInlineItems([])).toEqual([]);
  });

  it("passes unmarked content through", () => {
    expect(groupInlineItems([item(text("a"))])).toEqual([text("a")]);
  });

  it("factors a shared mark across a run (bold spanning italic)", () => {
    const out = groupInlineItems([
      item(text("a "), bold()),
      item(text("b"), bold(), italic()),
      item(text(" c"), bold()),
    ]);
    expect(out).toEqual([
      {
        type: "strong",
        children: [
          text("a "),
          { type: "emphasis", children: [text("b")] },
          text(" c"),
        ],
      },
    ]);
  });

  it("prefers the longer run over the single-item outermost mark", () => {
    // First item's outermost mark (italic) spans 1 item; bold spans 2.
    const out = groupInlineItems([
      item(text("a"), bold(), italic()),
      item(text(" b"), bold()),
    ]);
    expect(out).toEqual([
      {
        type: "strong",
        children: [{ type: "emphasis", children: [text("a")] }, text(" b")],
      },
    ]);
  });

  it("does not merge links with different hrefs", () => {
    const out = groupInlineItems([
      item(text("a"), linkTo("https://a.example/")),
      item(text("b"), linkTo("https://b.example/")),
    ]);
    expect(out).toEqual([
      { type: "link", url: "https://a.example/", children: [text("a")] },
      { type: "link", url: "https://b.example/", children: [text("b")] },
    ]);
  });

  it("merges consecutive items sharing an identical link mark", () => {
    const out = groupInlineItems([
      item(text("a"), linkTo("https://a.example/")),
      item(text("b"), linkTo("https://a.example/")),
    ]);
    expect(out).toEqual([
      { type: "link", url: "https://a.example/", children: [text("a"), text("b")] },
    ]);
  });

  it("splits a run at an unmarked atom", () => {
    const out = groupInlineItems([
      item(text("a"), bold()),
      item({ type: "break" }),
      item(text("b"), bold()),
    ]);
    expect(out).toEqual([
      { type: "strong", children: [text("a")] },
      { type: "break" },
      { type: "strong", children: [text("b")] },
    ]);
  });

  it("converges duplicate same-type marks to a single wrapper", () => {
    const out = groupInlineItems([item(text("a"), bold(), bold())]);
    expect(out).toEqual([{ type: "strong", children: [text("a")] }]);
  });

  it("keeps the historical nesting order on ties (last mark outermost)", () => {
    const out = groupInlineItems([item(text("a"), bold(), italic())]);
    expect(out).toEqual([
      { type: "emphasis", children: [{ type: "strong", children: [text("a")] }] },
    ]);
  });
});
