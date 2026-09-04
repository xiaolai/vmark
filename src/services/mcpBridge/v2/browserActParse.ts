/**
 * browserActParse — `vmark.browser.act` arguments → ONE validated action (round 3, #38).
 *
 * Purpose: the act handler used to validate four operations, four targeting
 * modes and their exclusions inline, in the same function that gated, resolved,
 * built scripts and responded. This module turns the wire payload into a
 * discriminated `ActAction` or a refusal, and nothing else: no store, no driver,
 * no response — so every rule is a table row in its test. The handler dispatches
 * on `action.operation` to one small function per operation.
 *
 * Rules, each pinned by `__tests__/browserActParse.test.ts`:
 *  - the operation vocabulary is closed: click / type / scroll / key;
 *  - click and type target EITHER `{ref}` (granted-only, never one-shot bound) OR a
 *    non-empty `{role, name}` (approval-legible), never both, never neither;
 *  - `type` requires a string `text` — an omitted text is malformed input, not a
 *    field clear (pass `""` to clear on purpose);
 *  - scroll targets either `{ref}` or a finite `{dy}`, not both;
 *  - key needs a non-empty key name; `ref` is optional (else the active element)
 *    and modifiers are read as booleans.
 * Refs are kept as supplied (the scripts match them exactly); only their
 * emptiness is judged after trimming.
 *
 * @coordinates-with services/mcpBridge/v2/browserAct.ts — the only caller
 * @coordinates-with generated/bridgeContracts.ts — the declared act fields
 * @module services/mcpBridge/v2/browserActParse
 */

import type { KeyModifiers } from "@/lib/browser/agent/interactScript";
import { readOperationArgs } from "./readOperationArgs";

/** How a click or type finds its element. */
type ActTargeting = { by: "ref"; ref: string } | { by: "target"; role: string; name: string };

export type ActAction =
  | { operation: "click"; targeting: ActTargeting }
  | { operation: "type"; text: string; targeting: ActTargeting }
  | { operation: "scroll"; targeting: { by: "ref"; ref: string } | { by: "delta"; dy: number } }
  | { operation: "key"; key: string; ref: string | null; modifiers: KeyModifiers | undefined };

export type ActParse = { ok: true; action: ActAction } | { ok: false; error: string };

type ActWire = ReturnType<typeof readOperationArgs<"vmark.browser.act">>;

const ok = (action: ActAction): ActParse => ({ ok: true, action });
const refuse = (error: string): ActParse => ({ ok: false, error });

function readModifiers(m: unknown): KeyModifiers | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  const o = m as Record<string, unknown>;
  return { ctrl: o.ctrl === true, shift: o.shift === true, alt: o.alt === true, meta: o.meta === true };
}

/** A ref that is present and not blank, as supplied; else "". */
function presentRef(wire: ActWire): string {
  return typeof wire.ref === "string" && wire.ref.trim() ? wire.ref : "";
}

function parsePointed(wire: ActWire, operation: "click" | "type"): ActParse {
  const role = typeof wire.role === "string" ? wire.role : "";
  const name = typeof wire.name === "string" ? wire.name : "";
  const ref = typeof wire.ref === "string" ? wire.ref : "";
  if (operation === "type" && typeof wire.text !== "string") {
    return refuse("type requires a string 'text' (pass \"\" to intentionally clear the field)");
  }
  const text = typeof wire.text === "string" ? wire.text : "";
  const wantsRef = ref.trim().length > 0;
  if (wantsRef && (role.trim() || name.trim())) return refuse("act takes either {ref} or {role, name}, not both");
  let targeting: ActTargeting;
  if (wantsRef) targeting = { by: "ref", ref };
  else if (!role.trim() || !name.trim()) return refuse("act requires {ref} or a non-empty role and name");
  else targeting = { by: "target", role, name };
  return operation === "type" ? ok({ operation, text, targeting }) : ok({ operation, targeting });
}

function parseScroll(wire: ActWire): ActParse {
  const ref = presentRef(wire);
  const dy = typeof wire.dy === "number" && Number.isFinite(wire.dy) ? wire.dy : undefined;
  if (ref && dy !== undefined) return refuse("scroll takes either {ref} or {dy}, not both");
  if (ref) return ok({ operation: "scroll", targeting: { by: "ref", ref } });
  if (dy !== undefined) return ok({ operation: "scroll", targeting: { by: "delta", dy } });
  return refuse("scroll requires a {ref} (from read) or a numeric {dy} pixel delta");
}

function parseKey(wire: ActWire): ActParse {
  const key = typeof wire.key === "string" && wire.key.length > 0 ? wire.key : "";
  if (!key) return refuse("key requires a non-empty 'key' name (e.g. 'Enter', 'Escape', 'Tab')");
  const ref = presentRef(wire);
  return ok({ operation: "key", key, ref: ref || null, modifiers: readModifiers(wire.modifiers) });
}

/** Parse the act payload into one validated action, or the refusal to answer with. */
export function parseActAction(args: Record<string, unknown>): ActParse {
  const wire = readOperationArgs("vmark.browser.act", args);
  const operation = typeof wire.operation === "string" ? wire.operation : "";
  switch (operation) {
    case "click":
    case "type":
      return parsePointed(wire, operation);
    case "scroll":
      return parseScroll(wire);
    case "key":
      return parseKey(wire);
    default:
      return refuse(`act supports 'click', 'type', 'scroll', 'key', not '${operation}'`);
  }
}
