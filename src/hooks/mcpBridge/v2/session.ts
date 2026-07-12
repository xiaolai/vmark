/**
 * Purpose: `vmark.session.get_state` — one-shot orientation for AI agents.
 *   Replaces five legacy discovery tools (get_capabilities,
 *   get_document_revision, tabs.list, workspace.get_focused,
 *   workspace.list_windows) with a single call that returns every window,
 *   every tab, and per-tab metadata including a revision token.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-6.
 *
 * Key decisions:
 *   - Revisions are keyed per tab (revisionStore, WI-0.10). Each SessionTab
 *     reports its own tab's revision so STALE detection on a non-active tab
 *     is validated against the correct document.
 *   - `kind` is computed by sniffing filePath + content via the existing
 *     workflow detection helpers — the AI shouldn't reimplement it.
 *
 * @coordinates-with stores/tabStore.ts — open tabs per window
 * @coordinates-with stores/documentStore.ts — filePath, dirty, content
 * @coordinates-with stores/revisionStore.ts — revision token
 * @coordinates-with stores/windowStore.ts — focused window resolution
 * @coordinates-with lib/ghaWorkflow/detection.ts — kind discrimination
 * @module hooks/mcpBridge/v2/session
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import type {
  DocumentKind,
  SessionState,
  SessionTab,
  SessionWindow,
} from "./types";

const MCP_PROTOCOL_VERSION = "0.2.0";

function detectKind(
  filePath: string | null,
  content: string,
): DocumentKind {
  if (looksLikeWorkflowPath(filePath ?? undefined)) return "yaml-workflow";
  if (isWorkflowYaml(content)) return "yaml-workflow";
  return "markdown";
}

/**
 * Build the session-state payload from current store state.
 *
 * Pure function over store state — exported for unit testing without
 * the bridge `respond` round-trip.
 */
export function buildSessionState(appVersion: string): SessionState {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();
  const revisionStore = useRevisionStore.getState();
  const focusedLabel = getCurrentWindowLabel();

  const windowLabels = Object.keys(tabState.tabs);
  const windows: SessionWindow[] = windowLabels.map((label) => {
    // D1-7: the legacy MCP session state describes documents only — browser
    // tabs are omitted here (the browser MCP surface lands in WI-2.5).
    const tabs = (tabState.tabs[label] ?? []).filter((t) => t.kind === "document");
    const sessionTabs: SessionTab[] = tabs.map((tab) => {
      const doc = docState.documents[tab.id];
      const content = doc?.content ?? "";
      return {
        id: tab.id,
        filePath: tab.filePath,
        title: tab.title,
        dirty: doc?.isDirty ?? false,
        revision: revisionStore.getRevision(tab.id),
        kind: detectKind(tab.filePath, content),
      };
    });
    return {
      label,
      focused: label === focusedLabel,
      tabs: sessionTabs,
    };
  });

  return {
    windows,
    capabilities: {
      version: appVersion,
      supportedKinds: ["markdown", "yaml-workflow"],
      mcpProtocol: MCP_PROTOCOL_VERSION,
    },
  };
}

/**
 * Handle `vmark.session.get_state` requests.
 *
 * No args. Returns the full session state — orientation in one round-trip.
 */
export async function handleSessionGetState(
  id: string,
  appVersion: string,
): Promise<void> {
  return wrapHandler(id, async () => {
    const state = buildSessionState(appVersion);
    await respond({ id, success: true, data: state });
  });
}
