/**
 * sessionSerializers — how one tab and one window become `session.get_state`
 * records (round 3, #76). Split from `session.ts`, whose `buildSessionState`
 * nested window projection, protocol gating, the human-tab privacy rule and both
 * tab serializers in one function; each is now a function with one job.
 *
 * Key decisions (carried from session.ts):
 *   - Human browser tabs are listed by id and origin only until the AI holds an
 *     attachment for them (audit 2026-09-03 X-02): attachment is the gate for AI
 *     access to a human tab, and title and path are page content. An AI-owned tab
 *     carries its title and redacted url and omits `attached`.
 *   - `kind` is computed by sniffing filePath + content via the workflow detection
 *     helpers — the AI shouldn't reimplement it.
 *   - A document tab carries `active` and `visible`, and a window the workspace
 *     instance it is showing (#1208), because a window holds tabs from several
 *     instances and renders only one instance's.
 *   - Browser tabs are withheld from a client whose declared protocol predates
 *     them (0.3.0), including a client that declares none — a document-only
 *     client never receives records its tool contract can't classify. Strict
 *     `major.minor(.patch)`, digits only: a malformed value must not slip through
 *     loose `Number()` coercion (e.g. "0.3e0.0").
 *
 * @coordinates-with services/mcpBridge/v2/session.ts — composes these into the payload
 * @coordinates-with stores/tabStore.ts — open tabs per window
 * @coordinates-with stores/browserApprovalStore.ts — human-tab attachments gate what is listed
 * @coordinates-with stores/documentStore.ts — filePath, dirty, content, revision
 * @coordinates-with services/tabs/visibleWindowTabs.ts — the on-screen projection
 * @coordinates-with lib/ghaWorkflow/detection.ts — kind discrimination
 * @module services/mcpBridge/v2/sessionSerializers
 */

import { useTabStore } from "@/stores/tabStore";
import type { BrowserTab, DocumentTab } from "@/stores/tabStoreTypes";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { visibleWindowTabs } from "@/services/tabs/visibleWindowTabs";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { isWorkflowYaml, looksLikeWorkflowPath } from "@/lib/ghaWorkflow/detection";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { originForAgent, urlForAgent } from "@/lib/browser/url";
import type { BrowserSessionTab, DocumentKind, DocumentSessionTab, SessionTab, SessionWindow } from "./types";

/** Minimum client protocol that understands `kind: "browser"` tabs. */
const BROWSER_TABS_MIN_PROTOCOL = { major: 0, minor: 3 };
const PROTOCOL_RE = /^(\d+)\.(\d+)(?:\.\d+)?$/;

/**
 * Whether the requesting client's declared protocol understands browser tabs.
 * Absent or malformed → treated as pre-0.3, so browser tabs are withheld.
 */
export function clientSupportsBrowserTabs(clientProtocol: string | undefined): boolean {
  if (!clientProtocol) return false;
  const match = PROTOCOL_RE.exec(clientProtocol);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    major > BROWSER_TABS_MIN_PROTOCOL.major ||
    (major === BROWSER_TABS_MIN_PROTOCOL.major && minor >= BROWSER_TABS_MIN_PROTOCOL.minor)
  );
}

/** The document kind, from the path first and the content second. */
export function detectKind(filePath: string | null, content: string): DocumentKind {
  if (looksLikeWorkflowPath(filePath ?? undefined)) return "yaml-workflow";
  if (isWorkflowYaml(content)) return "yaml-workflow";
  return "markdown";
}

/** A browser tab as the AI may see it: page content only for an AI tab or an attached human tab. */
export function serializeBrowserTab(tab: BrowserTab, active: boolean): BrowserSessionTab {
  const automationMode = tab.automationMode ?? "human";
  const generation = tab.generation ?? 0;
  const base = {
    id: tab.id,
    kind: "browser" as const,
    active,
    loading: browserEventBroker.isLoading(tab.id) ?? false,
    generation,
    automationMode,
  };
  if (automationMode !== "human") {
    return { ...base, title: tab.title, url: urlForAgent(tab.url) };
  }
  // A human tab is the user's browsing. Attachment is the gate for AI access to
  // it (browser.md), so without one the listing carries only what the AI needs
  // to ASK: the id and the origin. (Audit 2026-09-03 X-02.)
  const attached = useBrowserApprovalStore.getState().isHumanTabAttached(tab.id, generation);
  return attached
    ? { ...base, attached, title: tab.title, url: urlForAgent(tab.url) }
    : { ...base, attached, url: originForAgent(tab.url) };
}

/** A document tab with its kind, dirty state, per-tab revision and on-screen flags. */
export function serializeDocumentTab(tab: DocumentTab, active: boolean, visible: boolean): DocumentSessionTab {
  const doc = useDocumentStore.getState().documents[tab.id];
  const documentKind = detectKind(tab.filePath, doc?.content ?? "");
  return {
    id: tab.id,
    kind: documentKind,
    filePath: tab.filePath,
    title: tab.title,
    dirty: doc?.isDirty ?? false,
    revision: useRevisionStore.getState().getRevision(tab.id),
    documentKind,
    active,
    visible,
  };
}

/**
 * One window's record: which tabs it holds (browser tabs only for a client that
 * understands them), which is active, which are on screen, whether the OS focus is
 * on it, and the workspace instance it shows.
 */
export function serializeWindow(label: string, focusedLabel: string | null, includeBrowserTabs: boolean): SessionWindow {
  const tabState = useTabStore.getState();
  const visibleIds = new Set(visibleWindowTabs(label).map((t) => t.id));
  const activeTabId = tabState.activeTabId[label] ?? null;
  const tabs: SessionTab[] = (tabState.tabs[label] ?? [])
    .filter((tab) => includeBrowserTabs || tab.kind !== "browser")
    .map((tab) =>
      tab.kind === "browser"
        ? serializeBrowserTab(tab, tab.id === activeTabId)
        : serializeDocumentTab(tab, tab.id === activeTabId, visibleIds.has(tab.id)),
    );
  return {
    label,
    focused: label === focusedLabel,
    activeWorkspaceInstanceId:
      useWorkspaceInstancesStore.getState().windows[label]?.activeWorkspaceInstanceId ?? null,
    tabs,
  };
}
