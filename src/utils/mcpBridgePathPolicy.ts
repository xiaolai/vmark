/**
 * MCP Bridge Path Policy
 *
 * Purpose: Pure decision function that constrains MCP-bridge file reads and
 *   writes to a caller-supplied set of allowed root directories.
 *
 *   The bridge exposes `workspace.open` / `save` / `save_as` and
 *   `document.write` to an external AI agent whose instructions can be
 *   poisoned by untrusted content it processes (prompt injection). Without a
 *   scope check, that agent could read or overwrite any file the Tauri fs
 *   capability reaches (`$HOME/**`, incl. dotfiles). This function is the
 *   application-layer mitigation the capability file's SECURITY NOTE relies
 *   on — previously implemented only for image embeds (`validateImagePath`)
 *   and now extended to the bridge's file surface.
 *
 *   Leaf-pure per ADR-013: depends only on path-string helpers, never on
 *   stores or Tauri APIs. The caller (a `services/` adapter) resolves
 *   `allowedRoots` from live app state and injects them, so the boundary
 *   policy can be unit-tested and re-tuned without touching store wiring —
 *   the mechanism lives here, the product boundary stays with the caller.
 *
 * Key decisions:
 *   - Reject a NUL byte outright (fail closed): it can truncate the path at the
 *     C-string boundary in lower fs layers, and a new file's NUL-tail is never
 *     canonical-checked (the Rust guard only resolves the deepest existing
 *     ancestor), so refuse it lexically before any other reasoning.
 *   - Reject anything that isn't an absolute path: the bridge always deals
 *     in real on-disk files, so a relative path is meaningless (and would
 *     resolve against an unknowable CWD).
 *   - Reject any path containing a ".." segment outright. The Rust guard later
 *     canonicalizes existing paths and the deepest existing ancestor of new
 *     paths, but refusing traversal early keeps the bridge contract simple.
 *   - Allow iff the path is within (or equal to) at least one allowed root.
 *     Empty `allowedRoots` → always reject: no workspace and no open document
 *     means there is no legitimate target, so the bridge grants no access.
 *
 * @coordinates-with utils/paths/paths.ts — isWithinRoot, pathSegments, normalizePath
 * @coordinates-with services/mcpBridge/bridgePathGuard.ts — resolves allowedRoots from stores
 * @module utils/mcpBridgePathPolicy
 */

import { isWithinRoot, normalizePath, pathSegments } from "@/utils/paths";

/** Context for a bridge path decision — the directories access is scoped to. */
interface BridgePathContext {
  /** Absolute directories the bridge may read/write within. */
  allowedRoots: string[];
}

/** Result of a bridge path decision. `reason` is safe to surface to the agent. */
export type BridgePathDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** POSIX-absolute (`/x`) or Windows drive-absolute (`C:\x`). */
function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:/.test(path);
}

/**
 * Decide whether the MCP bridge may read or write `filePath`, given the set
 * of allowed root directories. Pure — see module header for the rules.
 */
export function resolveBridgePathDecision(
  filePath: string,
  ctx: BridgePathContext,
): BridgePathDecision {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return { allowed: false, reason: "Path must be a non-empty string" };
  }
  // Reject a NUL byte lexically (fail closed): it can truncate the path at the
  // C-string boundary in lower fs layers, and for a *new* file the Rust guard
  // only canonicalizes the deepest existing ancestor — so the raw string after
  // the NUL would never be canonical-checked. Refuse it here before any
  // FS-dependent reasoning.
  if (filePath.split("").some((ch) => ch.charCodeAt(0) === 0)) {
    return { allowed: false, reason: "Path must not contain a null byte" };
  }
  if (!isAbsolutePath(filePath)) {
    return { allowed: false, reason: "Path must be absolute" };
  }
  // pathSegments normalizes but never folds "..", so traversal survives here.
  if (pathSegments(filePath).includes("..")) {
    return { allowed: false, reason: "Path must not contain '..' segments" };
  }

  const roots = ctx.allowedRoots.filter(
    (root) => typeof root === "string" && root.length > 0,
  );
  if (roots.length === 0) {
    return {
      allowed: false,
      reason: "No workspace or open document to scope this path to",
    };
  }

  const target = normalizePath(filePath);
  const withinSomeRoot = roots.some((root) => isWithinRoot(root, target));
  if (!withinSomeRoot) {
    return {
      allowed: false,
      reason: "Path is outside the workspace and open documents",
    };
  }
  return { allowed: true };
}
