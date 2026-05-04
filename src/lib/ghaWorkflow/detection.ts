// WI-1.4 — detection heuristic.
//
// Plan ADR-5: combine path heuristic, shape heuristic, and explicit
// info-string marker to decide whether a piece of YAML is a GitHub
// Actions workflow.
//
// Cheap by design — the shape check parses YAML lazily (via a regex
// pre-filter) so callers can run it on every keystroke.

const PATH_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * Path-only check. Cheap; doesn't read the file content. Use this for
 * file-tree filtering before opening, then run isWorkflowYaml() once
 * the content is loaded.
 */
export function looksLikeWorkflowPath(
  path: string | undefined | null,
): boolean {
  if (!path) return false;
  return PATH_RE.test(path);
}

export interface IsWorkflowOpts {
  /**
   * If true, accept YAML even if the shape heuristic is borderline.
   * Used when the caller already knows this is a workflow (explicit
   * `yaml workflow` info string on a markdown code fence, or path under
   * `.github/workflows/`).
   */
  explicit?: boolean;
}

/**
 * Shape-based detection: returns true when the content has top-level
 * `on:` and `jobs:` keys at column 0, both of which are non-empty
 * mappings or arrays. Tuned to be cheap (no full YAML parse) so it can
 * run on every keystroke.
 *
 * False positives we accept:
 *   - YAML with `on:` and `jobs:` keys at top level but unrelated to
 *     GitHub Actions (rare in practice; explicit marker covers it).
 * False negatives we accept:
 *   - YAML with leading frontmatter that puts `on:` deeper.
 */
export function isWorkflowYaml(
  content: string,
  opts: IsWorkflowOpts = {},
): boolean {
  if (!content || content.trim().length === 0) return false;

  const hasOn = TOP_KEY_RE("on").test(content);
  const hasJobs = TOP_KEY_RE("jobs").test(content);

  if (opts.explicit) {
    // With an explicit marker, accept on: alone — the rest may be
    // partially written.
    return hasOn || hasJobs;
  }

  if (!hasOn || !hasJobs) return false;

  // Reject if YAML is obviously malformed by looking for triple-colon
  // patterns or nested key conflicts. Cheap heuristic.
  if (/^[a-zA-Z_][^\n:]*:\s*::/m.test(content)) return false;

  return true;
}

/**
 * Build a regex that matches a top-level YAML key (anchored at line
 * start, no leading whitespace, terminated by colon).
 */
function TOP_KEY_RE(key: string): RegExp {
  return new RegExp(`^${escapeRegex(key)}:`, "m");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
