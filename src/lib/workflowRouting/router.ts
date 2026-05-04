// WI-1.5 — workflow router (ADR-10).
//
// Decides whether a given file is a GitHub Actions workflow (this plan),
// a VMark Genie workflow (the existing 20260331 plan's feature), or
// neither. Both features mount different content into the shared
// WorkflowPanelShell; this router is the single source of routing
// truth so neither feature has to detect the other.

import { isWorkflowYaml, looksLikeWorkflowPath } from "../ghaWorkflow/detection";

export type WorkflowKind = "gha" | "genie" | "none";

export interface RouteInput {
  path: string;
  content: string;
}

/**
 * Returns the workflow kind for the given file. Stable, side-effect-free.
 *
 * Priority (per ADR-10):
 *   1. GHA — file under .github/workflows/ OR content has GHA shape
 *      (jobs: + on: at top level).
 *   2. Genie — content has Genie shape (top-level steps[] with genie/*
 *      uses, no jobs:).
 *   3. None.
 *
 * GHA wins ties because it's a strict superset of Genie's
 * vocabulary; a file with both `jobs:` and `genie/*` steps is treated
 * as GHA so the user gets the richer view.
 */
export function routeWorkflow(input: RouteInput): WorkflowKind {
  const { path, content } = input;
  if (!content || content.trim().length === 0) return "none";

  // Path is a strong signal — anything under .github/workflows/ is GHA
  // even if content is partial during an edit.
  if (looksLikeWorkflowPath(path)) return "gha";

  // Shape-based: GHA wins if shape matches.
  if (isWorkflowYaml(content)) return "gha";

  // Genie shape: top-level steps[] with at least one `uses: genie/*`.
  if (looksLikeGenieWorkflow(content)) return "genie";

  return "none";
}

const GENIE_STEPS_RE = /^steps:\s*\n/m;
const GENIE_USES_RE = /^\s*-\s+uses:\s*genie\//m;

function looksLikeGenieWorkflow(content: string): boolean {
  if (!GENIE_STEPS_RE.test(content)) return false;
  // At least one step uses a genie/* action.
  return GENIE_USES_RE.test(content);
}
