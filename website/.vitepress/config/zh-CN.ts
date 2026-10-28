import { guideSidebar } from "./guideSidebar";

export const zhCN = {
  label: "简体中文",
  lang: "zh-CN",
  themeConfig: {
    nav: [
      { text: "首页", link: "/zh-CN/" },
      { text: "下载", link: "/zh-CN/download" },
      { text: "指南", link: "/zh-CN/guide/" },
      { text: "博客", link: "/blog/" },
    ],

    sidebar: {
      "/zh-CN/guide/": guideSidebar("/zh-CN", {
        sections: { guide: "指南", usersAsDevelopers: "用户即开发者" },
        pages: {
          "": "快速上手",
          "formats": "支持的格式",
          "features": "功能特性",
          "large-files": "大文件",
          "export": "导出与打印",
          "shortcuts": "键盘快捷键",
          "tab-navigation": "智能标签页导航",
          "multi-cursor": "多光标编辑",
          "popups": "内联弹窗",
          "mermaid": "Mermaid 图表",
          "graphviz": "Graphviz 图表",
          "markmap": "Markmap 思维导图",
          "workflow-viewer": "GitHub Actions 工作流查看器",
          "svg": "SVG 图形",
          "media-support": "媒体（视频/音频）",
          "cloud-images": "云端托管图片",
          "terminal": "集成终端",
          "browser": "内置浏览器",
          "knowledge-base": "知识库与 Slidev",
          "workspace-management": "工作区管理",
          "workspace-rail": "工作区导轨",
          "cjk-formatting": "中日韩排版",
          "ai-genies": "AI 精灵",
          "coherence": "一致性与明细视图",
          "workflows": "Genie 工作流",
          "workflow-genies": "工作流精灵",
          "ai-providers": "AI 服务商",
          "mcp-setup": "MCP 设置",
          "mcp-tools": "MCP 工具参考",
          "edit-history-git": "将编辑历史导出到 Git",
          "lint": "Markdown 检查",
          "link-check": "链接检查",
          "settings": "设置",
          "troubleshooting": "故障排除",
          "privacy": "隐私政策",
          "license": "许可证",
          "users-as-developers/": "概览",
          "users-as-developers/why-i-built-vmark": "我为什么开发 VMark",
          "users-as-developers/what-are-indispensable": "AI 无法替代的五项技能",
          "users-as-developers/why-expensive-models-are-cheaper": "为什么贵的模型反而更便宜",
          "users-as-developers/subscription-vs-api": "订阅 vs API 定价",
          "users-as-developers/prompt-refinement": "英文提示词效果更好",
          "users-as-developers/cross-model-verification": "跨模型验证",
          "users-as-developers/why-issues-not-prs": "为什么提 Issue 而非 PR",
          "users-as-developers/cost-evaluation": "成本与工作量评估",
          "users-as-developers/plugins-as-infrastructure": "插件即基础设施",
        },
      }),
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/zh-CN/guide/license">ISC 许可证</a>',
    },

    lastUpdated: {
      text: "更新于",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "本页目录",
    },

    docFooter: {
      prev: "上一页",
      next: "下一页",
    },

    sidebarMenuLabel: "菜单",
    returnToTopLabel: "返回顶部",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          "zh-CN": {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                noResultsText: "未找到相关结果",
                resetButtonTitle: "清除查询",
                displayDetails: "显示详情",
                footer: {
                  selectText: "选择",
                  navigateText: "导航",
                  closeText: "关闭",
                },
              },
            },
          },
        },
      },
    },
  },
};
