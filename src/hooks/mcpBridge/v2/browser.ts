/**
 * MCP v2 `vmark.browser.*` handlers (WI-2.5 / R5).
 *
 * Purpose: expose the live embedded browser to AI clients through the MCP
 * bridge. `read` returns an ARIA snapshot of the current page (via the driver's
 * isolated-world eval, WI-2.1); `act` performs a click/type by ARIA role +
 * accessible name — but only after the operation-based approval gate
 * (browserApprovalStore / grants.ts, R5) allows it. Upload is hard-denied; an
 * un-granted operation is not performed — instead a pending approval is queued
 * and the AI is told approval is required, so the human stays in the loop for
 * anything not pre-authorized.
 *
 * @coordinates-with src-tauri browser_eval — evaluates the generated scripts
 * @coordinates-with stores/browserApprovalStore.ts — the R5 gate
 * @coordinates-with lib/browser/agent/actScript.ts — snapshot/click/type scripts
 * @module hooks/mcpBridge/v2/browser
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import {
  buildClickScript,
  buildSnapshotScript,
  buildTypeScript,
} from "@/lib/browser/agent/actScript";

/**
 * Resolve the target browser tab (by id, else the focused window's active tab).
 *
 * `generation` is the navigation generation of the tab's committed page. It
 * stamps every driver command so the Rust gate can reject one authorized against
 * a page that has since navigated. It defaults to 0 — a value the driver refuses
 * — when nothing has committed yet: fail-closed, never invent a plausible stamp.
 */
function resolveBrowserTab(
  tabIdArg?: string,
): { tabId: string; url: string; generation: number } | null {
  const store = useTabStore.getState();
  const tab = tabIdArg ? store.findTabById(tabIdArg) : store.getActiveTab(getCurrentWindowLabel());
  return tab && isBrowserTab(tab)
    ? { tabId: tab.id, url: tab.url, generation: tab.generation ?? 0 }
    : null;
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** `vmark.browser.read` — ARIA snapshot of the current page. Args `{tabId?}`. */
export async function handleBrowserRead(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = resolveBrowserTab(typeof args.tabId === "string" ? args.tabId : undefined);
    if (!tab) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    const raw = await invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script: buildSnapshotScript(),
      operation: "read",
      generation: tab.generation,
    });
    await respond({ id, success: true, data: { url: tab.url, snapshot: parse(raw) } });
  });
}

/**
 * `vmark.browser.act` — click/type by ARIA role + name, approval-gated (R5).
 * Args `{tabId?, operation: "click"|"type", role, name, text?}`.
 */
export async function handleBrowserAct(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = resolveBrowserTab(typeof args.tabId === "string" ? args.tabId : undefined);
    if (!tab) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    const operation = typeof args.operation === "string" ? args.operation : "";
    const role = typeof args.role === "string" ? args.role : "";
    const name = typeof args.name === "string" ? args.name : "";

    const decision = useBrowserApprovalStore.getState().decide(tab.url, operation);
    if (decision === "denied") {
      await respond({ id, success: false, error: `operation '${operation}' is not permitted` });
      return;
    }
    if (decision === "needs-approval") {
      useBrowserApprovalStore.getState().requestApproval(id, tab.url, operation);
      await respond({
        id,
        success: false,
        data: { needsApproval: true, operation, url: tab.url },
      });
      return;
    }

    const script =
      operation === "type"
        ? buildTypeScript(role, name, typeof args.text === "string" ? args.text : "")
        : buildClickScript(role, name);
    const raw = await invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation,
      generation: tab.generation,
    });
    await respond({ id, success: true, data: { result: parse(raw) } });
  });
}
