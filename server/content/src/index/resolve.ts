/**
 * Wiki-link → file resolution (Phase 2, WI-2.3) — implements the plan's §3bis
 * resolution spec table.
 *
 * Forms handled: `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]`, `[[Page|Alias]]`
 * (alias already stripped upstream), explicit extension, duplicate basenames,
 * case-insensitive filesystems, CJK/Unicode (NFC). Unresolved targets return
 * `null` so callers can render a "missing" link + an unresolved graph node.
 *
 * @module index/resolve
 */

import * as path from "node:path";
import type { DocEntry } from "./types";

export interface ResolverResult {
  /** Resolved doc relPath, or null if unresolved. */
  relPath: string | null;
  /** The `#anchor` portion if present (sans `#`). */
  anchor?: string;
}

/** A reverse index over the workspace docs for fast resolution. */
export class WikiResolver {
  /** basename (NFC, lowercased) → docs sharing it. */
  private byBasename = new Map<string, DocEntry[]>();
  /** relPath (NFC, lowercased, no extension) → doc. */
  private byRelPath = new Map<string, DocEntry>();
  /** exact relPath (NFC, lowercased, with extension) → doc. */
  private byRelPathExt = new Map<string, DocEntry>();

  constructor(docs: DocEntry[]) {
    for (const doc of docs) {
      const baseKey = doc.basename.toLowerCase();
      const list = this.byBasename.get(baseKey);
      if (list) list.push(doc);
      else this.byBasename.set(baseKey, [doc]);

      const relNoExt = stripExt(doc.relPath).normalize("NFC").toLowerCase();
      // Prefer first-wins is wrong; we resolve dups deterministically below,
      // but for relPath the path is unique so last-wins is fine.
      this.byRelPath.set(relNoExt, doc);
      this.byRelPathExt.set(doc.relPath.normalize("NFC").toLowerCase(), doc);
    }
  }

  /**
   * Resolve a raw wiki target (may include `#anchor`) from a given source doc.
   * `fromRelPath` is used to prefer same-directory matches on basename ties.
   */
  resolve(rawTarget: string, fromRelPath: string): ResolverResult {
    const [targetPart, anchor] = splitAnchor(rawTarget);
    const target = targetPart.trim().normalize("NFC");
    if (!target) return { relPath: null, anchor };

    const lower = target.toLowerCase();

    // 1. Explicit extension → exact relpath match.
    if (hasMarkdownExt(target)) {
      const exact = this.byRelPathExt.get(lower);
      return { relPath: exact ? exact.relPath : null, anchor };
    }

    // 2. Path-bearing target (`dir/Page`) → relpath match (then basename).
    if (target.includes("/")) {
      const rel = this.byRelPath.get(lower);
      if (rel) return { relPath: rel.relPath, anchor };
      // fall through to basename of the last segment
      const base = lower.slice(lower.lastIndexOf("/") + 1);
      return { relPath: this.pickByBasename(base, fromRelPath), anchor };
    }

    // 3. Bare page name → basename match.
    return { relPath: this.pickByBasename(lower, fromRelPath), anchor };
  }

  /** Choose among duplicate basenames: same dir first, then shortest path. */
  private pickByBasename(baseLower: string, fromRelPath: string): string | null {
    const candidates = this.byBasename.get(baseLower);
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].relPath;

    const fromDir = fromRelPath.includes("/")
      ? fromRelPath.slice(0, fromRelPath.lastIndexOf("/"))
      : "";
    const sameDir = candidates.filter((c) => {
      const dir = c.relPath.includes("/") ? c.relPath.slice(0, c.relPath.lastIndexOf("/")) : "";
      return dir === fromDir;
    });
    const pool = sameDir.length ? sameDir : candidates;
    // Shortest path wins; tiebreak by code-point order (grill L1 — NOT
    // localeCompare, which varies with the runtime locale and would make
    // resolution non-deterministic across machines/LANG).
    return [...pool].sort(
      (a, b) =>
        a.relPath.length - b.relPath.length ||
        (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0)
    )[0].relPath;
  }
}

function splitAnchor(raw: string): [string, string | undefined] {
  const idx = raw.indexOf("#");
  if (idx === -1) return [raw, undefined];
  return [raw.slice(0, idx), raw.slice(idx + 1) || undefined];
}

const MD_EXTS = [".md", ".markdown", ".mdown", ".mkd"];

function hasMarkdownExt(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return MD_EXTS.includes(ext);
}

function stripExt(p: string): string {
  const ext = path.extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}
