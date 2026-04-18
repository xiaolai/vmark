/**
 * MCP Bridge — VMark-specific inserts / CJK / smart-insert / media dispatcher.
 *
 * @module hooks/mcpBridge/dispatchers/insertDispatch
 */

import type { McpRequestEvent } from "../types";
import {
  handleInsertMathInline,
  handleInsertMathBlock,
  handleInsertMermaid,
  handleInsertMarkmap,
  handleInsertSvg,
  handleInsertWikiLink,
} from "../vmarkHandlers";
import {
  handleCjkPunctuationConvert,
  handleCjkSpacingFix,
  handleCjkFormat,
} from "../cjkHandlers";
import { handleSmartInsert } from "../smartInsertHandlers";
import { handleInsertMedia } from "../mediaHandlers";

export async function dispatchInsert(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  switch (type) {
    // VMark-specific operations
    case "vmark.insertMathInline":
      await handleInsertMathInline(id, args);
      return true;
    case "vmark.insertMathBlock":
      await handleInsertMathBlock(id, args);
      return true;
    case "vmark.insertMermaid":
      await handleInsertMermaid(id, args);
      return true;
    case "vmark.insertMarkmap":
      await handleInsertMarkmap(id, args);
      return true;
    case "vmark.insertSvg":
      await handleInsertSvg(id, args);
      return true;
    case "vmark.insertWikiLink":
      await handleInsertWikiLink(id, args);
      return true;
    case "vmark.cjkPunctuationConvert":
      await handleCjkPunctuationConvert(id, args);
      return true;
    case "vmark.cjkSpacingFix":
      await handleCjkSpacingFix(id, args);
      return true;
    case "vmark.cjkFormat":
      await handleCjkFormat(id, args);
      return true;

    // Smart insert (intuitive insertion at common locations)
    case "smartInsert":
      await handleSmartInsert(id, args);
      return true;

    // Media insert (video, audio, YouTube embed)
    case "insertMedia":
      await handleInsertMedia(id, args);
      return true;

    default:
      return false;
  }
}
