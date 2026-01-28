/**
 * Protocol Handlers - Capabilities and revision tracking.
 *
 * Part of AI-Oriented MCP Design implementation.
 */

import { respond } from "./utils";
import { useRevisionStore } from "@/stores/revisionStore";

/**
 * Protocol version.
 */
const PROTOCOL_VERSION = "1.0.0";

/**
 * Supported node types.
 */
const SUPPORTED_NODE_TYPES = [
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "horizontalRule",
  "image",
  "hardBreak",
  "text",
];

/**
 * Supported query operators.
 */
const SUPPORTED_QUERY_OPERATORS = ["type", "contains", "level", "index", "hasMarks"];

/**
 * Protocol limits.
 */
const LIMITS = {
  maxBatchSize: 100,
  maxPayloadBytes: 1048576, // 1MB
  maxRequestsPerSecond: 10,
  maxConcurrentRequests: 3,
};

/**
 * Handle get_capabilities request.
 */
export async function handleGetCapabilities(id: string): Promise<void> {
  try {
    const capabilities = {
      version: PROTOCOL_VERSION,
      supportedNodeTypes: SUPPORTED_NODE_TYPES,
      supportedQueryOperators: SUPPORTED_QUERY_OPERATORS,
      limits: LIMITS,
      features: {
        suggestionModeSupported: true,
        revisionTracking: true,
        idempotency: true,
      },
    };

    await respond({ id, success: true, data: capabilities });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle get_document_revision request.
 */
export async function handleGetRevision(id: string): Promise<void> {
  try {
    const { currentRevision, lastUpdated } = useRevisionStore.getState();

    await respond({
      id,
      success: true,
      data: {
        revision: currentRevision,
        lastUpdated,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
