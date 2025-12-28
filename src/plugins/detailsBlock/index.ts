/**
 * GitHub-style Collapsible Block Plugin
 *
 * Supports <details>/<summary> HTML blocks for collapsible content.
 *
 * Usage:
 * <details>
 * <summary>Click to expand</summary>
 *
 * Hidden content here
 *
 * </details>
 *
 * Or type: <details> or :::details
 */

import { remarkDetailsPlugin } from "./remark-plugin";
import { detailsBlockSchema, detailsSummarySchema } from "./node";
import { detailsBlockInputRule } from "./input-rule";
import { detailsClickHandler } from "./click-handler";

/**
 * Complete details block plugin for Milkdown
 *
 * Includes:
 * - Remark plugin for parsing <details>/<summary> HTML
 * - Node schemas for container and summary
 * - Input rule for typing <details> or :::details
 */
export const detailsBlockPlugin = [
  remarkDetailsPlugin,
  detailsSummarySchema,
  detailsBlockSchema,
  detailsBlockInputRule,
  detailsClickHandler,
];

export default detailsBlockPlugin;
