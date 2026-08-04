/**
 * WI-0.2 — unit tests for the spec.txt → corpus JSON converter.
 *
 * The converter is the trust boundary between upstream spec sources and the
 * vendored corpora: a parsing bug here silently vendors wrong examples, and
 * every downstream gate then verifies the wrong thing with full confidence.
 * Edge cases pinned: 32-backtick fences, the lone-`.` separator, `→` tab
 * placeholders, per-file example numbering, section tracking across heading
 * levels, empty expected-output halves, and section filtering.
 *
 * @coordinates-with scripts/vendor-spec-corpus.mjs — the module under test
 * @coordinates-with corpusRegistry.ts — consumer of the converter's output
 * @module utils/markdownPipeline/__tests__/spec/specTxtConverter.test
 */
import { describe, it, expect } from "vitest";
import {
  parseSpecTxt,
  restoreTabs,
  filterSections,
  fromCommonMarkJson,
  wrapCorpus,
} from "../../../../../scripts/vendor-spec-corpus.mjs";

const FENCE = "`".repeat(32);

function specTxt(...blocks: string[]): string {
  return blocks.join("\n");
}

describe("parseSpecTxt", () => {
  it("extracts markdown and expected output split on the lone dot", () => {
    const text = specTxt("## Section A", `${FENCE} example`, "*hi*", ".", "<p><em>hi</em></p>", FENCE);
    const [example] = parseSpecTxt(text);
    expect(example.markdown).toBe("*hi*\n");
    expect(example.html).toBe("<p><em>hi</em></p>\n");
    expect(example.section).toBe("Section A");
  });

  it("numbers examples by position in THIS file — numbering restarts per file", () => {
    const one = specTxt("# T", `${FENCE} example`, "a", ".", "b", FENCE);
    const two = specTxt(one, `${FENCE} example`, "c", ".", "d", FENCE);
    expect(parseSpecTxt(two).map((e) => e.example)).toEqual([1, 2]);
    expect(parseSpecTxt(one).map((e) => e.example)).toEqual([1]);
  });

  it("tracks the CURRENT section across heading levels", () => {
    const text = specTxt(
      "# Doc",
      "## First",
      `${FENCE} example`, "a", ".", "x", FENCE,
      "### Deeper",
      `${FENCE} example`, "b", ".", "y", FENCE,
    );
    expect(parseSpecTxt(text).map((e) => e.section)).toEqual(["First", "Deeper"]);
  });

  it("restores → placeholders to real tabs in both halves", () => {
    const text = specTxt("# T", `${FENCE} example`, "→foo", ".", "<pre>→</pre>", FENCE);
    const [example] = parseSpecTxt(text);
    expect(example.markdown).toBe("\tfoo\n");
    expect(example.html).toBe("<pre>\t</pre>\n");
  });

  it("keeps an empty expected-output half empty (no trailing newline invention)", () => {
    const text = specTxt("# T", `${FENCE} example`, "input only", ".", FENCE);
    expect(parseSpecTxt(text)[0].html).toBe("");
  });

  it("does not read headings INSIDE example bodies as sections", () => {
    const text = specTxt(
      "## Real",
      `${FENCE} example`, "## looks like a heading", ".", "<h2>looks like a heading</h2>", FENCE,
      `${FENCE} example`, "next", ".", "<p>next</p>", FENCE,
    );
    expect(parseSpecTxt(text).map((e) => e.section)).toEqual(["Real", "Real"]);
  });

  it("ignores shorter backtick fences — only the 32-backtick form delimits", () => {
    const text = specTxt("# T", "```js", "code", "```", `${FENCE} example`, "a", ".", "b", FENCE);
    expect(parseSpecTxt(text)).toHaveLength(1);
  });
});

describe("restoreTabs", () => {
  it("replaces every placeholder, not just the first", () => {
    expect(restoreTabs("→a→b")).toBe("\ta\tb");
  });
});

describe("filterSections", () => {
  it("keeps exactly the named sections", () => {
    const examples = parseSpecTxt(
      specTxt(
        "## Keep (extension)", `${FENCE} example`, "a", ".", "x", FENCE,
        "## Drop", `${FENCE} example`, "b", ".", "y", FENCE,
      ),
    );
    const kept = filterSections(examples, ["Keep (extension)"]);
    expect(kept.map((e) => e.markdown)).toEqual(["a\n"]);
    // File-position numbering survives filtering — ids must stay stable.
    expect(kept[0].example).toBe(1);
  });
});

describe("fromCommonMarkJson / wrapCorpus", () => {
  it("strips to the corpus shape and keeps upstream expected html", () => {
    const stripped = fromCommonMarkJson([
      { example: 9, section: "S", markdown: "m\n", html: "<p>m</p>\n" },
    ]);
    expect(stripped).toEqual([{ example: 9, section: "S", markdown: "m\n", html: "<p>m</p>\n" }]);
    const wrapped = wrapCorpus({ source: "u", revision: "r", license: "l" }, stripped);
    expect(wrapped.source).toBe("u");
    expect(wrapped.examples).toHaveLength(1);
  });
});
