# MCP 工具參考

VMark 對 AI 助理開放**四個複合 MCP 工具**：`session`、`workspace`、`document` 與 `workflow`。這四個工具合計提供 **14 個操作** —— 涵蓋讀寫主軸、檔案與視窗生命週期，以及針對 GitHub Actions YAML 的 CST 安全編輯。

先前的 12 工具 / 76 操作介面已被精簡，原因是文件內的格式化工具(粗體、標題、表格等)與 AI 代理透過 Markdown 來回轉換就能輕鬆完成的工作高度重複。完整的取捨理由請參閱 [MCP 精簡計畫](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md)。

::: tip 建議的工作流
1. 呼叫 `session.get_state` 一次，取得所有開啟的視窗、分頁，以及每個分頁的 `{filePath, dirty, revision, kind}`。
2. 對 Markdown 而言：`document.read` → 推理 → `document.write`(傳入 `expected_revision` 確保並行安全)。
3. 對 GitHub Actions YAML(`kind: "yaml-workflow"`)而言：以 `workflow.apply_patch` 進行 CST 安全編輯，保留註解與錨點；以 `workflow.validate` 取得 actionlint 診斷。
4. 檔案操作(開啟、儲存、關閉、切換分頁)集中在 `workspace`。
:::

::: tip Mermaid 圖表
透過 MCP 讓 AI 產生 Mermaid 圖表時，建議搭配安裝 [mermaid-validator MCP 伺服器](/zh-TW/guide/mermaid#mermaid-驗證器-mcp-伺服器-語法檢查) —— 它使用相同的 Mermaid v11 解析器，在圖表進入文件之前先攔截語法錯誤。
:::

---

## `session`

一次呼叫即可完成定位：透過單一請求探索所有視窗、分頁與伺服器能力。

### `get_state`

無參數。

**回傳** `{windows, capabilities}`：

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
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.1.0"
  }
}
```

`kind` 這個判別欄位告訴你某個分頁應使用 `document.write`(適用於 markdown)還是 `workflow.apply_patch`(適用於 yaml-workflow)。

---

## `workspace`

只負責檔案與視窗的生命週期，不處理文件內容。

### `new`

建立一個新的未命名分頁。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `kind` | string | 否 | `"markdown"`(預設值)或 `"yaml-workflow"` |
| `windowLabel` | string | 否 | 目標視窗；未指定時使用聚焦中的視窗 |

回傳 `{tabId}`。

### `open`

從磁碟開啟檔案。

| 參數 | 型別 | 必填 |
|------|------|------|
| `filePath` | string | 是 |
| `windowLabel` | string | 否 |

回傳 `{tabId}`。

### `save`

將分頁內容存回原本的路徑。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否(預設為聚焦中的分頁) |

回傳 `{filePath, revision}`。

### `save_as`

將分頁另存至新路徑。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `filePath` | string | 是 |

回傳 `{revision}`。

### `close`

關閉分頁。若未指定 `force`，遇到未儲存的內容會拒絕關閉。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 是 |
| `force` | boolean | 否 |

成功時回傳 `{closed: true}`；若分頁有未儲存變更且未提供 `force`，則回傳 `{closed: false, reason: "DIRTY"}`。

### `switch_tab`

啟用某個分頁。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 是 |

### `focus_window`

讓某個視窗取得焦點。

| 參數 | 型別 | 必填 |
|------|------|------|
| `windowLabel` | string | 是 |

---

## `document`

讀取、寫入、轉換 —— 整個介面的主軸。

### `read`

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否(預設為聚焦中的分頁) |

回傳 `{content, revision, filePath, kind, dirty}`。寫入前務必先讀取 —— 下一次的 `write` 必須帶上這次讀取所拿到的 `revision` 標記。

### `write`

整份文件內容替換。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `tabId` | string | 否 | 目標分頁(預設為聚焦中的分頁) |
| `content` | string | 是 | 全新的完整內容 |
| `expected_revision` | string | 否 | 上一次讀取拿到的 revision 標記 |

如果有提供 `expected_revision`，但文件自上次讀取後已變動，回應會是 `STALE` 結構化錯誤封包，並附上目前的 revision；此時請重新讀取後再嘗試。

```json
// 成功
{ "revision": "rev-newAfterWrite" }

// 過期
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

套用一個確定性的改寫操作。目前支援 CJK 相關的轉換(全形 ↔ ASCII 標點互換、CJK ↔ 拉丁字母間距)。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `tabId` | string | 否 | 目標分頁 |
| `kind` | string | 是 | `"cjk-format"`、`"cjk-spacing"` 或 `"cjk-punctuation"` |
| `expected_revision` | string | 否 | 並行控制標記 |

`cjk-format` 會套用使用者目前的 CJK 排版設定，從頭執行一遍。`cjk-spacing` 會在 CJK 字元與相鄰的拉丁字母或數字之間補上單一空格。`cjk-punctuation` 會把緊鄰 CJK 字元的 ASCII 標點轉換成對應的全形形式。

回傳 `{revision}`。

---

## `workflow`

針對 GitHub Actions 工作流程 YAML 提供 `actionlint` 驗證與 **CST 安全的精準編輯**。僅在 `kind` 為 `"yaml-workflow"` 的分頁上可用。

::: info `document.read` 與 `document.write` 對所有分頁皆有效 —— 包含 workflow YAML
`workflow` 工具**並不是**取代讀寫主軸的東西。針對 workflow 分頁，你仍然可以：

- 用 `document.read` 取得原始 YAML 文字(含所有註解)
- 用 `document.write` 整份替換(送進去什麼字串就原封不動寫入 —— 只要你保留註解，註解就會留下來)
- 在只想改一個欄位、其他都保持不變時用 `workflow.apply_patch` —— 由伺服器本身保證註解、錨點與鍵的順序都不會掉失(伺服器不會丟掉它沒有去改的註解)

簡而言之：要進行單點修改、其餘原樣保留時用 `apply_patch`；要整份重寫或從零產生新工作流程時用 `document.write`。
:::

### `apply_patch`

套用一組 `IRPatch` 物件陣列。每個 patch 都會經過 VMark 的 CST 感知變更器，能保留註解、錨點以及鍵的順序；若用原始 `document.write` 直接寫入 YAML 檔，這些都會丟失。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `patches` | IRPatch[] | 是 |
| `expected_revision` | string | 否 |

`IRPatch` 是以 `kind` 欄位區分的判別聯合型別。支援的種類如下：

| `kind` | 效果 |
|---|---|
| `workflow.set` | 設定頂層欄位(`{path, value}`) —— `name`、`env.X` 等 |
| `job.set` | 在某個 job 上設定欄位(`{jobId, path, value}`) |
| `step.set` | 在某個 step 上設定欄位(`{jobId, stepIndex, path, value}`) |
| `with.set` | 在某個 step 的 `with:` 區塊中設定鍵(`{jobId, stepIndex, key, value}`) |
| `with.remove` | 從某個 step 的 `with:` 區塊中移除鍵 |
| `needs.add` / `needs.remove` | 在 `needs:` 中新增或移除一個 job ID |
| `trigger.setFilters` | 替換觸發器的篩選陣列 —— branches、paths、types 等(`{event, filter, value: string[]}`) |

成功時回傳 `{revision}`；失敗時回傳結構化的 `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW` 錯誤封包。

### `validate`

對工作流程 YAML 執行 `actionlint`。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |

回傳 `{ok, diagnostics, binaryAvailable}`。每筆診斷帶有 `{line, col, message, severity}`。`binaryAvailable: false` 代表本機沒有安裝 `actionlint`；可透過 Homebrew 或上游 Releases 安裝。

---

## 錯誤

錯誤有兩種形態：

**領域錯誤(Domain errors)** —— 將 `success` 設為 `false`，並在 `error` 欄位以 JSON 格式回傳結構化封包：

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**參數形態錯誤(Argument-shape errors)** —— 對於必要參數遺漏或型別不符(例如 `document.write` 沒帶 `content`),`error` 欄位是直接描述問題的純字串。結構化封包僅保留給領域層級的條件。

| 代碼 | 出現形式 | 含義 |
|---|---|---|
| `STALE` | 結構化封包 | `expected_revision` 不符；請重新讀取後重試 |
| `INVALID_PATCH` | 結構化封包 | `workflow.apply_patch` 收到格式錯誤的 `patches` 陣列 |
| `INVALID_TAB` | 結構化封包 | 無法解析 `tabId` |
| `INVALID_PATH` | 結構化封包 | `workspace.open` 收到無法讀取的 `filePath` |
| `NOT_WORKFLOW` | 結構化封包 | 在非 yaml-workflow 分頁上呼叫 `workflow.*` |
| `READ_ONLY` | 結構化封包 | 對唯讀文件嘗試進行變更操作 |
| `INTERNAL` | 結構化封包 | 處理器發生非預期錯誤 |
| (純字串) | 字串 | 必要參數遺漏或型別錯誤 |
