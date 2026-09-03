/**
 * MCP v2 `vmark.browser.query` handler (WI-P5.1) — structured DOM detection by CSS
 * selector, read-class. Runs in the driver's ISOLATED content world. Split from
 * `browserPower.ts` (the write-class `style`/`execute_js`) for the file-size gate.
 *
 * @coordinates-with lib/browser/agent/powerScript.ts — the query script
 * @coordinates-with services/mcpBridge/v2/browserReadClass.ts — the read-class envelope
 * @module services/mcpBridge/v2/browserQuery
 */
import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { buildQueryScript, type QueryFields } from "@/lib/browser/agent/powerScript";
import { urlForAgent } from "@/lib/browser/url";
import { runReadClass, parseEvalResult } from "./browserReadClass";
import { readOperationArgs } from "./readOperationArgs";

function readFields(f: unknown): QueryFields | undefined {
  if (typeof f !== "object" || f === null) return undefined;
  const o = f as Record<string, unknown>;
  const out: QueryFields = {};
  if (o.attributes === true) out.attributes = true;
  if (o.box === true) out.box = true;
  if (Array.isArray(o.styles)) out.styles = o.styles.filter((s): s is string => typeof s === "string");
  return out;
}

/** `vmark.browser.query` — structured DOM detection by CSS selector (read-class). */
export async function handleBrowserQuery(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.browser.query", args);
    const selector = typeof wire.selector === "string" && wire.selector.trim() ? wire.selector : "";
    if (!selector) {
      await respond({ id, success: false, error: "query requires a non-empty CSS 'selector'" });
      return;
    }
    const fields = readFields(wire.fields);
    await runReadClass<string>(id, args, {
      invoke: (tab) =>
        invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildQueryScript(selector, tab.generation, fields),
          operation: "read",
          generation: tab.generation,
        }),
      data: (tab, raw) => {
        const r = parseEvalResult(raw);
        // A script-level failure (invalid selector, …) must be a FAILED
        // response, not a success envelope with an `error` field inside.
        if (typeof r === "object" && r !== null && "error" in r) {
          throw new Error(String((r as { error: unknown }).error));
        }
        return { url: urlForAgent(tab.url), ...(typeof r === "object" && r !== null ? r : { result: r }) };
      },
    });
  });
}

