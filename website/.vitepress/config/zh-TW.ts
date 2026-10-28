import { guideSidebar } from "./guideSidebar";

export const zhTW = {
  label: "繁體中文",
  lang: "zh-TW",
  themeConfig: {
    nav: [
      { text: "首頁", link: "/zh-TW/" },
      { text: "下載", link: "/zh-TW/download" },
      { text: "指南", link: "/zh-TW/guide/" },
      { text: "部落格", link: "/blog/" },
    ],

    sidebar: {
      "/zh-TW/guide/": guideSidebar("/zh-TW", {
        sections: { guide: "指南", usersAsDevelopers: "使用者即開發者" },
        pages: {
          "": "快速上手",
          "formats": "支援的格式",
          "features": "功能特性",
          "large-files": "大型檔案",
          "export": "匯出與列印",
          "shortcuts": "鍵盤快捷鍵",
          "tab-navigation": "智慧分頁導覽",
          "multi-cursor": "多游標編輯",
          "popups": "內嵌彈窗",
          "mermaid": "Mermaid 圖表",
          "graphviz": "Graphviz 圖表",
          "markmap": "Markmap 心智圖",
          "workflow-viewer": "GitHub Actions 工作流程檢視器",
          "svg": "SVG 圖形",
          "media-support": "媒體（影片/音訊）",
          "cloud-images": "雲端託管圖片",
          "terminal": "整合終端機",
          "browser": "內嵌瀏覽器",
          "knowledge-base": "知識庫與 Slidev",
          "workspace-management": "工作區管理",
          "workspace-rail": "工作區導軌",
          "cjk-formatting": "中日韓排版",
          "ai-genies": "AI 精靈",
          "coherence": "一致性與明細檢視",
          "workflows": "精靈工作流程",
          "workflow-genies": "工作流程精靈",
          "ai-providers": "AI 服務商",
          "mcp-setup": "MCP 設定",
          "mcp-tools": "MCP 工具參考",
          "edit-history-git": "將編輯歷史匯出到 Git",
          "lint": "Markdown 檢查",
          "link-check": "連結檢查",
          "settings": "設定",
          "troubleshooting": "疑難排解",
          "privacy": "隱私權政策",
          "license": "授權條款",
          "users-as-developers/": "概覽",
          "users-as-developers/why-i-built-vmark": "我為什麼開發 VMark",
          "users-as-developers/what-are-indispensable": "AI 無法取代的五項技能",
          "users-as-developers/why-expensive-models-are-cheaper": "為什麼貴的模型反而更便宜",
          "users-as-developers/subscription-vs-api": "訂閱 vs API 定價",
          "users-as-developers/prompt-refinement": "英文提示詞效果更好",
          "users-as-developers/cross-model-verification": "跨模型驗證",
          "users-as-developers/why-issues-not-prs": "為什麼提 Issue 而非 PR",
          "users-as-developers/cost-evaluation": "成本與工作量評估",
          "users-as-developers/plugins-as-infrastructure": "外掛即基礎設施",
        },
      }),
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
