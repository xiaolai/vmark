

export const de = {
  label: "Deutsch",
  lang: "de",
  themeConfig: {
    nav: [
      { text: "Startseite", link: "/de/" },
      { text: "Herunterladen", link: "/de/download" },
      { text: "Anleitung", link: "/de/guide/" },
      { text: "Blog", link: "/blog/" },
    ],

    sidebar: {
      "/de/guide/": [
        {
          text: "Anleitung",
          items: [
            { text: "Erste Schritte", link: "/de/guide/" },
            { text: "Funktionen", link: "/de/guide/features" },
            { text: "Große Dateien", link: "/de/guide/large-files" },
            {
              text: "Export und Drucken",
              link: "/de/guide/export",
            },
            {
              text: "Tastaturkürzel",
              link: "/de/guide/shortcuts",
            },
            {
              text: "Intelligente Tab-Navigation",
              link: "/de/guide/tab-navigation",
            },
            {
              text: "Mehrfachcursor-Bearbeitung",
              link: "/de/guide/multi-cursor",
            },
            {
              text: "Inline-Popups",
              link: "/de/guide/popups",
            },
            {
              text: "Mermaid-Diagramme",
              link: "/de/guide/mermaid",
            },
            {
              text: "Markmap-Mindmaps",
              link: "/de/guide/markmap",
            },
            {
              text: "GitHub Actions Workflow-Viewer",
              link: "/de/guide/workflow-viewer",
            },
            { text: "SVG-Grafiken", link: "/de/guide/svg" },
            {
              text: "Medien (Video/Audio)",
              link: "/de/guide/media-support",
            },
            {
              text: "Integriertes Terminal",
              link: "/de/guide/terminal",
            },
            {
              text: "Arbeitsbereichsverwaltung",
              link: "/de/guide/workspace-management",
            },
            {
              text: "CJK-Formatierung",
              link: "/de/guide/cjk-formatting",
            },
            { text: "AI Genies", link: "/de/guide/ai-genies" },
            {
              text: "Workflow-Genies",
              link: "/de/guide/workflow-genies",
            },
            {
              text: "KI-Anbieter",
              link: "/de/guide/ai-providers",
            },
            {
              text: "MCP-Einrichtung",
              link: "/de/guide/mcp-setup",
            },
            {
              text: "MCP-Tools-Referenz",
              link: "/de/guide/mcp-tools",
            },
            { text: "Markdown-Lint", link: "/de/guide/lint" },
            { text: "Link-Prüfung", link: "/de/guide/link-check" },
            { text: "Einstellungen", link: "/de/guide/settings" },
            { text: "Fehlerbehebung", link: "/de/guide/troubleshooting" },
            { text: "Datenschutz", link: "/de/guide/privacy" },
            { text: "Lizenz", link: "/de/guide/license" },
          ],
        },
        {
          text: "Benutzer als Entwickler",
          items: [
            {
              text: "Übersicht",
              link: "/de/guide/users-as-developers/",
            },
            {
              text: "Warum ich VMark entwickelt habe",
              link: "/de/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "Fünf Fähigkeiten, die KI nicht ersetzen kann",
              link: "/de/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "Warum teure Modelle günstiger sind",
              link: "/de/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "Abonnement vs API-Preise",
              link: "/de/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "Englische Prompts funktionieren besser",
              link: "/de/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "Modellübergreifende Verifizierung",
              link: "/de/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "Warum Issues statt PRs",
              link: "/de/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "Kosten- und Aufwandsanalyse",
              link: "/de/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "Plugins als Infrastruktur",
              link: "/de/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/de/guide/license">ISC-Lizenz</a>',
    },

    lastUpdated: {
      text: "Aktualisiert am",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "Auf dieser Seite",
    },

    docFooter: {
      prev: "Zurück",
      next: "Weiter",
    },

    sidebarMenuLabel: "Menü",
    returnToTopLabel: "Nach oben",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          de: {
            translations: {
              button: {
                buttonText: "Suchen",
                buttonAriaLabel: "Dokumentation durchsuchen",
              },
              modal: {
                noResultsText: "Keine Ergebnisse gefunden",
                resetButtonTitle: "Suche zurücksetzen",
                displayDetails: "Details anzeigen",
                footer: {
                  selectText: "Auswählen",
                  navigateText: "Navigieren",
                  closeText: "Schließen",
                },
              },
            },
          },
        },
      },
    },
  },
};
