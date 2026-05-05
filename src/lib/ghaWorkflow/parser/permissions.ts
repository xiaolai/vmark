// WI-1.3 — permissions normalization.
//
// GitHub Actions writes scope names in kebab-case (`pull-requests`,
// `id-token`); the IR uses camelCase to match TypeScript convention.
// String aliases (`read-all`, `write-all`, `none`) pass through verbatim.
//
// Codex audit HIGH-2 follow-up: the kebab↔camel map lives in a shared
// module so the parser, the mutator, and the form all agree. Without
// the shared map, the form's hand-rolled kebab-case keys diverged from
// the IR's camelCase, dropping edits to `pull-requests` / `id-token`
// / `security-events`.

import type {
  PermLevel,
  PermissionsIR,
  PermissionsValue,
} from "../types";
import { yamlMapToIr, kebabToCamel } from "../permissions/scopes";

const KNOWN_IR_SCOPES: ReadonlySet<string> = new Set([
  "actions",
  "attestations",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "idToken",
  "issues",
  "models",
  "packages",
  "pages",
  "pullRequests",
  "securityEvents",
  "statuses",
]);

const VALID_LEVELS: ReadonlySet<PermLevel> = new Set([
  "read",
  "write",
  "none",
]);

export interface ParsePermissionsResult {
  value: PermissionsValue;
}

/**
 * Normalize a `permissions:` block from raw YAML shape into our IR shape.
 *
 * Accepts:
 *   - `"read-all"` / `"write-all"` / `"none"` — literal alias
 *   - object with kebab-case scope names → camelCase
 *
 * Unknown keys are dropped (forwards-compatibility — GitHub may add
 * scopes; we don't want to fail loudly on every new release).
 * Invalid level values are dropped.
 */
export function parsePermissions(
  raw: unknown,
): ParsePermissionsResult {
  if (raw === "read-all" || raw === "write-all" || raw === "none") {
    return { value: raw };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // Filter to valid levels + known scopes (forwards-compat: drop
    // any GHA-future keys we don't recognize), then convert via the
    // shared scopes module.
    const valid: Record<string, PermLevel> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== "string" || !VALID_LEVELS.has(v as PermLevel)) continue;
      const camel = kebabToCamel(k);
      if (!KNOWN_IR_SCOPES.has(camel)) continue;
      valid[k] = v as PermLevel;
    }
    const out = yamlMapToIr(valid) as PermissionsIR;
    return { value: out };
  }

  return { value: {} };
}
