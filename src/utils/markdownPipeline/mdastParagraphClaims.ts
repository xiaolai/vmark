/**
 * Paragraph ownership claims — Phase 2, ADR-015 D2b.
 *
 * Purpose: make explicit which extension owns a `paragraph` mdast node, instead
 * of deciding it by `if`-order inside `convertParagraph`.
 *
 * A paragraph does not always become a paragraph. With a single `image` child it
 * may become `block_video`, `block_audio` or `block_image` depending on the file
 * extension; with a single `html` child it may become video, audio or a provider
 * embed depending on the tag. Before this, whichever branch was written first
 * won, and that accident was the contract.
 *
 * Strengths encode WHY each claim is made, which reproduces the previous
 * precedence without depending on ordering:
 *
 *   exact     an explicit signal in the source — a `.mp4`/`.mp3` extension, or a
 *             literal `<video>`/`<audio>`/`<iframe>` tag
 *   semantic  a weaker inference — "a lone image child, so probably a block
 *             image"
 *   fallback  ordinary preservation — it is just a paragraph
 *
 * Because strengths are ranked, `![clip](clip.mp4)` is unambiguous: the video
 * recognizer claims `exact`, the block-image recognizer claims `semantic`, and
 * the higher strength wins without either knowing the other exists. Two claims
 * at the SAME strength would be an error rather than a race — see claim.ts.
 *
 * @coordinates-with lib/extensions/claim.ts — the resolution rules
 * @coordinates-with mdastMediaConverters.ts — hosts the converters these wrap
 * @module utils/markdownPipeline/mdastParagraphClaims
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Html, Image, Paragraph } from "mdast";
import type { Claim, Recognizer } from "@/lib/extensions/claim";

/** What a paragraph recognizer is handed. */
export interface ParagraphClaimInput {
  node: Paragraph;
  /** The lone child, when the paragraph has exactly one; otherwise null. */
  onlyChild: Image | Html | null;
  /** Build the media node for a media URL, or null if it is not media. */
  promoteMedia: () => PMNode | null;
  /** Build the media node for raw HTML, or null if the HTML is not media. */
  promoteHtml: () => PMNode | null;
  /** Build a block image, or null if the schema lacks the node. */
  buildBlockImage: () => PMNode | null;
  /** Build the ordinary paragraph. */
  buildParagraph: () => PMNode | null;
}

type ParagraphRecognizer = Recognizer<ParagraphClaimInput, () => PMNode | null>;

function claim(
  strength: Claim<() => PMNode | null>["strength"],
  reason: string,
  build: () => PMNode | null,
): Claim<() => PMNode | null> {
  return { strength, value: build, reason };
}

/**
 * Recognizers for the `paragraph` mdast type, highest-intent first.
 *
 * Order here is documentation only — `resolveClaim` ranks by strength, so
 * reordering this array cannot change which converter wins. That is the whole
 * point of the protocol.
 */
export const PARAGRAPH_RECOGNIZERS: readonly ParagraphRecognizer[] = [
  {
    extensionId: "vmark.blockMedia",
    nodeType: "paragraph",
    recognize: (input) => {
      if (input.onlyChild?.type !== "image") return null;
      const node = input.promoteMedia();
      return node === null
        ? null
        : claim("exact", "image URL has a video/audio extension", () => node);
    },
  },
  {
    extensionId: "vmark.mediaHtml",
    nodeType: "paragraph",
    recognize: (input) => {
      if (input.onlyChild?.type !== "html") return null;
      const node = input.promoteHtml();
      return node === null
        ? null
        : claim("exact", "inline HTML is a <video>/<audio>/provider <iframe>", () => node);
    },
  },
  {
    extensionId: "vmark.blockImage",
    nodeType: "paragraph",
    recognize: (input) => {
      if (input.onlyChild?.type !== "image") return null;
      return claim("semantic", "paragraph holds a lone image child", input.buildBlockImage);
    },
  },
  {
    extensionId: "vmark.paragraph",
    nodeType: "paragraph",
    recognize: (input) => claim("fallback", "ordinary paragraph", input.buildParagraph),
  },
];
