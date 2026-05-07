

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
      "/fr/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Démarrage rapide", link: "/fr/guide/" },
            { text: "Fonctionnalités", link: "/fr/guide/features" },
            { text: "Fichiers volumineux", link: "/fr/guide/large-files" },
            {
              text: "Exportation et impression",
              link: "/fr/guide/export",
            },
            {
              text: "Raccourcis clavier",
              link: "/fr/guide/shortcuts",
            },
            {
              text: "Navigation intelligente par onglets",
              link: "/fr/guide/tab-navigation",
            },
            {
              text: "Édition multicurseur",
              link: "/fr/guide/multi-cursor",
            },
            {
              text: "Popups en ligne",
              link: "/fr/guide/popups",
            },
            {
              text: "Diagrammes Mermaid",
              link: "/fr/guide/mermaid",
            },
            {
              text: "Cartes mentales Markmap",
              link: "/fr/guide/markmap",
            },
            {
              text: "Visualiseur de workflows GitHub Actions",
              link: "/fr/guide/workflow-viewer",
            },
            { text: "Graphiques SVG", link: "/fr/guide/svg" },
            {
              text: "Médias (vidéo/audio)",
              link: "/fr/guide/media-support",
            },
            {
              text: "Terminal intégré",
              link: "/fr/guide/terminal",
            },
            {
              text: "Gestion de l'espace de travail",
              link: "/fr/guide/workspace-management",
            },
            {
              text: "Formatage CJK",
              link: "/fr/guide/cjk-formatting",
            },
            { text: "AI Genies", link: "/fr/guide/ai-genies" },
            {
              text: "Genies de workflow",
              link: "/fr/guide/workflow-genies",
            },
            {
              text: "Fournisseurs d'IA",
              link: "/fr/guide/ai-providers",
            },
            {
              text: "Configuration MCP",
              link: "/fr/guide/mcp-setup",
            },
            {
              text: "Référence des outils MCP",
              link: "/fr/guide/mcp-tools",
            },
            { text: "Lint Markdown", link: "/fr/guide/lint" },
            { text: "Vérification des liens", link: "/fr/guide/link-check" },
            { text: "Paramètres", link: "/fr/guide/settings" },
            { text: "Dépannage", link: "/fr/guide/troubleshooting" },
            { text: "Confidentialité", link: "/fr/guide/privacy" },
            { text: "Licence", link: "/fr/guide/license" },
          ],
        },
        {
          text: "Utilisateurs développeurs",
          items: [
            {
              text: "Vue d'ensemble",
              link: "/fr/guide/users-as-developers/",
            },
            {
              text: "Pourquoi j'ai créé VMark",
              link: "/fr/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "Cinq compétences que l'IA ne peut remplacer",
              link: "/fr/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "Pourquoi les modèles chers sont moins coûteux",
              link: "/fr/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "Abonnement vs tarification API",
              link: "/fr/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "Les prompts en anglais fonctionnent mieux",
              link: "/fr/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "Vérification inter-modèles",
              link: "/fr/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "Pourquoi des Issues plutôt que des PRs",
              link: "/fr/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "Évaluation des coûts et efforts",
              link: "/fr/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "Les plugins comme infrastructure",
              link: "/fr/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
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
