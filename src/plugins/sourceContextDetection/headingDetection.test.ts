import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getHeadingInfo, setHeadingLevel, convertToHeading } from "./headingDetection";

function createView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("getHeadingInfo", () => {
  it.each([
    { doc: "# Heading 1", cursor: 5, level: 1 },
    { doc: "## Heading 2", cursor: 5, level: 2 },
    { doc: "### Heading 3", cursor: 5, level: 3 },
    { doc: "#### Heading 4", cursor: 5, level: 4 },
    { doc: "##### Heading 5", cursor: 5, level: 5 },
    { doc: "###### Heading 6", cursor: 5, level: 6 },
  ])("detects heading level $level", ({ doc, cursor, level }) => {
    const view = createView(doc, cursor);
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(level);
    view.destroy();
  });

  it("returns null for plain paragraph", () => {
    const view = createView("Just a paragraph", 5);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("returns null for empty document", () => {
    const view = createView("", 0);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("returns null when # not followed by space", () => {
    const view = createView("#NoSpace", 3);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("returns null for more than 6 hashes", () => {
    const view = createView("####### Not a heading", 10);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("detects heading on multiline document", () => {
    const doc = "paragraph\n## Title\nmore text";
    const view = createView(doc, 14); // inside "Title"
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(2);
    view.destroy();
  });

  it("returns lineStart and lineEnd correctly", () => {
    const doc = "line one\n# Heading\nline three";
    const view = createView(doc, 12);
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.lineStart).toBe(9); // start of "# Heading"
    expect(info!.lineEnd).toBe(18); // end of "# Heading"
    view.destroy();
  });

  it("uses explicit pos parameter when provided", () => {
    const doc = "paragraph\n## Title\nmore text";
    const view = createView(doc, 0); // cursor at paragraph
    // Pass pos inside heading line
    const info = getHeadingInfo(view, 14);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(2);
    view.destroy();
  });

  it("handles heading with CJK text", () => {
    const view = createView("# 你好世界", 4);
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(1);
    view.destroy();
  });

  it("returns null for blank line", () => {
    const doc = "text\n\nmore";
    const view = createView(doc, 5); // at the blank line
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });
});

describe("setHeadingLevel", () => {
  it("changes heading level from 1 to 3", () => {
    const view = createView("# Heading", 5);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 3);
    expect(view.state.doc.toString()).toBe("### Heading");
    view.destroy();
  });

  it("removes heading when level is 0", () => {
    const view = createView("## Title", 5);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("Title");
    view.destroy();
  });

  it("changes heading level from 3 to 1", () => {
    const view = createView("### Deep heading", 5);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 1);
    expect(view.state.doc.toString()).toBe("# Deep heading");
    view.destroy();
  });
});

describe("convertToHeading", () => {
  it("converts paragraph to heading", () => {
    const view = createView("Plain text", 3);
    convertToHeading(view, 2);
    expect(view.state.doc.toString()).toBe("## Plain text");
    view.destroy();
  });

  it("does nothing for level 0", () => {
    const view = createView("text", 2);
    convertToHeading(view, 0);
    expect(view.state.doc.toString()).toBe("text");
    view.destroy();
  });

  it("does nothing for level 7", () => {
    const view = createView("text", 2);
    convertToHeading(view, 7);
    expect(view.state.doc.toString()).toBe("text");
    view.destroy();
  });

  it("replaces existing heading markers when called on heading line", () => {
    const view = createView("### Old heading", 5);
    convertToHeading(view, 1);
    expect(view.state.doc.toString()).toBe("# Old heading");
    view.destroy();
  });

  it("uses explicit pos parameter", () => {
    const doc = "first line\nsecond line";
    const view = createView(doc, 0);
    convertToHeading(view, 3, 15); // pos in "second line"
    expect(view.state.doc.toString()).toBe("first line\n### second line");
    view.destroy();
  });
});

// ---------- block markers already on the line ----------

/**
 * Converting a line to a heading has to reckon with what is already at its
 * start. The helpers used to strip only an existing `#` run, so a list item
 * became `# - text` — a heading whose text begins with a bullet — and a
 * blockquote became `# > text`, a heading CONTAINING a literal `>`, destroying
 * the quote. WYSIWYG replaces the list marker and keeps the quote wrapper;
 * these cases pin that contract for Source.
 */
describe("heading conversion over existing block markers", () => {
  function convert(doc: string, cursor: number, level: number): string {
    const view = createView(doc, cursor);
    convertToHeading(view, level);
    const out = view.state.doc.toString();
    view.destroy();
    return out;
  }

  it.each([
    { name: "bullet item", doc: "- The quick brown fox", expected: "# The quick brown fox" },
    { name: "star bullet", doc: "* The quick brown fox", expected: "# The quick brown fox" },
    { name: "ordered item", doc: "1. The quick brown fox", expected: "# The quick brown fox" },
    { name: "ordered paren", doc: "1) The quick brown fox", expected: "# The quick brown fox" },
    { name: "task item", doc: "- [ ] The quick brown fox", expected: "# The quick brown fox" },
    { name: "checked task", doc: "- [x] The quick brown fox", expected: "# The quick brown fox" },
    { name: "indented item", doc: "  - The quick brown fox", expected: "# The quick brown fox" },
  ])("replaces a $name marker rather than heading it", ({ doc, expected }) => {
    expect(convert(doc, doc.length - 1, 1)).toBe(expected);
  });

  it.each([
    { name: "blockquote", doc: "> The quick brown fox", expected: "> # The quick brown fox" },
    { name: "nested blockquote", doc: "> > The quick brown fox", expected: "> > # The quick brown fox" },
    { name: "quoted list item", doc: "> - The quick brown fox", expected: "> # The quick brown fox" },
  ])("keeps the $name wrapper and puts the heading inside", ({ doc, expected }) => {
    expect(convert(doc, doc.length - 1, 1)).toBe(expected);
  });

  it("still replaces an existing heading run", () => {
    expect(convert("### The quick brown fox", 8, 1)).toBe("# The quick brown fox");
  });

  it("detects a heading nested inside a blockquote", () => {
    const view = createView("> ## Quoted heading", 10);
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(2);
    view.destroy();
  });

  it("steps a quoted heading without losing the quote", () => {
    const view = createView("> ## Quoted heading", 10);
    const info = getHeadingInfo(view);
    setHeadingLevel(view, info!, 3);
    expect(view.state.doc.toString()).toBe("> ### Quoted heading");
    view.destroy();
  });

  it("returns a quoted heading to a paragraph inside its quote", () => {
    const view = createView("> # Quoted heading", 10);
    const info = getHeadingInfo(view);
    setHeadingLevel(view, info!, 0);
    expect(view.state.doc.toString()).toBe("> Quoted heading");
    view.destroy();
  });
});

// ---------- CommonMark block-prefix indentation (0-3 spaces) ----------

describe("leading-space handling (CommonMark: 0-3 allowed, 4+ is indented code)", () => {
  it.each([
    { doc: " # one space", level: 1 },
    { doc: "  ## two spaces", level: 2 },
    { doc: "   ### three spaces", level: 3 },
  ])("detects $doc", ({ doc, level }) => {
    const view = createView(doc, doc.length - 1);
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(level);
    view.destroy();
  });

  it("returns null for a four-space-indented hash run (indented code)", () => {
    const view = createView("    # not a heading", 8);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("detects a heading indented inside a quote", () => {
    const view = createView(">   ## indented in quote", 10);
    const info = getHeadingInfo(view);
    expect(info).not.toBeNull();
    expect(info!.level).toBe(2);
    view.destroy();
  });

  it("returns null when the quote marker itself is code-indented", () => {
    const view = createView("    > # not a quote", 10);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("returns null for 4+ spaces after the quote marker (code inside quote)", () => {
    const view = createView(">     # code in quote", 10);
    expect(getHeadingInfo(view)).toBeNull();
    view.destroy();
  });

  it("drops the consumed indent when converting an indented heading", () => {
    const view = createView("   ## indented", 6);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 1);
    expect(view.state.doc.toString()).toBe("# indented");
    view.destroy();
  });
});

// ---------- ATX closing sequences ----------

/**
 * CommonMark: a trailing run of #s closes an ATX heading when preceded by a
 * space and followed by nothing but spaces. Stripping only the OPENING run
 * turned "## title ##" into "title ##".
 */
describe("ATX closing sequences", () => {
  it("strips the closing run when removing a heading", () => {
    const view = createView("## title ##", 4);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("title");
    view.destroy();
  });

  it("strips the closing run when changing level", () => {
    const view = createView("## title ##", 4);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 3);
    expect(view.state.doc.toString()).toBe("### title");
    view.destroy();
  });

  it("strips a closing run of a different length than the opening", () => {
    const view = createView("# title ######", 3);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("title");
    view.destroy();
  });

  it("strips a closing run trailed by spaces", () => {
    const view = createView("## title ##  ", 4);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("title");
    view.destroy();
  });

  it("empties a heading that is only an opening and closing run", () => {
    const view = createView("### ###", 2);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("keeps an ESCAPED trailing hash run (\\## is content, not a closer)", () => {
    const view = createView("## title \\##", 4);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("title \\##");
    view.destroy();
  });

  it("keeps a hash run not followed by only spaces", () => {
    const view = createView("## title ##x", 4);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("title ##x");
    view.destroy();
  });

  it("keeps an interior hash run without trailing spaces (#hash content)", () => {
    const view = createView("# tag #hash", 3);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 0);
    expect(view.state.doc.toString()).toBe("tag #hash");
    view.destroy();
  });

  it("keeps the quote wrapper while stripping a closing run", () => {
    const view = createView("> ## quoted ##", 6);
    const info = getHeadingInfo(view)!;
    setHeadingLevel(view, info, 1);
    expect(view.state.doc.toString()).toBe("> # quoted");
    view.destroy();
  });
});
