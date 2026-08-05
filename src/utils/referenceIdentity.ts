/**
 * Reference identity carried by nodes that came from Markdown image syntax.
 *
 * Purpose: `![alt][id]` is resolved to an inline image for editing — the
 * editor needs a real `src` to render — but must serialize back as the
 * reference the author wrote. Without this the image was rewritten inline on
 * the first save and its `[id]: url` definition became an orphan, which
 * VMark's own lint then flagged as W03 "unused link definition".
 *
 * Lives in `utils/` rather than `plugins/shared/` because BOTH the markdown
 * pipeline and the node schemas need it, and `utils/` is the only tier both
 * may import (ADR-013 leaf purity).
 *
 * Links already solve this on the link MARK (`services/assembly/linkExtension`).
 * An image is a NODE, and one image can become four different nodes —
 * `image`, `block_image`, `block_video`, `block_audio` — so the attribute pair
 * is declared once here and spread into each.
 *
 * Key decisions:
 *   - `rendered: false`. These are serialization bookkeeping, not content;
 *     rendering them would leak `data-reference-id` into the DOM and into
 *     copied HTML.
 *   - Defaults are `null`, so documents created before the attributes
 *     existed load unchanged — ProseMirror fills the default in.
 *   - EDITING THE SOURCE DETACHES. If the user changes `src`, the node must
 *     stop claiming the reference: re-emitting `![alt][id]` would point at
 *     the OLD definition and silently discard what they just typed.
 *     `detachedReferenceAttrs` is the one place that decision lives.
 *
 * @coordinates-with utils/markdownPipeline/plugins/resolveReferences.ts — records the identity
 * @coordinates-with utils/markdownPipeline/pmMediaConverters.ts — puts the reference back
 * @module utils/referenceIdentity
 */

/** The reference a resolved image node came from, if any. */
export interface ReferenceIdentity {
  referenceId: string | null;
  referenceType: string | null;
}

/**
 * Tiptap attribute declarations. Spread into every node that can originate
 * from Markdown image syntax.
 */
export const referenceIdentityAttrs = {
  referenceId: { default: null as string | null, rendered: false },
  referenceType: { default: null as string | null, rendered: false },
} as const;

/** Empty identity — a node that is not a reference, or no longer one. */
export const NO_REFERENCE: ReferenceIdentity = {
  referenceId: null,
  referenceType: null,
};

/**
 * The identity a node should carry after its destination was edited.
 *
 * Always detached. Keeping the reference would re-serialize `![alt][id]`,
 * whose destination still comes from the untouched definition — so the user's
 * new URL would vanish on save. Updating the shared definition instead is
 * worse: other links and images may point at it.
 */
export function detachedReferenceAttrs(): ReferenceIdentity {
  return { ...NO_REFERENCE };
}

/** Read reference identity off arbitrary node attrs, normalising absent to null. */
export function readReferenceIdentity(
  attrs: Record<string, unknown> | undefined,
): ReferenceIdentity {
  const id = attrs?.referenceId;
  const type = attrs?.referenceType;
  return {
    referenceId: typeof id === "string" && id !== "" ? id : null,
    referenceType: typeof type === "string" && type !== "" ? type : null,
  };
}
