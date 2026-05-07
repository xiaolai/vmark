# AI プロバイダー

VMark の[AI Genie](/ja/guide/ai-genies)は提案を生成するために AI プロバイダーが必要です。ローカルにインストールされた CLI ツールを使用するか、REST API に直接接続できます。

## クイックセットアップ

最速で始める方法：

1. **設定 > 統合** を開く
2. **検出** をクリックしてインストールされた CLI ツールをスキャン
3. CLI が見つかった場合（例: Claude、Gemini）、それを選択 — 完了
4. CLI が利用できない場合は、REST プロバイダーを選択し、API キーを入力してモデルを選択

一度にアクティブにできるプロバイダーは 1 つだけです。

## CLI プロバイダー

CLI プロバイダーはローカルにインストールされた AI ツールを使用します。VMark はそれらをサブプロセスとして実行し、出力をエディタにストリーミングします。

| プロバイダー | CLI コマンド | インストール |
|------------|-----------|-----------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### CLI 検出の仕組み

設定 > 統合で **検出** をクリックします。VMark は各 CLI コマンドの `$PATH` を検索して可用性を報告します。CLI が見つかった場合、そのラジオボタンが選択可能になります。

### メリット

- **API キー不要** — CLI は既存のログインを使用して認証を処理
- **劇的に安価** — CLI ツールはサブスクリプションプラン（例: Claude Max、ChatGPT Plus/Pro、Google One AI Premium）を使用し、固定の月額料金がかかります。REST API プロバイダーはトークンごとに課金され、高負荷使用では 10〜30 倍のコストになる可能性があります
- **CLI の設定を使用** — モデルの設定、システムプロンプト、請求は CLI 自体によって管理されます

::: tip 開発者向けのサブスクリプション vs API
これらのツールをバイブコーディング（Claude Code、Codex CLI、Gemini CLI）にも使用している場合、同じサブスクリプションが VMark の AI Genie とコーディングセッションの両方をカバーします — 追加費用なし。
:::

### セットアップ: Claude CLI

1. Claude Code をインストール: `npm install -g @anthropic-ai/claude-code`
2. ターミナルで `claude` を一度実行して認証
3. VMark で **検出** をクリックして **Claude** を選択

### セットアップ: Gemini CLI

1. Gemini CLI をインストール: `npm install -g @google/gemini-cli`（または[公式リポジトリ](https://github.com/google-gemini/gemini-cli)から）
2. `gemini` を一度実行して Google アカウントで認証
3. VMark で **検出** をクリックして **Gemini** を選択

## REST API プロバイダー

REST プロバイダーはクラウド API に直接接続します。各プロバイダーにはエンドポイント、API キー、モデル名が必要です。

| プロバイダー | デフォルトエンドポイント | 環境変数 |
|------------|----------------------|---------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Google AI | _（組み込み）_ | `GOOGLE_API_KEY` または `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### 設定フィールド

REST プロバイダーを選択すると、3 つのフィールドが表示されます：

- **API エンドポイント** — ベース URL（Google AI は固定エンドポイントを使用するため非表示）
- **API キー** — シークレットキー（メモリのみに保存 — ディスクには書き込まれない）
- **モデル** — モデル識別子（例: `claude-sonnet-4-5-20250929`、`gpt-4o`、`gemini-2.0-flash`）

### 環境変数の自動入力

VMark は起動時に標準的な環境変数を読み取ります。`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、または `GEMINI_API_KEY` がシェルプロファイルに設定されている場合、そのプロバイダーを選択すると API キーフィールドが自動的に入力されます。

これにより、`~/.zshrc` または `~/.bashrc` でキーを一度設定できます：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

その後 VMmark を再起動 — 手動でキーを入力する必要はありません。

### セットアップ: Anthropic（REST）

1. [console.anthropic.com](https://console.anthropic.com)から API キーを取得
2. VMark 設定 > 統合で **Anthropic** を選択
3. API キーを貼り付け
4. モデルを選択（デフォルト: `claude-sonnet-4-5-20250929`）

### セットアップ: OpenAI（REST）

1. [platform.openai.com](https://platform.openai.com)から API キーを取得
2. VMark 設定 > 統合で **OpenAI** を選択
3. API キーを貼り付け
4. モデルを選択（デフォルト: `gpt-4o`）

### セットアップ: Google AI（REST）

1. [aistudio.google.com](https://aistudio.google.com)から API キーを取得
2. VMark 設定 > 統合で **Google AI** を選択
3. API キーを貼り付け
4. モデルを選択（デフォルト: `gemini-2.0-flash`）

### セットアップ: Ollama API（REST）

ローカルの Ollama インスタンスに REST 形式でアクセスしたい場合、または Ollama がネットワーク上の別のマシンで実行されている場合に使用します。

1. Ollama が実行されていることを確認: `ollama serve`
2. VMark 設定 > 統合で **Ollama (API)** を選択
3. エンドポイントを `http://localhost:11434`（または Ollama ホスト）に設定
4. API キーは空欄のまま
5. モデルをプルしたモデル名に設定（例: `llama3.2`）

## プロバイダーの選択

| 状況 | 推奨 |
|------|------|
| Claude Code が既にインストールされている | **Claude（CLI）** — ゼロ設定、サブスクリプションを使用 |
| Codex または Gemini が既にインストールされている | **Codex / Gemini（CLI）** — サブスクリプションを使用 |
| プライバシー/オフラインが必要 | Ollama をインストール → `http://localhost:11434` で **Ollama（API）** |
| カスタムまたは自己ホストモデル | エンドポイント付きの **Ollama（API）** |
| 最安値のクラウドオプションが欲しい | **任意の CLI プロバイダー** — サブスクリプションは API より劇的に安価 |
| サブスクリプションなし、軽い利用のみ | API キー環境変数を設定 → **REST プロバイダー**（トークン課金） |
| 最高品質の出力が必要 | **Claude（CLI）** または`claude-sonnet-4-5-20250929`付きの **Anthropic（REST）** |

## ジーニーごとのモデルオーバーライド

個々の Genie は `model` フロントマターフィールドを使用してプロバイダーのデフォルトモデルをオーバーライドできます：

```markdown
---
name: quick-fix
description: クイック文法修正
scope: selection
model: claude-haiku-4-5-20251001
---
```---
name: quick-fix
description: クイック文法修正
scope: selection
model: claude-haiku-4-5-20251001
---
```

これは単純なタスクを高速/低コストモデルにルーティングしながら強力なデフォルトを維持するのに便利です。

## 信頼性とタイムアウト

VMark はすべてのプロバイダー呼び出しを保護しており、ハングした CLI や不正な API レスポンスがエディタをブロックすることはありません:

- **CLI サブプロセスタイムアウト**: すべての CLI プロバイダーの呼び出しは実行タイムアウト下で実行されます。CLI が応答しない場合、VMark は呼び出しをキャンセルし、エラーを Genie に返し、ワーカーを解放します — 暴走したサブプロセスによってスレッドプールがブロックされることはありません。
- **REST JSON パース安全性**: REST プロバイダーが予期しないレスポンス形状（HTML エラーページ、切り捨てられた JSON、上流の変更後のスキーマドリフト）を返した場合、VMark は AI リスナーを永遠に待機させる代わりに、型付きエラーをフロントエンドに返します。Genie のステータスバナーにエラーが表示され、再試行するオプションが提供されます。
- **キャンセレーショントークン**: 長時間実行中の Genie またはワークフローステップはいつでもキャンセルできます — Genie ピッカーでキャンセルするか、パネルを閉じると、実行中のリクエストがクリーンに中止されます。
- **共有 HTTP クライアント**: REST プロバイダーは単一のコネクションプール済み `reqwest` クライアントを共有するため、連続した Genie 実行ごとに TCP/TLS ハンドシェイクのコストを払う必要はありません。
- **Windows パス検出**: Windows では、VMark は CLI を検出する際にユーザーの完全な `PATH`（PowerShell 専用エントリを含む）を読み取るため、ターミナルで動作するユーザーインストールのツールは VMark 内でも動作します。

## セキュリティノート

- **API キーはエフェメラル** — メモリのみに保存、ディスクや `localStorage` には書き込まれない
- **環境変数** は起動時に一度読み取られ、メモリにキャッシュされる
- **CLI プロバイダー** は既存の CLI 認証を使用 — VMark は認証情報を見ない
- **すべてのリクエストは直接** マシンからプロバイダーへ送信 — 中間に VMark サーバーはない

## トラブルシューティング

**「AI プロバイダーが利用できません」** — **検出** をクリックして CLI をスキャンするか、API キーで REST プロバイダーを設定してください。

**CLI が「見つかりません」と表示される** — CLI が `$PATH` にありません。インストールするかシェルプロファイルを確認してください。macOS では、GUI アプリがターミナルの `$PATH` を継承しない場合があります — パスを `/etc/paths.d/` に追加してみてください。

**CLI が「見つかりません」と表示される** — CLI が `$PATH` にありません。インストールするかシェルプロファイルを確認してください。macOS では、GUI アプリがターミナルの `$PATH` を継承しない場合があります — パスを `/etc/paths.d/` に追加してみてください。

**CLI がハング / 応答なし** — VMark の実行タイムアウトが自動的に呼び出しをキャンセルします。Genie ステータスバナーにエラーが表示されます。特定の CLI が常にタイムアウトに達する場合は、ターミナルから一度実行して動作を確認し、インタラクティブな認証が必要かどうか確認してください。

**REST プロバイダーが 401 を返す** — API キーが無効か期限切れです。プロバイダーのコンソールで新しいキーを生成してください。

**REST プロバイダーが 429 を返す** — レート制限に達しました。少し待ってから再試行するか、別のプロバイダーに切り替えてください。

**REST プロバイダーが不正な / 予期しない JSON を返す** — VMark は型付きパースエラーを表示します（例: 「list_models が予期しないレスポンス形状を返しました」）。エンドポイント URL と、選択したプロバイダータイプの API コントラクトが一致しているか確認してください。一部のセルフホストゲートウェイは OpenAI 互換 URL を公告しますが、異なるスキーマを提供する場合があります。

**応答が遅い** — CLI プロバイダーにはサブプロセスのオーバーヘッドがあります。より速い応答のためには、直接接続する REST プロバイダーを使用してください。最速のローカルオプションには、小さなモデルで Ollama を使用してください。

**モデルが見つからないエラー** — モデル識別子がプロバイダーが提供するものと一致しません。有効なモデル名についてはプロバイダーのドキュメントを確認してください。

## 関連情報

- [AI Genie](/ja/guide/ai-genies) — AI ライティング支援の使用方法
- [MCP セットアップ](/ja/guide/mcp-setup) — Model Context Protocol による AI 外部統合
