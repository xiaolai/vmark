/**
 * Mark-dedup tests for MDAST → PM inline conversion (#1102).
 *
 * Every mark converter must collapse nested identical MDAST wrappers to a
 * single PM mark (addMarkOnce) so the text run merges and re-serializes to
 * a fixed point. Links are the exception with data: the inner link binds,
 * replacing the outer href. Also pins the empty-inline-code guard.
 */
import { describe, it, expect } from "vitest";
import type { Root, PhrasingContent } from "mdast";
import { mdastToProseMirror } from "../mdastToProseMirror";
import { testSchema } from "../testSchema";

function rootWith(...children: PhrasingContent[]): Root {
  return {
    type: "root",
    children: [{ type: "paragraph", children }],
  } as Root;
}

function text(value: string): PhrasingContent {
  return { type: "text", value };
}

/** Build `<type>[ "a ", <type>["b"], " c" ]` — nested identical wrappers. */
function nestedSameType(type: string): PhrasingContent {
  return {
    type,
    children: [text("a "), { type, children: [text("b")] }, text(" c")],
  } as unknown as PhrasingContent;
}

describe("nested identical marks collapse to one (addMarkOnce)", () => {
  it.each([
    ["strong", "bold"],
    ["emphasis", "italic"],
    ["delete", "strike"],
    ["subscript", "subscript"],
    ["superscript", "superscript"],
    ["highlight", "highlight"],
    ["underline", "underline"],
  ])("%s → single %s mark, merged text run", (mdastType, markName) => {
    const doc = mdastToProseMirror(testSchema, rootWith(nestedSameType(mdastType)));
    const para = doc.child(0);
    // One merged text node — duplicates would split the run.
    expect(para.childCount).toBe(1);
    const textNode = para.child(0);
    expect(textNode.text).toBe("a b c");
    expect(textNode.marks).toHaveLength(1);
    expect(textNode.marks[0].type.name).toBe(markName);
  });
});

describe("nested links (inner binds)", () => {
  it("replaces the outer href with the inner one", () => {
    const nested = {
      type: "link",
      url: "https://outer.example/",
      children: [
        text("a "),
        {
          type: "link",
          url: "https://inner.example/",
          children: [text("b")],
        },
        text(" c"),
      ],
    } as unknown as PhrasingContent;
    const doc = mdastToProseMirror(testSchema, rootWith(nested));
    const para = doc.child(0);
    const hrefs: Array<string | undefined> = [];
    para.forEach((child) => {
      const link = child.marks.find((m) => m.type.name === "link");
      hrefs.push(link?.attrs.href as string | undefined);
      expect(child.marks.filter((m) => m.type.name === "link")).toHaveLength(1);
    });
    expect(hrefs).toEqual([
      "https://outer.example/",
      "https://inner.example/",
      "https://outer.example/",
    ]);
  });
});

describe("empty inline code", () => {
  it("drops an empty code span instead of throwing", () => {
    const doc = mdastToProseMirror(
      testSchema,
      rootWith(text("x"), { type: "inlineCode", value: "" }),
    );
    const para = doc.child(0);
    expect(para.textContent).toBe("x");
  });
});
