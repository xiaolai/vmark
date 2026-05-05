# MCP ツールリファレンス

VMark は AI アシスタントに **4 つの複合 MCP ツール** を公開します：`session`、`workspace`、`document`、`workflow`。これらは合計 **14 アクション** をカバーし、読み書きのバックボーンに加えて、ファイル／ウィンドウのライフサイクルと GitHub Actions YAML 用の CST セーフな編集を提供します。

以前の 12 ツール／76 アクションのサーフェスは整理されました — ドキュメント内のフォーマットツール（太字、見出し、テーブルなど）は、AI エージェントがすでに Markdown のラウンドトリップで簡単にこなせる作業を重複していたためです。完全な根拠は [MCP プルーニングプラン](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) を参照してください。

::: tip 推奨ワークフロー
1. `session.get_state` を 1 回呼び出して、開いているウィンドウ、タブ、タブごとの `{filePath, dirty, revision, kind}` を確認します。
2. Markdown の場合：`document.read` → 推論 → `document.write`（安全な並行性のために `expected_revision` を渡す）。
3. GitHub Actions YAML（`kind: "yaml-workflow"`）の場合：コメントとアンカーを保持する CST セーフな編集には `workflow.apply_patch`、actionlint 診断には `workflow.validate`。
4. ファイル操作（開く、保存、閉じる、タブ切り替え）は `workspace` にあります。
:::

::: tip Mermaid ダイアグラム
MCP 経由で AI を使用して Mermaid を生成する場合は、[mermaid-validator MCP サーバー](/ja/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) のインストールを検討してください — ダイアグラムがドキュメントに到達する前に、同じ Mermaid v11 パーサーで構文エラーをキャッチします。
:::

---

## `session`

ワンショットの状況把握。1 回の呼び出しですべてのウィンドウ、すべてのタブ、サーバーの機能を発見します。

### `get_state`

引数なし。

**返り値** `{windows, capabilities}`：

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "<revision-token>",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "<revision-token>",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "<mcp-protocol-version>"
  }
}
```

`kind` の判別子は、そのタブで `document.write`（markdown 用）と `workflow.apply_patch`（yaml-workflow 用）のどちらを使うべきかを示します。

---

## `workspace`

ファイルとウィンドウのライフサイクル。ドキュメント内のことは扱いません。

### `new`

新しい無題のタブを作成します。

| パラメーター | タイプ | 必須 | 説明 |
|-----------|------|------|-----|
| `kind` | string | いいえ | `"markdown"`（デフォルト）または `"yaml-workflow"` |
| `windowLabel` | string | いいえ | 対象ウィンドウ；デフォルトはフォーカス中 |

`{tabId}` を返します。

### `open`

ディスクからファイルを開きます。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `filePath` | string | はい |
| `windowLabel` | string | いいえ |

`{tabId}` を返します。

### `save`

タブを既存のパスに保存します。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | いいえ（デフォルトはフォーカス中のタブ） |

`{filePath, revision}` を返します。

### `save_as`

タブを新しいパスに保存します。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | いいえ |
| `filePath` | string | はい |

`{revision}` を返します。

### `close`

タブを閉じます。`force` なしで未保存の作業を破棄することを拒否します。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | はい |
| `force` | boolean | いいえ |

成功時は `{closed: true}`、タブがダーティで `force` が指定されていない場合は `{closed: false, reason: "DIRTY"}` を返します。

### `switch_tab`

タブをアクティブにします。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | はい |

### `focus_window`

ウィンドウにフォーカスします。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `windowLabel` | string | はい |

---

## `document`

読み取り、書き込み、変換。サーフェスのバックボーンです。

### `read`

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | いいえ（デフォルトはフォーカス中のタブ） |

`{content, revision, filePath, kind, dirty}` を返します。書き込み前には必ず読み取ります — `revision` トークンは次の `write` に同伴される必要があります。

### `write`

ドキュメント全体のコンテンツを置き換えます。

| パラメーター | タイプ | 必須 | 説明 |
|-----------|------|------|-----|
| `tabId` | string | いいえ | 対象タブ（デフォルトはフォーカス中） |
| `content` | string | はい | 新しい全コンテンツ |
| `expected_revision` | string | いいえ | 直近の読み取りからのリビジョントークン |

`expected_revision` が指定されていてその読み取り以降にドキュメントが変更されている場合、レスポンスは現在のリビジョンを含む `STALE` 構造化エラーエンベロープになります；再読み取りしてリトライしてください。

```json
// 成功
{ "revision": "<new-revision-after-write>" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "<current-revision>" }
```

### `transform`

決定的な書き換えを適用します。現在は CJK 固有の変換（全角 ↔ ASCII 句読点変換、CJK ↔ ラテン間のスペース調整）をサポートします。

| パラメーター | タイプ | 必須 | 説明 |
|-----------|------|------|-----|
| `tabId` | string | いいえ | 対象タブ |
| `kind` | string | はい | `"cjk-format"`、`"cjk-spacing"`、または `"cjk-punctuation"` |
| `expected_revision` | string | いいえ | 並行制御トークン |

`cjk-format` はユーザーの CJK フォーマット設定をエンドツーエンドで適用します。`cjk-spacing` は CJK 文字と隣接するラテン／数字の間に単一スペースを挿入します。`cjk-punctuation` は CJK 文字に隣接する ASCII 句読点を全角形式に変換します。

`{revision}` を返します。

---

## `workflow`

GitHub Actions ワークフロー YAML 用の `actionlint` 検証と **CST セーフな外科的編集**。`kind` が `"yaml-workflow"` のタブでのみ利用可能です。

::: info `document.read` ／ `document.write` はすべてのタブで動作 — ワークフロー YAML を含む
`workflow` ツールは読み書きのバックボーンの代替では **ありません**。ワークフロータブでは以下が可能です：

- `document.read` で生の YAML テキスト（すべてのコメント付き）を取得
- `document.write` で全体を置き換え（送信した文字列はそのまま保存される — コメントを含めれば保持される）
- 部分的な編集でコメント、アンカー、キー順が確実に保持されることを **サーバー自身に保証** させたい場合は `workflow.apply_patch`

1 つのフィールドを変更しつつ他はそのままにしたい場合は `apply_patch` を使ってください（サーバーは変更しないコメントを落とすことができません）。全体を書き直したり、新しいワークフローをゼロから生成したりする場合は `document.write` を使ってください。
:::

### `apply_patch`

`IRPatch` オブジェクトの配列を適用します。パッチは VMark の CST 認識ミューテーターを通じてディスパッチされ、コメント、アンカー、キー順を保持します。YAML ファイルへの生の `document.write` ではこれらが失われます。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | いいえ |
| `patches` | IRPatch[] | はい |
| `expected_revision` | string | いいえ |

`IRPatch` は判別共用体（`kind` フィールド）です。サポートされる種類：

| `kind` | 効果 |
|---|---|
| `workflow.set` | トップレベルフィールドを設定（`{path, value}`）— `name`、`env.X` など |
| `job.set` | ジョブ上のフィールドを設定（`{jobId, path, value}`） |
| `step.set` | ステップ上のフィールドを設定（`{jobId, stepIndex, path, value}`） |
| `with.set` | ステップの `with:` ブロック内のキーを設定（`{jobId, stepIndex, key, value}`） |
| `with.remove` | ステップの `with:` ブロックからキーを削除 |
| `needs.add` ／ `needs.remove` | `needs:` からジョブ ID を追加または削除 |
| `trigger.setFilters` | トリガーのフィルター配列を置き換え — branches、paths、types など（`{event, filter, value: string[]}`） |

成功時は `{revision}`、失敗時は構造化された `STALE` ／ `INVALID_PATCH` ／ `NOT_WORKFLOW` エラーエンベロープを返します。

### `validate`

ワークフロー YAML に対して `actionlint` を実行します。

| パラメーター | タイプ | 必須 |
|-----------|------|------|
| `tabId` | string | いいえ |

`{ok, diagnostics, binaryAvailable}` を返します。各診断は `{line, col, message, severity}` を持ちます。`binaryAvailable: false` は `actionlint` がローカルにインストールされていないことを意味します；Homebrew または上流のリリースからインストールしてください。

---

## エラー

2 種類のエラー形状が現れます：

**ドメインエラー** — `success: false` を設定し、JSON エンコードされたエンベロープを `error` で返します：

```json
{ "error": "STALE", "message": "...", "current_revision": "<current-revision>" }
```

**引数形状エラー** — 必須引数の不足／不正（例: `content` フィールドなしの `document.write`）の場合、`error` は問題を説明する平文の文字列です。構造化エンベロープはドメインレベルの条件のために予約されています。

| コード | 表面化形式 | 意味 |
|---|---|---|
| `STALE` | エンベロープ | `expected_revision` が一致しなかった；再読み取りしてリトライ |
| `INVALID_PATCH` | エンベロープ | `workflow.apply_patch` が不正な `patches` 配列を受信 |
| `INVALID_TAB` | エンベロープ | `tabId` を解決できなかった |
| `INVALID_PATH` | エンベロープ | `workspace.open` が読み取れない `filePath` を受信 |
| `NOT_WORKFLOW` | エンベロープ | 非 YAML ワークフロータブで `workflow.*` が呼ばれた |
| `READ_ONLY` | エンベロープ | 読み取り専用ドキュメントへのミューテーションが試行された |
| `INTERNAL` | エンベロープ | ハンドラーで予期しないエラー |
| （平文文字列） | 文字列 | 必須引数の欠落または型違い |
