/**
 * Strict accessors for a `ToolCallResult`'s text payload.
 *
 * `content[0].text` is optional at the type level (image and embedded-resource
 * blocks carry no text), so every assertion site had to widen or cast. These
 * helpers narrow once and THROW when the block is missing — an assertion that
 * silently compares against `''` passes for the wrong reason.
 */

import type { ToolCallResult } from '../../src/types.js';

/** Text of the result's first text block. Throws when there is none. */
export function toolText(result: ToolCallResult): string {
  const block = result.content.find((c) => c.type === 'text');
  if (!block || typeof block.text !== 'string') {
    throw new Error(
      `tool result has no text block: ${JSON.stringify(result.content)}`,
    );
  }
  return block.text;
}

/** Parsed JSON payload of the result's first text block. */
export function toolJson<T = unknown>(result: ToolCallResult): T {
  return JSON.parse(toolText(result)) as T;
}
