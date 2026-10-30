import { guideSidebar } from "./guideSidebar";

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
      "/de/guide/": guideSidebar("/de", {
        sections: { guide: "Anleitung", usersAsDevelopers: "Benutzer als Entwickler" },
        pages: {
          "": "Erste Schritte",
          "formats": "Unterstützte Formate",
          "features": "Funktionen",
          "large-files": "Große Dateien",
          "export": "Export und Drucken",
          "shortcuts": "Tastaturkürzel",
          "tab-navigation": "Intelligente Tab-Navigation",
          "multi-cursor": "Mehrfachcursor-Bearbeitung",
          "popups": "Inline-Popups",
          "mermaid": "Mermaid-Diagramme",
          "graphviz": "Graphviz-Diagramme",
          "markmap": "Markmap-Mindmaps",
          "workflow-viewer": "GitHub Actions Workflow-Viewer",
          "svg": "SVG-Grafiken",
          "media-support": "Medien (Video/Audio)",
          "cloud-images": "In der Cloud gehostete Bilder",
          "terminal": "Integriertes Terminal",
          "browser": "Integrierter Browser",
          "knowledge-base": "Wissensdatenbank & Slidev",
          "workspace-management": "Arbeitsbereichsverwaltung",
          "workspace-rail": "Workspace-Leiste",
          "cjk-formatting": "CJK-Formatierung",
          "ai-genies": "AI Genies",
          "coherence": "Kohärenz-Aufschlüsselung",
          "workflows": "Genie-Workflows",
          "workflow-genies": "Workflow-Genies",
          "ai-providers": "KI-Anbieter",
          "mcp-setup": "MCP-Einrichtung",
          "mcp-tools": "MCP-Tools-Referenz",
          "edit-history-git": "Bearbeitungsverlauf in Git",
          "lint": "Markdown-Lint",
          "link-check": "Link-Prüfung",
          "settings": "Einstellungen",
          "troubleshooting": "Fehlerbehebung",
          "privacy": "Datenschutz",
          "license": "Lizenz",
          "users-as-developers/": "Übersicht",
          "users-as-developers/why-i-built-vmark": "Warum ich VMark entwickelt habe",
          "users-as-developers/what-are-indispensable": "Fünf Fähigkeiten, die KI nicht ersetzen kann",
          "users-as-developers/why-expensive-models-are-cheaper": "Warum teure Modelle günstiger sind",
          "users-as-developers/subscription-vs-api": "Abonnement vs API-Preise",
          "users-as-developers/prompt-refinement": "Englische Prompts funktionieren besser",
          "users-as-developers/cross-model-verification": "Modellübergreifende Verifizierung",
          "users-as-developers/why-issues-not-prs": "Warum Issues statt PRs",
          "users-as-developers/cost-evaluation": "Kosten- und Aufwandsanalyse",
          "users-as-developers/plugins-as-infrastructure": "Plugins als Infrastruktur",
        },
      }),
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
