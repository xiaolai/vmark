

export const zhTW = {
  label: "繁體中文",
  lang: "zh-TW",
  themeConfig: {
    nav: [
      { text: "首頁", link: "/zh-TW/" },
      { text: "下載", link: "/zh-TW/download" },
      { text: "指南", link: "/zh-TW/guide/" },
    ],

    sidebar: {
      "/zh-TW/guide/": [
        {
          text: "指南",
          items: [
            { text: "快速上手", link: "/zh-TW/guide/" },
            { text: "功能特性", link: "/zh-TW/guide/features" },
            { text: "匯出與列印", link: "/zh-TW/guide/export" },
            { text: "鍵盤快捷鍵", link: "/zh-TW/guide/shortcuts" },
            { text: "大型檔案", link: "/zh-TW/guide/large-files" },
            {
              text: "GitHub Actions 工作流程檢視器",
              link: "/zh-TW/guide/workflow-viewer",
            },
            {
              text: "智慧分頁導覽",
              link: "/zh-TW/guide/tab-navigation",
            },
            {
              text: "多游標編輯",
              link: "/zh-TW/guide/multi-cursor",
            },
            { text: "內嵌彈窗", link: "/zh-TW/guide/popups" },
            {
              text: "Mermaid 圖表",
              link: "/zh-TW/guide/mermaid",
            },
            {
              text: "Markmap 心智圖",
              link: "/zh-TW/guide/markmap",
            },
            { text: "SVG 圖形", link: "/zh-TW/guide/svg" },
            {
              text: "媒體（影片/音訊）",
              link: "/zh-TW/guide/media-support",
            },
            {
              text: "整合終端機",
              link: "/zh-TW/guide/terminal",
            },
            {
              text: "工作區管理",
              link: "/zh-TW/guide/workspace-management",
            },
            {
              text: "中日韓排版",
              link: "/zh-TW/guide/cjk-formatting",
            },
            { text: "AI 精靈", link: "/zh-TW/guide/ai-genies" },
            {
              text: "AI 服務商",
              link: "/zh-TW/guide/ai-providers",
            },
            { text: "MCP 設定", link: "/zh-TW/guide/mcp-setup" },
            {
              text: "MCP 工具參考",
              link: "/zh-TW/guide/mcp-tools",
            },
            { text: "Markdown 檢查", link: "/zh-TW/guide/lint" },
            { text: "連結檢查", link: "/zh-TW/guide/link-check" },
            { text: "設定", link: "/zh-TW/guide/settings" },
            { text: "疑難排解", link: "/zh-TW/guide/troubleshooting" },
            { text: "隱私權政策", link: "/zh-TW/guide/privacy" },
            { text: "授權條款", link: "/zh-TW/guide/license" },
          ],
        },
        {
          text: "使用者即開發者",
          items: [
            {
              text: "概覽",
              link: "/zh-TW/guide/users-as-developers/",
            },
            {
              text: "我為什麼開發 VMark",
              link: "/zh-TW/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "AI 無法取代的五項技能",
              link: "/zh-TW/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "為什麼貴的模型反而更便宜",
              link: "/zh-TW/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "訂閱 vs API 定價",
              link: "/zh-TW/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "英文提示詞效果更好",
              link: "/zh-TW/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "跨模型驗證",
              link: "/zh-TW/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "為什麼提 Issue 而非 PR",
              link: "/zh-TW/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "成本與工作量評估",
              link: "/zh-TW/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "外掛即基礎設施",
              link: "/zh-TW/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/zh-TW/guide/license">ISC 授權條款</a>',
    },

    lastUpdated: {
      text: "更新於",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "本頁目錄",
    },

    docFooter: {
      prev: "上一頁",
      next: "下一頁",
    },

    sidebarMenuLabel: "選單",
    returnToTopLabel: "返回頂部",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          "zh-TW": {
            translations: {
              button: {
                buttonText: "搜尋文件",
                buttonAriaLabel: "搜尋文件",
              },
              modal: {
                noResultsText: "未找到相關結果",
                resetButtonTitle: "清除查詢",
                displayDetails: "顯示詳情",
                footer: {
                  selectText: "選擇",
                  navigateText: "導覽",
                  closeText: "關閉",
                },
              },
            },
          },
        },
      },
    },
  },
};
