/**
 * MCP v2 `vmark.browser.act` handler (WI-2.5 / WI-P2.2 / WI-P4.2).
 *
 * Extracted from browser.ts (audit #9) so the act path — the most complex MCP
 * handler — lives in its own file. `act` performs `click` / `type` / `scroll` /
 * `key`, targeting either a precise `{ref}` (from a prior read; honored only on
 * the already-granted path) or ARIA `{role, name}` (through the approval flow).
 *
 * **The check here is advisory.** The authoritative gate is the Rust driver
 * (browser/authorize.rs): it re-checks the operation against the tab's committed
 * origin and rejects a stale generation. `scroll`/`key` dispatch SYNTHETIC DOM
 * events (SPIKE-3), so a site gating on `event.isTrusted` ignores them.
 *
 * Audit 2026-09-03: a `type`, `key` or `scroll` approval binds the BUILT script
 * (so the text, key+modifiers or delta the user approved is what runs — A-05)
 * and the prompt shows a one-line summary of it; the one-shot mint is awaited
 * before acting (single mint path, A-04); a driver rejection propagates to
 * `wrapHandler` as its typed token instead of "did not affect the target"
 * (E-01/E-03); a popup the page tried to open during the act is reported (X-03);
 * the attachment mirror follows the driver's consume (A-01).
 *
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative gate
 * @coordinates-with lib/browser/agent/actScript.ts / interactScript.ts — the scripts
 * @coordinates-with services/mcpBridge/v2/browserActFlow.ts — approval + one-shot flow
 * @module services/mcpBridge/v2/browserAct
 */

import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import {
  buildClickScript,
  buildClickByRefScript,
  buildTypeScript,
  buildTypeByRefScript,
} from "@/lib/browser/agent/actScript";
import {
  buildScrollToRefScript,
  buildScrollByScript,
  buildKeyScript,
  type KeyModifiers,
} from "@/lib/browser/agent/interactScript";
import { readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { browserGate } from "./browserAccess";
import { requireHumanAttachment } from "./browserReadClass";
import { approveAndAct, finishAct, refuseUngrantedRef } from "./browserActFlow";
import { readOperationArgs } from "./readOperationArgs";

/** Clip a payload for the prompt's one-line summary. */
const SUMMARY_MAX = 120;
function clip(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

function readModifiers(m: unknown): KeyModifiers | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  const o = m as Record<string, unknown>;
  return { ctrl: o.ctrl === true, shift: o.shift === true, alt: o.alt === true, meta: o.meta === true };
}

function describeKey(key: string, modifiers: KeyModifiers | undefined): string {
  const parts: string[] = [];
  if (modifiers?.ctrl) parts.push("Ctrl");
  if (modifiers?.alt) parts.push("Alt");
  if (modifiers?.shift) parts.push("Shift");
  if (modifiers?.meta) parts.push("Meta");
  parts.push(key);
  return `Key: ${parts.join("+")}`;
}

type ActWire = ReturnType<typeof readOperationArgs<"vmark.browser.act">>;

async function handleScroll(id: string, tab: BrowserTarget, wire: ActWire): Promise<void> {
  const ref = typeof wire.ref === "string" && wire.ref.trim() ? wire.ref : "";
  const dy = typeof wire.dy === "number" && Number.isFinite(wire.dy) ? wire.dy : undefined;
  if (ref && dy !== undefined) {
    await respond({ id, success: false, error: "scroll takes either {ref} or {dy}, not both" });
    return;
  }
  if (!ref && dy === undefined) {
    await respond({ id, success: false, error: "scroll requires a {ref} (from read) or a numeric {dy} pixel delta" });
    return;
  }
  if (ref) {
    if (await refuseUngrantedRef(id, tab, "scroll")) return;
    await finishAct(id, tab, "scroll", buildScrollToRefScript(ref, tab.generation));
    return;
  }
  const script = buildScrollByScript(dy as number);
  await approveAndAct(id, tab, "scroll", undefined, script, `Scroll by ${dy} px`);
}

async function handleKey(id: string, tab: BrowserTarget, wire: ActWire): Promise<void> {
  const key = typeof wire.key === "string" && wire.key.length > 0 ? wire.key : "";
  if (!key) {
    await respond({ id, success: false, error: "key requires a non-empty 'key' name (e.g. 'Enter', 'Escape', 'Tab')" });
    return;
  }
  const ref = typeof wire.ref === "string" && wire.ref.trim() ? wire.ref : null;
  const modifiers = readModifiers(wire.modifiers);
  const script = buildKeyScript(key, ref, tab.generation, modifiers);
  if (ref) {
    if (await refuseUngrantedRef(id, tab, "key")) return;
    await finishAct(id, tab, "key", script);
    return;
  }
  await approveAndAct(id, tab, "key", undefined, script, describeKey(key, modifiers));
}

/** `vmark.browser.act` — click / type / scroll / key by `{ref}` or `{role, name}`. */
export async function handleBrowserAct(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
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
    if (!(await requireHumanAttachment(id, tab))) return;
    const wire = readOperationArgs("vmark.browser.act", args);
    const operation = typeof wire.operation === "string" ? wire.operation : "";
    if (operation !== "click" && operation !== "type" && operation !== "scroll" && operation !== "key") {
      await respond({ id, success: false, error: `act supports 'click', 'type', 'scroll', 'key', not '${operation}'` });
      return;
    }
    if (operation === "scroll") return handleScroll(id, tab, wire);
    if (operation === "key") return handleKey(id, tab, wire);

    // click / type — targeted by {ref} (granted-only) or {role, name} (approval-legible).
    const role = typeof wire.role === "string" ? wire.role : "";
    const name = typeof wire.name === "string" ? wire.name : "";
    const ref = typeof wire.ref === "string" ? wire.ref : "";
    if (operation === "type" && typeof wire.text !== "string") {
      await respond({
        id,
        success: false,
        error: "type requires a string 'text' (pass \"\" to intentionally clear the field)",
      });
      return;
    }
    const text = typeof wire.text === "string" ? wire.text : "";
    const wantsRef = ref.trim().length > 0;
    if (wantsRef && (role.trim() || name.trim())) {
      await respond({ id, success: false, error: "act takes either {ref} or {role, name}, not both" });
      return;
    }
    if (wantsRef) {
      if (await refuseUngrantedRef(id, tab, operation)) return;
      const script =
        operation === "type"
          ? buildTypeByRefScript(ref, text, tab.generation)
          : buildClickByRefScript(ref, tab.generation);
      await finishAct(id, tab, operation, script);
      return;
    }
    if (!role.trim() || !name.trim()) {
      await respond({ id, success: false, error: "act requires {ref} or a non-empty role and name" });
      return;
    }
    if (operation === "type") {
      // The built script embeds the text, so binding the script binds the text.
      const script = buildTypeScript(role, name, text, tab.generation);
      await approveAndAct(id, tab, "type", { role, name }, script, `Text: ${JSON.stringify(clip(text))}`);
      return;
    }
    await approveAndAct(id, tab, "click", { role, name }, buildClickScript(role, name, tab.generation));
  });
}
