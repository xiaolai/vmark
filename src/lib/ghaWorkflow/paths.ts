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
 * Detect the root form of an absolute path so we can preserve it
 * across normalization. Returns:
 *   - "drive": Windows drive root like `C:/`
 *   - "unc":   UNC share root like `//server/share/`
 *   - "posix": POSIX absolute root `/`
 *
 * The remainder is the path body without the root prefix.
 */
function classifyRoot(absPath: string): {
  rootKind: "drive" | "unc" | "posix";
  rootPrefix: string;
  body: string;
} {
  const norm = absPath.replace(/\\/g, "/");
  // UNC: leading `//server/share`
  const unc = /^(\/\/[^/]+\/[^/]+)(\/.*|$)/.exec(norm);
  if (unc) return { rootKind: "unc", rootPrefix: unc[1], body: unc[2] };
  // Drive: leading `C:` (any letter + colon).
  const drive = /^([A-Za-z]:)(\/.*|$)/.exec(norm);
  if (drive) return { rootKind: "drive", rootPrefix: drive[1], body: drive[2] };
  return { rootKind: "posix", rootPrefix: "", body: norm };
}

/**
 * Resolve a relative path. GitHub Actions treats `./` paths as
 * relative to the WORKSPACE ROOT (the repo root), not relative to
 * the workflow file's directory — see docs.github.com/actions/
 * sharing-automations/creating-actions/about-custom-actions#types-of-actions.
 * Returns an absolute path normalized for `..` segments, or null
 * when the path escapes `wsRoot`.
 *
 * Preserves the workspace root's prefix form (`C:/`, `//server/share/`,
 * or `/`) so Windows callers don't see pseudo-POSIX paths like
 * `/C:/repo/...` (Codex audit MED-7 fix).
 *
 * `workflowFile` is accepted for API symmetry but currently unused.
 */
function resolveAgainst(
  rel: string,
  _workflowFile: string,
  wsRoot: string,
): string | null {
  const wsRootNorm = wsRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const { rootKind, rootPrefix, body: wsBody } = classifyRoot(wsRootNorm);

  let relNorm = rel.replace(/\\/g, "/");
  if (relNorm.startsWith("./")) relNorm = relNorm.slice(2);

  // Anchor at workspace root's body. We split the body (no root
  // prefix) and re-attach the prefix at the end.
  const segments = (wsBody + "/" + relNorm).split("/").filter(Boolean);
  const stack: string[] = [];
  const wsDepth = wsBody.split("/").filter(Boolean).length;
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (stack.length <= wsDepth) return null;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const tail = stack.join("/");
  if (rootKind === "posix") return "/" + tail;
  if (rootKind === "drive") return `${rootPrefix}/${tail}`;
  // UNC
  return `${rootPrefix}/${tail}`;
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
