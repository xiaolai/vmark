import { guideSidebar } from "./guideSidebar";

export const it = {
  label: "Italiano",
  lang: "it",
  themeConfig: {
    nav: [
      { text: "Home", link: "/it/" },
      { text: "Scarica", link: "/it/download" },
      { text: "Guida", link: "/it/guide/" },
      { text: "Blog", link: "/blog/" },
    ],

    sidebar: {
      "/it/guide/": guideSidebar("/it", {
        sections: { guide: "Guida", usersAsDevelopers: "Utenti come sviluppatori" },
        pages: {
          "": "Per iniziare",
          "formats": "Formati Supportati",
          "features": "Funzionalità",
          "large-files": "File di grandi dimensioni",
          "export": "Esportazione e stampa",
          "shortcuts": "Scorciatoie da tastiera",
          "tab-navigation": "Navigazione intelligente tra schede",
          "multi-cursor": "Modifica multicursore",
          "popups": "Popup in linea",
          "mermaid": "Diagrammi Mermaid",
          "graphviz": "Diagrammi Graphviz",
          "markmap": "Mappe mentali Markmap",
          "workflow-viewer": "Visualizzatore workflow GitHub Actions",
          "svg": "Grafica SVG",
          "media-support": "Media (video/audio)",
          "cloud-images": "Immagini ospitate nel cloud",
          "terminal": "Terminale integrato",
          "browser": "Browser integrato",
          "knowledge-base": "Base di conoscenza e Slidev",
          "workspace-management": "Gestione workspace",
          "workspace-rail": "Barra degli spazi di lavoro",
          "cjk-formatting": "Formattazione CJK",
          "ai-genies": "AI Genies",
          "coherence": "Coerenza e vista di dettaglio",
          "workflows": "Flussi di lavoro Genie",
          "workflow-genies": "Genie del workflow",
          "ai-providers": "Provider di IA",
          "mcp-setup": "Configurazione MCP",
          "mcp-tools": "Riferimento strumenti MCP",
          "edit-history-git": "Cronologia modifiche in Git",
          "lint": "Lint Markdown",
          "link-check": "Controllo collegamenti",
          "settings": "Impostazioni",
          "troubleshooting": "Risoluzione dei problemi",
          "privacy": "Privacy",
          "license": "Licenza",
          "users-as-developers/": "Panoramica",
          "users-as-developers/why-i-built-vmark": "Perché ho creato VMark",
          "users-as-developers/what-are-indispensable": "Cinque competenze che l'IA non può sostituire",
          "users-as-developers/why-expensive-models-are-cheaper": "Perché i modelli costosi sono più economici",
          "users-as-developers/subscription-vs-api": "Abbonamento vs prezzi API",
          "users-as-developers/prompt-refinement": "I prompt in inglese funzionano meglio",
          "users-as-developers/cross-model-verification": "Verifica incrociata tra modelli",
          "users-as-developers/why-issues-not-prs": "Perché Issue e non PR",
          "users-as-developers/cost-evaluation": "Valutazione di costi e impegno",
          "users-as-developers/plugins-as-infrastructure": "Plugin come infrastruttura",
        },
      }),
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/it/guide/license">Licenza ISC</a>',
    },

    lastUpdated: {
      text: "Aggiornato il",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "In questa pagina",
    },

    docFooter: {
      prev: "Precedente",
      next: "Successivo",
    },

    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Torna in cima",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          it: {
            translations: {
              button: {
                buttonText: "Cerca",
                buttonAriaLabel: "Cerca nella documentazione",
              },
              modal: {
                noResultsText: "Nessun risultato trovato",
                resetButtonTitle: "Reimposta ricerca",
                displayDetails: "Mostra dettagli",
                footer: {
                  selectText: "Seleziona",
                  navigateText: "Naviga",
                  closeText: "Chiudi",
                },
              },
            },
          },
        },
      },
    },
  },
};
