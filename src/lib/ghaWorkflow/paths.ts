/**
 * Purpose: Resolve a `uses:` reference that points at a workspace-local
 *   action or reusable workflow, against the workflow file's location
 *   and the workspace root. Used by:
 *     - WI-B.1 (local action discovery): registry calls this before
 *       reading action.yml off disk
 *     - WI-B.2 (go-to-def): Cmd-Click on a local uses opens the target
 *
 *   Cross-platform: accepts both POSIX `/` and Windows `\` separators
 *   in the input; emits POSIX absolute paths for the rest of the
 *   codebase to consume uniformly.
 *
 *   Security: refuses to resolve outside the workspace root via `..`
 *   traversal — returns `kind: "escaped"` so callers can show a
 *   warning rather than load attacker-controlled YAML.
 *
 * @module lib/ghaWorkflow/paths
 */

export type ResolvedLocalRef =
  | { kind: "action"; absPath: string }
  | { kind: "workflow"; absPath: string; gitRef: string | null }
  | { kind: "invalid"; reason: string }
  | { kind: "escaped"; reason: string };

/** Cheap predicate — true when the ref looks like a local path. */
export function isLocalUsesRef(ref: string): boolean {
  if (!ref) return false;
  // Normalize separators for the prefix check.
  const norm = ref.replace(/\\/g, "/");
  if (norm === "./" || norm === "../") return false;
  return norm.startsWith("./") || norm.startsWith("../");
}

/**
 * Resolve a relative path. GitHub Actions treats `./` paths as
 * relative to the WORKSPACE ROOT (the repo root), not relative to
 * the workflow file's directory — see docs.github.com/actions/
 * sharing-automations/creating-actions/about-custom-actions#types-of-actions.
 * Returns a POSIX absolute path normalized for `..` segments, or null
 * when the path escapes `wsRoot`.
 *
 * `workflowFile` is accepted for API symmetry but currently unused;
 * a future feature might support workflow-relative refs.
 */
function resolveAgainst(
  rel: string,
  _workflowFile: string,
  wsRoot: string,
): string | null {
  const wsRootNorm = wsRoot.replace(/\\/g, "/").replace(/\/$/, "");

  let relNorm = rel.replace(/\\/g, "/");
  if (relNorm.startsWith("./")) relNorm = relNorm.slice(2);

  // Anchor at workspace root.
  const segments = (wsRootNorm + "/" + relNorm).split("/").filter(Boolean);
  const stack: string[] = [];
  const wsDepth = wsRootNorm.split("/").filter(Boolean).length;
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      // Refuse to pop above the workspace root.
      if (stack.length <= wsDepth) return null;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return "/" + stack.join("/");
}

/**
 * Resolve a workspace-local `uses:` ref. Distinguishes:
 *   - action ref: ends in a directory (auto-appends `action.yml`),
 *     or already points at `action.yml`/`action.yaml`
 *   - reusable workflow ref: ends in `.yml`/`.yaml` under
 *     `.github/workflows/`, with optional `@ref` git anchor
 *   - invalid: not a local ref (passes through)
 *   - escaped: would resolve outside the workspace
 */
export function resolveLocalUsesRef(
  ref: string,
  workflowFile: string,
  wsRoot: string,
): ResolvedLocalRef {
  if (!isLocalUsesRef(ref)) {
    return { kind: "invalid", reason: "not a local ref" };
  }

  // Split the optional @gitRef.
  const atIdx = ref.lastIndexOf("@");
  const pathPart = atIdx > 0 ? ref.slice(0, atIdx) : ref;
  const gitRef = atIdx > 0 ? ref.slice(atIdx + 1) : null;

  const resolved = resolveAgainst(pathPart, workflowFile, wsRoot);
  if (resolved === null) {
    return { kind: "escaped", reason: "path escapes workspace root" };
  }

  // Reusable workflow heuristic: contains `/.github/workflows/` and
  // ends in .yml or .yaml.
  const isWorkflow =
    /\/\.github\/workflows\/[^/]+\.(yml|yaml)$/.test(resolved);
  if (isWorkflow) {
    return { kind: "workflow", absPath: resolved, gitRef };
  }

  // Action: either resolved directly to action.yml/yaml, or it's a
  // directory and we append action.yml.
  if (/\/action\.(yml|yaml)$/.test(resolved)) {
    return { kind: "action", absPath: resolved };
  }
  return { kind: "action", absPath: `${resolved}/action.yml` };
}
