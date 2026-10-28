import { guideSidebar } from "./guideSidebar";

export const en = {
  label: "English",
  lang: "en",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Download", link: "/download" },
      { text: "Guide", link: "/guide/" },
      { text: "Blog", link: "/blog/" },
    ],

    sidebar: {
      "/blog/": [
        {
          text: "Blog",
          items: [
            { text: "All posts", link: "/blog/" },
            {
              text: "VMark speaks your language (2026-06)",
              link: "/blog/2026-06-i18n-launch",
            },
            {
              text: "Multi-format launch (2026-05)",
              link: "/blog/2026-05-multi-format-launch",
            },
          ],
        },
      ],
      "/guide/": guideSidebar("", {
        sections: { guide: "Guide", usersAsDevelopers: "Users as Developers" },
        pages: {
          "": "Getting Started",
          "formats": "Supported Formats",
          "features": "Features",
          "large-files": "Large Files",
          "export": "Export & Print",
          "shortcuts": "Keyboard Shortcuts",
          "tab-navigation": "Smart Tab Navigation",
          "multi-cursor": "Multi-Cursor Editing",
          "popups": "Inline Popups",
          "mermaid": "Mermaid Diagrams",
          "graphviz": "Graphviz Diagrams",
          "markmap": "Markmap Mindmaps",
          "workflow-viewer": "GitHub Actions Workflow Viewer",
          "svg": "SVG Graphics",
          "media-support": "Media (Video/Audio)",
          "cloud-images": "Cloud-hosted Images",
          "terminal": "Integrated Terminal",
          "browser": "Embedded Browser",
          "knowledge-base": "Knowledge Base & Slidev",
          "workspace-management": "Workspace Management",
          "workspace-rail": "Workspace Rail",
          "cjk-formatting": "CJK Formatting",
          "ai-genies": "AI Genies",
          "coherence": "Coherence & Breakdown View",
          "workflows": "Genie Workflows",
          "workflow-genies": "Workflow Genies",
          "ai-providers": "AI Providers",
          "mcp-setup": "MCP Setup",
          "mcp-tools": "MCP Tools Reference",
          "edit-history-git": "Edit History in Git",
          "lint": "Markdown Lint",
          "link-check": "Link Check",
          "settings": "Settings",
          "troubleshooting": "Troubleshooting",
          "privacy": "Privacy",
          "license": "License",
          "users-as-developers/": "Overview",
          "users-as-developers/why-i-built-vmark": "Why I Built VMark",
          "users-as-developers/what-are-indispensable": "Five Skills AI Can't Replace",
          "users-as-developers/why-expensive-models-are-cheaper": "Why Expensive Models Are Cheaper",
          "users-as-developers/subscription-vs-api": "Subscription vs API Pricing",
          "users-as-developers/prompt-refinement": "English Prompts Work Better",
          "users-as-developers/cross-model-verification": "Cross-Model Verification",
          "users-as-developers/why-issues-not-prs": "Why Issues, Not PRs",
          "users-as-developers/cost-evaluation": "Cost & Effort Evaluation",
          "users-as-developers/plugins-as-infrastructure": "Plugins as Infrastructure",
        },
      }),
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/guide/license">ISC License</a>',
    },

    search: {
      provider: "local" as const,
    },

    lastUpdated: {
      text: "Updated at",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },
  },
};
