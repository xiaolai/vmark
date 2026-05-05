

export const es = {
  label: "Español",
  lang: "es",
  themeConfig: {
    nav: [
      { text: "Inicio", link: "/es/" },
      { text: "Descargar", link: "/es/download" },
      { text: "Guía", link: "/es/guide/" },
    ],

    sidebar: {
      "/es/guide/": [
        {
          text: "Guía",
          items: [
            { text: "Primeros pasos", link: "/es/guide/" },
            { text: "Características", link: "/es/guide/features" },
            {
              text: "Exportar e imprimir",
              link: "/es/guide/export",
            },
            {
              text: "Atajos de teclado",
              link: "/es/guide/shortcuts",
            },
            {
              text: "Navegación inteligente de pestañas",
              link: "/es/guide/tab-navigation",
            },
            {
              text: "Edición multicursor",
              link: "/es/guide/multi-cursor",
            },
            {
              text: "Popups en línea",
              link: "/es/guide/popups",
            },
            {
              text: "Diagramas Mermaid",
              link: "/es/guide/mermaid",
            },
            {
              text: "Mapas mentales Markmap",
              link: "/es/guide/markmap",
            },
            { text: "Gráficos SVG", link: "/es/guide/svg" },
            {
              text: "Medios (vídeo/audio)",
              link: "/es/guide/media-support",
            },
            {
              text: "Terminal integrada",
              link: "/es/guide/terminal",
            },
            {
              text: "Gestión de espacios de trabajo",
              link: "/es/guide/workspace-management",
            },
            {
              text: "Archivos grandes",
              link: "/es/guide/large-files",
            },
            {
              text: "Visor de flujos de trabajo",
              link: "/es/guide/workflow-viewer",
            },
            {
              text: "Formato CJK",
              link: "/es/guide/cjk-formatting",
            },
            { text: "AI Genies", link: "/es/guide/ai-genies" },
            {
              text: "Proveedores de IA",
              link: "/es/guide/ai-providers",
            },
            {
              text: "Configuración de MCP",
              link: "/es/guide/mcp-setup",
            },
            {
              text: "Referencia de herramientas MCP",
              link: "/es/guide/mcp-tools",
            },
            { text: "Lint de Markdown", link: "/es/guide/lint" },
            { text: "Verificación de enlaces", link: "/es/guide/link-check" },
            { text: "Ajustes", link: "/es/guide/settings" },
            { text: "Solución de problemas", link: "/es/guide/troubleshooting" },
            { text: "Privacidad", link: "/es/guide/privacy" },
            { text: "Licencia", link: "/es/guide/license" },
          ],
        },
        {
          text: "Usuarios como desarrolladores",
          items: [
            {
              text: "Descripción general",
              link: "/es/guide/users-as-developers/",
            },
            {
              text: "Por qué creé VMark",
              link: "/es/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "Cinco habilidades que la IA no puede reemplazar",
              link: "/es/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "Por qué los modelos caros son más baratos",
              link: "/es/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "Suscripción vs precios de API",
              link: "/es/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "Los prompts en inglés funcionan mejor",
              link: "/es/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "Verificación entre modelos",
              link: "/es/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "Por qué Issues y no PRs",
              link: "/es/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "Evaluación de costos y esfuerzo",
              link: "/es/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "Plugins como infraestructura",
              link: "/es/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/es/guide/license">Licencia ISC</a>',
    },

    lastUpdated: {
      text: "Actualizado",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "En esta página",
    },

    docFooter: {
      prev: "Anterior",
      next: "Siguiente",
    },

    sidebarMenuLabel: "Menú",
    returnToTopLabel: "Volver arriba",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          es: {
            translations: {
              button: {
                buttonText: "Buscar",
                buttonAriaLabel: "Buscar documentos",
              },
              modal: {
                noResultsText: "No se encontraron resultados",
                resetButtonTitle: "Restablecer búsqueda",
                displayDetails: "Mostrar detalles",
                footer: {
                  selectText: "Seleccionar",
                  navigateText: "Navegar",
                  closeText: "Cerrar",
                },
              },
            },
          },
        },
      },
    },
  },
};
