/**
 * Purpose: Async checker that validates local link and image targets
 *   in a markdown document exist on disk. Fragment-only links
 *   (`#anchor`) are handled by the existing `linkFragments` rule;
 *   external URLs (`http://`, `https://`, `mailto:`, `tel:`,
 *   `ftp:`) are skipped.
 *
 *   This is a CORRECTNESS check, not style. A broken local link is
 *   a bug — the published doc points at a file that won't load.
 *
 *   Async because each unique target requires a Tauri fs.exists call.
 *   Dedupes by resolved absolute path so each path is checked at
 *   most once per invocation.
 *
 * @coordinates-with src/stores/lintStore.ts — runs on save, merges
 *   results into the same diagnostic gutter as the sync lint engine.
 * @module lib/markdownLinkCheck/check
 */

import { exists } from "@tauri-apps/plugin-fs";
import { visit } from "unist-util-visit";
import type { Root, Link, Image } from "mdast";
import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser";
import {
  createDiagnostic,
  type LintDiagnostic,
} from "@/lib/lintEngine/types";

const SCHEME_RE = /^(https?|ftp|mailto|tel|data|file):/i;
const processor = createMarkdownProcessor();

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
  visit(mdast, "link", (node: Link) => {
    if (!node.position) return;
    const url = node.url ?? "";
    if (!url || url.startsWith("#") || SCHEME_RE.test(url)) return;
    out.push({
      url,
      line: node.position.start.line,
      column: node.position.start.column,
      offset: node.position.start.offset ?? 0,
      endOffset: node.position.end.offset ?? 0,
      kind: "link",
    });
  });
  visit(mdast, "image", (node: Image) => {
    if (!node.position) return;
    const url = node.url ?? "";
    if (!url || url.startsWith("#") || SCHEME_RE.test(url)) return;
    out.push({
      url,
      line: node.position.start.line,
      column: node.position.start.column,
      offset: node.position.start.offset ?? 0,
      endOffset: node.position.end.offset ?? 0,
      kind: "image",
    });
  });
  return out;
}

/**
 * Resolve a markdown URL against the source file's directory.
 * Handles `./`, `../`, and `/`-rooted paths. Returns POSIX absolute
 * path. Strips any `#fragment` suffix before resolution.
 */
export function resolveMarkdownUrl(
  url: string,
  sourcePath: string,
): string {
  // Strip fragment.
  const hashIdx = url.indexOf("#");
  const pathPart = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  if (!pathPart) return "";

  const sourceNorm = sourcePath.replace(/\\/g, "/");
  const baseDir = sourceNorm.slice(0, sourceNorm.lastIndexOf("/"));

  // `/`-rooted: GitHub-flavored "absolute within repo" — without a
  // workspace-root concept we treat as relative to file's directory
  // (best-effort; safer than walking outside the dir).
  let rel = pathPart.replace(/\\/g, "/");
  if (rel.startsWith("/")) rel = rel.slice(1);
  if (rel.startsWith("./")) rel = rel.slice(2);

  const segments = (baseDir + "/" + rel).split("/").filter(Boolean);
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (stack.length === 0) continue;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return "/" + stack.join("/");
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
          ruleId: r.kind === "image" ? "M001" : "M002",
          severity: "error",
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
