

export const en = {
  label: "English",
  lang: "en",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Download", link: "/download" },
      { text: "Guide", link: "/guide/" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started", link: "/guide/" },
            { text: "Features", link: "/guide/features" },
            { text: "Large Files", link: "/guide/large-files" },
            { text: "Export & Print", link: "/guide/export" },
            { text: "Keyboard Shortcuts", link: "/guide/shortcuts" },
            { text: "Smart Tab Navigation", link: "/guide/tab-navigation" },
            { text: "Multi-Cursor Editing", link: "/guide/multi-cursor" },
            { text: "Inline Popups", link: "/guide/popups" },
            { text: "Mermaid Diagrams", link: "/guide/mermaid" },
            { text: "Markmap Mindmaps", link: "/guide/markmap" },
            { text: "GitHub Actions Workflow Viewer", link: "/guide/workflow-viewer" },
            { text: "SVG Graphics", link: "/guide/svg" },
            { text: "Media (Video/Audio)", link: "/guide/media-support" },
            { text: "Integrated Terminal", link: "/guide/terminal" },
            { text: "Workspace Management", link: "/guide/workspace-management" },
            { text: "CJK Formatting", link: "/guide/cjk-formatting" },
            { text: "AI Genies", link: "/guide/ai-genies" },
            { text: "AI Providers", link: "/guide/ai-providers" },
            { text: "MCP Setup", link: "/guide/mcp-setup" },
            { text: "MCP Tools Reference", link: "/guide/mcp-tools" },
            { text: "Settings", link: "/guide/settings" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
            { text: "Privacy", link: "/guide/privacy" },
            { text: "License", link: "/guide/license" },
          ],
        },
        {
          text: "Users as Developers",
          items: [
            { text: "Overview", link: "/guide/users-as-developers/" },
            { text: "Why I Built VMark", link: "/guide/users-as-developers/why-i-built-vmark" },
            { text: "Five Skills AI Can't Replace", link: "/guide/users-as-developers/what-are-indispensable" },
            { text: "Why Expensive Models Are Cheaper", link: "/guide/users-as-developers/why-expensive-models-are-cheaper" },
            { text: "Subscription vs API Pricing", link: "/guide/users-as-developers/subscription-vs-api" },
            { text: "English Prompts Work Better", link: "/guide/users-as-developers/prompt-refinement" },
            { text: "Cross-Model Verification", link: "/guide/users-as-developers/cross-model-verification" },
            { text: "Why Issues, Not PRs", link: "/guide/users-as-developers/why-issues-not-prs" },
            { text: "Cost & Effort Evaluation", link: "/guide/users-as-developers/cost-evaluation" },
            { text: "Plugins as Infrastructure", link: "/guide/users-as-developers/plugins-as-infrastructure" },
          ],
        },
      ],
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
