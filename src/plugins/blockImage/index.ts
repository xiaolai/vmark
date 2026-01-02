/**
 * Block Image Plugin
 *
 * Adds block-level image support to the editor.
 * Block images appear on their own line, not inline with text.
 *
 * Features:
 * - Standalone images (alone in a paragraph) become block images
 * - Images mixed with text remain inline
 * - Block images serialize with proper line breaks
 *
 * Usage:
 *   import { blockImagePlugin } from "@/plugins/blockImage";
 *
 *   // In editor setup (BEFORE commonmark):
 *   .use(blockImagePlugin.flat())
 *   .use(commonmark)
 */

import "./block-image.css";
import { blockImageId, blockImageSchema } from "./node";
import { remarkBlockImagePlugin } from "./remark-plugin";
import { blockImageViewPlugin } from "./view";

export { blockImageId, blockImageSchema };
export { remarkBlockImagePlugin };
export { blockImageViewPlugin };

// Bundled plugin array for convenient use with .use().flat()
export const blockImagePlugin = [
  remarkBlockImagePlugin,
  blockImageSchema,
  blockImageViewPlugin,
];
