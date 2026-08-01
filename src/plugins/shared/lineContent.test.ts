import { describe, it, expect } from "vitest";
import { stripBlockMarkup } from "./lineContent";
import { fenceRanges, enclosingFence, isDelimiterLine } from "./fenceScanner";

describe("stripBlockMarkup", () => {
  it.each([
    { line: "The quick brown fox", quote: "", indent: "", content: "The quick brown fox" },
    { line: "### The quick brown fox", quote: "", indent: "", content: "The quick brown fox" },
    { line: "###### deep", quote: "", indent: "", content: "deep" },
    { line: "- The quick brown fox", quote: "", indent: "", content: "The quick brown fox" },
    { line: "1. numbered", quote: "", indent: "", content: "numbered" },
    { line: "1) paren", quote: "", indent: "", content: "paren" },
    { line: "- [ ] todo", quote: "", indent: "", content: "todo" },
    { line: "- [x] done", quote: "", indent: "", content: "done" },
    { line: "> quoted", quote: "> ", indent: "", content: "quoted" },
    { line: "> > deep quote", quote: "> > ", indent: "", content: "deep quote" },
    { line: "> - quoted item", quote: "> ", indent: "", content: "quoted item" },
    { line: "> ### quoted heading", quote: "> ", indent: "", content: "quoted heading" },
  ])("$line", ({ line, quote, indent, content }) => {
    expect(stripBlockMarkup(line)).toEqual({ quote, indent, content });
  });

  // Indentation is CONTENT for a code block: it is what shows the nesting once
  // the markers are gone. `splitLine` in headingDetection discards it, which is
  // right for a heading conversion and wrong here.
  it("keeps a nested item's indentation", () => {
    expect(stripBlockMarkup("  - inner brown")).toEqual({
      quote: "",
      indent: "  ",
      content: "inner brown",
    });
  });

  it("keeps indentation on a plain indented line", () => {
    expect(stripBlockMarkup("    code-ish")).toEqual({
      quote: "",
      indent: "    ",
      content: "code-ish",
    });
  });

  it("leaves a blank line blank", () => {
    expect(stripBlockMarkup("")).toEqual({ quote: "", indent: "", content: "" });
  });

  it("does not mistake a thematic break for a list marker", () => {
    expect(stripBlockMarkup("---")).toEqual({ quote: "", indent: "", content: "---" });
  });

  it("does not strip an emphasis marker", () => {
    expect(stripBlockMarkup("*emphasis* here")).toEqual({
      quote: "",
      indent: "",
      content: "*emphasis* here",
    });
  });

  it("reports indentation found INSIDE a quote wrapper", () => {
    // The quote is the wrapper; the whitespace after it is the content's own
    // nesting, which a quoted nested list depends on.
    expect(stripBlockMarkup(">   deep inside")).toEqual({
      quote: "> ",
      indent: "  ",
      content: "deep inside",
    });
  });

  it("treats an underline-length rule inside a quote as content", () => {
    expect(stripBlockMarkup("> ---")).toEqual({ quote: "> ", indent: "", content: "---" });
  });

  it("handles CJK content", () => {
    expect(stripBlockMarkup("- 中文内容")).toEqual({ quote: "", indent: "", content: "中文内容" });
  });

  it("strips only ONE list marker, so a doubled one stays visible", () => {
    expect(stripBlockMarkup("- - two").content).toBe("- two");
  });
});

describe("stripBlockMarkup — CommonMark limits", () => {
  it.each(["- - -", "* * *", "_ _ _", "-  -  -", "- - - -"])(
    "treats %s as a thematic break, not a list item",
    (line) => {
      expect(stripBlockMarkup(line).content).toBe(line);
    },
  );

  it("still strips a real list marker that merely looks similar", () => {
    expect(stripBlockMarkup("- - two").content).toBe("- two");
    expect(stripBlockMarkup("* item").content).toBe("item");
  });

  it("does not treat mixed break characters as a break", () => {
    // CommonMark requires the SAME character throughout.
    expect(stripBlockMarkup("- * -").content).toBe("* -");
  });

  it("keeps a 10-digit number as text — CommonMark caps ordered markers at 9", () => {
    expect(stripBlockMarkup("1234567890. text").content).toBe("1234567890. text");
  });

  it("still strips a 9-digit ordered marker", () => {
    expect(stripBlockMarkup("123456789. text").content).toBe("text");
  });

  it("keeps `>` as content when indented four spaces (indented code)", () => {
    const r = stripBlockMarkup("    > literal");
    expect(r.quote).toBe("");
    expect(r.content).toBe("> literal");
  });

  it("still treats up to three spaces before `>` as a quote", () => {
    expect(stripBlockMarkup("   > quoted").quote).toBe("> ");
  });
});

describe("fenceRanges — CommonMark pairing", () => {
  it("does NOT close a longer opener with a shorter run", () => {
    // ```` opened, ``` cannot close it. Treating it as closed classified the
    // real code below as ordinary markdown and dropped its protection.
    const lines = ["````", "code", "```", "still code"];
    expect(fenceRanges(lines)).toMatchObject([{ open: 0, close: 3, closed: false }]);
    expect(enclosingFence(lines, 3)).not.toBeNull();
  });

  it("closes with a run at least as long as the opener", () => {
    expect(fenceRanges(["```", "code", "````", "after"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("does not let a tilde close a backtick fence", () => {
    expect(fenceRanges(["```", "x", "~~~", "y"])).toMatchObject([{ open: 0, close: 3, closed: false }]);
  });

  it("rejects a backtick fence whose info string contains a backtick", () => {
    // CommonMark: that is not a fence at all. Accepting it invented a fence out
    // of prose, and the toggle would then "unfence" ordinary text.
    expect(fenceRanges(["``` foo`bar", "text"])).toMatchObject([]);
  });

  it("allows a backtick in a TILDE fence's info string", () => {
    expect(fenceRanges(["~~~ foo`bar", "text", "~~~"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("recognises a fence inside a blockquote", () => {
    // `insertCodeBlock` GENERATES this shape when converting inside a quote, so
    // failing to recognise it meant the toggle could not undo its own output.
    expect(fenceRanges(["> ```plaintext", "> code", "> ```", "after"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("recognises a fence in a nested blockquote", () => {
    expect(fenceRanges(["> > ```", "> > x", "> > ```"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("refuses a closer indented four spaces", () => {
    expect(fenceRanges(["```", "x", "    ```"])).toMatchObject([{ open: 0, close: 2, closed: false }]);
  });

  it("treats an unclosed fence as running to the end", () => {
    expect(fenceRanges(["```", "a", "b"])).toMatchObject([{ open: 0, close: 2, closed: false }]);
  });

  it("finds several fences", () => {
    expect(fenceRanges(["```", "a", "```", "mid", "~~~", "b", "~~~"])).toMatchObject([
      { open: 0, close: 2, closed: true },
      { open: 4, close: 6, closed: true },
    ]);
  });

  it("identifies delimiter lines from precomputed ranges", () => {
    const ranges = fenceRanges(["```", "code", "```"]);
    expect(isDelimiterLine(ranges, 0)).toBe(true);
    expect(isDelimiterLine(ranges, 1)).toBe(false);
    expect(isDelimiterLine(ranges, 2)).toBe(true);
  });
});

describe("fenceRanges — container scope and delimiter whitespace", () => {
  it("does not close a QUOTED fence with an unquoted delimiter", () => {
    // Pairing across container scopes left the real fenced code below
    // classified as ordinary markdown, with no protection.
    const lines = ["> ```", "> x", "```", "real code"];
    expect(fenceRanges(lines)).toMatchObject([{ open: 0, close: 3, closed: false }]);
    expect(enclosingFence(lines, 3)).not.toBeNull();
  });

  it("does not close an unquoted fence with a quoted delimiter", () => {
    expect(fenceRanges(["```", "x", "> ```"])).toMatchObject([{ open: 0, close: 2, closed: false }]);
  });

  it("does not close a nested quote's fence at the outer depth", () => {
    expect(fenceRanges(["> > ```", "> > x", "> ```"])).toMatchObject([
      { open: 0, close: 2, closed: false },
    ]);
  });

  it("rejects a non-breaking space after a closing fence", () => {
    // CommonMark allows only spaces and tabs there; `.trim()` accepted NBSP.
    expect(fenceRanges(["```", "x", "``` "])).toMatchObject([{ open: 0, close: 2, closed: false }]);
  });

  it("still accepts spaces and tabs after a closer", () => {
    expect(fenceRanges(["```", "x", "``` \t"])).toMatchObject([{ open: 0, close: 2, closed: true }]);
  });
});

describe("stripBlockMarkup — indented code and Unicode whitespace", () => {
  // Four spaces of indentation is INDENTED CODE: the markers inside it are
  // literal text, and stripping them destroyed content that CommonMark says is
  // not markup at all.
  it.each([
    { line: "    # literal", indent: "    ", content: "# literal" },
    { line: "    - literal", indent: "    ", content: "- literal" },
    { line: "\tcode - here", indent: "\t", content: "code - here" },
  ])("keeps markers inside indented code: $line", ({ line, indent, content }) => {
    expect(stripBlockMarkup(line)).toEqual({ quote: "", indent, content });
  });

  it("keeps markers inside indented code WITHIN a quote", () => {
    expect(stripBlockMarkup(">     - deep")).toEqual({
      quote: "> ",
      indent: "    ",
      content: "- deep",
    });
  });

  it("treats a no-break space as CONTENT, not indentation", () => {
    // `^\s*` swallowed NBSP as structural whitespace and then stripped the
    // marker after it; CommonMark whitespace is spaces and tabs only.
    expect(stripBlockMarkup(" - literal")).toEqual({
      quote: "",
      indent: "",
      content: " - literal",
    });
  });

  it("still strips a marker at one to three spaces of indent", () => {
    expect(stripBlockMarkup("   - x")).toEqual({ quote: "", indent: "   ", content: "x" });
  });
});

describe("fenceRanges — indentation is measured in COLUMNS", () => {
  it("rejects a tab-indented opener — CommonMark expands the tab to four columns", () => {
    expect(fenceRanges(["\t```", "x", "\t```"])).toMatchObject([]);
  });

  it("rejects a four-space opener (already indented code)", () => {
    expect(fenceRanges(["    ```", "x"])).toMatchObject([]);
  });
});

describe("fenceRanges — fences inside list items", () => {
  it("recognises a fence opened on a bullet list marker line", () => {
    // `- ``` / content / closer` is a valid fence inside the item. Missing the
    // opener while classifying the indented closer as a NEW opener flipped
    // inside and outside for the rest of the document.
    expect(fenceRanges(["- ```", "  x", "  ```", "after"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("recognises a fence opened on an ordered list marker line", () => {
    expect(fenceRanges(["1. ```js", "  code", "  ```"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("recognises a QUOTED list-item fence", () => {
    expect(fenceRanges(["> - ```", "> x", "> ```"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });
});

describe("fence pairing — container identity and indent compatibility", () => {
  // Three High-severity findings from an audit of the safety boundary. Each
  // let a fence pair with a delimiter that does not belong to it, and the
  // consequence is always the same: real fenced code is classified as prose
  // and every cursor-context guard stops protecting it.

  it("a LIST MARKER line cannot close the previous item's fence — it ENDS it", () => {
    // Two consecutive list items, each opening a fence. Three readings of this
    // input, in order: they paired with EACH OTHER (so item 2's code was
    // unprotected); then the marker was barred from closing, which was right
    // but left ONE unclosed range swallowing both items; now the item boundary
    // ends the first and opens the second, which is what remark-parse yields —
    // two list items, each holding its own code block.
    const ranges = fenceRanges(["- ```", "first", "- ```", "second"]);
    expect(ranges).toMatchObject([
      { open: 0, close: 1, closed: false },
      { open: 2, close: 3, closed: false },
    ]);
    // Line 3 is still INSIDE — in the SECOND range, not the first.
    expect(enclosingFence(["- ```", "first", "- ```", "second"], 3)).not.toBeNull();
  });

  it("an ordered-list marker behaves the same way", () => {
    expect(fenceRanges(["1. ```", "first", "2. ```", "second"])).toMatchObject([
      { open: 0, close: 1, closed: false },
      { open: 2, close: 3, closed: false },
    ]);
  });

  it("containers nest in ANY order — list outside blockquote", () => {
    // `- > ` was unparseable: the scanner stripped one quote run then one list
    // marker, in that order only, so this was no fence at all.
    expect(fenceRanges(["- > ```", "  > code", "  > ```"])).toMatchObject([
      { open: 0, close: 2, closed: true },
    ]);
  });

  it("alternating containers parse, and a repeated marker still starts a new item", () => {
    // Verified against remark-parse rather than reasoned about: this input is
    // THREE list items each holding an empty code block, not one fence closed
    // by its own prefix. The assertion used to say ONE range while its own
    // comment said three items — the comment was right. Each item boundary now
    // ends the previous item, so the two fence-bearing items get a range each
    // and the middle item (ordinary text) gets none.
    expect(fenceRanges(["> - > ```", "> - > code", "> - > ```"])).toMatchObject([
      { open: 0, close: 0, closed: false, markerOffset: 6 },
      { open: 2, close: 2, closed: false, markerOffset: 6 },
    ]);
  });

  it("matches CommonMark on the three inputs the audit raised", () => {
    // Cross-checked with remark-parse:
    //   `- ``` / first / - ``` / second`  → two list items, NOT one fence
    //   "``` / code / ␣␣␣␣``` / after"    → one code block running to the end
    // The first assertion said ONE range while the comment beside it said two
    // items. It says two now.
    expect(fenceRanges(["- ```", "first", "- ```", "second"])).toMatchObject([
      { open: 0, close: 1, closed: false },
      { open: 2, close: 3, closed: false },
    ]);
    expect(fenceRanges(["```", "code", "    ```", "after"], "deep-indent")).toMatchObject([
      { open: 0, closed: false },
    ]);
  });

  it("under deep-indent, a 4-space line does NOT close an unindented fence", () => {
    // It is indented code, not a closer. Pairing them ended the fence early and
    // left everything after it unprotected — the deviation was documented as
    // "only over-includes", which was wrong.
    expect(fenceRanges(["```", "code", "    ```", "after"], "deep-indent")).toMatchObject([
      { open: 0, close: 3, closed: false },
    ]);
  });

  it("under deep-indent, matching indentation still closes (the list-nested case)", () => {
    expect(
      fenceRanges(["    ```", "code", "    ```", "after"], "deep-indent")
    ).toMatchObject([{ open: 0, close: 2, closed: true }]);
  });

  it("indent may differ by up to 3 — CommonMark's own tolerance", () => {
    expect(fenceRanges(["    ```", "code", "       ```"], "deep-indent")).toMatchObject([
      { closed: true },
    ]);
    expect(fenceRanges(["    ```", "code", "        ```"], "deep-indent")).toMatchObject([
      { closed: false },
    ]);
  });

  it.each([
    { label: "plain", lines: ["```", "code", "```"] },
    { label: "list item", lines: ["- ```", "  code", "  ```"] },
    { label: "blockquote", lines: ["> ```", "> code", "> ```"] },
    { label: "nested blockquote", lines: [">> ```", ">> code", ">> ```"] },
  ])("$label fences still pair — no regression", ({ lines }) => {
    expect(fenceRanges(lines)).toMatchObject([{ open: 0, close: 2, closed: true }]);
  });
});

describe("the closing-fence indent rule is ABSOLUTE, not relative to the opener", () => {
  // `Math.abs(closer - opener) <= 3` accepted a closer 3 columns deeper than an
  // indented opener, which CommonMark reads as indented code — closing the
  // fence early and stripping every guard from the rest of the block.
  it("leaves the fence OPEN when the closer is indented 4+", () => {
    const ranges = fenceRanges([" ```", "code", "    ```", "still code"], "commonmark");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].closed).toBe(false);
  });

  it("closes at 0-3 columns, wherever the opener sat", () => {
    for (const closer of ["```", " ```", "  ```", "   ```"]) {
      const ranges = fenceRanges([" ```", "code", closer], "commonmark");
      expect(ranges[0].closed).toBe(true);
    }
  });

  it("deep-indent keeps the RELATIVE window — it stands in for a container", () => {
    // That policy scans text whose container prefixes were already stripped, so
    // absolute columns carry no information there.
    const ranges = fenceRanges(["    ```", "code", "    ```"], "deep-indent");
    expect(ranges[0].closed).toBe(true);
  });
});

describe("a list item boundary ends the previous item's fence", () => {
  it("gives each item its own range instead of one run-on", () => {
    // `!startsListItem` stopped the second item's ``` from CLOSING the first —
    // correct, it opens its own — but nothing then ENDED the first, so one
    // unclosed range swallowed both items and everything after them.
    const ranges = fenceRanges(["- ```", "first", "- ```", "second"], "commonmark");
    expect(ranges).toHaveLength(2);
    expect(ranges[0].open).toBe(0);
    expect(ranges[1].open).toBe(2);
  });

  it("a NESTED item does not end an outer item's fence", () => {
    const ranges = fenceRanges(["- ```", "  - x", "code", "- ```"], "commonmark");
    expect(ranges[0].open).toBe(0);
  });
});

describe("a list marker's padding is bounded — 5+ spaces is indented code", () => {
  it("does not invent a fence from an over-padded nested marker", () => {
    // CommonMark: with 5+ spaces after a marker, content starts one space in
    // and the rest is INDENTED CODE, so there is no fence to find here.
    expect(fenceRanges(["- -     ```", "x"], "commonmark")).toHaveLength(0);
  });

  it("still reads a fence at 1-4 spaces of padding", () => {
    for (const pad of [" ", "  ", "   ", "    "]) {
      expect(fenceRanges([`-${pad}\`\`\``, "x"], "commonmark")).toHaveLength(1);
    }
  });
});

describe("a SIBLING item at shallower marker column is still a boundary", () => {
  it("does NOT end the item at a marker deeper than the opener's own", () => {
    // Three readings, in order. The boundary first compared the whole consumed
    // PREFIX (3) against the opener's markerOffset (2) and called ` - x`
    // nested. Comparing marker COLUMN against content column (1 < 2) then made
    // it a sibling and ended the item — but remark keeps that line INSIDE the
    // unclosed fence, so the scanner dropped protection from real code. The
    // comparison is against the OPENER'S OWN MARKER column (0): 1 > 0, so the
    // range continues. Over-inclusive versus remark, which is the only
    // tolerable direction for a guard, and pinned in
    // `remarkFenceAgreement.test.ts` with its direction MEASURED.
    const ranges = fenceRanges(["- ```", " - x", "code"], "commonmark");
    expect(ranges).toMatchObject([{ open: 0, close: 2, closed: false }]);
  });

  it("still treats `  - x` at the content column as NESTED", () => {
    const ranges = fenceRanges(["- ```", "  - x", "code", "- ```"], "commonmark");
    expect(ranges[0].open).toBe(0);
    expect(ranges[0].close).toBeGreaterThan(1);
  });
});
