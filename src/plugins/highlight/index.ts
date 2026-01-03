/**
 * Highlight Plugin
 *
 * Adds support for ==highlight== markdown syntax.
 *
 * Features:
 * - Mark schema for highlight
 * - Remark plugin for parsing markdown
 * - Input rule for live typing
 * - Toggle command for programmatic control
 */

import "./highlight.css";

import { highlightSchema } from "./marks";
import { remarkHighlightPlugin } from "./remark-plugin";
import { highlightInputRule } from "./input-rules";
import { toggleHighlightCommand } from "./commands";

// Re-export individual components
export {
  highlightSchema,
  remarkHighlightPlugin,
  highlightInputRule,
  toggleHighlightCommand,
};

/**
 * Combined plugin array for easy registration
 * Usage: .use(highlightPlugin.flat())
 */
export const highlightPlugin = [
  // Remark plugin for parsing markdown
  remarkHighlightPlugin,
  // Mark schema
  highlightSchema,
  // Input rule for live typing
  highlightInputRule,
  // Toggle command
  toggleHighlightCommand,
];
