/**
 * Purpose: read a markdown link or image DESTINATION out of Source text.
 *
 * `LinkContext.href` and `ImageContext.src` were built as `""` with the note
 * "Would need to parse from content". The information was always present —
 * Source holds the raw `[text](url)` — so every consumer that needed the
 * target re-derived it, and a separate module grew to recover what the context
 * already knew.
 *
 * Uses the CANONICAL parser in `utils/markdownLinkPatterns`, deliberately, so
 * this does not become the fourth link parser in the codebase. That parser
 * already handles `<angled>` destinations and trailing `"titles"`, which a
 * local regex would quietly get wrong.
 *
 * Also builds the four INLINE CONTEXTS from a detected element, which moved
 * here with it — the switch was already a unit, and it is the only caller of
 * `targetIn`.
 *
 * @coordinates-with plugins/sourceContextDetection/cursorContext.ts — the consumer
 * @coordinates-with utils/markdownLinkPatterns.ts — the one parser
 * @module plugins/sourceContextDetection/linkTarget
 */

import type { EditorView } from "@codemirror/view";
import { findMarkdownLinksInLine } from "@/utils/markdownLinkPatterns";
import type {
  LinkContext,
  ImageContext,
  InlineMathContext,
  FootnoteContext,
} from "@/types/cursorContext";
import type { InlineElementInfo } from "./inlineDetection";

/**
 * The destination of the markdown link or image OVERLAPPING [from, to), or "".
 *
 * Scoped to the line, which is what the canonical parser takes and is also
 * correct: a markdown inline link cannot span a line break.
 *
 * Range overlap rather than a point test, because the two spans do not start
 * at the same character: for an image, the detected element begins at the `!`
 * while the link match begins at the `[`. A point test using the element's
 * start therefore found links and silently missed every image.
 */
function targetIn(
  view: EditorView,
  from: number,
  to: number,
  wantImage: boolean,
): string {
  const line = view.state.doc.lineAt(from);
  const isImage = (m: { from: number }) => line.text[m.from - line.from - 1] === "!";
  const match = findMarkdownLinksInLine(line.text, line.from, false)
    .filter((m) => isImage(m) === wantImage)
    .find((m) => m.from < to && m.to > from);
  return match?.url ?? "";
}


/** The four inline contexts, built from a detected inline element. */
export interface InlineContexts {
  inLink: LinkContext | null;
  inImage: ImageContext | null;
  inInlineMath: InlineMathContext | null;
  inFootnote: FootnoteContext | null;
}

/**
 * Build the inline contexts for a detected element.
 *
 * Extracted from `cursorContext.ts` when parsing real `href`/`src` values
 * pushed that file past its size baseline — the switch was already a unit.
 */
export function inlineContextsFor(
  view: EditorView,
  inlineElement: InlineElementInfo | null,
): InlineContexts {
  let inLink: LinkContext | null = null;
  let inImage: ImageContext | null = null;
  let inInlineMath: InlineMathContext | null = null;
  let inFootnote: FootnoteContext | null = null;

  if (inlineElement) {
    switch (inlineElement.type) {
      case "link":
        // href/src are PARSED — see linkTarget.ts. Both were `""` before.
        inLink = {
          href: targetIn(view, inlineElement.from, inlineElement.to, false),
          text: view.state.doc.sliceString(
            inlineElement.contentFrom,
            inlineElement.contentTo
          ),
          from: inlineElement.from,
          to: inlineElement.to,
          contentFrom: inlineElement.contentFrom,
          contentTo: inlineElement.contentTo,
        };
        break;
      case "image":
        inImage = {
          src: targetIn(view, inlineElement.from, inlineElement.to, true),
          alt: view.state.doc.sliceString(
            inlineElement.contentFrom,
            inlineElement.contentTo
          ),
          from: inlineElement.from,
          to: inlineElement.to,
        };
        break;
      case "math":
        inInlineMath = {
          from: inlineElement.from,
          to: inlineElement.to,
          contentFrom: inlineElement.contentFrom,
          contentTo: inlineElement.contentTo,
        };
        break;
      case "footnote":
        inFootnote = {
          label: view.state.doc.sliceString(
            inlineElement.contentFrom,
            inlineElement.contentTo
          ),
          from: inlineElement.from,
          to: inlineElement.to,
          contentFrom: inlineElement.contentFrom,
          contentTo: inlineElement.contentTo,
        };
        break;
    }
  }

  return { inLink, inImage, inInlineMath, inFootnote };
}
