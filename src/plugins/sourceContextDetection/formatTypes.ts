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
