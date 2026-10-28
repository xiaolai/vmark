/**
 * Purpose: the guide sidebar's pages — ONE ordered list every locale builds
 * from. Each locale config supplies only labels.
 *
 * The routes used to be written out by hand in ten locale configs, and
 * VitePress builds happily with a page missing from a sidebar: the same five
 * guide pages sat unlisted in every translation. A page added here appears in
 * every locale, and a locale that has no label for it fails at config load
 * rather than silently dropping it.
 *
 * @coordinates-with website/.vitepress/config/sidebarParity.test.ts — pins the builder and every locale
 * @module website/.vitepress/config/guideSidebar
 */

/** Guide pages in sidebar order, relative to `<locale>/guide/`; a trailing `/` is a directory index. */
const GUIDE_SECTIONS = {
  guide: [
    "",
    "formats",
    "features",
    "large-files",
    "export",
    "shortcuts",
    "tab-navigation",
    "multi-cursor",
    "popups",
    "mermaid",
    "graphviz",
    "markmap",
    "workflow-viewer",
    "svg",
    "media-support",
    "cloud-images",
    "terminal",
    "browser",
    "knowledge-base",
    "workspace-management",
    "workspace-rail",
    "cjk-formatting",
    "ai-genies",
    "coherence",
    "workflows",
    "workflow-genies",
    "ai-providers",
    "mcp-setup",
    "mcp-tools",
    "edit-history-git",
    "lint",
    "link-check",
    "settings",
    "troubleshooting",
    "privacy",
    "license",
  ],
  usersAsDevelopers: [
    "users-as-developers/",
    "users-as-developers/why-i-built-vmark",
    "users-as-developers/what-are-indispensable",
    "users-as-developers/why-expensive-models-are-cheaper",
    "users-as-developers/subscription-vs-api",
    "users-as-developers/prompt-refinement",
    "users-as-developers/cross-model-verification",
    "users-as-developers/why-issues-not-prs",
    "users-as-developers/cost-evaluation",
    "users-as-developers/plugins-as-infrastructure",
  ],
} as const;

type GuideSection = keyof typeof GUIDE_SECTIONS;
export type GuidePage = (typeof GUIDE_SECTIONS)[GuideSection][number];
export const GUIDE_PAGES: readonly GuidePage[] = [...GUIDE_SECTIONS.guide, ...GUIDE_SECTIONS.usersAsDevelopers];

/** One locale's labels: a title per section and a link text per page. */
export interface GuideLabels {
  sections: Record<GuideSection, string>;
  pages: Record<GuidePage, string>;
}

/**
 * The `<prefix>/guide/` sidebar for one locale (`""` for English, `"/ja"`…).
 * THROWS on a page with no label or a label for no page: the first is a page
 * the locale would silently drop, the second a page that was removed or renamed.
 */
export function guideSidebar(prefix: string, labels: GuideLabels) {
  const pages: Record<string, string> = labels.pages;
  for (const page of GUIDE_PAGES) {
    if (typeof pages[page] !== "string" || pages[page].trim() === "") throw new Error(`${prefix || "/"}: no sidebar label for guide page "${page}"`);
  }
  for (const page of Object.keys(pages)) {
    if (!(GUIDE_PAGES as readonly string[]).includes(page)) throw new Error(`${prefix || "/"}: sidebar label for "${page}", which is not a guide page`);
  }
  return (Object.keys(GUIDE_SECTIONS) as GuideSection[]).map((section) => ({
    text: labels.sections[section],
    items: GUIDE_SECTIONS[section].map((page) => ({ text: pages[page], link: `${prefix}/guide/${page}` })),
  }));
}
