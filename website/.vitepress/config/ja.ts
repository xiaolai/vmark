

export const ja = {
  label: "日本語",
  lang: "ja",
  themeConfig: {
    nav: [
      { text: "ホーム", link: "/ja/" },
      { text: "ダウンロード", link: "/ja/download" },
      { text: "ガイド", link: "/ja/guide/" },
      { text: "ブログ", link: "/blog/" },
    ],

    sidebar: {
      "/ja/guide/": [
        {
          text: "ガイド",
          items: [
            { text: "はじめに", link: "/ja/guide/" },
            { text: "機能", link: "/ja/guide/features" },
            { text: "大きなファイル", link: "/ja/guide/large-files" },
            { text: "エクスポートと印刷", link: "/ja/guide/export" },
            {
              text: "キーボードショートカット",
              link: "/ja/guide/shortcuts",
            },
            {
              text: "スマートタブナビゲーション",
              link: "/ja/guide/tab-navigation",
            },
            {
              text: "マルチカーソル編集",
              link: "/ja/guide/multi-cursor",
            },
            {
              text: "インラインポップアップ",
              link: "/ja/guide/popups",
            },
            {
              text: "Mermaid ダイアグラム",
              link: "/ja/guide/mermaid",
            },
            {
              text: "Markmap マインドマップ",
              link: "/ja/guide/markmap",
            },
            {
              text: "GitHub Actions ワークフロービューア",
              link: "/ja/guide/workflow-viewer",
            },
            { text: "SVG グラフィックス", link: "/ja/guide/svg" },
            {
              text: "メディア（動画/音声）",
              link: "/ja/guide/media-support",
            },
            {
              text: "統合ターミナル",
              link: "/ja/guide/terminal",
            },
            {
              text: "ワークスペース管理",
              link: "/ja/guide/workspace-management",
            },
            {
              text: "CJK フォーマット",
              link: "/ja/guide/cjk-formatting",
            },
            { text: "AI ジーニー", link: "/ja/guide/ai-genies" },
            { text: "ワークフロージーニー", link: "/ja/guide/workflow-genies" },
            {
              text: "AI プロバイダー",
              link: "/ja/guide/ai-providers",
            },
            { text: "MCP セットアップ", link: "/ja/guide/mcp-setup" },
            {
              text: "MCP ツールリファレンス",
              link: "/ja/guide/mcp-tools",
            },
            { text: "Markdown Lint", link: "/ja/guide/lint" },
            { text: "リンクチェック", link: "/ja/guide/link-check" },
            { text: "設定", link: "/ja/guide/settings" },
            { text: "トラブルシューティング", link: "/ja/guide/troubleshooting" },
            { text: "プライバシー", link: "/ja/guide/privacy" },
            { text: "ライセンス", link: "/ja/guide/license" },
          ],
        },
        {
          text: "ユーザーとしての開発者",
          items: [
            {
              text: "概要",
              link: "/ja/guide/users-as-developers/",
            },
            {
              text: "VMark を開発した理由",
              link: "/ja/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "AI が代替できない5つのスキル",
              link: "/ja/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "高価なモデルがなぜ安いのか",
              link: "/ja/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "サブスクリプション vs API 料金",
              link: "/ja/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "英語プロンプトが効果的な理由",
              link: "/ja/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "クロスモデル検証",
              link: "/ja/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "PR ではなく Issue を出す理由",
              link: "/ja/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "コストと工数の評価",
              link: "/ja/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "プラグインというインフラ",
              link: "/ja/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/ja/guide/license">ISC ライセンス</a>',
    },

    lastUpdated: {
      text: "最終更新",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "目次",
    },

    docFooter: {
      prev: "前のページ",
      next: "次のページ",
    },

    sidebarMenuLabel: "メニュー",
    returnToTopLabel: "トップに戻る",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          ja: {
            translations: {
              button: {
                buttonText: "検索",
                buttonAriaLabel: "ドキュメントを検索",
              },
              modal: {
                noResultsText: "結果が見つかりません",
                resetButtonTitle: "検索をクリア",
                displayDetails: "詳細を表示",
                footer: {
                  selectText: "選択",
                  navigateText: "移動",
                  closeText: "閉じる",
                },
              },
            },
          },
        },
      },
    },
  },
};
