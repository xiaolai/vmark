

export const ptBR = {
  label: "Português",
  lang: "pt-BR",
  themeConfig: {
    nav: [
      { text: "Início", link: "/pt-BR/" },
      { text: "Baixar", link: "/pt-BR/download" },
      { text: "Guia", link: "/pt-BR/guide/" },
      { text: "Blog", link: "/blog/" },
    ],

    sidebar: {
      "/pt-BR/guide/": [
        {
          text: "Guia",
          items: [
            { text: "Primeiros passos", link: "/pt-BR/guide/" },
            { text: "Funcionalidades", link: "/pt-BR/guide/features" },
            {
              text: "Exportar e imprimir",
              link: "/pt-BR/guide/export",
            },
            {
              text: "Atalhos de teclado",
              link: "/pt-BR/guide/shortcuts",
            },
            {
              text: "Navegação inteligente por abas",
              link: "/pt-BR/guide/tab-navigation",
            },
            {
              text: "Edição multicursor",
              link: "/pt-BR/guide/multi-cursor",
            },
            {
              text: "Popups em linha",
              link: "/pt-BR/guide/popups",
            },
            {
              text: "Diagramas Mermaid",
              link: "/pt-BR/guide/mermaid",
            },
            {
              text: "Mapas mentais Markmap",
              link: "/pt-BR/guide/markmap",
            },
            { text: "Gráficos SVG", link: "/pt-BR/guide/svg" },
            {
              text: "Mídia (vídeo/áudio)",
              link: "/pt-BR/guide/media-support",
            },
            {
              text: "Terminal integrado",
              link: "/pt-BR/guide/terminal",
            },
            {
              text: "Gerenciamento de workspace",
              link: "/pt-BR/guide/workspace-management",
            },
            {
              text: "Arquivos grandes",
              link: "/pt-BR/guide/large-files",
            },
            {
              text: "Visualizador de Workflows",
              link: "/pt-BR/guide/workflow-viewer",
            },
            {
              text: "Formatação CJK",
              link: "/pt-BR/guide/cjk-formatting",
            },
            { text: "AI Genies", link: "/pt-BR/guide/ai-genies" },
            {
              text: "Genies de Workflow",
              link: "/pt-BR/guide/workflow-genies",
            },
            {
              text: "Provedores de IA",
              link: "/pt-BR/guide/ai-providers",
            },
            {
              text: "Configuração do MCP",
              link: "/pt-BR/guide/mcp-setup",
            },
            {
              text: "Referência de ferramentas MCP",
              link: "/pt-BR/guide/mcp-tools",
            },
            { text: "Lint do Markdown", link: "/pt-BR/guide/lint" },
            { text: "Verificação de links", link: "/pt-BR/guide/link-check" },
            {
              text: "Configurações",
              link: "/pt-BR/guide/settings",
            },
            { text: "Solução de problemas", link: "/pt-BR/guide/troubleshooting" },
            { text: "Privacidade", link: "/pt-BR/guide/privacy" },
            { text: "Licença", link: "/pt-BR/guide/license" },
          ],
        },
        {
          text: "Usuários como desenvolvedores",
          items: [
            {
              text: "Visão geral",
              link: "/pt-BR/guide/users-as-developers/",
            },
            {
              text: "Por que criei o VMark",
              link: "/pt-BR/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "Cinco habilidades que a IA não substitui",
              link: "/pt-BR/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "Por que modelos caros são mais baratos",
              link: "/pt-BR/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "Assinatura vs preços de API",
              link: "/pt-BR/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "Prompts em inglês funcionam melhor",
              link: "/pt-BR/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "Verificação entre modelos",
              link: "/pt-BR/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "Por que Issues e não PRs",
              link: "/pt-BR/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "Avaliação de custo e esforço",
              link: "/pt-BR/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "Plugins como infraestrutura",
              link: "/pt-BR/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/pt-BR/guide/license">Licença ISC</a>',
    },

    lastUpdated: {
      text: "Atualizado em",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "Nesta página",
    },

    docFooter: {
      prev: "Anterior",
      next: "Próximo",
    },

    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Voltar ao topo",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          "pt-BR": {
            translations: {
              button: {
                buttonText: "Pesquisar",
                buttonAriaLabel: "Pesquisar documentação",
              },
              modal: {
                noResultsText: "Nenhum resultado encontrado",
                resetButtonTitle: "Limpar pesquisa",
                displayDetails: "Exibir detalhes",
                footer: {
                  selectText: "Selecionar",
                  navigateText: "Navegar",
                  closeText: "Fechar",
                },
              },
            },
          },
        },
      },
    },
  },
};
