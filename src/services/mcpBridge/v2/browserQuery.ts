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
import { scriptTooLarge } from "./browserHelpers";
import { buildQueryScript, type QueryFields } from "@/lib/browser/agent/powerScript";
import { urlForAgent } from "@/lib/browser/url";
import { runReadClass, parseEvalResult } from "./browserReadClass";
import { readOperationArgs } from "./readOperationArgs";

const FIELDS_SHAPE = "query `fields` must be {attributes?: true, box?: true, styles?: string[]}";

/** Parse `fields` strictly: an unknown key, a non-`true` flag or a non-string
 *  style name is a refusal, not a field quietly dropped from a "successful" query. */
function readFields(f: unknown): { ok: true; fields: QueryFields | undefined } | { ok: false; error: string } {
  if (f === undefined) return { ok: true, fields: undefined };
  if (typeof f !== "object" || f === null || Array.isArray(f)) return { ok: false, error: FIELDS_SHAPE };
  const o = f as Record<string, unknown>;
  const out: QueryFields = {};
  for (const [key, value] of Object.entries(o)) {
    if (key === "attributes" || key === "box") {
      if (value !== true) return { ok: false, error: `${FIELDS_SHAPE} — '${key}' must be true when present` };
      out[key] = true;
    } else if (key === "styles") {
      if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
        return { ok: false, error: `${FIELDS_SHAPE} — 'styles' must be an array of CSS property names` };
      }
      out.styles = value as string[];
    } else {
      return { ok: false, error: `${FIELDS_SHAPE} — unknown field '${key}'` };
    }
  }
  return { ok: true, fields: out };
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
    const parsedFields = readFields(wire.fields);
    if (!parsedFields.ok) {
      await respond({ id, success: false, error: parsedFields.error });
      return;
    }
    const fields = parsedFields.fields;
    // Sized before the attachment gate: the selector and style names are embedded
    // in the script, and an oversized query must fail here, not after a human-tab
    // attachment was spent on it.
    const tooLarge = scriptTooLarge(buildQueryScript(selector, 0, fields), "query script");
    if (tooLarge) {
      await respond({ id, success: false, error: tooLarge });
      return;
    }
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

