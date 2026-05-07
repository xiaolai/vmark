import footnote from "markdown-it-footnote";
import { vitepressMarkmapPreview } from "vitepress-markmap-preview";
import type { UserConfig } from "vitepress";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../../package.json"), "utf-8")
);

export const shared: UserConfig = {
  title: "VMark",
  description: "The plain-text workspace where humans and AI collaborate",

  vite: {
    define: {
      __VMARK_VERSION__: JSON.stringify(pkg.version),
    },
  },
  lastUpdated: true,
  appearance: false, // We use our own theme switcher

  markdown: {
    config: (md: any) => {
      md.use(footnote);
      vitepressMarkmapPreview(md);
    },
  },

  head: [
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
    ["meta", { name: "theme-color", content: "#4a6fa5" }],
    ["meta", { name: "mobile-web-app-capable", content: "yes" }],
    [
      "meta",
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
    ],
  ],

  mermaid: {
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  },
};
