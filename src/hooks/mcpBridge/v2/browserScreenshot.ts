/**
 * MCP v2 `vmark.browser.screenshot` handler (WI-P1.2).
 *
 * Purpose: give the AI a visual channel onto the embedded browser. `read`
 * returns only an ARIA tree; `screenshot` returns a base64 JPEG of the tab's
 * current rendering so the model can see layout and rendered state the DOM does
 * not name.
 *
 * Read-class: it shares the whole gate/attachment/consume envelope with `read`
 * via `runReadClass` (browserReadClass.ts) — allowed on an AI-owned tab; a human
 * tab requires an explicit attachment, consumed on capture. The native command
 * (`browser_screenshot`) is the authoritative gate; this layer keeps the human in
 * the loop and returns `{url, image}`.
 *
 * @coordinates-with src-tauri browser/authorize.rs — the shared driver gate
 * @coordinates-with hooks/mcpBridge/v2/browserReadClass.ts — the shared read-class flow
 * @module hooks/mcpBridge/v2/browserScreenshot
 */

import { invoke } from "@tauri-apps/api/core";
import { wrapHandler } from "./wrapHandler";
import { urlForAgent } from "@/lib/browser/url";
import { runReadClass } from "./browserReadClass";

/** `vmark.browser.screenshot` — base64 JPEG of the current page. Args `{tabId?}`. */
export async function handleBrowserScreenshot(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, () =>
    runReadClass<string>(id, args, {
      invoke: (tab) =>
        invoke<string>("browser_screenshot", {
          tabId: tab.tabId,
          generation: tab.generation,
        }),
      data: (tab, image) => ({ url: urlForAgent(tab.url), image }),
    }),
  );
}
