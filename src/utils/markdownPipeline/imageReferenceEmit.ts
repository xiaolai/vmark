/**
 * The ONE place a ProseMirror image becomes MDAST.
 *
 * Purpose: an image reaches markdown from four different node types
 * (`image`, `block_image`, `block_video`, `block_audio`) through two
 * converters. Reconstructing the reference form in each of them is how the
 * inline path came to remember `![alt][id]` while every media path silently
 * rewrote it inline.
 *
 * @coordinates-with pmInlineConverters.ts — inline images
 * @coordinates-with pmMediaConverters.ts — promoted video/audio
 * @coordinates-with @/utils/referenceIdentity — the attrs
 * @module utils/markdownPipeline/imageReferenceEmit
 */
import type { Image, ImageReference } from "mdast";
import { readReferenceIdentity } from "@/utils/referenceIdentity";

export interface ImageEmitAttrs {
  src: string;
  alt?: string | null;
  title?: string | null;
  referenceId?: unknown;
  referenceType?: unknown;
}

/**
 * Emit `![alt][id]` when the node still carries a reference identity, and a
 * plain `![alt](src)` otherwise.
 *
 * The identity is cleared whenever the user edits the destination (see
 * `detachedReferenceAttrs`), so a node that reaches here with one is a node
 * whose URL still comes from its definition.
 */
export function buildImageOrReference(
  attrs: ImageEmitAttrs,
): Image | ImageReference {
  const alt = (attrs.alt as string) || undefined;
  const title = (attrs.title as string) || undefined;
  const { referenceId, referenceType } = readReferenceIdentity(
    attrs as unknown as Record<string, unknown>,
  );

  if (referenceId) {
    return {
      type: "imageReference",
      identifier: referenceId.toLowerCase(),
      label: referenceId,
      alt: alt ?? "",
      referenceType:
        referenceType === "full" || referenceType === "collapsed"
          ? referenceType
          : "shortcut",
    } as ImageReference;
  }

  return { type: "image", url: attrs.src, alt, title };
}
