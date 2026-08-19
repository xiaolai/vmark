/**
 * Pure helpers for the browser approval store (extracted for the file-size
 * gate, WI-NB5.3). No store, no Tauri — just the operation vocabulary and the
 * small pure functions the store's actions call.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the only consumer
 * @module stores/browserApprovalStore.helpers
 */

import { canonicalizeOrigin } from "@/lib/browser/origin/originGuard";
import type { ActionTarget } from "./browserApprovalStore.types";

/** Closed operation vocabulary; upload is intentionally never grantable. */
export const KNOWN_OPERATIONS = new Set([
  "read",
  "attach",
  "click",
  "type",
  "scroll",
  "key",
  "style",
  "navigate",
  "publish",
  "eval",
  "session",
]);

/** The optional (target, script) bindings an approval/one-shot carries. */
export const approvalBindings = (
  target: ActionTarget | undefined,
  script: string | undefined,
): { target?: ActionTarget; script?: string } => ({
  ...(target !== undefined && { target }),
  ...(script !== undefined && { script }),
});

/** Whether two act targets name the same element (role + accessible name). */
export function sameTarget(a: ActionTarget | undefined, b: ActionTarget | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.role === b.role && a.name === b.name;
}

/** The origin-pattern a URL grants against, or null for an opaque origin
 *  (about:/data:) that can be neither remembered nor authorized once. */
export function grantPatternFor(url: string): string | null {
  const origin = canonicalizeOrigin(url);
  if (!origin) return null;
  const defaultPort = origin.scheme === "https" ? 443 : 80;
  return origin.port === defaultPort
    ? `${origin.scheme}://${origin.host}`
    : `${origin.scheme}://${origin.host}:${origin.port}`;
}
