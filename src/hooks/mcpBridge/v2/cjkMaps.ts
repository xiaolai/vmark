/**
 * Purpose: Half-width ↔ full-width punctuation tables used by
 *   `vmark.document.transform({kind: "cjk-punctuation"})`.
 *
 *   Extracted out of the legacy `cjkHandlers.ts` so the v2 surface has
 *   no dependency on the deleted handler file.
 *
 * @module hooks/mcpBridge/v2/cjkMaps
 */

export const HALF_TO_FULL: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
  "(": "（",
  ")": "）",
};
