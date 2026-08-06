/**
 * Purpose: VMark's Link mark — the attributes a markdown round trip needs.
 *
 * Tiptap's base Link carries only `href`. Everything else here exists because
 * dropping it silently REWRITES the author's file:
 *
 *   - `title`         `[text](url "title")` loses its title without it.
 *   - `referenceId`   A reference link (`[text][id]`) is resolved to its inline
 *     `referenceType` form for editing — the editor needs a real href to open —
 *                     but must serialize back as a reference. Without these,
 *                     every reference-style file was rewritten inline on the
 *                     first debounced edit, and lint rule W03 then warned
 *                     "Unused link definition" about VMark's own output.
 *
 * Split out of `tiptapExtensions.ts`, which sits at the 300-line limit.
 *
 * @coordinates-with utils/markdownPipeline/plugins/resolveReferences.ts — records the identity
 * @coordinates-with utils/markdownPipeline/pmInlineConverters.ts — puts the reference back
 * @module services/assembly/linkExtension
 */

import Link from "@tiptap/extension-link";

/** Link with excludes (no nested links, no code inside) and round-trip attrs. */
export const vmarkLinkExtension = Link.extend({
  excludes: "link code",
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      referenceId: { default: null },
      referenceType: { default: null },
    };
  },
}).configure({
  openOnClick: false,
  // No target="_blank" — it bypasses VMark's own click handling.
  HTMLAttributes: { target: null, rel: null },
});
