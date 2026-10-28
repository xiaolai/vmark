import { guideSidebar } from "./guideSidebar";

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
      "/ja/guide/": guideSidebar("/ja", {
        sections: { guide: "ガイド", usersAsDevelopers: "ユーザーとしての開発者" },
        pages: {
          "": "はじめに",
          "formats": "サポートされるフォーマット",
          "features": "機能",
          "large-files": "大きなファイル",
          "export": "エクスポートと印刷",
          "shortcuts": "キーボードショートカット",
          "tab-navigation": "スマートタブナビゲーション",
          "multi-cursor": "マルチカーソル編集",
          "popups": "インラインポップアップ",
          "mermaid": "Mermaid ダイアグラム",
          "graphviz": "Graphviz ダイアグラム",
          "markmap": "Markmap マインドマップ",
          "workflow-viewer": "GitHub Actions ワークフロービューア",
          "svg": "SVG グラフィックス",
          "media-support": "メディア（動画/音声）",
          "cloud-images": "クラウドホスト画像",
          "terminal": "統合ターミナル",
          "browser": "組み込みブラウザ",
          "knowledge-base": "ナレッジベースと Slidev",
          "workspace-management": "ワークスペース管理",
          "workspace-rail": "ワークスペースレール",
          "cjk-formatting": "CJK フォーマット",
          "ai-genies": "AI ジーニー",
          "coherence": "整合性と内訳ビュー",
          "workflows": "Genie ワークフロー",
          "workflow-genies": "ワークフロージーニー",
          "ai-providers": "AI プロバイダー",
          "mcp-setup": "MCP セットアップ",
          "mcp-tools": "MCP ツールリファレンス",
          "edit-history-git": "編集履歴を Git へ",
          "lint": "Markdown Lint",
          "link-check": "リンクチェック",
          "settings": "設定",
          "troubleshooting": "トラブルシューティング",
          "privacy": "プライバシー",
          "license": "ライセンス",
          "users-as-developers/": "概要",
          "users-as-developers/why-i-built-vmark": "VMark を開発した理由",
          "users-as-developers/what-are-indispensable": "AI が代替できない5つのスキル",
          "users-as-developers/why-expensive-models-are-cheaper": "高価なモデルがなぜ安いのか",
          "users-as-developers/subscription-vs-api": "サブスクリプション vs API 料金",
          "users-as-developers/prompt-refinement": "英語プロンプトが効果的な理由",
          "users-as-developers/cross-model-verification": "クロスモデル検証",
          "users-as-developers/why-issues-not-prs": "PR ではなく Issue を出す理由",
          "users-as-developers/cost-evaluation": "コストと工数の評価",
          "users-as-developers/plugins-as-infrastructure": "プラグインというインフラ",
        },
      }),
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
