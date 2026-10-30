import { guideSidebar } from "./guideSidebar";

export const es = {
  label: "Español",
  lang: "es",
  themeConfig: {
    nav: [
      { text: "Inicio", link: "/es/" },
      { text: "Descargar", link: "/es/download" },
      { text: "Guía", link: "/es/guide/" },
      { text: "Blog", link: "/blog/" },
    ],

    sidebar: {
      "/es/guide/": guideSidebar("/es", {
        sections: { guide: "Guía", usersAsDevelopers: "Usuarios como desarrolladores" },
        pages: {
          "": "Primeros pasos",
          "formats": "Formatos Compatibles",
          "features": "Características",
          "large-files": "Archivos grandes",
          "export": "Exportar e imprimir",
          "shortcuts": "Atajos de teclado",
          "tab-navigation": "Navegación inteligente de pestañas",
          "multi-cursor": "Edición multicursor",
          "popups": "Popups en línea",
          "mermaid": "Diagramas Mermaid",
          "graphviz": "Diagramas Graphviz",
          "markmap": "Mapas mentales Markmap",
          "workflow-viewer": "Visor de flujos de trabajo",
          "svg": "Gráficos SVG",
          "media-support": "Medios (vídeo/audio)",
          "cloud-images": "Imágenes alojadas en la nube",
          "terminal": "Terminal integrada",
          "browser": "Navegador integrado",
          "knowledge-base": "Base de conocimiento y Slidev",
          "workspace-management": "Gestión de espacios de trabajo",
          "workspace-rail": "Barra de espacios de trabajo",
          "cjk-formatting": "Formato CJK",
          "ai-genies": "AI Genies",
          "coherence": "Desglose de coherencia",
          "workflows": "Flujos de trabajo de Genie",
          "workflow-genies": "Genies de flujo de trabajo",
          "ai-providers": "Proveedores de IA",
          "mcp-setup": "Configuración de MCP",
          "mcp-tools": "Referencia de herramientas MCP",
          "edit-history-git": "Historial de edición en Git",
          "lint": "Lint de Markdown",
          "link-check": "Verificación de enlaces",
          "settings": "Ajustes",
          "troubleshooting": "Solución de problemas",
          "privacy": "Privacidad",
          "license": "Licencia",
          "users-as-developers/": "Descripción general",
          "users-as-developers/why-i-built-vmark": "Por qué creé VMark",
          "users-as-developers/what-are-indispensable": "Cinco habilidades que la IA no puede reemplazar",
          "users-as-developers/why-expensive-models-are-cheaper": "Por qué los modelos caros son más baratos",
          "users-as-developers/subscription-vs-api": "Suscripción vs precios de API",
          "users-as-developers/prompt-refinement": "Los prompts en inglés funcionan mejor",
          "users-as-developers/cross-model-verification": "Verificación entre modelos",
          "users-as-developers/why-issues-not-prs": "Por qué Issues y no PRs",
          "users-as-developers/cost-evaluation": "Evaluación de costos y esfuerzo",
          "users-as-developers/plugins-as-infrastructure": "Plugins como infraestructura",
        },
      }),
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
