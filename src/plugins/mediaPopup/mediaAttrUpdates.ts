/**
 * Attribute assembly for media-node edits.
 *
 * Purpose: one place that knows WHICH edits invalidate a stored reference
 * identity. A media node resolved from `![alt][id]` keeps that identity so
 * it can serialize back as the reference — but only while its destination
 * still comes from the definition. Change the source and keep the identity,
 * and the next save re-emits `![alt][id]`, whose URL is still the OLD one:
 * the user's new source silently disappears.
 *
 * Split out of `MediaPopupView.ts`, which sits at its frozen size baseline.
 *
 * @coordinates-with MediaPopupView.ts — the popup that edits these nodes
 * @coordinates-with @/utils/referenceIdentity — the detach rule
 * @module plugins/mediaPopup/mediaAttrUpdates
 */
import { detachedReferenceAttrs } from "@/utils/referenceIdentity";

/**
 * Attributes whose edit invalidates a stored reference.
 *
 * `src`/`poster` because the destination no longer comes from the
 * definition. `title` because an `ImageReference` has nowhere to PUT a
 * title — re-emitting `![alt][id]` drops it, and the unchanged definition
 * then restores the old one on the next parse, so the user's edit silently
 * reverts. (`alt` is NOT here: a reference carries its own alt text.)
 */
const DETACHING_ATTRS: ReadonlySet<string> = new Set(["src", "poster", "title"]);

/** Attrs for a single-attribute edit, detaching the reference when needed. */
export function attrsForSingleEdit(
  current: Record<string, unknown>,
  attr: string,
  value: string,
): Record<string, unknown> {
  const detaches = DETACHING_ATTRS.has(attr) && current[attr] !== value;
  return {
    ...current,
    [attr]: value,
    ...(detaches ? detachedReferenceAttrs() : {}),
  };
}

/** Attrs for the image form (source + alt). */
export function attrsForImageEdit(
  current: Record<string, unknown>,
  src: string,
  alt: string,
): Record<string, unknown> {
  return {
    ...current,
    src,
    alt,
    ...(current.src !== src ? detachedReferenceAttrs() : {}),
  };
}

/** Attrs for the media form (source + title + poster). */
export function attrsForMediaEdit(
  current: Record<string, unknown>,
  src: string,
  title: string,
  poster: string,
): Record<string, unknown> {
  const detaches =
    current.src !== src || current.title !== title || current.poster !== poster;
  return {
    ...current,
    src,
    title,
    poster,
    ...(detaches ? detachedReferenceAttrs() : {}),
  };
}
