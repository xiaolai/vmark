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
 * @module services/mcpBridge/v2/browserSession
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { originForAgent } from "@/lib/browser/url";
import { grantPatternFor } from "@/stores/browserApprovalStore.helpers";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";
import { readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { browserGate, invokeAttached } from "./browserAccess";
import { requireHumanAttachment } from "./browserReadClass";
import { readOperationArgs } from "./readOperationArgs";

/** A handle is a short label (keychain account + AI-facing token); keep it to the
 *  same safe charset the Rust layer enforces so a rejection is caught up front. */
function readHandle(operation: "vmark.browser.session.save" | "vmark.browser.session.load", args: Record<string, unknown>): string | null {
  const wire = readOperationArgs(operation, args);
  const h = typeof wire.handle === "string" ? wire.handle.trim() : "";
  if (!h || h.length > 128) return null;
  return /^[A-Za-z0-9._-]+$/.test(h) ? h : null;
}

async function resolveForSession(id: string, args: Record<string, unknown>): Promise<BrowserTarget | null> {
  if (!(await browserGate(id))) return null;
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
  // The attachment prompt is raised by the caller AFTER the handle has been
  // validated: a malformed request must fail on its own, not after the user has
  // attached the tab for it.
  return tab;
}

/** The `session` op is never grantable, so this always needs a per-call approval,
 *  bound to the exact `action:handle`. Returns true once authorized. */
async function approveSession(id: string, tab: BrowserTarget, action: string, handle: string): Promise<boolean> {
  const payload = `${action}:${handle}`;
  const store = useBrowserApprovalStore.getState();
  const ok = store.consumeOneShot(tab.url, "session", undefined, tab.tabId, payload, tab.generation);
  if (!ok) {
    const queued = store.requestApproval(id, tab.url, "session", undefined, tab.tabId, tab.generation, payload);
    // No prompt exists to approve: a needsApproval envelope would be a lie.
    if (queued === "overloaded" || queued === "rejected") {
      await respond({
        id,
        success: false,
        error: "approval queue is full — resolve or deny pending approvals, then retry",
      });
      return false;
    }
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
  // One mint path (audit A-04): await the driver's confirmation of the mirror's
  // spent copy before invoking, else the command is refused as unauthorized.
  const pattern = grantPatternFor(tab.url);
  const minted =
    pattern !== null &&
    (await mintOneShotConfirmed({
      originPattern: pattern,
      operation: "session",
      tabId: tab.tabId,
      generation: tab.generation,
      script: payload,
    }));
  if (!minted) {
    await respond({
      id,
      success: false,
      error: `the driver refused the 'session' authorization — the page may have navigated; retry to be prompted again`,
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
    const handle = readHandle("vmark.browser.session.save", args);
    if (!handle) {
      await respond({ id, success: false, error: "session.save requires a 'handle' matching [A-Za-z0-9._-] (1..128)" });
      return;
    }
    if (!(await requireHumanAttachment(id, tab))) return;
    if (!(await approveSession(id, tab, "save", handle))) return;
    // Returns a value-free summary (counts) — never a cookie/localStorage value.
    // The attachment mirror follows the driver's consume (`invokeAttached`).
    const summary = await invokeAttached(tab, () =>
      invoke<string>("browser_save_storage_state", {
        tabId: tab.tabId,
        generation: tab.generation,
        handle,
      }),
    );
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
    const handle = readHandle("vmark.browser.session.load", args);
    if (!handle) {
      await respond({ id, success: false, error: "session.load requires a 'handle' matching [A-Za-z0-9._-] (1..128)" });
      return;
    }
    if (!(await requireHumanAttachment(id, tab))) return;
    if (!(await approveSession(id, tab, "load", handle))) return;
    // The AI gets no values back — just confirmation the session was restored.
    await invokeAttached(tab, () =>
      invoke("browser_load_storage_state", { tabId: tab.tabId, generation: tab.generation, handle }),
    );
    await respond({ id, success: true, data: { loaded: true, handle } });
  });
}
