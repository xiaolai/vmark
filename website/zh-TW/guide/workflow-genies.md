<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# 工作流程精靈

VMark 的精靈（Genies）有兩種型態：

- **Markdown 精靈**（`.md`）—— 單次提示詞範本，也是最初的精靈格式。詳見 [AI 精靈](/zh-TW/guide/ai-genies)。
- **工作流程精靈**（`.yml` / `.yaml`）—— 多步驟流程，將多個 Markdown 精靈以明確的資料流串接起來。

兩種格式存放在同一個全域精靈目錄，並出現在同一個挑選器中（`Cmd+Y`）。工作流程精靈在挑選器中顯示為一般的精靈項目；選取後會啟動工作流程執行器，而非觸發單次 AI 呼叫。

## 何時該選用哪一種

| 需求 | 格式 |
|------|------|
| 單一轉換（改寫、翻譯、摘要） | Markdown |
| 大綱 → 草稿 → 潤飾的流程 | 工作流程 |
| 不同階段使用不同的 AI 模型 | 工作流程 |
| 步驟需要核准把關 | 工作流程 |
| 某一階段的輸出餵給下一階段 | 工作流程 |

如果單一提示詞就能解決，就用 Markdown 精靈。若需要組合多個階段、結構化資料流或人為介入核准，就改用工作流程。

## 檔案格式

工作流程精靈是一份 YAML 檔案。最上層欄位如下：

| 欄位 | 必填 | 用途 |
|------|------|------|
| `name` | 是 | 易讀的標籤。挑選器以**檔名**作為顯示名稱；若未設定 `description:`，此欄位則作為描述顯示。 |
| `description` | 否 | 出現在挑選器中的單行摘要。 |
| `defaults` | 否 | 套用在每個步驟上的預設模型／核准方式／限制。 |
| `env` | 否 | 環境變數，可透過 `${VAR}` 或 `${{ env.NAME }}` 取用。 |
| `steps` | 是 | 依序排列的步驟清單。 |

### 步驟結構

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

### 步驟類型

| `uses:` 前綴 | 行為 |
|--------------|------|
| `genie/<name>` | 載入對應的 Markdown 精靈，以該步驟的 `with:` 對應表填入範本，再呼叫目前啟用的 AI 服務商。Markdown 精靈中的 `{{content}}` / `{{input}}` 佔位符會自動接收 `with.input` 的值。 |
| `action/read-file` | 讀取相對於工作區的路徑，輸出為檔案內容。 |
| `action/save-file` | 將 `with.input` 寫入 `with.path`。 |
| `action/notify` | 記錄 `with.message`。 |
| `action/copy` | 原樣回傳 `with.input`（適合用於串接）。 |

### 運算式

任何 `with:` 值之中皆可使用：

| 語法 | 解析結果 |
|------|----------|
| `${{ steps.ID.outputs.FIELD }}` | 前一步驟特定輸出欄位的值。 |
| `${{ steps.ID.output }}` | 前一步驟 `outputs.text` 的簡寫。 |
| `${{ env.NAME }}` | 工作流程 `env:` 中的值。 |
| `${VAR}` | 與上同義，舊式寫法。 |
| `stepId.output`（整段字串） | `${{ steps.stepId.output }}` 的舊式別名。 |

若引用了不存在的步驟或欄位，會在參數解析階段直接讓該步驟失敗，並不會觸發任何 AI 呼叫。

### 範本綁定

當 `genie/<name>` 步驟執行時，其 Markdown 精靈的提示詞範本依下列規則填入：

- `{{input}}` → `with.input`
- `{{content}}` → 若有 `with.content` 則用之，否則用 `with.input`（兩者皆無則致命錯誤）
- `{{context}}` → 若有 `with.context` 則用之，否則為空字串（不會致命錯誤）
- `{{any-other-key}}` → `with.<key>`（缺少則致命錯誤）

也就是說，**既有的 Markdown 精靈無需修改即可在工作流程中使用** —— 用 `with: { input: "..." }` 呼叫它，`{{content}}` 佔位符就會透過上述別名鏈接收到值。

### 核准把關

當步驟設定 `approval: ask`（或工作流程 `defaults.approval: ask`）時，執行器會暫停並開啟對話框，顯示已解析的提示詞預覽與模型，等待使用者裁定後再呼叫服務商。按 Esc 等同拒絕。逾時時間取步驟 `limits.timeout` 與 10 分鐘兩者中的較小值。

## 範例

VMark 隨附一份範例工作流程，位於內建精靈中的 `outline-and-polish.yml`。將它複製到您的使用者精靈目錄即可自訂：

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

`genie/outline` 會產生一份結構化大綱；接著 `polish` 步驟會將其輸出改寫得更清晰。兩個 `genie/*` 引用會解析到內建的 Markdown 精靈 `structure/outline.md` 與 `editing/polish.md`。

## 取消、逾時與限制

- **取消** —— 點按工作流程側邊面板中的「停止」。執行器會在下一個 tick 內終止任何進行中的 CLI 服務商子程序，並中止進行中的 REST 請求。
- **單步驟逾時** —— 以 `tokio::time::timeout(step.limits.timeout)` 包裹。逾時後該步驟以「Timed out after Xs」失敗，下游步驟一併略過。
- **輸出上限** —— 單一步驟的輸出上限為 5 MB。若服務商失控輸出，將觸發取消並回報「Provider output exceeded 5 MB cap」。

## 延伸閱讀

- [AI 精靈](/zh-TW/guide/ai-genies) —— Markdown 精靈格式與撰寫方式。
- [工作流程檢視器](/zh-TW/guide/workflow-viewer) —— 此處所用的同一個 React Flow 側邊面板，最初是為 GitHub Actions 工作流程設計的。

</div>
