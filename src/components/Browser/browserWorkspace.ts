import type { BrowserTab, DocumentTab, Tab } from "@/stores/tabStoreTypes";

export interface BrowserWorkspaceView {
  documentTabs: DocumentTab[];
  browserPages: BrowserTab[];
  /** The first browser page anchors the single browser workspace tab. */
  browserWorkspaceTabId: string | null;
  /** The active page only when the browser workspace is currently selected. */
  activeBrowserPageId: string | null;
  browserWorkspaceActive: boolean;
}

/**
 * Project the flat window tab list into the two navigation levels shown by VMark:
 * document/workspace tabs at the bottom and webpage tabs inside the browser
 * workspace. Browser page ids remain the real tab ids so native WebKit and MCP
 * operations keep their existing identity and security bindings.
 */
export function getBrowserWorkspaceView(
  tabs: readonly Tab[],
  activeTabId: string | null,
): BrowserWorkspaceView {
  const documentTabs: DocumentTab[] = [];
  const browserPages: BrowserTab[] = [];

  for (const tab of tabs) {
    if (tab.kind === "browser") browserPages.push(tab);
    else documentTabs.push(tab);
  }

  const activeBrowserPage = browserPages.find((tab) => tab.id === activeTabId);

  return {
    documentTabs,
    browserPages,
    browserWorkspaceTabId: browserPages[0]?.id ?? null,
    activeBrowserPageId: activeBrowserPage?.id ?? null,
    browserWorkspaceActive: activeBrowserPage !== undefined,
  };
}
