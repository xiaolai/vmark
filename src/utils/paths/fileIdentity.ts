/**
 * File identity — the one answer to "do these two path spellings name the
 * same file?", for the save queue's key and every same-file comparison the
 * save pipeline makes.
 *
 * Key decisions:
 *   - Lexical. Separators, repeated and trailing slashes and `.`/`..` segments
 *     are collapsed; the filesystem is not consulted, so a symlink and its
 *     target stay two identities. Resolving them needs an await, and the save
 *     queue is keyed before its first await so no later save can overtake it.
 *   - Case is folded on Windows only (NTFS is case-insensitive by default).
 *     macOS stays byte-exact, like `pathComparison.ts`: an APFS volume may be
 *     case-sensitive, and a fold there would let a Save As to `Notes.md`
 *     replace a distinct `notes.md` as if it were the document's own file.
 *   - A UNC share keeps its leading `//`, so it is never the rooted path of
 *     the same names.
 *
 * Pure string functions — no filesystem access, no store imports.
 *
 * @coordinates-with pathComparison.ts — the dot-segment collapse and the macOS case decision
 * @module utils/paths/fileIdentity
 */
import { canonicalPathKey } from "./pathComparison";
import { normalizePath } from "./paths";
import type { RuntimePlatform } from "@/utils/platform";

/** The identity of the file `path` names on `platform`: compare these, never the spellings. */
export function fileIdentityKey(path: string, platform: RuntimePlatform): string {
  const unc = platform === "windows" && normalizePath(path).startsWith("//");
  const key = (unc ? "/" : "") + canonicalPathKey(path);
  return platform === "windows" ? key.toLowerCase() : key;
}

/** True when both paths are non-empty and name the same file on `platform`. */
export function isSameFile(a: string, b: string, platform: RuntimePlatform): boolean {
  if (!a || !b) return false;
  return fileIdentityKey(a, platform) === fileIdentityKey(b, platform);
}
