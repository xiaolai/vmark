/**
 * MCP v2 console tool (WI-P7.1): `console` — read the tab's captured `console.*`
 * output for debugging a page the AI is driving.
 *
 * READ-CLASS: it reads the shared DOM ring buffer (populated by the page-world
 * shim, `consoleShim.ts`) through the isolated-world eval — no new permission, and
 * a human tab still needs an attachment. The captured output is page-controlled and
 * **untrusted**; the AI must treat it like any other `read` result, never as an act
 * target. Returns `{entries:[{level,text}], url}`; pass `clear:true` to drain the
 * buffer as you read it.
 *
 * @coordinates-with lib/browser/agent/consoleShim.ts — the buffer + reader script
 * @module hooks/mcpBridge/v2/browserConsole
 */

import { invoke } from "@tauri-apps/api/core";
import { wrapHandler } from "./wrapHandler";
import { buildConsoleReadScript } from "@/lib/browser/agent/consoleShim";
import { urlForAgent } from "@/lib/browser/url";
import { runReadClass, parseEvalResult } from "./browserReadClass";

/** `vmark.browser.console` — return the captured console ring buffer (read-class). */
export async function handleBrowserConsole(id: string, args: Record<string, unknown>): Promise<void> {
  const clear = args.clear === true;
  return wrapHandler(id, () =>
    runReadClass<string>(id, args, {
      invoke: (tab) =>
        invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildConsoleReadScript(clear),
          operation: "read",
          generation: tab.generation,
        }),
      data: (tab, raw) => {
        const r = parseEvalResult(raw);
        return { url: urlForAgent(tab.url), ...(typeof r === "object" && r !== null ? r : { entries: [] }) };
      },
    }),
  );
}
