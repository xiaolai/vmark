// @vitest-environment node
/**
 * WI-4.1 regression — edge whitespace inside emphasis-like marks must be
 * EXPELLED outside the delimiters on serialize.
 *
 * Found by the editing-op fuzz (seed 42, shrunk to 5 ops): a strike mark
 * spanning text that ends in a space serialized as `~~word你好 ~~`, and GFM
 * cannot parse a closing delimiter preceded by whitespace — the re-parse
 * read LITERAL tildes and the strike mark was gone. Data corruption, not
 * normalization: junk delimiters appear in the author's text.
 *
 * The rule is CommonMark's: emphasis-like closers must be right-flanking,
 * so `**a **b` and `~~a ~~b` are not emphasis. The serializer therefore
 * moves edge whitespace OUT of the mark: `~~word~~ tail`.
 *
 * @coordinates-with ../pmInlineConverters.ts — wrapWithMark, where expulsion lives
 * @module utils/markdownPipeline/__tests__/markEdgeWhitespace.test
 */
import { describe, it, expect } from "vitest";
import "../dialect";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { getProductionSchema } from "@/test/productionSchema";

const schema = getProductionSchema();

function docWithMarkedText(markName: string, text: string, tail = "tail"): ReturnType<typeof schema.node> {
  const mark = schema.marks[markName].create();
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text(text, [mark]), schema.text(tail)]),
  ]);
}

describe.each(["strike", "bold", "italic"])("edge whitespace under %s", (markName) => {
  it("a trailing space inside the mark is expelled outside the delimiters", () => {
    const md = serializeMarkdown(schema, docWithMarkedText(markName, "word "));
    // Whatever the delimiter, the character before the CLOSING delimiter
    // must not be a space, and the space must survive between mark and tail.
    expect(md).not.toMatch(/ (\*\*|\*|~~)tail/);
    // The mark survives a reparse — the real invariant.
    const reparsed = parseMarkdown(schema, md);
    let markSeen = false;
    reparsed.descendants((n) => {
      if (n.marks.some((m) => m.type.name === markName)) markSeen = true;
    });
    expect(markSeen, `mark lost through roundtrip; md=${JSON.stringify(md)}`).toBe(true);
    expect(reparsed.textContent).toBe("word tail");
  });

  it("a leading space inside the mark is expelled too", () => {
    const md = serializeMarkdown(schema, docWithMarkedText(markName, " word"));
    const reparsed = parseMarkdown(schema, md);
    let markSeen = false;
    reparsed.descendants((n) => {
      if (n.marks.some((m) => m.type.name === markName)) markSeen = true;
    });
    expect(markSeen, `mark lost through roundtrip; md=${JSON.stringify(md)}`).toBe(true);
    // " word" + "tail"; the expelled leading space sits at paragraph start,
    // which markdown strips — the words themselves must survive.
    expect(reparsed.textContent.replace(/^ /, "")).toBe("wordtail");
  });
});

it.fails(
  "OPEN DEFECT (fuzz seed 42, shrunk): strike opening after a word char before punctuation cannot left-flank",
  () => {
    // Serializes as `word~~**w**ord~~`: the opening ~~ is preceded by a word
    // character and followed by punctuation, which GFM's flanking rules read
    // as a closer-position — so the re-parse sees LITERAL tildes and the
    // strike is lost. A real serializer defect (delimiter policy must
    // consider flanking context, not only edge whitespace); pinned here as
    // expected-to-fail so the fix flips this test RED-to-GREEN deliberately.
    const bold = schema.marks.bold.create();
    const strike = schema.marks.strike.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("word"),
        schema.text("w", [bold, strike]),
        schema.text("ord", [strike]),
      ]),
    ]);
    const md = serializeMarkdown(schema, doc);
    const reparsed = parseMarkdown(schema, md);
    expect(reparsed.textContent, `md=${JSON.stringify(md)}`).not.toContain("~~");
    let strikeSeen = false;
    reparsed.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "strike")) strikeSeen = true;
    });
    expect(strikeSeen).toBe(true);
  },
);

it("the fuzz's shrunk trace class: bold+strike over space-ending CJK text roundtrips", () => {
  const bold = schema.marks.bold.create();
  const strike = schema.marks.strike.create();
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("word你好 ", [bold, strike]), schema.text("x")]),
  ]);
  const md = serializeMarkdown(schema, doc);
  const reparsed = parseMarkdown(schema, md);
  expect(reparsed.textContent, `md=${JSON.stringify(md)}`).not.toContain("~~");
  let strikeSeen = false;
  reparsed.descendants((n) => {
    if (n.marks.some((m) => m.type.name === "strike")) strikeSeen = true;
  });
  expect(strikeSeen).toBe(true);
});
