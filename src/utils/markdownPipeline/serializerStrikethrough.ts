/**
 * Strikethrough delimiter flanking — the `~~` half of what remark already does
 * for `*`.
 *
 * Purpose: stop `~~` delimiters being emitted where GFM cannot parse them back.
 *
 * GFM gives `~~` the same delimiter-run rules as emphasis: an OPENING run must
 * be left-flanking, which it is not when it is followed by punctuation while
 * being preceded by an alphanumeric; a CLOSING run must be right-flanking, the
 * mirror image. So `plain~~* word~~tail` is not strikethrough at all — it
 * reparses as literal text, and the tildes VMark emitted become four
 * characters in the author's document that they never typed. That is text
 * corruption, not a lost mark (audit 20260906, found by the editing fuzz once
 * the mark-edge whitespace normalization stopped masking it).
 *
 * `mdast-util-to-markdown` solves this for emphasis and strong by CHARACTER-
 * REFERENCING the offending neighbour — `plain*word*` becomes
 * `plai&#x6E;*word*`, which is punctuation before the marker, so the run
 * flanks and the text decodes back to exactly what it was. The strikethrough
 * extension never adopted it, so `delete` was left with the raw handler.
 *
 * This is that same treatment, and deliberately nothing more: no change to
 * which characters carry the mark (unlike the whitespace case, which genuinely
 * cannot be represented and must move the boundary), and no HTML fallback
 * (`<del>` round-trips as `html_inline`, not as a strike mark — measured).
 *
 * @coordinates-with markEdgeWhitespace.ts — the whitespace half of the same rule
 * @coordinates-with serializer.ts — installs this handler
 * @module utils/markdownPipeline/serializerStrikethrough
 */

/** The `state` a `delete` handler receives from mdast-util-to-markdown. */
interface DeleteState {
  enter: (construct: string) => () => void;
  createTracker: (info: unknown) => {
    move: (value: string) => string;
    /** Position bookkeeping — `{ now, lineShift }`, NOT before/after. */
    current: () => { now: { line: number; column: number }; lineShift: number };
  };
  containerPhrasing: (
    node: unknown,
    info: { before: string; after: string },
  ) => string;
  /**
   * Consumed by `containerPhrasing` to character-reference the character on
   * either side of this node. The mechanism emphasis uses; strikethrough
   * simply never set it.
   */
  attentionEncodeSurroundingInfo?: { before: boolean; after: boolean };
}

interface DeleteInfo {
  before: string;
  after: string;
}

/** ASCII punctuation, per CommonMark's definition for delimiter flanking. */
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WHITESPACE = /\s/;

/**
 * Whether the character OUTSIDE a delimiter run must be character-referenced
 * for that run to flank.
 *
 * A run adjacent to punctuation only flanks when its outer neighbour is
 * whitespace or punctuation. An empty `outside` means the start or end of the
 * line, which counts as whitespace and always flanks.
 */
function outsideNeedsEncoding(outside: string, inside: string): boolean {
  if (!inside || !PUNCTUATION.test(inside)) return false;
  if (!outside) return false;
  return !WHITESPACE.test(outside) && !PUNCTUATION.test(outside);
}

/**
 * Serialize a `delete` node as `~~…~~`, asking for the surrounding characters
 * to be encoded when the delimiters would otherwise not flank.
 */
export function handleDelete(
  node: unknown,
  _parent: unknown,
  state: DeleteState,
  info: DeleteInfo,
): string {
  const exit = state.enter("strikethrough");
  const tracker = state.createTracker(info);
  tracker.move("~~");
  const between = tracker.move(
    state.containerPhrasing(node, {
      before: "~",
      after: "~",
      ...tracker.current(),
    }),
  );
  tracker.move("~~");
  exit();

  const encodeBefore = outsideNeedsEncoding(
    info.before.slice(-1),
    between.slice(0, 1),
  );
  const encodeAfter = outsideNeedsEncoding(
    info.after.slice(0, 1),
    between.slice(-1),
  );
  if (encodeBefore || encodeAfter) {
    state.attentionEncodeSurroundingInfo = {
      before: encodeBefore,
      after: encodeAfter,
    };
  }

  return `~~${between}~~`;
}


/**
 * Repair numeric character references that split an astral character.
 *
 * `mdast-util-to-markdown` fixes a non-flanking delimiter by character-
 * referencing the neighbour, but it does so by UTF-16 CODE UNIT. When that
 * neighbour is an astral character — an emoji, most CJK extension-B
 * ideographs — it encodes only the leading HIGH SURROGATE and leaves the low
 * surrogate raw:
 *
 *     **word\***🙂word   →   **word\***&#xD83D;\uDE42word
 *
 * which reparses as U+FFFD followed by a lone low surrogate. The emoji is
 * destroyed. It is upstream, it predates VMark's `delete` handler — plain
 * `**bold**` ending in punctuation and followed by an emoji reproduces it with
 * no strikethrough anywhere — and it is real text corruption, not a cosmetic
 * artefact (audit 20260906, found by the editing fuzz).
 *
 * The repair is to finish the job the library started: re-encode the PAIR as
 * one reference for the actual code point. Decoding back to the raw character
 * would be wrong — the encoding is what makes the delimiter flank, so undoing
 * it would break the emphasis instead.
 *
 * BOTH directions occur. Which half gets encoded depends on which side of the
 * delimiter the astral character sits: encoding the neighbour AFTER a closer
 * takes its first code unit (the high surrogate), while encoding the neighbour
 * BEFORE an opener takes its last (the low surrogate).
 *
 * Applied unconditionally, and NOT in the cosmetic pass: that pass is skipped
 * above a size ceiling, and a correctness repair must not have one.
 */
export function repairSplitSurrogateEntities(markdown: string): string {
  if (!markdown.includes("&#x")) return markdown;

  /** One reference for the code point the pair encodes. */
  const joined = (high: number, low: number): string =>
    `&#x${(((high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000)
      .toString(16)
      .toUpperCase())};`;

  return (
    markdown
      // Encoded HIGH surrogate followed by a raw low one.
      .replace(
        /&#x(D[89ab][0-9a-f]{2});([\uDC00-\uDFFF])/gi,
        (whole, hex: string, low: string) => {
          const high = Number.parseInt(hex, 16);
          if (high < 0xd800 || high > 0xdbff) return whole;
          return joined(high, low.charCodeAt(0));
        },
      )
      // Raw HIGH surrogate followed by an encoded low one.
      .replace(
        /([\uD800-\uDBFF])&#x(D[c-f][0-9a-f]{2});/gi,
        (whole, high: string, hex: string) => {
          const low = Number.parseInt(hex, 16);
          if (low < 0xdc00 || low > 0xdfff) return whole;
          return joined(high.charCodeAt(0), low);
        },
      )
  );
}
