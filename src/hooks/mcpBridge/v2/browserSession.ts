/**
 * MCP v2 session/storage tools (WI-P6.2 / P6.3): `session.save` and
 * `session.load`.
 *
 * A saved session is a credential-bearing blob (cookies + localStorage) that the
 * AI reuses by an opaque HANDLE — it never sees the values. Both save and load are
 * the `session` op: NEVER grantable, so every call raises a fresh user approval,
 * and the one-shot is bound to the exact `action:handle` (so an approved
 * `load:work_login` can't be spent on a different handle — the anti-substitution
 * rule from the Phase 5 security review). `save` returns a value-free summary;
 * `load` returns `{loaded:true, handle}` — a confirmation plus the AI-supplied
 * handle, never any values. A `load` only applies to a page with the SAME origin
 * the session was saved from (Rust enforces it). The values live in the OS keychain
 * (Rust session_state.rs) and never cross this boundary.
 *
 * @coordinates-with src-tauri browser/session_commands.rs — the authoritative gate + persistence
 * @module hooks/mcpBridge/v2/browserSession
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { originForAgent } from "@/lib/browser/url";
import { browserEnabled, readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { requireHumanAttachment } from "./browserReadClass";

/** A handle is a short label (keychain account + AI-facing token); keep it to the
 *  same safe charset the Rust layer enforces so a rejection is caught up front. */
function readHandle(args: Record<string, unknown>): string | null {
  const h = typeof args.handle === "string" ? args.handle.trim() : "";
  if (!h || h.length > 128) return null;
  return /^[A-Za-z0-9._-]+$/.test(h) ? h : null;
}

async function resolveForSession(id: string, args: Record<string, unknown>): Promise<BrowserTarget | null> {
  if (!browserEnabled()) {
    await respond({ id, success: false, error: "BROWSER_DISABLED" });
    return null;
  }
  const tabIdArg = readTabIdArg(args);
  if (tabIdArg === null) {
    await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
    return null;
  }
  const tab = resolveBrowserTab(tabIdArg);
  if (!tab) {
    await respond({ id, success: false, error: "no active browser tab" });
    return null;
  }
  if (!(await requireHumanAttachment(id, tab))) return null;
  return tab;
}

/** The `session` op is never grantable, so this always needs a per-call approval,
 *  bound to the exact `action:handle`. Returns true once authorized. */
async function approveSession(id: string, tab: BrowserTarget, action: string, handle: string): Promise<boolean> {
  const payload = `${action}:${handle}`;
  const store = useBrowserApprovalStore.getState();
  const ok = store.consumeOneShot(tab.url, "session", undefined, tab.tabId, payload);
  if (!ok) {
    store.requestApproval(id, tab.url, "session", undefined, tab.tabId, tab.generation, payload);
    // Origin-only in the pre-authorization envelope — the path can carry a token.
    const origin = originForAgent(tab.url);
    await respond({
      id,
      success: false,
      error: `approval required: '${action}' session '${handle}' on ${origin}`,
      data: { needsApproval: true, operation: "session", action, handle, url: origin, tabId: tab.tabId, generation: tab.generation },
    });
    return false;
  }
  return true;
}

/** `vmark.browser.session.save` — snapshot the tab's session into the keychain. */
export async function handleBrowserSessionSave(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveForSession(id, args);
    if (!tab) return;
    const handle = readHandle(args);
    if (!handle) {
      await respond({ id, success: false, error: "session.save requires a 'handle' matching [A-Za-z0-9._-] (1..128)" });
      return;
    }
    if (!(await approveSession(id, tab, "save", handle))) return;
    // Returns a value-free summary (counts) — never a cookie/localStorage value.
    const summary = await invoke<string>("browser_save_storage_state", {
      tabId: tab.tabId,
      generation: tab.generation,
      handle,
    });
    // Record in the metadata-only registry so the management UI can list it.
    useBrowserSessionStore.getState().recordSession(handle, summary, Date.now());
    await respond({ id, success: true, data: { handle, summary } });
  });
}

/** `vmark.browser.session.load` — restore a saved session into the tab by handle. */
export async function handleBrowserSessionLoad(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveForSession(id, args);
    if (!tab) return;
    const handle = readHandle(args);
    if (!handle) {
      await respond({ id, success: false, error: "session.load requires a 'handle' matching [A-Za-z0-9._-] (1..128)" });
      return;
    }
    if (!(await approveSession(id, tab, "load", handle))) return;
    // The AI gets no values back — just confirmation the session was restored.
    await invoke("browser_load_storage_state", { tabId: tab.tabId, generation: tab.generation, handle });
    await respond({ id, success: true, data: { loaded: true, handle } });
  });
}
