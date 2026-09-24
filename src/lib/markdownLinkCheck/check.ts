/**
 * Purpose: Async checker that validates local link and image targets
 *   in a markdown document exist on disk. Fragment-only links
 *   (`#anchor`) are handled by the existing `linkFragments` rule;
 *   external URLs — any RFC-3986 scheme (`https:`, `mailto:`,
 *   `obsidian:`, …) or protocol-relative `//host/…` — are skipped.
 *   Windows drive-letter paths (`C:\…`, `C:/…`) are still checked, and
 *   a `/`-rooted path is the filesystem path it names. A UNC `\\host\…`
 *   or drive-relative `C:foo` target is never probed (see
 *   `resolveMarkdownUrl`): touching a network path can leak credentials.
 *
 *   This is a CORRECTNESS check, not style. A broken local link is
 *   a bug — the published doc points at a file that won't load.
 *
 *   Async because each unique target requires a Tauri fs.exists call.
 *   Dedupes by resolved absolute path so each path is checked at
 *   most once per invocation.
 *
 * @coordinates-with src/stores/documentStore/lint.ts — runs on save, merges
 *   results into the same diagnostic gutter as the sync lint engine.
 * @module lib/markdownLinkCheck/check
 */

import { exists } from "@tauri-apps/plugin-fs";
import { visit } from "unist-util-visit";
import {
  createRangeAuthorizer,
  type PositionedNode,
} from "@/utils/markdownPipeline/positionTrust";
import type { Root, Link, Image } from "mdast";
import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { ruleEmission } from "@/lib/lintEngine/ruleMeta";
import {
  createDiagnostic,
  type LintDiagnostic,
} from "@/lib/lintEngine/types";

// Any RFC-3986 scheme (`obsidian:`, `vscode:`, `zotero:`, …) marks an
// external URI — a fixed allowlist produced false M001/M002 on app
// protocols. Windows drive letters ("C:\…", "C:/…") also match the
// scheme shape, so they are carved out explicitly below.
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const processor = createMarkdownProcessor();

/**
 * True for URLs the filesystem check must skip: any scheme'd URI or a
 * protocol-relative (`//host/…`) URL. Windows drive-letter paths return
 * false — they are local paths, not URIs.
 */
export function isExternalUrl(url: string): boolean {
  if (url.startsWith("//")) return true;
  if (WINDOWS_DRIVE_RE.test(url)) return false;
  return SCHEME_RE.test(url);
}

interface ExtractedRef {
  url: string;
  line: number;
  column: number;
  endOffset: number;
  offset: number;
  /** "link" | "image" — surfaced in the diagnostic for clarity. */
  kind: "link" | "image";
}

function extractLocalRefs(mdast: Root): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  // The offsets here address the document a diagnostic points AT, so they must
  // be canonical. `?? 0` meant a node with no offset silently reported the
  // start of the file, and a link inside a `<details>` body carries offsets
  // from the re-parsed substring — well-formed, and pointing at the wrong
  // text. The authorizer knows the ancestry a single node cannot show.
  const authorizer = createRangeAuthorizer(mdast as unknown as PositionedNode);

  const collect = (kind: "link" | "image") => (node: Link | Image) => {
    const url = node.url ?? "";
    if (!url || url.startsWith("#") || isExternalUrl(url)) return;
    const range = authorizer.rangeOf(node as unknown as PositionedNode);
    // No canonical range: skip rather than guess. A missed diagnostic is a gap;
    // one anchored to the wrong span sends the user to unrelated text.
    if (!range || !node.position) return;
    out.push({
      url,
      line: node.position.start.line,
      column: node.position.start.column,
      offset: range.start,
      endOffset: range.end,
      kind,
    });
  };

  visit(mdast, "link", collect("link"));
  visit(mdast, "image", collect("image"));
  return out;
}

/**
 * Split a forward-slashed path into its absolute root and the remainder.
 * Roots are a Windows drive (`C:/`), a UNC share (`//server/share/`) or the
 * POSIX `/`; a relative path has none.
 */
function splitPathRoot(path: string): { root: string; rest: string } | null {
  const drive = /^([A-Za-z]:)\//.exec(path);
  if (drive) return { root: `${drive[1]}/`, rest: path.slice(drive[0].length) };
  const unc = /^\/\/([^/]+)\/([^/]+)(\/|$)/.exec(path);
  if (unc) return { root: `//${unc[1]}/${unc[2]}/`, rest: path.slice(unc[0].length) };
  if (path.startsWith("/")) return { root: "/", rest: path.slice(1) };
  return null;
}

/**
 * Resolve a markdown URL to an absolute, forward-slashed filesystem path.
 *
 * A relative URL resolves against the source file's directory, keeping the
 * source's root — its drive or UNC share on Windows, where dropping it used
 * to yield `/C:/…`. An absolute URL (`/…`, `C:\…`) names that file directly,
 * the same reading the media renderer gives an image `src` (#1448); a
 * `/`-rooted URL in a Windows document lands on that document's drive, as it
 * would for the OS. `..` never climbs above a root.
 *
 * Refused (""): a URL naming a NETWORK host — UNC `\\server\share\…` or
 * protocol-relative `//host/…` — because opening one on Windows goes out over
 * SMB and can hand the user's NTLM credentials to whatever host the document
 * picked; and a drive-relative `C:foo`, which is relative to the process's
 * working directory and means nothing for a document.
 *
 * Strips any `#fragment` suffix, then percent-decodes the path part (so
 * `photo%20one.png` resolves to the file the media renderer loads — see
 * `services/media/resolveMediaSrc.ts`); malformed `%` sequences fall back to
 * the raw path. Returns "" for an empty path, or a relative one with no
 * source document to resolve against.
 */
export function resolveMarkdownUrl(
  url: string,
  sourcePath: string | null,
): string {
  // Strip fragment, then decode the path part. Decoding after the
  // fragment split keeps an encoded `%23` inside the path from being
  // mistaken for a fragment delimiter.
  const hashIdx = url.indexOf("#");
  const pathPart = decodeMarkdownUrl(
    hashIdx >= 0 ? url.slice(0, hashIdx) : url,
  );
  if (!pathPart) return "";

  const target = pathPart.replace(/\\/g, "/");
  if (target.startsWith("//") || /^[A-Za-z]:(?!\/)/.test(target)) return "";
  const source = sourcePath ? splitPathRoot(sourcePath.replace(/\\/g, "/")) : null;
  const absolute = splitPathRoot(target);

  let root: string;
  let rest: string;
  if (absolute) {
    root = absolute.root === "/" && source ? source.root : absolute.root;
    rest = absolute.rest;
  } else {
    if (!source) return "";
    root = source.root;
    const dirEnd = source.rest.lastIndexOf("/");
    rest = `${dirEnd >= 0 ? source.rest.slice(0, dirEnd) : ""}/${target}`;
  }

  const stack: string[] = [];
  for (const seg of rest.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return root + stack.join("/");
}

/**
 * Check every local link and image target against the filesystem.
 * Returns LintDiagnostic[] for missing targets. Empty array when
 * `sourcePath` is null (untitled document — nothing to resolve
 * relative paths against).
 */
export async function checkLocalLinks(
  source: string,
  sourcePath: string | null,
): Promise<LintDiagnostic[]> {
  if (!sourcePath || !source.trim()) return [];

  let mdast: Root;
  try {
    mdast = processor.parse(source) as Root;
    mdast = processor.runSync(mdast) as Root;
  } catch {
    return [];
  }

  const refs = extractLocalRefs(mdast);
  if (refs.length === 0) return [];

  // Dedupe by resolved absolute path.
  const pathToRefs = new Map<string, ExtractedRef[]>();
  for (const ref of refs) {
    const abs = resolveMarkdownUrl(ref.url, sourcePath);
    if (!abs) continue;
    const list = pathToRefs.get(abs) ?? [];
    list.push(ref);
    pathToRefs.set(abs, list);
  }

  const checks = await Promise.all(
    [...pathToRefs.keys()].map(async (abs) => {
      try {
        return { abs, status: (await exists(abs)) ? "ok" : "missing" } as const;
      } catch {
        // Codex audit MED-5: a thrown exists() call is an operational
        // failure (permission denied, capability scope error, transient
        // I/O), not proof that the file is missing. Distinguish so we
        // don't surface false-positive "not found" diagnostics.
        return { abs, status: "error" } as const;
      }
    }),
  );

  const diagnostics: LintDiagnostic[] = [];
  for (const { abs, status } of checks) {
    // Skip the diagnostic on operational error — better silent than
    // a wrong claim. The error path is rare enough that surfacing
    // it as a user-visible warning would create more noise than signal.
    if (status === "ok" || status === "error") continue;
    const refs = pathToRefs.get(abs) ?? [];
    for (const r of refs) {
      diagnostics.push(
        createDiagnostic({
          ...ruleEmission(r.kind === "image" ? "M001" : "M002"),
          line: r.line,
          column: r.column,
          offset: r.offset,
          endOffset: r.endOffset,
          messageKey:
            r.kind === "image"
              ? "lint.imageNotFound"
              : "lint.linkNotFound",
          messageParams: { path: r.url },
          uiHint: "exact",
        }),
      );
    }
  }
  return diagnostics;
}
