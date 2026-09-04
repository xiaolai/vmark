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
 * @coordinates-with services/mcpBridge/v2/browserApprovalFlow.ts — the shared approval machine
 * @module services/mcpBridge/v2/browserSession
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import type { BrowserTarget } from "./browserHelpers";
import { invokeAttached, resolveBrowserTarget } from "./browserAccess";
import { authorizeOperation } from "./browserApprovalFlow";
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

/** The `session` op is never grantable, so the shared approval machine always
 *  prompts per call, bound to the exact `action:handle` payload (the
 *  anti-substitution rule). Returns true once authorized. */
async function approveSession(id: string, tab: BrowserTarget, action: string, handle: string): Promise<boolean> {
  const outcome = await authorizeOperation(id, tab, {
    operation: "session",
    script: `${action}:${handle}`,
    describe: `'${action}' session '${handle}'`,
    promptData: { action, handle },
  });
  return outcome === "authorized";
}

/** `vmark.browser.session.save` — snapshot the tab's session into the keychain. */
export async function handleBrowserSessionSave(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    // The attachment prompt is raised AFTER the handle has been validated: a
    // malformed request must fail on its own, not after the user attached for it.
    const tab = await resolveBrowserTarget(id, args);
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
    const tab = await resolveBrowserTarget(id, args);
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
