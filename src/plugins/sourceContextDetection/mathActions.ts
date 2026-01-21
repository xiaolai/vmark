import type { Text } from "@codemirror/state";
import type { BlockMathInfo } from "./blockMathDetection";

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function getBlockMathContentRange(
  doc: Text,
  info: BlockMathInfo
): { from: number; to: number } | null {
  if (info.startLine < 1 || info.endLine > doc.lines) return null;
  if (info.startLine >= info.endLine) return null;

  const startLine = doc.line(info.startLine);
  const endLine = doc.line(info.endLine);

  const openIndex = startLine.text.indexOf("$$");
  const closeIndex = endLine.text.lastIndexOf("$$");

  if (openIndex === -1 || closeIndex === -1) return null;

  const openLineBare = startLine.text.trim() === "$$";
  const closeLineBare = endLine.text.trim() === "$$";

  let from: number;
  if (openLineBare) {
    const contentStartLine = info.startLine + 1;
    if (contentStartLine > doc.lines) return null;
    from = doc.line(contentStartLine).from;
  } else {
    from = startLine.from + openIndex + 2;
  }

  let to: number;
  if (closeLineBare) {
    const contentEndLine = info.endLine - 1;
    if (contentEndLine < 1) return null;
    if (openLineBare && contentEndLine < info.startLine + 1) return null;
    if (!openLineBare && contentEndLine < info.startLine) return null;
    to = doc.line(contentEndLine).to;
  } else {
    to = endLine.from + closeIndex;
  }

  return { from, to };
}

export function getBlockMathUnwrapChanges(
  doc: Text,
  info: BlockMathInfo
): TextChange[] | null {
  if (info.startLine < 1 || info.endLine > doc.lines) return null;
  if (info.startLine >= info.endLine) return null;

  const startLine = doc.line(info.startLine);
  const endLine = doc.line(info.endLine);

  const openIndex = startLine.text.indexOf("$$");
  const closeIndex = endLine.text.lastIndexOf("$$");

  if (openIndex === -1 || closeIndex === -1) return null;

  return [
    {
      from: startLine.from + openIndex,
      to: startLine.from + openIndex + 2,
      insert: "",
    },
    {
      from: endLine.from + closeIndex,
      to: endLine.from + closeIndex + 2,
      insert: "",
    },
  ];
}
