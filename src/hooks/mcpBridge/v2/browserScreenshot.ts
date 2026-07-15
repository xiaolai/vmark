/**
 * MCP v2 `vmark.browser.screenshot` handler (WI-P1.2).
 *
 * Purpose: give the AI a visual channel onto the embedded browser. `read`
 * returns only an ARIA tree; `screenshot` returns a base64 JPEG of the tab's
 * current rendering so the model can see layout and rendered state the DOM does
 * not name.
 *
 * Read-class, so it authorizes exactly like `read`: an AI-owned tab may capture
 * its own committed page; a **human** tab requires an explicit attachment
 * (consumed on capture), mirroring `handleBrowserRead`. The native command
 * (`browser_screenshot`) is the authoritative gate — this layer keeps the human
 * in the loop and stamps the committed generation. The image bytes never carry a
 * URL, but the returned metadata URL still passes through `urlForAgent`.
 *
 * @coordinates-with src-tauri browser/commands_auth.rs — browser_screenshot (the gate)
 * @coordinates-with hooks/mcpBridge/v2/browser.ts — requireHumanAttachment (shared)
 * @module hooks/mcpBridge/v2/browserScreenshot
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { urlForAgent } from "@/lib/browser/url";
import { browserEnabled, readTabIdArg, resolveBrowserTab } from "./browserHelpers";
import { requireHumanAttachment } from "./browser";

/** `vmark.browser.screenshot` — base64 JPEG of the current page. Args `{tabId?}`. */
export async function handleBrowserScreenshot(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) {
      await respond({ id, success: false, error: "BROWSER_DISABLED" });
      return;
    }
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) {
      await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
      return;
    }
    const tab = resolveBrowserTab(tabIdArg);
    if (!tab) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    if (!requireHumanAttachment(id, tab)) return;
    const approvals = useBrowserApprovalStore.getState();
    const humanCapture =
      tab.automationMode === "human" &&
      approvals.isHumanTabAttached(tab.tabId, tab.generation);
    const image = await invoke<string>("browser_screenshot", {
      tabId: tab.tabId,
      generation: tab.generation,
    });
    // Rust consumes the one-shot attachment while authorizing the capture; mirror
    // that here so the next action cannot pass the frontend check and then fail in
    // the driver (same pattern as handleBrowserRead).
    if (humanCapture) approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
    await respond({
      id,
      success: true,
      data: { url: urlForAgent(tab.url), image },
    });
  });
}
