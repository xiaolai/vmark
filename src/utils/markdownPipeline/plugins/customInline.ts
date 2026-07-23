/**
 * Custom Inline Marks — Remark Plugin
 *
 * Purpose: Adds support for VMark's custom inline syntax markers:
 *   ==highlight==, ++underline++, ^superscript^, ~subscript~
 *
 * Key decisions:
 *   - Uses tree transform (post-parse) rather than tokenizer extension because
 *     remark's micromark tokenizer API is complex and fragile for paired markers
 *   - Subscript uses single `~` with skipDouble to avoid conflict with GFM's
 *     `~~strikethrough~~` (double tilde)
 *   - Marker parsing supports nesting: ==^bold superscript^== works
 *   - Code spans, math, HTML, and YAML nodes are skipped (markers are literal inside code)
 *   - Serialization uses unsafe rules to prevent remark-stringify from escaping markers
 *
 * @coordinates-with parser.ts — always loaded (lightweight, common syntax)
 * @coordinates-with serializer.ts — serialization handlers registered via toMarkdownExtensions
 * @coordinates-with types.ts — Subscript, Superscript, Highlight, Underline types
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
      subscript: createMarkHandler("~", "subscript"),
      superscript: createMarkHandler("^", "superscript"),
      highlight: createMarkHandler("==", "highlight"),
      underline: createMarkHandler("++", "underline"),
    },
    unsafe: [
      // Override GFM's ~ escaping to exclude our subscript construct
      // This needs to match but be more permissive than the GFM rule
      {
        character: "~",
        inConstruct: "phrasing",
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
      {
        character: "^",
        inConstruct: "phrasing",
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
      // Escape marker sequences to prevent false parsing
      { character: "=", inConstruct: "phrasing", before: "[^=]", after: "=", notInConstruct: ["highlight"] },
      { character: "+", inConstruct: "phrasing", before: "[^+]", after: "\\+", notInConstruct: ["underline"] },
    ],
  };
}

function createMarkHandler(marker: string, constructName: string): MarkHandler {
  return function (node: unknown, _parent: unknown, state: MarkHandlerState, info: { before: string; after: string }) {
    const tracker = state.createTracker(info);
    const exit = state.enter(constructName);

    let value = tracker.move(marker);
    const current = tracker.current();
    value += state.containerPhrasing(node as { children: PhrasingContent[] }, {
      ...current,
      before: marker,
      after: marker,
    });
    value += tracker.move(marker);

    exit();
    return value;
  };
}

