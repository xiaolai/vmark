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
 *   - Revision is currently a global counter (revisionStore). All tabs
 *     share it. STALE detection still works correctly because any doc
 *     change bumps the global counter; it is conservative, not lossy.
 *     Per-doc revisions are a deliberate future enhancement.
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
import { useRevisionStore } from "@/stores/revisionStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { respond } from "../utils";
import type {
  DocumentKind,
  SessionState,
  SessionTab,
  SessionWindow,
} from "./types";

const MCP_PROTOCOL_VERSION = "0.1.0";

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
  const revision = useRevisionStore.getState().getRevision();
  const focusedLabel = getCurrentWindowLabel();

  const windowLabels = Object.keys(tabState.tabs);
  const windows: SessionWindow[] = windowLabels.map((label) => {
    const tabs = tabState.tabs[label] ?? [];
    const sessionTabs: SessionTab[] = tabs.map((tab) => {
      const doc = docState.documents[tab.id];
      const content = doc?.content ?? "";
      return {
        id: tab.id,
        filePath: tab.filePath,
        title: tab.title,
        dirty: doc?.isDirty ?? false,
        revision,
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
  try {
    const state = buildSessionState(appVersion);
    await respond({ id, success: true, data: state });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
