// WI-1.3 — permissions normalization.
//
// GitHub Actions writes scope names in kebab-case (`pull-requests`,
// `id-token`); the IR uses camelCase to match TypeScript convention.
// String aliases (`read-all`, `write-all`, `none`) pass through verbatim.

import type {
  PermLevel,
  PermissionsIR,
  PermissionsValue,
} from "../types";

const KEBAB_TO_CAMEL: Record<string, keyof PermissionsIR> = {
  actions: "actions",
  attestations: "attestations",
  checks: "checks",
  contents: "contents",
  deployments: "deployments",
  discussions: "discussions",
  "id-token": "idToken",
  issues: "issues",
  models: "models",
  packages: "packages",
  pages: "pages",
  "pull-requests": "pullRequests",
  "security-events": "securityEvents",
  statuses: "statuses",
};

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
    const out: PermissionsIR = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const camel = KEBAB_TO_CAMEL[k];
      if (!camel) continue;
      if (typeof v !== "string" || !VALID_LEVELS.has(v as PermLevel)) continue;
      out[camel] = v as PermLevel;
    }
    return { value: out };
  }

  return { value: {} };
}
