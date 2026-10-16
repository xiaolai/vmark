/**
 * Purpose: the inline image view's `src` resolver.
 *
 * The algorithm is shared with the Source-mode preview and the block media
 * node views and lives in `plugins/shared/resolveMediaPath.ts`; this module is
 * the name the node view imports, and the place its tests exercise the
 * resolver against this plugin's host seam.
 *
 * @coordinates-with plugins/shared/resolveMediaPath.ts — the implementation
 * @coordinates-with plugins/imageView/plugin.ts — the node view that calls this
 * @module plugins/imageView/resolveSrc
 */

export { resolveImageSrc, snapshotActiveFilePath } from "@/plugins/shared/resolveMediaPath";
