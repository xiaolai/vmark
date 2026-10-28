import { guideSidebar } from "./guideSidebar";

export const fr = {
  label: "Français",
  lang: "fr",
  themeConfig: {
    nav: [
      { text: "Accueil", link: "/fr/" },
      { text: "Télécharger", link: "/fr/download" },
      { text: "Guide", link: "/fr/guide/" },
      { text: "Blog", link: "/blog/" },
    ],

    sidebar: {
      "/fr/guide/": guideSidebar("/fr", {
        sections: { guide: "Guide", usersAsDevelopers: "Utilisateurs développeurs" },
        pages: {
          "": "Démarrage rapide",
          "formats": "Formats pris en charge",
          "features": "Fonctionnalités",
          "large-files": "Fichiers volumineux",
          "export": "Exportation et impression",
          "shortcuts": "Raccourcis clavier",
          "tab-navigation": "Navigation intelligente par onglets",
          "multi-cursor": "Édition multicurseur",
          "popups": "Popups en ligne",
          "mermaid": "Diagrammes Mermaid",
          "graphviz": "Diagrammes Graphviz",
          "markmap": "Cartes mentales Markmap",
          "workflow-viewer": "Visualiseur de workflows GitHub Actions",
          "svg": "Graphiques SVG",
          "media-support": "Médias (vidéo/audio)",
          "cloud-images": "Images hébergées dans le cloud",
          "terminal": "Terminal intégré",
          "browser": "Navigateur intégré",
          "knowledge-base": "Base de connaissances et Slidev",
          "workspace-management": "Gestion de l'espace de travail",
          "workspace-rail": "Barre des espaces de travail",
          "cjk-formatting": "Formatage CJK",
          "ai-genies": "AI Genies",
          "coherence": "Cohérence et vue Détail",
          "workflows": "Workflows Genie",
          "workflow-genies": "Genies de workflow",
          "ai-providers": "Fournisseurs d'IA",
          "mcp-setup": "Configuration MCP",
          "mcp-tools": "Référence des outils MCP",
          "edit-history-git": "Historique des modifications dans Git",
          "lint": "Lint Markdown",
          "link-check": "Vérification des liens",
          "settings": "Paramètres",
          "troubleshooting": "Dépannage",
          "privacy": "Confidentialité",
          "license": "Licence",
          "users-as-developers/": "Vue d'ensemble",
          "users-as-developers/why-i-built-vmark": "Pourquoi j'ai créé VMark",
          "users-as-developers/what-are-indispensable": "Cinq compétences que l'IA ne peut remplacer",
          "users-as-developers/why-expensive-models-are-cheaper": "Pourquoi les modèles chers sont moins coûteux",
          "users-as-developers/subscription-vs-api": "Abonnement vs tarification API",
          "users-as-developers/prompt-refinement": "Les prompts en anglais fonctionnent mieux",
          "users-as-developers/cross-model-verification": "Vérification inter-modèles",
          "users-as-developers/why-issues-not-prs": "Pourquoi des Issues plutôt que des PRs",
          "users-as-developers/cost-evaluation": "Évaluation des coûts et efforts",
          "users-as-developers/plugins-as-infrastructure": "Les plugins comme infrastructure",
        },
      }),
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/fr/guide/license">Licence ISC</a>',
    },

    lastUpdated: {
      text: "Mis à jour le",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "Sur cette page",
    },

    docFooter: {
      prev: "Précédent",
      next: "Suivant",
    },

    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Retour en haut",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          fr: {
            translations: {
              button: {
                buttonText: "Rechercher",
                buttonAriaLabel: "Rechercher dans la documentation",
              },
              modal: {
                noResultsText: "Aucun résultat trouvé",
                resetButtonTitle: "Réinitialiser la recherche",
                displayDetails: "Afficher les détails",
                footer: {
                  selectText: "Sélectionner",
                  navigateText: "Naviguer",
                  closeText: "Fermer",
                },
              },
            },
          },
        },
      },
    },
  },
};
