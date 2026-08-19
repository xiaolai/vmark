/**
 * Wikipedia site plugin (WI-NB4.3) — the registry's first production
 * registration, so `registerSite`/`dispatchSite`/`readerForUrl` run in anger
 * rather than only in tests.
 *
 * Purpose: read a Wikipedia article as clean Markdown. The generic reader
 * mostly works on Wikipedia; what a site reader adds is knowing the wiki
 * chrome by NAME — infoboxes, navboxes, hatnotes, the TOC, edit-section links,
 * reference markers — so the extraction is deterministic instead of relying on
 * the density heuristic to guess right per article.
 *
 * `match` claims the ARTICLE namespace only (`/wiki/<title>` without a `Ns:`
 * prefix); special pages, talk pages, and the bare host fall through to the
 * generic reader by design — declining is how a site reader stays honest about
 * what it has fixtures for.
 *
 * @coordinates-with lib/sites/registry.ts — registered via builtins.ts
 * @coordinates-with lib/browser/reader/reader.ts — the readPage backend
 * @module lib/sites/wikipedia/wikipedia
 */

import { readPage, type ReaderResult } from "@/lib/browser/reader/reader";
import type { SiteReader } from "@/lib/browser/reader/siteReader";
import type { SiteManifest } from "../types";

export const wikipediaSite: SiteManifest = {
  id: "wikipedia",
  nameI18nKey: "sites.wikipedia.name",
  origins: ["https://*.wikipedia.org", "https://wikipedia.org"],
  capabilities: ["read"],
  minAgentApi: 1,
};

/** Wiki chrome that must never reach the Markdown, addressed by name. */
const WIKI_NOISE = [
  ".infobox",
  ".navbox",
  ".sidebar",
  ".hatnote",
  ".mw-editsection",
  ".mw-jump-link",
  "#toc",
  ".toc",
  "sup.reference",
  ".reflist",
  ".mw-references-wrap",
  "table.metadata",
  ".ambox",
  "#mw-navigation",
  "#footer",
].join(", ");

function isArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!(u.hostname === "wikipedia.org" || u.hostname.endsWith(".wikipedia.org"))) return false;
    if (!u.pathname.startsWith("/wiki/")) return false;
    const title = decodeURIComponent(u.pathname.slice("/wiki/".length));
    // Namespaced pages (Special:, Talk:, File:, …) are not articles.
    return title.length > 0 && !title.includes(":");
  } catch {
    return false;
  }
}

export const wikipediaReader: SiteReader = {
  id: "wikipedia",
  match: isArticleUrl,
  read: (html: string, url: string): ReaderResult => {
    // Strip the chrome BEFORE the generic pass, so the density heuristic and the
    // Markdown serializer only ever see article content.
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    doc.querySelectorAll(WIKI_NOISE).forEach((el) => el.remove());
    const body = doc.documentElement ? doc.documentElement.outerHTML : "";
    return readPage(body, url);
  },
};
