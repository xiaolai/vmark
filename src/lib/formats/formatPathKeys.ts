/**
 * Path → lookup-key helpers, extracted from registry.ts.
 *
 * Purpose: turn a file path into the ordered keys used to match it against user
 * associations and the built-in extension map. This is string work about paths;
 * it neither reads nor mutates the registry, so it does not belong in the file
 * that owns registration state (and registry.ts was exactly at its 300-line
 * limit, so the next invariant could not be added without this split).
 *
 * @coordinates-with registry.ts — the caller
 * @module lib/formats/formatPathKeys
 */

/**
 * Compute the ordered list of lookup keys for a file path, most specific
 * first. Used to match a file against user associations and the built-in
 * extension map. Lowercased; query string and fragment stripped so
 * `file://` URLs and tab-restore paths (`?reload=1`, `#anchor`) match.
 *
 * Examples:
 *   - `/x/notes.md`        → ["notes.md", "md"]
 *   - `/x/.env.local`      → [".env.local", ".env", "local"]
 *   - `/x/.gitignore`      → [".gitignore"]            (no junk extension)
 *   - `/x/Dockerfile`      → ["dockerfile"]            (extensionless)
 *   - `C:\proj\app.TS`     → ["app.ts", "ts"]          (Windows + case)
 *
 * The dotfile stem (`.env` from `.env.local`) lets a single association on
 * `.env` cover the whole family. A bare extension is only emitted when the
 * dot is not the leading character, so `.gitignore` never yields a
 * spurious `gitignore` "extension".
 */
export function formatLookupKeys(filePath: string): string[] {
  // URLs carry a real query/fragment whose slashes corrupt the basename split
  // (`?next=/tmp/a`), so strip it first (Audit Round B H1). Local paths keep
  // `?`/`#` literal; a trailing `?…`/`#…` on the basename is a marker only when
  // nothing after it has a dot — `?reload=1`/`#anchor` strip, `photo#1.png` keeps `.png`.
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(filePath);
  const stripped = isUrl ? filePath.replace(/[?#].*$/, "") : filePath;
  const slash = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"));
  const base = (slash >= 0 ? stripped.slice(slash + 1) : stripped).replace(/[?#][^.]*$/, "");
  const lower = base.toLowerCase();
  if (!lower) return [];

  const keys: string[] = [lower];

  // Dotfile stem: ".env.local" → ".env" (a single association covers the
  // family). A bare dotfile like ".env" has no second dot, so nothing is
  // added beyond the full name already pushed above.
  if (lower.startsWith(".")) {
    const secondDot = lower.indexOf(".", 1);
    if (secondDot > 0) keys.push(lower.slice(0, secondDot));
  }

  // Bare extension — only when the dot is not the leading character, so
  // leading-dot files (".gitignore") don't produce a junk extension.
  const dot = lower.lastIndexOf(".");
  if (dot > 0 && dot < lower.length - 1) keys.push(lower.slice(dot + 1));

  return [...new Set(keys)];
}

/**
 * The canonical key to persist a user association on for a given file —
 * chosen so a single "Set File Type" override applies to the whole family
 * the user would intuitively expect:
 *
 *   - `notes.txt`   → "txt"        (all plain-text files)
 *   - `.env.local`  → ".env"       (all env files, via the dotfile stem)
 *   - `.gitignore`  → ".gitignore" (the file itself — no real extension)
 *   - `Dockerfile`  → "dockerfile" (extensionless — the filename)
 *
 * Returns null when the path reduces to nothing.
 */
export function associationKey(filePath: string): string | null {
  const keys = formatLookupKeys(filePath);
  if (keys.length === 0) return null;
  // Dotfile stem (".env" from ".env.local") — the most useful family key.
  // The stem (when present) is always at index > 0 and starts with ".", so
  // this returns before the tail logic below.
  const stem = keys.find((k, i) => i > 0 && k.startsWith("."));
  if (stem) return stem;
  // No dotfile stem: the remaining shape is [full] or [full, bareExtension].
  // Prefer the bare extension (covers all files of that type), else the
  // full filename (extensionless / single-dot dotfile).
  return keys.length > 1 ? keys[keys.length - 1] : keys[0];
}
