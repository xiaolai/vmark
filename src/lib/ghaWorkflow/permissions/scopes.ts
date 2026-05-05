/**
 * Purpose: Shared kebab-case ↔ camelCase scope key map for GitHub
 *   Actions permissions. The IR normalizes scope keys to camelCase
 *   (TypeScript convention); the YAML on disk uses kebab-case (GHA
 *   convention).
 *
 *   Codex audit HIGH-2 fix: PermissionsForm previously used kebab-case
 *   keys to read from a camelCase IR — `pull-requests`, `id-token`,
 *   `security-events` lookups returned undefined. The form rendered
 *   blank for those scopes and edits dropped. This module centralizes
 *   the conversion so the parser, mutator, and form all agree.
 *
 * @module lib/ghaWorkflow/permissions/scopes
 */

import type { PermLevel } from "@/lib/ghaWorkflow/types";

/** YAML key → IR key. Kept exhaustive for known GHA scopes. */
const KEBAB_TO_CAMEL: Record<string, string> = {
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

const CAMEL_TO_KEBAB: Record<string, string> = Object.fromEntries(
  Object.entries(KEBAB_TO_CAMEL).map(([k, v]) => [v, k]),
);

/** Common scopes shown in the form (kebab-case for user-visible YAML). */
export const COMMON_SCOPES_KEBAB: readonly string[] = [
  "contents",
  "pull-requests",
  "issues",
  "actions",
  "checks",
  "deployments",
  "id-token",
  "packages",
  "statuses",
];

export function kebabToCamel(kebab: string): string {
  return KEBAB_TO_CAMEL[kebab] ?? kebab;
}

export function camelToKebab(camel: string): string {
  return CAMEL_TO_KEBAB[camel] ?? camel;
}

/** Convert an IR-shaped permissions map (camelCase keys) to YAML keys. */
export function irToYamlMap(
  ir: Record<string, PermLevel>,
): Record<string, PermLevel> {
  const out: Record<string, PermLevel> = {};
  for (const [k, v] of Object.entries(ir)) {
    out[camelToKebab(k)] = v;
  }
  return out;
}

/** Convert a YAML-shaped permissions map (kebab-case keys) to IR keys. */
export function yamlMapToIr(
  yaml: Record<string, PermLevel>,
): Record<string, PermLevel> {
  const out: Record<string, PermLevel> = {};
  for (const [k, v] of Object.entries(yaml)) {
    out[kebabToCamel(k)] = v;
  }
  return out;
}
