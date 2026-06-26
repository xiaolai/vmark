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
import ignore, { type Ignore } from "ignore";
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
  /** Honor `.gitignore` files (hierarchical, git semantics). Default true. */
  respectGitignore?: boolean;
}

/** One `.gitignore` matcher anchored at the directory that declared it. */
interface GitignoreScope {
  base: string;
  ig: Ignore;
}

/**
 * Load a directory's `.gitignore` into a matcher, or null when there are no
 * rules to apply.
 *
 * ENOENT (no `.gitignore`) is the common, expected case. For any other read
 * error we deliberately FAIL OPEN (no rules) rather than fail closed: this is a
 * single-user local tool where `.gitignore` honoring is a convenience filter
 * (hide build artifacts), not a security boundary — hiding the user's own notes
 * because one `.gitignore` was momentarily unreadable would be the worse
 * outcome. (Codex audit — documented intentional choice.)
 */
async function loadGitignore(dir: string): Promise<Ignore | null> {
  try {
    const content = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
    return ignore().add(content);
  } catch {
    return null;
  }
}

/**
 * Test a path against every applicable `.gitignore` scope (outermost → current
 * dir), matching with the path relative to each declaring directory. Later
 * (more deeply nested) scopes override earlier ones, so a child `.gitignore`'s
 * `!negation` can re-include a file a parent ignored — git semantics.
 */
function isGitignored(scopes: GitignoreScope[], absPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const { base, ig } of scopes) {
    const rel = path.relative(base, absPath).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) continue; // not under this scope
    const result = ig.test(isDir ? `${rel}/` : rel);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false; // explicit `!` re-include
  }
  return ignored;
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
  const respectGitignore = options.respectGitignore ?? true;

  const docs: DocEntry[] = [];
  let truncated = false;

  async function walk(dir: string, scopes: GitignoreScope[]): Promise<void> {
    if (truncated) return;
    // Extend the gitignore scope stack with this directory's .gitignore.
    let dirScopes = scopes;
    if (respectGitignore) {
      const ig = await loadGitignore(dir);
      if (ig) dirScopes = [...scopes, { base: dir, ig }];
    }
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
        if (respectGitignore && isGitignored(dirScopes, full, true)) continue;
        await walk(full, dirScopes);
        continue;
      }
      if (!entry.isFile()) continue;
      if (respectGitignore && isGitignored(dirScopes, full, false)) continue;

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

  await walk(root, []);
  return { docs, truncated };
}
