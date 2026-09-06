/**
 * Keeping a requested path inside the workspace.
 *
 * Shared by the `/note/` and `/asset/` routes, which is the point: one
 * definition of containment, applied twice, rather than two that can drift.
 * Split out of `createServer.ts` for the size gate.
 *
 * @coordinates-with createServer.ts — the note and preview routes
 * @coordinates-with assetRoute.ts — the media route
 * @module server/pathContainment
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Resolve a requested note path within root; returns null on escape/garbage. */
export function containedAbsPath(root: string, relRequest: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relRequest); // throws URIError on bad %-encoding
  } catch {
    return null; // grill H8 — malformed encoding → 400, not a 500
  }
  if (decoded.includes("\0")) return null; // grill M6 — reject NUL bytes
  decoded = decoded.replace(/^\/+/, "");
  const abs = path.resolve(root, decoded);
  const normRoot = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root) && !abs.startsWith(normRoot)) return null;
  return abs;
}

/** Validate an absolute deck path is a markdown file under the real root. */
export async function containedDeck(root: string, deck: string): Promise<string | null> {
  if (typeof deck !== "string" || !deck) return null;
  try {
    const real = await fs.realpath(deck);
    const realRoot = await fs.realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    if (!/\.(md|markdown|mdown|mkd)$/i.test(real)) return null;
    return real;
  } catch {
    return null;
  }
}

/** Re-assert containment after following symlinks (grill M11). */
export async function realContainedPath(root: string, abs: string): Promise<string | null> {
  try {
    const real = await fs.realpath(abs);
    const realRoot = (await fs.realpath(root)) + path.sep;
    if (real !== (await fs.realpath(root)) && !real.startsWith(realRoot)) return null;
    return real;
  } catch {
    return null; // ENOENT etc.
  }
}
