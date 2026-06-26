/**
 * Full-text workspace search (Phase 4, WI-4.2).
 *
 * Node-side search over the indexed docs. Self-contained (no cross-process call
 * to Rust `content_search`) so the served site works wherever the content
 * server runs. Caps intentionally mirror `content_search.rs`.
 *
 * @module server/search
 */

import { promises as fs } from "node:fs";
import type { DocEntry } from "../index/types";

export const SEARCH_CAPS = {
  maxMatches: 1000,
  maxFiles: 50,
  maxLineLen: 200,
};

export interface LineMatch {
  lineNumber: number;
  lineContent: string;
}

export interface FileSearchResult {
  relPath: string;
  title?: string;
  matches: LineMatch[];
}

export interface SearchOptions {
  caseSensitive?: boolean;
  /** Map relPath → frontmatter title for richer results. */
  titles?: Map<string, string | undefined>;
}

function truncateLine(line: string, idx: number): string {
  if (line.length <= SEARCH_CAPS.maxLineLen) return line.trim();
  const start = Math.max(0, idx - 40);
  const end = Math.min(line.length, start + SEARCH_CAPS.maxLineLen);
  return (start > 0 ? "…" : "") + line.slice(start, end).trim() + (end < line.length ? "…" : "");
}

/** Search doc contents for `query`; returns capped per-file line matches. */
export async function searchWorkspace(
  docs: DocEntry[],
  query: string,
  options: SearchOptions = {}
): Promise<FileSearchResult[]> {
  const q = options.caseSensitive ? query : query.toLowerCase();
  if (!q) return [];

  const results: FileSearchResult[] = [];
  let totalMatches = 0;

  for (const doc of docs) {
    if (results.length >= SEARCH_CAPS.maxFiles) break;
    if (totalMatches >= SEARCH_CAPS.maxMatches) break;

    let content: string;
    try {
      content = await fs.readFile(doc.absPath, "utf8");
    } catch {
      continue;
    }
    const haystack = options.caseSensitive ? content : content.toLowerCase();
    if (!haystack.includes(q)) continue;

    const lines = content.split("\n");
    const matches: LineMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (totalMatches >= SEARCH_CAPS.maxMatches) break;
      const cmp = options.caseSensitive ? lines[i] : lines[i].toLowerCase();
      const idx = cmp.indexOf(q);
      if (idx === -1) continue;
      matches.push({ lineNumber: i + 1, lineContent: truncateLine(lines[i], idx) });
      totalMatches++;
    }
    if (matches.length) {
      results.push({ relPath: doc.relPath, title: options.titles?.get(doc.relPath), matches });
    }
  }

  return results;
}
