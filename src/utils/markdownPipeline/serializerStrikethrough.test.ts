// @vitest-environment node
/**
 * Audit 20260906 — `~~` delimiters were emitted where GFM cannot parse them
 * back, turning the tildes into literal characters in the author's document.
 *
 * Found by the editing fuzz once the mark-edge whitespace normalization
 * stopped masking it. The failing shape is the one GFM's flanking rules
 * forbid: an opening run followed by punctuation while preceded by an
 * alphanumeric (and its mirror image at the closer).
 */
import { describe, expect, it } from "vitest";
import { getProductionSchema } from "@/test/productionSchema";
import { serializeMarkdown, parseMarkdown } from "./adapter";
import { repairSplitSurrogateEntities } from "./serializerStrikethrough";

const schema = getProductionSchema();

/** Build a paragraph of [plain?, struck, plain?] and round-trip it. */
function roundTrip(pre: string, marked: string, post: string) {
  const strike = schema.marks.strike.create();
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      ...(pre ? [schema.text(pre)] : []),
      schema.text(marked, [strike]),
      ...(post ? [schema.text(post)] : []),
    ]),
  ]);
  const markdown = serializeMarkdown(schema, doc);
  const reparsed = parseMarkdown(schema, markdown);
  return {
    markdown,
    text: reparsed.textContent,
    restruck: serializeMarkdown(schema, reparsed),
  };
}

/** Whether the reparsed doc still carries a strike mark over `marked`. */
function hasStrike(pre: string, marked: string, post: string): boolean {
  const strike = schema.marks.strike.create();
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      ...(pre ? [schema.text(pre)] : []),
      schema.text(marked, [strike]),
      ...(post ? [schema.text(post)] : []),
    ]),
  ]);
  const reparsed = parseMarkdown(schema, serializeMarkdown(schema, doc));
  let found = false;
  reparsed.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "strike")) found = true;
  });
  return found;
}

describe("strikethrough delimiter flanking", () => {
  // The reported defect. `plain~~* word~~tail` reparses with NO strike mark
  // and four literal tildes the author never typed.
  it("does not inject literal tildes when the content starts with punctuation", () => {
    const { markdown, text, restruck } = roundTrip("plain", "* word", "tail");

    expect(text).toBe("plain* wordtail");
    expect(text).not.toContain("~");
    expect(restruck).toBe(markdown);
  });

  it("does not inject literal tildes when the content ends with punctuation", () => {
    const { markdown, text, restruck } = roundTrip("plain", "word*", "tail");

    expect(text).toBe("plainword*tail");
    expect(text).not.toContain("~");
    expect(restruck).toBe(markdown);
  });

  it("keeps the mark alive across the round-trip", () => {
    expect(hasStrike("plain", "* word", "tail")).toBe(true);
    expect(hasStrike("plain", "word*", "tail")).toBe(true);
  });

  // The remedy is remark's own: character-reference the neighbour so it counts
  // as punctuation. It decodes back to the identical character, so nothing
  // about which text carries the mark changes.
  it("character-references the neighbour rather than moving the mark boundary", () => {
    expect(roundTrip("plain", "* word", "tail").markdown).toContain("&#x6E;");
  });

  it.each([
    ["punctuation both ends", "plain", "*word*", "tail"],
    ["whitespace before", "plain ", "* word", "tail"],
    ["whitespace after", "plain", "word*", " tail"],
    ["no punctuation at all", "plain", "more", "tail"],
    ["start of line", "", "* word", "tail"],
    ["end of line", "plain", "word*", ""],
    ["CJK neighbours", "文字", "* word", "文字"],
    ["marked run is only punctuation", "plain", "***", "tail"],
  ])("round-trips: %s", (_label, pre, marked, post) => {
    const { markdown, text, restruck } = roundTrip(pre, marked, post);

    expect(text).toBe(pre + marked + post);
    expect(restruck).toBe(markdown);
  });

  // A neighbour that already flanks must not be encoded — the fix has to be
  // conditional, or every strikethrough in the corpus grows entities.
  it("leaves an already-valid neighbour untouched", () => {
    expect(roundTrip("plain ", "* word", "tail").markdown).toBe("plain ~~* word~~tail\n");
    expect(roundTrip("plain", "more", "tail").markdown).toBe("plain~~more~~tail\n");
  });
});


/**
 * Audit 20260906 — attention-encoding split astral characters.
 *
 * `mdast-util-to-markdown` makes a non-flanking delimiter work by character-
 * referencing its neighbour, but encodes by UTF-16 CODE UNIT: an emoji next to
 * such a delimiter came out as `&#xD83D;` plus a raw low surrogate, reparsing
 * as U+FFFD. Upstream, and older than VMark's `delete` handler — plain
 * `**bold**` reproduces it with no strikethrough involved.
 */
describe("astral characters beside an encoded delimiter", () => {
  /** Round-trip a paragraph of [marked, plain]. */
  function afterMark(markName: "bold" | "italic" | "strike", marked: string, tail: string) {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text(marked, [schema.marks[markName].create()]),
        schema.text(tail),
      ]),
    ]);
    const markdown = serializeMarkdown(schema, doc);
    return { markdown, text: parseMarkdown(schema, markdown).textContent };
  }

  it("preserves an emoji after a bold run ending in punctuation", () => {
    const { text } = afterMark("bold", "word*", "🙂word");

    expect(text).toBe("word*🙂word");
    expect(text).not.toContain("\uFFFD");
  });

  it("preserves an emoji after a strikethrough run ending in punctuation", () => {
    const { text } = afterMark("strike", "word*", "🙂word");

    expect(text).toBe("word*🙂word");
  });

  it("preserves an emoji after an italic run ending in punctuation", () => {
    const { text } = afterMark("italic", "word*", "🙂word");

    expect(text).toBe("word*🙂word");
  });

  // The repair must re-encode the PAIR, not decode it — decoding would undo
  // the very thing that makes the delimiter flank.
  it("re-encodes the surrogate pair as one code point", () => {
    expect(afterMark("bold", "word*", "🙂word").markdown).toContain("&#x1F642;");
  });

  describe("repairSplitSurrogateEntities", () => {
    it("joins a high-surrogate reference with its raw low surrogate", () => {
      expect(repairSplitSurrogateEntities("a&#xD83D;\uDE42b")).toBe("a&#x1F642;b");
    });

    it("leaves an ordinary character reference alone", () => {
      expect(repairSplitSurrogateEntities("plai&#x6E;~~x~~")).toBe("plai&#x6E;~~x~~");
    });

    it("leaves text with no references alone", () => {
      expect(repairSplitSurrogateEntities("just 🙂 text")).toBe("just 🙂 text");
    });

    it("ignores a high-surrogate reference not followed by a low surrogate", () => {
      expect(repairSplitSurrogateEntities("&#xD83D;x")).toBe("&#xD83D;x");
    });

    it("repairs several occurrences", () => {
      expect(repairSplitSurrogateEntities("&#xD83D;\uDE42 and &#xD83D;\uDE00")).toBe(
        "&#x1F642; and &#x1F600;",
      );
    });
  });
});
