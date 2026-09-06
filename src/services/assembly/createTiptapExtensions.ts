/**
 * Composition of the WYSIWYG extension array.
 *
 * Split from `tiptapExtensions.ts` for the size gate, along the seam that was
 * already there: that file DECLARES the extensions, this one RESOLVES them
 * into an ordered array. Nothing else moved, and the canonical-order guard
 * still runs here, so a new extension is still a hard failure until it is
 * listed.
 *
 * @coordinates-with tiptapExtensions.ts — the declaration list
 * @coordinates-with compositionOrder.ts — the canonical order
 * @module services/assembly/createTiptapExtensions
 */
import type { Extensions } from "@tiptap/core";
import { resolveExtensions } from "@/lib/extensions/resolve";
import type { VMarkExtension } from "@/lib/extensions/types";
import { WYSIWYG_COMPOSITION_ORDER, WYSIWYG_OPTIONAL_IDS } from "./compositionOrder";
import {
  assertCanonicalCoverage,
  deriveAfterConstraints,
  orderingSlice,
} from "./extensionOrdering";
import { buildExtensionList, type TiptapExtensionConfig } from "./tiptapExtensions";

/**
 * Creates the array of Tiptap extensions for the WYSIWYG editor. Composition
 * goes through `resolveExtensions` (ADR-015 D1): the registry IS the composition,
 * so no second representation can drift from it.
 *
 * Each Tiptap extension becomes a descriptor keyed by its own `name` (unique
 * across all 78). Order is pinned by explicit `after` constraints derived from
 * `WYSIWYG_COMPOSITION_ORDER` (WI-3.4), so the descriptors are sorted
 * alphabetically before resolution and the resolver reproduces the canonical
 * order regardless of array position. Resolution errors throw rather than
 * silently dropping an extension — a missing editor extension is a broken editor.
 */
export function createTiptapExtensions(config: TiptapExtensionConfig = {}): Extensions {
  const list = buildExtensionList(config);
  const presentIds = list.map((extension, index) => extension.name || `anonymous-${index}`);

  // Fail loud if an extension was added/removed without updating the canonical
  // order (WI-3.4), then pin each present entry after its canonical predecessor.
  assertCanonicalCoverage("wysiwyg", WYSIWYG_COMPOSITION_ORDER, presentIds, WYSIWYG_OPTIONAL_IDS);
  const after = deriveAfterConstraints(WYSIWYG_COMPOSITION_ORDER, presentIds);

  const descriptors: VMarkExtension[] = list
    .map((extension, index): VMarkExtension => {
      const id = extension.name || `anonymous-${index}`;
      return {
        id,
        contributions: [{ kind: "tiptap", factory: () => extension }],
        ...orderingSlice(after, id),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const { ordered, errors } = resolveExtensions(descriptors);
  if (errors.length > 0) {
    throw new Error(
      `Editor extension composition failed:\n${errors
        .map((error) => `  - [${error.code}] ${error.message}`)
        .join("\n")}`,
    );
  }

  return ordered.map(
    (descriptor) =>
      (descriptor.contributions[0] as { factory: () => Extensions[number] }).factory(),
  );
}
