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

  it("a LIST MARKER line cannot close the previous item's fence", () => {
    // Two consecutive list items, each opening a fence, paired with EACH
    // OTHER — so the second item's code was outside any fence.
    const ranges = fenceRanges(["- ```", "first", "- ```", "second"]);
    expect(ranges).toMatchObject([{ open: 0, close: 3, closed: false }]);
    // The point: line 3 is INSIDE. It used to be outside.
    expect(enclosingFence(["- ```", "first", "- ```", "second"], 3)).not.toBeNull();
  });

  it("an ordered-list marker cannot close one either", () => {
    const ranges = fenceRanges(["1. ```", "first", "2. ```", "second"]);
    expect(ranges).toMatchObject([{ closed: false }]);
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
    // by its own prefix. So the fence opens (markerOffset spans `> - > `) and
    // does not close — which is what the scanner now reports.
    expect(fenceRanges(["> - > ```", "> - > code", "> - > ```"])).toMatchObject([
      { open: 0, close: 2, closed: false, markerOffset: 6 },
    ]);
  });

  it("matches CommonMark on the three inputs the audit raised", () => {
    // Cross-checked with remark-parse:
    //   `- ``` / first / - ``` / second`  → two list items, NOT one fence
    //   "``` / code / ␣␣␣␣``` / after"    → one code block running to the end
    // Both are what these ranges say now; neither was before.
    expect(fenceRanges(["- ```", "first", "- ```", "second"])).toMatchObject([
      { open: 0, closed: false },
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
