/**
 * Built-in site plugin registration (WI-NB4.3) — the production call site for
 * `registerSite`. Idempotent: the extract path calls it on every request, the
 * registry is a module singleton, and re-registering would throw on the
 * duplicate id — so registration happens exactly once, lazily, with no init
 * ordering to get wrong.
 *
 * @coordinates-with lib/sites/registry.ts — the registry being populated
 * @coordinates-with services/mcpBridge/v2/browserExtract.ts — the caller
 * @module lib/sites/builtins
 */

import { registerSite } from "./registry";
import { wikipediaSite, wikipediaReader } from "./wikipedia/wikipedia";

let registered = false;

/** Register every built-in site plugin, once. */
export function ensureBuiltinSitesRegistered(): void {
  if (registered) return;
  registerSite(wikipediaSite, wikipediaReader);
  registered = true;
}

/** Test-only: allow a reset registry to be repopulated. */
export function __resetBuiltinSites(): void {
  registered = false;
}
