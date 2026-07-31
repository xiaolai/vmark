/**
 * Platform-aware path COMPARISON normalization (WI-17.1).
 *
 * Purpose: one comparison identity for containment/equality checks so that
 * ownership classification, nested-root specificity, root deduplication, and
 * persistence keys all agree on when two path spellings mean the same entry.
 *
 * Key decisions:
 *   - Windows folds the FULL path case (drive letter, components, UNC hosts):
 *     NTFS is case-insensitive, and folding only the drive letter (what
 *     `normalizePath` does) makes containment disagree with workspace
 *     identity for ordinary component-case variants.
 *   - macOS stays BYTE-EXACT. It is the primary platform, existing workspace
 *     rootIds are derived from byte-exact paths, and APFS can be
 *     case-sensitive per volume. Alternate-casing duplicates on
 *     case-insensitive volumes are a documented known limitation
 *     (plan D9), not a bug to fix by folding.
 *   - Linux stays byte-exact (case-sensitive filesystems).
 *   - These functions are for COMPARISON ONLY — never persist or display
 *     their output; persist the instance's stored rootPath instead (WI-17.2).
 *
 * Pure string functions — no filesystem access, no store imports.
 *
 * @coordinates-with workspaceContextOwnership.ts — containment + specificity
 * @coordinates-with workspaceIdentityPaths.ts — identity (dedup) normalization
 * @module utils/paths/pathComparison
 */
import { normalizePath } from "./paths";
import type { RuntimePlatform } from "@/utils/platform";

/**
 * Normalize a path for comparison on the given platform: forward slashes,
 * no trailing separators, and full case folding on Windows only.
 */
export function normalizePathForCompare(
  path: string,
  platform: RuntimePlatform,
): string {
  const normalized = normalizePath(path);
  return platform === "windows" ? normalized.toLowerCase() : normalized;
}

/**
 * Canonical MAP-KEY form of an absolute document path (WI-8c): forward slashes,
 * dot segments collapsed. Two spellings of one file (`/a/b/../b/x.md`,
 * `/a/./b/x.md`) otherwise occupy two keys, and a live-buffer lookup misses —
 * which, in orphan cleanup, is the difference between protecting a document's
 * image and deleting it. Case is left alone: folding would corrupt keys on
 * case-sensitive filesystems, and the cleanup compares KEYS from one source
 * (the document store) where spelling is already consistent per file.
 */
export function canonicalPathKey(path: string): string {
  const normalized = normalizePath(path);
  const isAbsolute = normalized.startsWith("/");
  const out: string[] = [];
  for (const seg of normalized.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      // ".." above an absolute root is discarded — "/" has no parent.
      continue;
    }
    out.push(seg);
  }
  return (isAbsolute ? "/" : "") + out.join("/");
}

/** True when the two paths are the same entry under comparison normalization. */
export function pathsEqualForCompare(
  a: string,
  b: string,
  platform: RuntimePlatform,
): boolean {
  if (!a || !b) return false;
  return (
    normalizePathForCompare(a, platform) === normalizePathForCompare(b, platform)
  );
}

/**
 * True when `targetPath` is within (or equal to) `rootPath` under comparison
 * normalization. Boundary-checked (root + "/") so `/Users/root` never matches
 * `/Users/rootother`.
 */
export function isWithinRootForCompare(
  rootPath: string,
  targetPath: string,
  platform: RuntimePlatform,
): boolean {
  if (!rootPath || !targetPath) return false;
  const root = normalizePathForCompare(rootPath, platform);
  const target = normalizePathForCompare(targetPath, platform);
  if (target === root) return true;
  return target.startsWith(root + "/");
}
