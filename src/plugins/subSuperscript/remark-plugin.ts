/**
 * Remark Plugin for Subscript/Superscript
 *
 * Parses ~subscript~ and ^superscript^ syntax in markdown.
 * Uses mdast-util-find-and-replace for text transformation.
 */

import { $remark } from "@milkdown/kit/utils";
import { findAndReplace, type Find, type Replace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";

// Regex patterns - match text between delimiters
// Subscript: ~text~ (but not ~~strikethrough~~) OR <sub>text</sub>
const SUB_REGEX = /(?<![~\\])~([^~\s][^~]*[^~\s]|[^~\s])~(?!~)|<sub>([^<]+)<\/sub>/gi;
// Superscript: ^text^ (but not escaped) OR <sup>text</sup>
const SUP_REGEX = /(?<![\\])\^([^^]+)\^|<sup>([^<]+)<\/sup>/gi;

/**
 * Custom mdast node types for subscript/superscript
 */
interface SubscriptNode {
  type: "subscript";
  data: { hName: "sub" };
  children: Array<{ type: "text"; value: string }>;
}

interface SuperscriptNode {
  type: "superscript";
  data: { hName: "sup" };
  children: Array<{ type: "text"; value: string }>;
}

/**
 * Creates a subscript node from matched text
 * Handles both ~text~ (group 1) and <sub>text</sub> (group 2)
 */
function createSubscriptNode(_: string, text1: string, text2: string): SubscriptNode {
  const text = text1 || text2;
  return {
    type: "subscript",
    data: { hName: "sub" },
    children: [{ type: "text", value: text }],
  };
}

/**
 * Creates a superscript node from matched text
 * Handles both ^text^ (group 1) and <sup>text</sup> (group 2)
 */
function createSuperscriptNode(_: string, text1: string, text2: string): SuperscriptNode {
  const text = text1 || text2;
  return {
    type: "superscript",
    data: { hName: "sup" },
    children: [{ type: "text", value: text }],
  };
}

/**
 * Remark plugin that transforms ~text~ to subscript and ^text^ to superscript
 */
function remarkSubSuperscript() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [SUB_REGEX as unknown as Find, createSubscriptNode as unknown as Replace],
      [SUP_REGEX as unknown as Find, createSuperscriptNode as unknown as Replace],
    ]);
  };
}

/**
 * Milkdown remark plugin wrapper
 */
export const remarkSubSuperscriptPlugin = $remark(
  "remarkSubSuperscript",
  () => remarkSubSuperscript
);
