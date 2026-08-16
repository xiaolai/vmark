/**
 * Custom Inline Marks — Remark Plugin (registration + serialize)
 *
 * Purpose: registers VMark's custom inline markers with remark, and holds the
 * SERIALIZE side (mdast → markdown handlers + escaping rules) for:
 *   ==highlight==, ++underline++, ^superscript^, ~subscript~
 * The PARSE side (the mdast tree transform) lives in `customInlineTransform.ts`.
 *
 * Key decisions:
 *   - Serialization uses `unsafe` rules to control escaping. Double markers
 *     (`==`/`++`) escape via a "followed by same char" match; single markers
 *     (`^`/`~`) use a phrasing rule exempting their own construct, so a
 *     literal `x\^2\^` is never re-parsed as a real superscript (defect D4).
 *   - The single-marker rules carry `before`/`after` guards so they fire only
 *     where a marker could actually re-pair — a partner on either side with no
 *     whitespace between, matching what the parser accepts since #1280.
 *     Escaping every `^` put backslashes through LaTeX-ish prose
 *     (`\sum_{k=1}\^n a_k\^2`) to prevent a pairing that cannot happen.
 *   - `~`/`^` handlers escape spaces in their CONTENT (`~two\ words~`,
 *     Pandoc's spelling). The parser refuses to pair across unescaped
 *     whitespace, so a subscript the user applied to a phrase would otherwise
 *     stop being one on reload.
 *   - Marker chars emitted by a handler are exempt from escaping via
 *     `notInConstruct`, so real superscripts/highlights keep their markers.
 *   - remark-gfm adds its OWN blanket `~` rule, which this cannot narrow: a
 *     tilde VMark reads as literal is still escaped on output. That is wanted
 *     — cmark-gfm pairs single tildes across spaces, so an unescaped `4~6 …
 *     1~2` would render struck through on GitHub.
 *
 * @coordinates-with customInlineTransform.ts — the parse-side tree transform
 * @coordinates-with parser.ts — always loaded (lightweight, common syntax)
 * @coordinates-with serializer.ts — serialization handlers registered via toMarkdownExtensions
 * @module utils/markdownPipeline/plugins/customInline
 */

import type { Root, PhrasingContent } from "mdast";
import type { Plugin } from "unified";

interface ToMarkdownExtension {
  handlers?: Record<string, MarkHandler>;
  unsafe?: Array<{
    character: string;
    inConstruct?: string;
    notInConstruct?: string[];
    before?: string;
    after?: string;
  }>;
}

type MarkHandler = (
  node: unknown,
  parent: unknown,
  state: MarkHandlerState,
  info: { before: string; after: string }
) => string;

interface MarkHandlerState {
  createTracker: (info: { before: string; after: string }) => {
    move: (value: string) => string;
    current: () => { before: string; after: string };
  };
  enter: (constructName: string) => () => void;
  containerPhrasing: (
    node: { children: PhrasingContent[] },
    options: { before: string; after: string }
  ) => string;
}

import {
  customInlineFromMarkdown,
  type FromMarkdownExtension,
} from "./customInlineTransform";

export const remarkCustomInline: Plugin<[], Root> = function () {
  const data = this.data() as {
    fromMarkdownExtensions?: FromMarkdownExtension[];
    toMarkdownExtensions?: ToMarkdownExtension[];
  };

  data.fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];
  data.toMarkdownExtensions = data.toMarkdownExtensions ?? [];

  data.fromMarkdownExtensions.push(customInlineFromMarkdown());
  data.toMarkdownExtensions.push(customInlineToMarkdown());
};

function customInlineToMarkdown(): ToMarkdownExtension {
  return {
    handlers: {
      // The single-character marks escape spaces in their content. The parser
      // refuses to pair `~`/`^` across unescaped whitespace (Pandoc's rule, see
      // customInlineTransform.ts), so a subscript the user applied to a phrase
      // would silently stop being a subscript on reload without this (#1280).
      subscript: createMarkHandler("~", "subscript", { escapeSpaces: true }),
      superscript: createMarkHandler("^", "superscript", { escapeSpaces: true }),
      highlight: createMarkHandler("==", "highlight"),
      underline: createMarkHandler("++", "underline"),
    },
    unsafe: [
      // Override GFM's ~ escaping to exclude our subscript construct
      // This needs to match but be more permissive than the GFM rule
      {
        character: "~",
        inConstruct: "phrasing",
        // Escape only when a `~` could actually re-pair: a later `~` with no
        // whitespace between, which is exactly what the parser now requires.
        // Escaping unconditionally put backslashes into every prose tilde —
        // `4~6 files` became `4\~6 files` — for a pairing that cannot happen.
        after: "[^\\s~]*~",
        notInConstruct: [
          "autolink",
          "destinationLiteral",
          "destinationRaw",
          "reference",
          "titleQuote",
          "titleApostrophe",
          "subscript", // Add our construct
        ],
      },
      // Escape a literal `^` in phrasing so it is never re-parsed as a
      // superscript marker. Single-char markers cannot use the `==`/`++`
      // "followed by same char" trick (there is no doubling to key on), so this
      // mirrors the `~` rule above. Markers emitted BY the superscript handler
      // are exempt via notInConstruct, so real superscripts stay `^…^`.
      // Without this, `x\^2\^` (literal) round-trips to `x^2^` (real superscript).
      // The `after` guard keeps LaTeX-ish prose readable: in
      // `\sum_{k=1}^n a_k^2` neither caret can re-pair (whitespace intervenes),
      // so neither is escaped.
      {
        character: "^",
        inConstruct: "phrasing",
        after: "[^\\s^]*\\^",
        notInConstruct: [
          "autolink",
          "destinationLiteral",
          "destinationRaw",
          "reference",
          "titleQuote",
          "titleApostrophe",
          "superscript",
        ],
      },
      // The mirror of the two `after` guards above: escape a marker whose
      // PARTNER precedes it, so an author's `x\^2\^` keeps both backslashes
      // instead of being normalised to `x\^2^`. Two entries rather than one
      // with both fields, because the condition is "a partner on either side",
      // and a single entry would require both at once.
      {
        character: "~",
        inConstruct: "phrasing",
        before: "~[^\\s~]*",
        notInConstruct: ["autolink", "destinationLiteral", "destinationRaw", "reference", "titleQuote", "titleApostrophe", "subscript"],
      },
      {
        character: "^",
        inConstruct: "phrasing",
        before: "\\^[^\\s^]*",
        notInConstruct: ["autolink", "destinationLiteral", "destinationRaw", "reference", "titleQuote", "titleApostrophe", "superscript"],
      },
      // Escape marker sequences to prevent false parsing
      { character: "=", inConstruct: "phrasing", before: "[^=]", after: "=", notInConstruct: ["highlight"] },
      { character: "+", inConstruct: "phrasing", before: "[^+]", after: "\\+", notInConstruct: ["underline"] },
    ],
  };
}

function createMarkHandler(
  marker: string,
  constructName: string,
  options: { escapeSpaces?: boolean } = {}
): MarkHandler {
  return function (node: unknown, _parent: unknown, state: MarkHandlerState, info: { before: string; after: string }) {
    const tracker = state.createTracker(info);
    const exit = state.enter(constructName);

    let value = tracker.move(marker);
    const current = tracker.current();
    const content = state.containerPhrasing(node as { children: PhrasingContent[] }, {
      ...current,
      before: marker,
      after: marker,
    });
    // Spaces and tabs only. A newline escaped this way would serialize as a
    // markdown hard break, which is not what a sub/superscript means; such a
    // span is pathological and degrades to literal text on reparse instead.
    value += options.escapeSpaces ? content.replace(/[ \t]/g, "\\$&") : content;
    value += tracker.move(marker);

    exit();
    return value;
  };
}

