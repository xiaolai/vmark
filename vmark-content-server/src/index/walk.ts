/**
 * Deterministic workspace file walker (Phase 2, WI-2.1).
 *
 * Rules (review D2.3 — explicit, not "approximate"):
 *   - Honors caller-supplied exclude folders + a built-in always-skip set that
 *     intentionally mirrors `src-tauri/src/content_search.rs`.
 *   - Hidden/dot files and dot-directories are skipped unless `includeHidden`.
 *   - Symlinks are skipped entirely (traversal-safety, mirrors content_search).
 *   - Files larger than `maxFileSize` are skipped.
 *   - Basenames are NFC-normalized so CJK/diacritic forms compare stably.
 *   - Per-entry errors (permission, broken symlink) are skipped, not fatal.
 *   - Total files capped at `maxFiles`; the cap being hit is reported.
 *
 * @module index/walk
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { DocEntry } from "./types";

/** Always-skipped directory names — mirrors content_search.rs. */
export const ALWAYS_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".obsidian",
  ".svn",
  "__pycache__",
  ".vscode",
  ".idea",
  "target",
  ".next",
  "dist",
  ".superpowers",
]);

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdown", ".mkd"]);

export interface WalkOptions {
  excludeFolders?: string[];
  includeHidden?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  extensions?: Set<string>;
}

export interface WalkResult {
  docs: DocEntry[];
  /** True when maxFiles was reached and the walk stopped early. */
  truncated: boolean;
}

const DEFAULTS = {
  maxFiles: 20_000,
  maxFileSize: 5 * 1024 * 1024,
};

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/** Walk a workspace root, returning markdown docs by the rules above. */
export async function walkWorkspace(
  root: string,
  options: WalkOptions = {}
): Promise<WalkResult> {
  const exclude = new Set([...ALWAYS_SKIP_DIRS, ...(options.excludeFolders ?? [])]);
  const includeHidden = options.includeHidden ?? false;
  const maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;
  const maxFileSize = options.maxFileSize ?? DEFAULTS.maxFileSize;
  const exts = options.extensions ?? MARKDOWN_EXT;

  const docs: DocEntry[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission / gone — skip, not fatal
    }
    // Stable, locale-independent order (grill L1 — code-point, not localeCompare).
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (truncated) return;
      const name = entry.name;
      if (entry.isSymbolicLink()) continue; // never follow symlinks
      if (!includeHidden && isHidden(name)) continue;

      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        if (exclude.has(name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(name).toLowerCase();
      if (!exts.has(ext)) continue;

      try {
        const stat = await fs.stat(full);
        if (stat.size > maxFileSize) continue;
      } catch {
        continue;
      }

      if (docs.length >= maxFiles) {
        truncated = true;
        return;
      }

      // grill M3 — NFC-normalize relPath too (not just basename) so local-link
      // resolution matches on macOS volumes that store NFD filenames.
      const relPath = path.relative(root, full).split(path.sep).join("/").normalize("NFC");
      const base = path.basename(name, path.extname(name)).normalize("NFC");
      docs.push({ absPath: full, relPath, basename: base });
    }
  }

  await walk(root);
  return { docs, truncated };
}
