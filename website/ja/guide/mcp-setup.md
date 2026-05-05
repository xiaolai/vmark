# AI 統合 (MCP)

VMark には AI アシスタント（Claude など）がエディタと直接やり取りできる組み込み MCP（Model Context Protocol）サーバーが搭載されています。

## MCP とは?

[Model Context Protocol](https://modelcontextprotocol.io/)は、AI アシスタントが外部ツールやアプリケーションとやり取りするためのオープン標準です。VMark の MCP サーバーはエディタ機能をツールとして公開し、AI アシスタントが次のことを行えるようにします:

- ドキュメントコンテンツの読み取りと書き込み
- 書式設定の適用と構造の作成
- ドキュメントのナビゲーションと管理
- 特別なコンテンツの挿入（数式、ダイアグラム、Wiki リンク）

## クイックセットアップ

VMark はワンクリックインストールで AI アシスタントを簡単に接続できます。

### 1. MCP サーバーを有効化

**設定 → 統合** を開き、MCP サーバーを有効にします:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP Server Settings" />
</div>

- **MCP サーバーを有効化** — AI 接続を許可するためにオンにする
- **起動時に開始** — VMark 起動時に自動開始
- **編集を自動承認** — プレビューなしで AI の変更を適用する（下記参照）

### 2. 設定をインストール

AI アシスタント用の **インストール** をクリックします:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

サポートされている AI アシスタント:
- **Claude Desktop** — Anthropic のデスクトップ App
- **Claude Code** — 開発者向け CLI
- **Codex CLI** — OpenAI のコーディングアシスタント
- **Gemini CLI** — Google の AI アシスタント

::: info その他の MCP 互換クライアント
Cursor、Windsurf などの MCP 互換クライアントも VMark の MCP サーバーに接続できます。MCP サーバーバイナリのパスを指定して手動で設定してください（下記の[手動設定](#手動設定)を参照）。
:::

#### ステータスアイコン

各プロバイダーにはステータスインジケーターが表示されます:

| アイコン | ステータス | 意味 |
|--------|---------|-----|
| ✓ 緑 | 有効 | 設定が正しく機能している |
| ⚠ 黄 | パスの不一致 | VMark が移動されました — **修復** をクリック |
| ✗ 赤 | バイナリが見つからない | MCP バイナリが見つかりません — VMark を再インストール |
| ○ グレー | 未設定 | インストールされていません — **インストール** をクリック |

::: tip VMark を移動しましたか?
VMark.app を別の場所に移動すると、ステータスに黄色の「パスの不一致」が表示されます。**修復** ボタンをクリックするだけで、新しいパスで設定が更新されます。
:::

### 3. AI アシスタントを再起動

インストールまたは修復後、**AI アシスタントを完全に再起動**（終了して再起動）して新しい設定を読み込みます。VMark は各設定変更後にリマインダーを表示します。

### 4. 試してみる

AI アシスタントで次のコマンドを試してください:
- *「VMark のドキュメントに何がある?」*
- *「VMark に量子コンピューティングの概要を書いて」*
- *「ドキュメントに目次を追加して」*

## 動作確認

Claude に質問し、答えを VMark ドキュメントに直接書かせてみましょう:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop using VMark MCP" />
  <p class="screenshot-caption">Claude Desktop が<code>document</code> → <code>set_content</code>を呼び出して VMark に書き込む</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Content rendered in VMark" />
  <p class="screenshot-caption">コンテンツは VMark に即座に表示され、完全にフォーマットされます</p>
</div>

<!-- Styles in style.css -->

## 手動設定

手動で設定する場合、設定ファイルの場所は次のとおりです:

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）または`%APPDATA%\Claude\claude_desktop_config.json`（Windows）を編集します:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

`~/.claude.json`またはプロジェクトの`.mcp.json`を編集します:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`を編集します:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Gemini CLI

`~/.gemini/settings.json`を編集します:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip バイナリパスの確認
macOS では、MCP サーバーバイナリは VMark.app 内にあります:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Windows では:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Linux では:
- `/usr/bin/vmark-mcp-server`（またはインストールした場所）

ポートは自動検出されます — `args`は不要です。
:::

## 仕組み

```text
AI Assistant <--stdio--> MCP Server <--WebSocket--> VMark Editor
```

1. **VMark が WebSocket ブリッジを起動** し、起動時に利用可能なポートで待機します
2. **MCP サーバー** が VMark のアプリデータディレクトリからポートと認証トークンを読み取ります
3. **MCP サーバー** が WebSocket ブリッジを通じて接続・認証します
4. **AI アシスタント** が stdio 経由で MCP サーバーと通信します
5. **コマンドがリレー** され、ブリッジを通じて VMark のエディタに届きます

## 利用可能な機能

接続すると、AI アシスタントは次のことができます:

| カテゴリ | 機能 |
|--------|-----|
| **Document** | コンテンツの読み取り/書き込み、検索、置換 |
| **Selection** | 選択の取得/設定、選択されたテキストの置換 |
| **Formatting** | 太字、斜体、コード、リンクなど |
| **Blocks** | 見出し、段落、コードブロック、引用 |
| **Lists** | 箇条書き、順序付き、タスクリスト |
| **Tables** | 行/列の挿入、変更 |
| **Special** | 数式、Mermaid ダイアグラム、Wiki リンク |
| **Workspace** | ドキュメントの開閉/保存、ウィンドウ管理 |

完全なドキュメントは[MCP ツールリファレンス](/ja/guide/mcp-tools)を参照してください。

## MCP ステータスの確認

VMark は MCP サーバーのステータスを確認する複数の方法を提供します:

### ステータスバーインジケーター

ステータスバーの右側に **MCP** インジケーターが表示されます:

| 色 | ステータス |
|----|---------|
| 緑 | 接続済みで実行中 |
| グレー | 切断済みまたは停止中 |
| 点滅（アニメーション） | 起動中 |

起動は通常 1〜2 秒以内に完了します。

インジケーターをクリックして詳細ステータスダイアログを開きます。

### ステータスダイアログ

**ヘルプ → MCP サーバーステータス** またはステータスバーインジケーターをクリックしてアクセスします。

ダイアログには以下が表示されます:
- 接続の健全性（正常 / エラー / 停止）
- ブリッジの実行状態とポート
- サーバーバージョン
- 利用可能なツール（12）とリソース（4）
- 最終ヘルスチェック時刻
- コピーボタン付きの利用可能なツールの完全リスト

### 設定パネル

**設定 → 統合** では、サーバーが実行中の場合に以下が表示されます:
- バージョン番号
- ツールとリソースの数
- **接続テスト** ボタン — ヘルスチェックを実行
- **詳細を表示** ボタン — ステータスダイアログを開く

## トラブルシューティング

### 「接続が拒否されました」または「アクティブなエディタがありません」

- VMark が実行中でドキュメントが開いていることを確認してください
- 設定 → 統合で MCP サーバーが有効になっていることを確認してください
- MCP ブリッジが「実行中」ステータスを示しているか確認してください
- 接続が中断された場合は VMark を再起動してください

### VMark 移動後のパスの不一致

VMark.app を別の場所（例: ダウンロードからアプリケーションへ）に移動した場合、設定は古いパスを指します:

1. **設定 → 統合** を開く
2. 影響を受けるプロバイダーの横にある黄色の⚠警告アイコンを探す
3. **修復** をクリックしてパスを更新する
4. AI アシスタントを再起動する

### AI アシスタントにツールが表示されない

- 設定のインストール後に AI アシスタントを再起動してください
- 設定がインストールされているか確認してください（設定で緑のチェックマーク）
- AI アシスタントのログで MCP 接続エラーを確認してください

### 「アクティブなエディタがありません」でコマンドが失敗する

- VMark でドキュメントタブがアクティブになっていることを確認してください
- エディタエリアをクリックしてフォーカスを当ててください
- 一部のコマンドはまずテキストを選択する必要があります

## 提案システムと自動承認

デフォルトでは、AI アシスタントがドキュメントを変更（挿入、置換、削除）する場合、VMark は承認を必要とする **提案** を作成します:

- **Insert** — 新しいテキストがゴーストテキストのプレビューとして表示される
- **Replace** — 元のテキストに取り消し線が付き、新しいテキストがゴーストテキストとして表示される
- **Delete** — 削除されるテキストに取り消し線が付いて表示される

**Enter** で承認、**Escape** で拒否します。これにより元に戻す/やり直しの履歴が保持され、完全なコントロールが得られます。

### 自動承認モード

::: warning 注意して使用してください
**編集を自動承認** を有効にすると、提案プレビューをバイパスして、AI の変更が即座に適用されます。AI アシスタントを信頼し、より速い編集を望む場合にのみ有効にしてください。
:::

自動承認が有効の場合:
- 変更はプレビューなしで直接適用されます
- 元に戻す（Mod+Z）は引き続き変更を元に戻せます
- 応答メッセージには透明性のために「(auto-approved)」が含まれます

この設定は次のような場合に役立ちます:
- 迅速な AI 支援ライティングワークフロー
- 明確に定義されたタスクを持つ信頼できる AI アシスタント
- 各変更のプレビューが現実的でないバッチ操作

## セキュリティノート

- MCP サーバーはローカル接続（localhost）のみを受け付けます
- データは外部サーバーに送信されません
- すべての処理はあなたのマシン上で行われます
- WebSocket ブリッジはローカルでのみアクセス可能です
- 意図しない変更を防ぐため、自動承認はデフォルトで無効になっています

## 次のステップ

- 利用可能なすべての[MCP ツール](/ja/guide/mcp-tools)を探索する
- [キーボードショートカット](/ja/guide/shortcuts)について学ぶ
- その他の[機能](/ja/guide/features)をチェックする
