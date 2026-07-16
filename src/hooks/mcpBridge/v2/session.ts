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
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { urlForAgent } from "@/lib/browser/url";

const MCP_PROTOCOL_VERSION = "0.3.0";

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
    const sessionTabs: SessionTab[] = (tabState.tabs[label] ?? []).map((tab) => {
      if (tab.kind === "browser") {
        return {
          id: tab.id,
          kind: "browser" as const,
          active: tab.id === tabState.activeTabId[label],
          title: tab.title,
          url: urlForAgent(tab.url),
          loading: browserEventBroker.isLoading(tab.id) ?? false,
          generation: tab.generation ?? 0,
          automationMode: tab.automationMode ?? "human",
        };
      }
      const doc = docState.documents[tab.id];
      const content = doc?.content ?? "";
      const documentKind = detectKind(tab.filePath, content);
      return {
        id: tab.id,
        kind: documentKind,
        filePath: tab.filePath,
        title: tab.title,
        dirty: doc?.isDirty ?? false,
        revision: revisionStore.getRevision(tab.id),
        documentKind,
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
