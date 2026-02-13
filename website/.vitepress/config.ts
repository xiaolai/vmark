import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'VMark',
  description: 'AI friendly markdown editor',
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#4a6fa5' }],
    ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }],
  ],

  appearance: false, // We use our own theme switcher

  themeConfig: {

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Download', link: '/download' },
      { text: 'Guide', link: '/guide/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/' },
            { text: 'Features', link: '/guide/features' },
            { text: 'Export & Print', link: '/guide/export' },
            { text: 'Keyboard Shortcuts', link: '/guide/shortcuts' },
            { text: 'Smart Tab Navigation', link: '/guide/tab-navigation' },
            { text: 'Multi-Cursor Editing', link: '/guide/multi-cursor' },
            { text: 'Inline Popups', link: '/guide/popups' },
            { text: 'Mermaid Diagrams', link: '/guide/mermaid' },
            { text: 'Markmap Mindmaps', link: '/guide/markmap' },
            { text: 'SVG Graphics', link: '/guide/svg' },
            { text: 'Integrated Terminal', link: '/guide/terminal' },
            { text: 'CJK Formatting', link: '/guide/cjk-formatting' },
          ]
        },
        {
          text: 'AI Integration',
          items: [
            { text: 'AI Genies', link: '/guide/ai-genies' },
            { text: 'AI Providers', link: '/guide/ai-providers' },
            { text: 'MCP Setup', link: '/guide/mcp-setup' },
            { text: 'MCP Tools Reference', link: '/guide/mcp-tools' },
            {
              text: 'Users as Developers',
              link: '/guide/users-as-developers/',
              items: [
                { text: 'Cross-Model Verification', link: '/guide/users-as-developers/cross-model-verification' },
                { text: 'Prompt Refinement', link: '/guide/users-as-developers/prompt-refinement' },
                { text: 'Subscription vs API', link: '/guide/users-as-developers/subscription-vs-api' },
              ]
            },
          ]
        }
      ]
    },

    footer: {
      copyright: 'Copyright © 2026 VMark'
    },

    search: {
      provider: 'local'
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    }
  }
})
