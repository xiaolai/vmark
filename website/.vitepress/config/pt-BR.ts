import { guideSidebar } from "./guideSidebar";

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
      "/pt-BR/guide/": guideSidebar("/pt-BR", {
        sections: { guide: "Guia", usersAsDevelopers: "Usuários como desenvolvedores" },
        pages: {
          "": "Primeiros passos",
          "formats": "Formatos Suportados",
          "features": "Funcionalidades",
          "large-files": "Arquivos grandes",
          "export": "Exportar e imprimir",
          "shortcuts": "Atalhos de teclado",
          "tab-navigation": "Navegação inteligente por abas",
          "multi-cursor": "Edição multicursor",
          "popups": "Popups em linha",
          "mermaid": "Diagramas Mermaid",
          "graphviz": "Diagramas Graphviz",
          "markmap": "Mapas mentais Markmap",
          "workflow-viewer": "Visualizador de Workflows",
          "svg": "Gráficos SVG",
          "media-support": "Mídia (vídeo/áudio)",
          "cloud-images": "Imagens hospedadas na nuvem",
          "terminal": "Terminal integrado",
          "browser": "Navegador integrado",
          "knowledge-base": "Base de conhecimento e Slidev",
          "workspace-management": "Gerenciamento de workspace",
          "workspace-rail": "Barra de espaços de trabalho",
          "cjk-formatting": "Formatação CJK",
          "ai-genies": "AI Genies",
          "coherence": "Coerência e visão de detalhamento",
          "workflows": "Workflows de Genie",
          "workflow-genies": "Genies de Workflow",
          "ai-providers": "Provedores de IA",
          "mcp-setup": "Configuração do MCP",
          "mcp-tools": "Referência de ferramentas MCP",
          "edit-history-git": "Histórico de edições no Git",
          "lint": "Lint do Markdown",
          "link-check": "Verificação de links",
          "settings": "Configurações",
          "troubleshooting": "Solução de problemas",
          "privacy": "Privacidade",
          "license": "Licença",
          "users-as-developers/": "Visão geral",
          "users-as-developers/why-i-built-vmark": "Por que criei o VMark",
          "users-as-developers/what-are-indispensable": "Cinco habilidades que a IA não substitui",
          "users-as-developers/why-expensive-models-are-cheaper": "Por que modelos caros são mais baratos",
          "users-as-developers/subscription-vs-api": "Assinatura vs preços de API",
          "users-as-developers/prompt-refinement": "Prompts em inglês funcionam melhor",
          "users-as-developers/cross-model-verification": "Verificação entre modelos",
          "users-as-developers/why-issues-not-prs": "Por que Issues e não PRs",
          "users-as-developers/cost-evaluation": "Avaliação de custo e esforço",
          "users-as-developers/plugins-as-infrastructure": "Plugins como infraestrutura",
        },
      }),
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
