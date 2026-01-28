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
            { text: 'Keyboard Shortcuts', link: '/guide/shortcuts' },
            { text: 'Multi-Cursor Editing', link: '/guide/multi-cursor' },
            { text: 'Inline Popups', link: '/guide/popups' },
            { text: 'Mermaid Diagrams', link: '/guide/mermaid' },
            { text: 'CJK Formatting', link: '/guide/cjk-formatting' },
          ]
        },
        {
          text: 'AI Integration',
          items: [
            { text: 'MCP Setup', link: '/guide/mcp-setup' },
            { text: 'MCP Tools Reference', link: '/guide/mcp-tools' },
            { text: 'Claude Code Skill', link: '/guide/claude-code-skill' },
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
