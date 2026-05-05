<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# ワークフロージーニー

VMark のジーニーには 2 つの種類があります。

- **マークダウンジーニー**(`.md`) — シングルショットのプロンプトテンプレート。元々のジーニー形式です。[AI ジーニー](/ja/guide/ai-genies)を参照してください。
- **ワークフロージーニー**(`.yml` / `.yaml`) — 明示的なデータフローでマークダウンジーニーをつなげる、複数ステップのパイプラインです。

どちらの形式も同じグローバルジーニーディレクトリに配置され、同じピッカー(`Cmd+Y`)に表示されます。ワークフロージーニーは通常のジーニー行として表示されますが、選択すると単発の AI 呼び出しではなくワークフローランナーが起動します。

## どちらを使うべきか

| 必要な処理 | 形式 |
|------|--------|
| 単一の変換(リライト、翻訳、要約) | マークダウン |
| アウトライン → ドラフト → 仕上げのパイプライン | ワークフロー |
| ステージごとに異なる AI モデルを使いたい | ワークフロー |
| 承認ゲートが必要なステップ | ワークフロー |
| あるステージの出力を次のステージの入力にしたい | ワークフロー |

単一のプロンプトで足りるならマークダウンジーニーを使ってください。ステージを組み合わせる、構造化されたデータフローを扱う、人間による承認ループが必要、といった場合はワークフローを使います。

## ファイル形式

ワークフロージーニーは YAML ファイルです。トップレベルのフィールドは次のとおりです。

| フィールド | 必須 | 用途 |
|-------|----------|---------|
| `name` | はい | 人間が読めるラベル。ピッカーは表示名として**ファイル名**を使用します。`description:` が設定されていない場合、このフィールドが説明として表示されます。 |
| `description` | いいえ | ピッカーに表示される 1 行の概要。 |
| `defaults` | いいえ | すべてのステップに適用されるデフォルトのモデル / 承認 / リミット。 |
| `env` | いいえ | `${VAR}` または `${{ env.NAME }}` として利用できる環境変数。 |
| `steps` | はい | ステップの順序付きリスト。 |

### ステップの形

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### ステップの種類

| `uses:` プレフィックス | 動作 |
|----------------|----------|
| `genie/<name>` | 対応するマークダウンジーニーを読み込み、ステップの `with:` マップでテンプレートを埋め、現在の AI プロバイダーを呼び出します。マークダウンジーニーの `{{content}}` / `{{input}}` プレースホルダーは `with.input` を自動的に拾います。 |
| `action/read-file` | ワークスペース相対パスのファイルを読み込みます。出力はファイルの本文です。 |
| `action/save-file` | `with.input` を `with.path` に書き出します。 |
| `action/notify` | `with.message` をログに出力します。 |
| `action/copy` | `with.input` をそのまま返します(チェーンに便利)。 |

### 式

任意の `with:` の値の中で使えます。

| 構文 | 解決される値 |
|--------|-------------|
| `${{ steps.ID.outputs.FIELD }}` | 先行ステップの特定の出力フィールド。 |
| `${{ steps.ID.output }}` | 先行ステップの `outputs.text` のシュガー。 |
| `${{ env.NAME }}` | ワークフローの `env:` の値。 |
| `${VAR}` | 上記と同じ、レガシー形式。 |
| `stepId.output`(文字列全体) | `${{ steps.stepId.output }}` のレガシーエイリアス。 |

未知のステップ / フィールドへの参照は、AI 呼び出しの前、パラメータ解決時にステップを失敗させます。

### テンプレートのバインディング

`genie/<name>` ステップが実行されると、そのマークダウンジーニーのプロンプトテンプレートは次のルールで埋められます。

- `{{input}}` → `with.input`
- `{{content}}` → `with.content` があればそれ、なければ `with.input`(どちらもなければ致命的エラー)
- `{{context}}` → `with.context` があればそれ、なければ空文字列(致命的にはなりません)
- `{{any-other-key}}` → `with.<key>`(欠けていれば致命的エラー)

つまり、**既存のマークダウンジーニーはそのままワークフローの中で動作します** — `with: { input: "..." }` で呼び出せば、`{{content}}` プレースホルダーがエイリアスチェーン経由で値を拾ってくれます。

### 承認ゲート

ステップに `approval: ask`(またはワークフローの `defaults.approval: ask`)が指定されている場合、ランナーは一時停止し、解決済みのプロンプトプレビューとモデルを表示するダイアログを開き、ユーザーの判定を待ってからプロバイダーを呼び出します。Esc は拒否です。タイムアウトは、ステップの `limits.timeout` と 10 分の小さいほうです。

## サンプル

VMark には同梱ジーニーの中にサンプルワークフロー `outline-and-polish.yml` が含まれています。カスタマイズするには、ユーザージーニーディレクトリにコピーしてください。

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` は構造化されたアウトラインを生成し、`polish` ステップがその出力を明確さのためにリライトします。2 つの `genie/*` 参照は、同梱マークダウンジーニーの `structure/outline.md` と `editing/polish.md` に解決されます。

## キャンセル、タイムアウト、リミット

- **キャンセル** — ワークフローのサイドパネルで Stop をクリックします。ランナーは進行中の CLI プロバイダーの子プロセスを 1 ティック以内に終了させ、進行中の REST リクエストを破棄します。
- **ステップごとのタイムアウト** — `tokio::time::timeout(step.limits.timeout)` でラップされています。経過すると、ステップは「Timed out after Xs」で失敗し、下流のステップはスキップされます。
- **出力上限** — 1 ステップの出力は 5 MB に制限されています。暴走したプロバイダーはキャンセルと「Provider output exceeded 5 MB cap」をトリガーします。

## 関連項目

- [AI ジーニー](/ja/guide/ai-genies) — マークダウンジーニーの形式とオーサリング。
- [ワークフロービューア](/ja/guide/workflow-viewer) — ここで使われているのと同じ React Flow のサイドパネル。元々は GitHub Actions ワークフロー用です。

</div>
