/**
 * Wiki Links — Remark Plugin
 *
 * Purpose: Parses Obsidian-style wiki links ([[Page]] and [[Page|Alias]])
 * into WikiLink MDAST nodes and serializes them back to `[[...]]` syntax.
 *
 * Key decisions:
 *   - Uses mdast-util-find-and-replace for pattern matching (handles node boundaries)
 *   - Negative lookbehind `(?<!!)` prevents matching embeds `![[...]]`
 *   - Ignores links, code, math, HTML, and YAML nodes to avoid false matches
 *   - Pipe character `|` separates target from alias: [[target|display text]]
 *   - Empty targets after trimming return null (invalid wiki link)
 *
 * @coordinates-with markdownLinkPatterns.ts — WIKI_LINK_REGEX for source mode detection
 * @coordinates-with markdownArtifacts/wikiLink.ts — PM node definition for wiki links
 * @module utils/markdownPipeline/plugins/wikiLinks
 */

import type { Root } from "mdast";
import type { Plugin } from "unified";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { WikiLink } from "../types";

interface FromMarkdownExtension {
  transforms?: Array<(tree: Root) => void>;
}

interface ToMarkdownExtension {
  handlers?: Record<string, WikiHandler>;
}

type WikiHandler = (
  node: WikiLink,
  parent: unknown,
  state: WikiHandlerState,
  info: { before: string; after: string }
) => string;

interface WikiHandlerState {
  enter: (constructName: string) => () => void;
  createTracker: (info: { before: string; after: string }) => {
    move: (value: string) => string;
    current: () => { before: string; after: string };
  };
}

// Only match wiki links [[...]], not embeds ![[...]]
const WIKI_LINK_PATTERN = /(?<!!)\[\[([^\]]+?)\]\]/g;
const IGNORE_NODES = ["link", "linkReference", "definition", "inlineCode", "code", "math", "inlineMath", "yaml", "html"] as const;

export const remarkWikiLinks: Plugin<[], Root> = function () {
  const data = this.data() as {
    fromMarkdownExtensions?: FromMarkdownExtension[];
    toMarkdownExtensions?: ToMarkdownExtension[];
  };

  data.fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];
  data.toMarkdownExtensions = data.toMarkdownExtensions ?? [];

  data.fromMarkdownExtensions.push({ transforms: [transformWikiLinks] });
  data.toMarkdownExtensions.push({ handlers: { wikiLink: wikiLinkHandler } });
};

function transformWikiLinks(tree: Root): void {
  findAndReplace(
    tree,
    [
      [WIKI_LINK_PATTERN, (_value: string, inner: string) => {
        const parsed = parseWikiTarget(inner);
        if (!parsed) return false;

        return { type: "wikiLink", value: parsed.value, alias: parsed.alias } as WikiLink;
      }],
    ],
    { ignore: IGNORE_NODES }
  );
}

function parseWikiTarget(raw: string): { value: string; alias?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const pipeIndex = trimmed.indexOf("|");
  if (pipeIndex === -1) {
    return { value: trimmed };
  }

  const value = trimmed.slice(0, pipeIndex).trim();
  const alias = trimmed.slice(pipeIndex + 1).trim();

  if (!value) return null;
  return alias ? { value, alias } : { value };
}

function buildWikiTarget(node: WikiLink): string {
  const alias = node.alias ? `|${node.alias}` : "";
  return `${node.value}${alias}`;
}

function wikiLinkHandler(
  node: WikiLink,
  _parent: unknown,
  state: WikiHandlerState,
  info: { before: string; after: string }
): string {
  const exit = state.enter("wikiLink");
  const tracker = state.createTracker(info);
  const value = tracker.move(`[[${buildWikiTarget(node)}]]`);
  exit();
  return value;
}
