/**
 * Per-document reference extraction (Phase 2, WI-2.3/2.2).
 *
 * Parses a markdown string with VMark's pipeline plugins and collects the
 * references that feed the relationship graph: wiki-links, local markdown
 * links, inline `#tags`, and typed frontmatter relations.
 *
 * @module index/extract
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import { remarkWikiLinks } from "@vmark/markdown-plugins";
import type { DocRefs } from "./types";

/** Frontmatter keys treated as typed relations (plan §7 default set). */
const RELATION_KEYS = ["related", "up", "links", "down", "next", "prev"];

const INLINE_TAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;

function isLocalLink(href: string): boolean {
  if (!href) return false;
  if (/^[a-z]+:/i.test(href)) return false; // scheme → external (http:, mailto:, etc.)
  if (href.startsWith("#")) return false; // pure fragment
  if (href.startsWith("//")) return false; // protocol-relative
  return true;
}

function normalizeTag(raw: string): string {
  return raw.replace(/^#/, "").normalize("NFC").toLowerCase();
}

/** Coerce a frontmatter value into a flat list of string targets. */
function toList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toList);
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [];
}

/** Extract references + frontmatter metadata from one markdown document. */
export function extractRefs(markdown: string): DocRefs {
  const refs: DocRefs = {
    wikiTargets: [],
    localLinks: [],
    tags: [],
    relations: {},
  };

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks);
  const tree = processor.runSync(processor.parse(markdown));

  const tagSet = new Set<string>();

  visit(tree, (raw) => {
    const node = raw as unknown as { type: string; [k: string]: unknown };
    if (node.type === "wikiLink") {
      // strip alias; keep `target` (may carry #anchor, resolved later)
      const value = String(node.value ?? "");
      refs.wikiTargets.push(value.split("|")[0].trim());
    } else if (node.type === "link") {
      const href = String(node.url ?? "");
      if (isLocalLink(href)) refs.localLinks.push(href);
    } else if (node.type === "text") {
      const text = String(node.value ?? "");
      for (const m of text.matchAll(INLINE_TAG)) tagSet.add(normalizeTag(m[2]));
    } else if (node.type === "yaml") {
      const raw = String(node.value ?? "");
      try {
        // grill M8 — cap alias expansion so a YAML "billion laughs" in one
        // file can't stall the (serial) index rebuild.
        const fm = parseYaml(raw, { maxAliasCount: 100 }) as Record<string, unknown> | null;
        if (fm && typeof fm === "object") {
          if (typeof fm.title === "string") refs.title = fm.title;
          for (const t of toList(fm.tags)) tagSet.add(normalizeTag(t));
          for (const key of RELATION_KEYS) {
            const list = toList(fm[key]);
            if (list.length) refs.relations[key] = list;
          }
        }
      } catch {
        // malformed frontmatter → ignore metadata, body still indexes
      }
    }
  });

  refs.tags = [...tagSet].sort();
  return refs;
}
