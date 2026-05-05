# Markmap マインドマップ

VMark は Markdown ドキュメントに直接インタラクティブなマインドマップツリーを作成するための[Markmap](https://markmap.js.org/)をサポートします。Mermaid の静的なマインドマップ図タイプとは異なり、Markmap は標準的な Markdown 見出しを入力として使用し、インタラクティブなパン/ズーム/折りたたみを提供します。

## マインドマップの挿入

### メニューを使用

**メニュー:** 挿入 > マインドマップ

**キーボードショートカット:** `Alt + Shift + Cmd + K`（macOS）/ `Alt + Shift + Ctrl + K`（Windows/Linux）

### コードブロックを使用

`markmap`言語識別子でフェンスされたコードブロックを入力します:

````markdown
```markmap
# Mindmap

## Branch A
### Topic 1
### Topic 2

## Branch B
### Topic 3
### Topic 4
```text
````

### MCP ツールを使用

`media` MCP ツールを`action: "markmap"`と、Markdown 見出しを含む`code`パラメーターで使用します。

## 編集モード

### リッチテキストモード（WYSIWYG）

WYSIWYG モードでは、Markmap のマインドマップはインタラクティブな SVG ツリーとしてレンダリングされます。次のことができます:

- スクロールまたはクリックしてドラッグで **パン**
- `Cmd`/`Ctrl`を押しながらスクロールで **ズーム**
- 各ブランチの円をクリックしてノードを **折りたたみ/展開**
- フィットボタン（ホバー時に右上角に表示）でビューを **フィット**
- マインドマップを **ダブルクリック** してソースを編集

### ライブプレビュー付きソースモード

ソースモードでは、カーソルが markmap コードブロック内にあると、フローティングプレビューパネルが表示され、入力に合わせて更新されます。

## 入力フォーマット

Markmap は入力として標準的な Markdown を使用します。見出しがツリー階層を定義します:

| Markdown | 役割 |
|----------|------|
| `# Heading 1` | ルートノード |
| `## Heading 2` | 第 1 レベルブランチ |
| `### Heading 3` | 第 2 レベルブランチ |
| `#### Heading 4+` | より深いブランチ |

### ノード内のリッチコンテンツ

ノードはインライン Markdown を含められます:

````markdown
```markmap
# Project Plan

## Research
### Read **important** papers
### Review [existing tools](https://example.com)

## Implementation
### Write `core` module
### Add tests
- Unit tests
- Integration tests

## Documentation
### API reference
### User guide
```text
````

見出しの下のリストアイテムは、その見出しの子ノードになります。

### ライブデモ

このページ上で直接レンダリングされたインタラクティブなマークマップです。パン、ズーム、ノードの折りたたみを試してみてください：

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## インタラクティブな機能

| アクション | 方法 |
|--------|-----|
| **パン** | スクロールまたはクリックしてドラッグ |
| **ズーム** | `Cmd`/`Ctrl` + スクロール |
| **ノードを折りたたむ** | ブランチポイントの円をクリック |
| **ノードを展開する** | 再度円をクリック |
| **ビューをフィット** | フィットボタンをクリック（ホバー時に右上に表示） |

## テーマ統合

Markmap のマインドマップは、VMark の現在のテーマ（White、Paper、Mint、Sepia、Night）に自動的に適応します。ブランチの色はすべてのテーマで読みやすさのために調整されます。

## PNG としてエクスポート

WYSIWYG モードでレンダリングされたマインドマップの上にホバーすると、**エクスポート** ボタンが表示されます。クリックしてテーマを選択します:

| テーマ | 背景 |
|-------|------------|
| **ライト** | 白い背景 |
| **ダーク** | 暗い背景 |

マインドマップはシステムの保存ダイアログを通じて 2x 解像度の PNG としてエクスポートされます。

## ヒント

### Markmap vs Mermaid マインドマップ

VMark は Markmap と Mermaid の`mindmap`図タイプの両方をサポートします:

| 機能 | Markmap | Mermaid マインドマップ |
|---------|---------|-----------------|
| 入力フォーマット | 標準 Markdown | Mermaid DSL |
| インタラクティビティ | パン、ズーム、折りたたみ | 静的画像 |
| リッチコンテンツ | リンク、太字、コード、リスト | テキストのみ |
| 最適な用途 | 大きなインタラクティブツリー | シンプルな静的図 |

インタラクティビティが必要な場合や、すでに Markdown コンテンツがある場合は **Markmap** を使用してください。他の Mermaid 図と一緒に使う必要がある場合は **Mermaid マインドマップ** を使用してください。

### 詳細を学ぶ

- **[Markmap ドキュメント](https://markmap.js.org/)** — 公式リファレンス
- **[Markmap プレイグラウンド](https://markmap.js.org/repl)** — マインドマップをテストするインタラクティブなプレイグラウンド
