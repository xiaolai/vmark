/**
 * Format Type Definitions for Source Mode
 *
 * Purpose: Canonical type and marker definitions for all inline markdown formatting.
 * Used by format detection, format actions, and the toolbar adapter to keep
 * marker strings and type names in a single source of truth.
 *
 * @module plugins/sourceContextDetection/formatTypes
 */
export type FormatType =
  | "bold"
  | "italic"
  | "code"
  | "strikethrough"
  | "highlight"
  | "underline"
  | "link"
  | "image"
  | "superscript"
  | "subscript"
  | "footnote";

export interface FormatMarkers {
  prefix: string;
  suffix: string;
}

// Formats that use simple prefix/suffix wrapping
export type WrapFormatType = Exclude<FormatType, "footnote">;

export const FORMAT_MARKERS: Record<WrapFormatType, FormatMarkers> = {
  bold: { prefix: "**", suffix: "**" },
  italic: { prefix: "*", suffix: "*" },
  code: { prefix: "`", suffix: "`" },
  strikethrough: { prefix: "~~", suffix: "~~" },
  highlight: { prefix: "==", suffix: "==" },
  underline: { prefix: "++", suffix: "++" },
  link: { prefix: "[", suffix: "](url)" },
  image: { prefix: "![", suffix: "](url)" },
  superscript: { prefix: "^", suffix: "^" },
  subscript: { prefix: "~", suffix: "~" },
};
