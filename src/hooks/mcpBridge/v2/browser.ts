/**
 * MCP v2 `vmark.browser.*` handler entry points (WI-2.5 / R5).
 *
 * `read` returns an ARIA snapshot (with stable refs) of the current page. The act
 * path (`act` — click / type / scroll / key) lives in `browserAct.ts`;
 * navigation, screenshot, and wait_for in their own modules. This file is the
 * `read` handler plus the barrel of re-exports the dispatcher imports.
 *
 * **The check here is advisory, not the security boundary.** The authoritative
 * gate is the Rust driver (`browser/authorize.rs`): it re-checks the operation
 * against the tab's COMMITTED origin and rejects a command stamped with a stale
 * navigation generation.
 *
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative R4/R5 gate
 * @coordinates-with hooks/mcpBridge/v2/browserReadClass.ts — the shared read-class flow
 * @module hooks/mcpBridge/v2/browser
 */

import { invoke } from "@tauri-apps/api/core";
import { wrapHandler } from "./wrapHandler";
import { buildSnapshotScript } from "@/lib/browser/agent/actScript";
import { urlForAgent } from "@/lib/browser/url";
import { runReadClass, parseEvalResult } from "./browserReadClass";
export {
  handleBrowserNavigate,
  handleBrowserOpen,
  handleBrowserWait,
} from "./browserNavigation";
export { handleBrowserScreenshot } from "./browserScreenshot";
export { handleBrowserWaitFor } from "./browserWaitFor";
export { handleBrowserAct } from "./browserAct";
export { handleBrowserQuery, handleBrowserStyle, handleBrowserExecuteJs } from "./browserPower";

/**
 * `vmark.browser.read` — ARIA snapshot (with a stable `ref` per node) of the
 * current page. Args `{tabId?}`. A read-class op: the shared executor
 * (`runReadClass`) handles the feature gate, tab resolution, human-attachment
 * gate, and mirrored attachment consumption.
 */
export async function handleBrowserRead(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, () =>
    runReadClass<string>(id, args, {
      invoke: (tab) =>
        invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildSnapshotScript(tab.generation),
          operation: "read",
          generation: tab.generation,
        }),
      // Redacted at the trust boundary: credentials in a URL are the one thing about
      // a page the AI could not read out of the DOM anyway (audit, High).
      data: (tab, raw) => ({ url: urlForAgent(tab.url), snapshot: parseEvalResult(raw) }),
    }),
  );
}
