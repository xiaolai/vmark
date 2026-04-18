/**
 * MCP Bridge — AI-oriented protocol / structure / mutation / section / paragraph
 * / batch-ops dispatcher.
 *
 * @module hooks/mcpBridge/dispatchers/aiMcpDispatch
 */

import type { McpRequestEvent } from "../types";
import {
  handleGetCapabilities,
  handleGetRevision,
} from "../protocolHandlers";
import {
  handleGetAst,
  handleGetDigest,
  handleListBlocks,
  handleResolveTargets,
  handleGetSection,
} from "../structureHandlers";
import {
  handleBatchEdit,
  handleApplyDiff,
  handleReplaceAnchored,
} from "../mutationHandlers";
import {
  handleSectionUpdate,
  handleSectionInsert,
  handleSectionMove,
} from "../sectionHandlers";
import {
  handleParagraphRead,
  handleParagraphWrite,
} from "../paragraphHandlers";
import {
  handleTableBatchModify,
  handleListBatchModify,
} from "../batchOpHandlers";

export async function dispatchAiMcp(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  switch (type) {
    // Protocol operations
    case "protocol.getCapabilities":
      await handleGetCapabilities(id);
      return true;
    case "protocol.getRevision":
      await handleGetRevision(id);
      return true;

    // Structure operations
    case "structure.getAst":
      await handleGetAst(id, args);
      return true;
    case "structure.getDigest":
      await handleGetDigest(id);
      return true;
    case "structure.listBlocks":
      await handleListBlocks(id, args);
      return true;
    case "structure.resolveTargets":
      await handleResolveTargets(id, args);
      return true;
    case "structure.getSection":
      await handleGetSection(id, args);
      return true;

    // Mutation operations
    case "mutation.batchEdit":
      await handleBatchEdit(id, args);
      return true;
    case "mutation.applyDiff":
      await handleApplyDiff(id, args);
      return true;
    case "mutation.replaceAnchored":
      await handleReplaceAnchored(id, args);
      return true;

    // Section operations
    case "section.update":
      await handleSectionUpdate(id, args);
      return true;
    case "section.insert":
      await handleSectionInsert(id, args);
      return true;
    case "section.move":
      await handleSectionMove(id, args);
      return true;

    // Paragraph operations (for flat documents without headings)
    case "paragraph.read":
      await handleParagraphRead(id, args);
      return true;
    case "paragraph.write":
      await handleParagraphWrite(id, args);
      return true;

    // Batch operations
    case "table.batchModify":
      await handleTableBatchModify(id, args);
      return true;
    case "list.batchModify":
      await handleListBatchModify(id, args);
      return true;

    default:
      return false;
  }
}
