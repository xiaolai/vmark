/**
 * MCP Bridge — top-level request router.
 *
 * Applies source-mode and read-only guards, then chains the category
 * sub-dispatchers in `dispatchers/`. The first dispatcher that claims the
 * event wins; if none match, responds with `Unknown request type`.
 *
 * @coordinates-with utils.ts — respond()
 * @coordinates-with types.ts — McpRequestEvent
 * @coordinates-with sourceModeGuard.ts — isBlockedInSourceMode, hasSourceHandler
 * @coordinates-with readOnlyGuard.ts — isBlockedInReadOnly
 * @module hooks/mcpBridge/handleRequest
 */

import type { McpRequestEvent } from "./types";
import { respond } from "./utils";
import { useEditorStore } from "@/stores/editorStore";
import {
  isBlockedInSourceMode,
  SOURCE_MODE_ERROR,
  hasSourceHandler,
} from "./sourceModeGuard";
import { isBlockedInReadOnly, READ_ONLY_ERROR } from "./readOnlyGuard";
import { isActiveDocReadOnly } from "@/utils/readOnlyGuard";
import {
  handleSourceDocumentGetContent,
  handleSourceOutlineGet,
  handleSourceMetadataGet,
  handleSourceEditorFocus,
} from "./sourceHandlers";
import { dispatchDocument } from "./dispatchers/documentDispatch";
import { dispatchEditor } from "./dispatchers/editorDispatch";
import { dispatchWorkspace } from "./dispatchers/workspaceDispatch";
import { dispatchInsert } from "./dispatchers/insertDispatch";
import { dispatchAiMcp } from "./dispatchers/aiMcpDispatch";
import { dispatchV2 } from "./v2/dispatch";

/** Route an MCP request through the guard chain and category dispatchers. */
export async function handleRequest(event: McpRequestEvent): Promise<void> {
  const { id, type, args } = event;

  // Block editor-dependent tools in source mode
  const { sourceMode } = useEditorStore.getState();
  if (sourceMode && isBlockedInSourceMode(type)) {
    await respond({ id, success: false, error: SOURCE_MODE_ERROR });
    return;
  }

  // Route source-capable operations to source handlers when in source mode
  if (sourceMode && hasSourceHandler(type)) {
    switch (type) {
      case "document.getContent": await handleSourceDocumentGetContent(id, args); return;
      case "outline.get": await handleSourceOutlineGet(id); return;
      case "metadata.get": await handleSourceMetadataGet(id); return;
      case "editor.focus": await handleSourceEditorFocus(id); return;
    }
  }

  // Block write operations on read-only documents
  if (isBlockedInReadOnly(type) && isActiveDocReadOnly()) {
    await respond({ id, success: false, error: READ_ONLY_ERROR });
    return;
  }

  try {
    // Pruned 4-tool surface (vmark.session/workspace/document/workflow)
    // matches first; legacy dispatchers stay until WI-1.5 deletes them.
    if (await dispatchV2(event)) return;
    if (await dispatchDocument(event)) return;
    if (await dispatchEditor(event)) return;
    if (await dispatchWorkspace(event)) return;
    if (await dispatchInsert(event)) return;
    if (await dispatchAiMcp(event)) return;

    await respond({
      id,
      success: false,
      error: `Unknown request type: ${type}`,
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
