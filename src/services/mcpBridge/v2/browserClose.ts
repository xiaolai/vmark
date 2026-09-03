/**
 * MCP v2 `vmark.browser.close` handler (audit 2026-09-03 X-01).
 *
 * The AI can open tabs but had no verb to close one, and the driver now caps
 * live AI-owned tabs (`MAX_AI_TABS` in `browser_ai_create`): without this an
 * agent that opened eight tabs was stuck. Closing an AI-owned tab is NEVER
 * approval-gated — stopping something is always allowed (the WI-19 lesson) — and
 * a human tab is refused: the AI does not close what the user opened.
 *
 * Closing goes through the tab store so every subscriber of the removal bus
 * (native-view teardown, lease, recorder, pane layout) does its part exactly as
 * for a user-closed tab.
 *
 * @coordinates-with stores/tabStore.ts — closeTab → notifyTabRemoved
 * @coordinates-with services/browser/browserTabLifecycle.ts — destroys the native view
 * @module services/mcpBridge/v2/browserClose
 */
import { respond } from "@/services/mcpBridge/utils";
import { useTabStore } from "@/stores/tabStore";
import { wrapHandler } from "./wrapHandler";
import { readTabIdArg, resolveBrowserTab } from "./browserHelpers";
import { browserGate } from "./browserAccess";

export async function handleBrowserClose(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null || tabIdArg === undefined) {
      await respond({ id, success: false, error: "close requires a non-empty tabId" });
      return;
    }
    const tab = resolveBrowserTab(tabIdArg);
    if (!tab) {
      await respond({ id, success: false, error: "TAB_NOT_FOUND" });
      return;
    }
    if (tab.automationMode === "human") {
      await respond({ id, success: false, error: "TAB_NOT_AI_OWNED" });
      return;
    }
    const closed = useTabStore.getState().closeTab(tab.windowLabel, tab.tabId);
    if (!closed) {
      // `closeTab` refuses a pinned tab (and an unknown one). Reporting success
      // here left the tab open AND its MAX_AI_TABS slot taken while the model
      // believed it had freed it.
      await respond({
        id,
        success: false,
        error: "TAB_PINNED: the tab is pinned and cannot be closed by the AI — unpin it or close it yourself",
        data: { token: "TAB_PINNED", tabId: tab.tabId },
      });
      return;
    }
    await respond({ id, success: true, data: { tabId: tab.tabId, closed } });
  });
}
