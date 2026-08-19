# MCP 工具參考

VMark 對 AI 助理開放**九個複合 MCP 工具**：`session`、`workspace`、`document`、`workflow`、`selection`、`browser`、`browser_read`、`coherence` 與 `coherence_resolve`。這些工具合計涵蓋編輯器讀寫主軸、檔案與視窗生命週期、CST 安全的工作流程編輯、針對選取範圍的精準編輯、受限的瀏覽器導覽，以及工作區一致性層的視圖。

這九個之中有三個——`session`、`browser_read` 與 `coherence`——宣告了 `readOnlyHint: true`，因此 MCP 用戶端可以自動核准它們。這正是 `browser`/`browser_read` 與 `coherence`/`coherence_resolve` 之所以要拆成不同工具的原因：標註是**以工具為單位**，而非以操作為單位，因此一個把 ARIA 快照與 `execute_js` 綁在一起的工具，就必須把 `execute_js` 的危險性一併宣告出來。沿著「這會不會改動任何東西？」來拆分，讓每一半都能說出實情，也讓這個介面中真正具破壞性的操作在工具清單裡保持醒目。

先前的 12 工具 / 76 操作介面之所以被精簡，是因為文件內的格式化工具（粗體、標題、表格等）與 AI 代理透過 Markdown 來回轉換就能輕鬆完成的工作高度重複。`selection` 之所以保留（依精簡計畫的 ADR-7），是因為在大型檔案上整份文件來回轉換並不划算——每次編輯都要以輸入權杖付出整份文件的代價、以輸出權杖付出整份文件的代價（約為輸入價格的 5 倍），還要承受更長的寫入視窗，而這會擴大過期版本的重試迴圈。完整的取捨理由請參閱 [MCP 精簡計畫](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md)。

::: tip 建議的工作流程
1. 呼叫 `session.get_state` 一次，取得所有開啟的視窗、分頁，以及每個分頁的 `{filePath, dirty, revision, kind}`。
2. 對於小幅度的 Markdown 修改或整份重寫：`document.read` → 推理 → `document.write`（傳入 `expected_revision` 以確保並行安全）。
3. 當使用者已選取要修改的區域、且檔案是大型 Markdown 時，進行針對性的編輯：`selection.get` → 推理 → `selection.set`（把輸入與輸出的權杖成本都壓縮到選取範圍）。
4. 對於 GitHub Actions YAML（`kind: "yaml-workflow"`）：以 `workflow.apply_patch` 進行 CST 安全的編輯，保留註解與錨點；以 `workflow.validate` 取得 actionlint 診斷。
5. 檔案操作（開啟、儲存、關閉、切換分頁）集中在 `workspace`。
:::

::: tip Mermaid 圖表
透過 MCP 讓 AI 產生 Mermaid 圖表時，建議搭配安裝 [mermaid-validator MCP 伺服器](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking)——它使用相同的 Mermaid v11 解析器，在圖表進入文件之前先攔截語法錯誤。
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### 確認畫面上實際顯示了什麼

一個分頁可以存在、可被定址，卻仍然沒有顯示出來。有三個欄位說明這件事：

| 欄位 | 含義 |
|---|---|
| `tab.active` | 此分頁是其所屬視窗目前的分頁。 |
| `tab.visible` | 此分頁目前正在算繪。當分頁隸屬於某個視窗當前並未顯示的工作區實例時，此欄位為 `false`。 |
| `window.activeWorkspaceInstanceId` | 視窗正在顯示的工作區實例；當工作區側欄關閉時為 `null`（此時每個分頁都是可見的）。 |

`window.focused` 是**使用者**正在注視的視窗，取自作業系統。它並不是「回應這個請求的視窗」——VMark 會把請求路由到擁有相關工作區的那個視窗，在多視窗工作階段中，那往往是另一個視窗。

請把這些欄位當成確認步驟：在 `workspace.switch_tab` 之後，再呼叫一次 `get_state` 就能告訴你該分頁是否真的出現在使用者眼前。`switch_tab` 本身在回應前會重新讀取 store，因此當啟用並未生效時它會回報 `activated: false`，而不是把請求原封不動地回傳。

`kind` 這個判別欄位告訴你某個分頁應使用 `document.write`（適用於 markdown）還是 `workflow.apply_patch`（適用於 yaml-workflow）。

---

## `workspace`

只負責檔案與視窗的生命週期，不處理文件內容。

> **路徑範圍。**檔案操作（`open`、`save`、`save_as`）僅限於已開啟的工作區根目錄，以及已開啟文件所在的目錄。對此範圍以外的路徑發出的請求會以 `INVALID_PATH` 拒絕。若既沒有工作區也沒有開啟中的文件，就沒有範圍可言，因此檔案操作會被拒絕。這能讓自動化用戶端只在你已開啟的範圍內行動。

### `new`

建立一個新的未命名分頁。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `kind` | string | 否 | `"markdown"`（預設值）或 `"yaml-workflow"` |
| `windowLabel` | string | 否 | 目標視窗；未指定時使用聚焦中的視窗 |

回傳 `{tabId}`。

### `open`

從磁碟開啟一個**檔案**到**背景**分頁——使用者當前可見的分頁與工作區不會改變。把回傳的 `tabId` 串接到 `document` / `selection` 呼叫；只有在需要讓使用者*看見*該分頁時，才使用 `switch_tab`。

| 參數 | 型別 | 必填 |
|------|------|------|
| `filePath` | string | 是 |
| `windowLabel` | string | 否 |

回傳 `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`。

### `open_workspace`

把一個**資料夾**開啟為使用中的工作區。與 `open`（開啟已同意樹狀結構內的單一檔案）不同，這會授予助理存取一整棵全新檔案樹的權限，因此它**需經過一次性的使用者核准**，且不受上述路徑範圍的限制。

| 參數 | 型別 | 必填 |
|------|------|------|
| `folderPath` | string | 是 |

與 `new` 和 `open` 不同，這裡**不**接受 `windowLabel`。資料夾一律在請求抵達的那個視窗中開啟。這是刻意設計：核准對話框與開啟動作必須落在同一個視窗，而由用戶端提供的標籤可能會把提示放在某個視窗前面、卻改動另一個視窗——核准了一件事，得到的卻是另一件。多視窗指定需要目前尚未存在的請求路由機制。

**核准流程。**第一次呼叫會回傳 `{needsApproval: true}`，並彈出一個同意對話框，標明*正規化*後的資料夾路徑（符號連結已解析）。助理應詢問使用者，然後**重試同一個呼叫**；一旦使用者核准，重試就會開啟該資料夾。被拒絕的請求會持續失敗，直到再次獲得核准。沒有「記住」選項——每次開啟都要個別核准。

### `save`

將分頁內容存回原本的路徑。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否（預設為聚焦中的分頁） |

回傳 `{filePath, revision}`。

### `save_as`

將分頁另存至新路徑。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `filePath` | string | 是 |

回傳 `{revision}`。

存到分頁自身目前檔案以外的路徑，會被視為一次新的寫入。當「自動核准編輯」（設定 → 整合）關閉時（預設值），這類請求會以 `APPROVAL_REQUIRED` 拒絕，並以浮動通知告訴你什麼被阻擋了。存回分頁自身的路徑則一律允許。

### `close`

關閉分頁。若未指定 `force`，遇到未儲存的內容會拒絕關閉。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 是 |
| `force` | boolean | 否 |

成功時回傳 `{closed: true}`；若分頁有未儲存變更且未提供 `force`，則回傳 `{closed: false, reason: "DIRTY"}`。

### `switch_tab`

啟用一個分頁並讓它**變得可見**。啟用[工作區側欄](/guide/workspace-rail)後，這可能會切換使用者使用中的工作區情境——發生時回應會回報 `workspaceSwitched: true`，因此助理應告知使用者。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 是 |

回傳 `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`。

### `focus_window`

讓某個視窗取得焦點。

| 參數 | 型別 | 必填 |
|------|------|------|
| `windowLabel` | string | 是 |

---

## `document`

讀取、寫入、轉換——整個介面的主軸。

### `read`

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否（預設為聚焦中的分頁） |

回傳 `{content, revision, filePath, kind, dirty}`。寫入前務必先讀取——下一次的 `write` 必須帶上這次讀取所拿到的 `revision` 標記。

### `write`

整份文件內容替換。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `tabId` | string | 否 | 目標分頁（預設為聚焦中的分頁） |
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

套用一個確定性的改寫操作。目前支援 CJK 相關的轉換（全形 ↔ ASCII 標點互換、CJK ↔ 拉丁字母間距）。

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

::: info `document.read` 與 `document.write` 對所有分頁皆有效——包含 workflow YAML
`workflow` 工具**並不是**取代讀寫主軸的東西。針對 workflow 分頁，你仍然可以：

- 用 `document.read` 取得原始 YAML 文字（含所有註解）
- 用 `document.write` 整份替換（送進去什麼字串就原封不動寫入——只要你保留註解，註解就會留下來）
- 在只想改一個欄位、其他都保持不變時用 `workflow.apply_patch`——由伺服器本身保證註解、錨點與鍵的順序都不會掉失（伺服器不會丟掉它沒有去改的註解）

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
| `workflow.set` | 設定頂層欄位（`{path, value}`）——`name`、`env.X` 等 |
| `job.set` | 在某個 job 上設定欄位（`{jobId, path, value}`） |
| `step.set` | 在某個 step 上設定欄位（`{jobId, stepIndex, path, value}`） |
| `with.set` | 在某個 step 的 `with:` 區塊中設定鍵（`{jobId, stepIndex, key, value}`） |
| `with.remove` | 從某個 step 的 `with:` 區塊中移除鍵 |
| `needs.add` / `needs.remove` | 在 `needs:` 中新增或移除一個 job ID |
| `trigger.setFilters` | 替換觸發器的篩選陣列——branches、paths、types 等（`{event, filter, value: string[]}`） |

成功時回傳 `{revision}`；失敗時回傳結構化的 `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW` 錯誤封包。

### `validate`

對工作流程 YAML 執行 `actionlint`。

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |

回傳 `{ok, diagnostics, binaryAvailable}`。每筆診斷帶有 `{line, col, message, severity}`。`binaryAvailable: false` 代表本機沒有安裝 `actionlint`；可透過 Homebrew 或上游 Releases 安裝。

---

## `selection`

讀取或替換使用者目前在編輯器中的選取範圍。當使用者已標出要修改的區域時，請改用它而非 `document.read`/`document.write`——`selection.get` 只回傳選取的片段，`selection.set` 只改寫那一段範圍，因此權杖成本會隨編輯量而非整份文件而變化。

::: warning 選取範圍屬於檢視狀態——僅限聚焦中的分頁
選取範圍只存在於當前算繪中的編輯器裡。若有提供 `tabId`，它必須與聚焦中的分頁相符；不相符會回傳 `INVALID_TAB`。若聚焦中的分頁沒有實際運作的編輯器（例如唯讀檢視器），回應會是 `NO_EDITOR`。
:::

### `get`

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |

回傳：

| 欄位 | 型別 | 備註 |
|---|---|---|
| `text` | string | 選取片段的 Markdown 序列化結果（WYSIWYG 模式），或原始的選取文字（原始碼模式）。折疊時為空字串。 |
| `isEmpty` | boolean | 選取範圍折疊（僅有游標）時為 `true`。 |
| `range` | `{from, to}` | WYSIWYG 模式下為 ProseMirror 位置；原始碼模式下為字元偏移量。 |
| `mode` | `"wysiwyg"` \| `"source"` | 用來釐清 `range` 所屬的位置空間。 |
| `kind` | `"markdown"` \| `"yaml-workflow"` | 文件種類判別欄位。 |
| `tabId` | string | 回傳以供確認。 |
| `revision` | string | 傳回給 `set` 以進行樂觀並行控制。 |

### `set`

| 參數 | 型別 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `content` | string | 是 |
| `expected_revision` | string | 否（建議提供） |

替換編輯器回報為目前選取範圍的任何內容。**在 WYSIWYG 模式下**，純內嵌文字會以字面文字節點插入，因此前後的空白能精確地來回保留；帶有 markdown 標記的內容（`**bold**`、`*italic*`、`` `code` ``、圍欄程式碼、引用區塊、清單等）會被解析為 markdown 並插入為對應的節點。**在原始碼模式下**，`content` 一律以原始文字接合——原始碼介面本身就已經是 markdown 位元組。空的 `content` 會刪除選取範圍。當選取範圍折疊時，`content` 會插入在游標處。

成功時回傳 `{revision, replaced_chars}`。`replaced_chars` 是呼叫之前被選取文字的長度——有助於 AI 確認它所編輯的正是預期的內容。

`STALE` 會回傳 `{error: "STALE", message, current_revision}`，與 `document.write` 完全相同。文件層級的 revision 能攔截 `get` 與 `set` 之間的按鍵輸入。純粹的游標移動（沒有按鍵輸入）不由伺服器仲裁——如果使用者在 `get` 與 `set` 之間移動了游標，這次編輯就會落在新的位置。

---

## `browser`

內嵌瀏覽器介面中會**造成變更**的那一半——凡是會改變頁面、分頁或已儲存登入資訊的操作。請先用 [`browser_read`](#browser-read) 讀取頁面：這裡的每一種指定目標的方式都是指讀取所回傳的內容。

瀏覽器工具會遵循「設定 → 進階 → macOS → 內嵌瀏覽器」，在 macOS 上**預設為開啟**——因此除非你將它關閉，否則這些工具對已連線的 AI 用戶端都是可用的。當它關閉時，每個操作都會以 `BROWSER_DISABLED` 失敗。回傳給 MCP 的 URL 會經過與應用程式瀏覽器工作階段狀態相同的邊界進行遮蔽。

標註為 `readOnlyHint: false, destructiveHint: true`——這是準確而非只是保守，因為這裡的每個操作都會改動某些東西。

### `act`

參數：`tabId?`、`operation: "click" | "type" | "scroll" | "key"`，以及依操作而定的目標：

- **click / type**——一個目標，可以是 `ref`（來自先前的讀取）**或** `role` + `name`，輸入時再加上 `text?`。`ref` 精確且與順序無關，但只有對**已獲授權**的操作才會被採用；若該操作可能需要核准，請改用 `role` + `name`，好讓提示向使用者顯示一個可讀的元素。
- **scroll**——`ref`（把它捲動到可見範圍）**或** `dy`（垂直方向的像素增量）。
- **key**——`key`（例如 `"Enter"`、`"Escape"`、`"Tab"`）、選用的 `ref` 以指定目標，以及選用的 `modifiers: {ctrl, shift, alt, meta}`。

`scroll` 與 `key` 屬於 act 類別（需經核准），並派送**合成的** DOM 事件，因此依 `event.isTrusted` 把關的網站可能會忽略它們。造成變更的操作需要以來源為範圍的核准；由 AI 自行選擇的上傳從不被允許。

**點擊在回報成功之前會先驗證其效果。**目標會被捲動到可見範圍，且必須確實算繪出來（會檢查計算後樣式與折疊的上層元素，因此位於已收合手風琴步驟內的重複按鈕會被略過，而不是被點擊），並對點擊點進行命中測試——被覆蓋層擋住的目標會被拒絕，並指名遮蔽者（`covered by div.cmp-overlay`），而不是穿透點擊。role + name 的結果會附帶 `matchedTotal` / `matchedVisible` 計數，讓歧義顯而易見，而且每個 act 回應都包含分頁目前的 `url` 與 `generation`。`type` 能處理文字欄位、`<select>` 控制項（傳入選項的標籤或值；找不到的選項會以 `no-such-option` 拒絕），以及 `contenteditable` 區域。

### `workflow_run` / `workflow_cancel`

`workflow_run` 會在 AI 擁有的分頁上執行一個你以 `source` 文字提供的工作流程。參數：`tabId?`、`source`（工作流程文字——一種以行為單位的小型語法；由你撰寫、由 AI 撰寫，或由 [`workflow_record`](#workflow-record) 從你自己的操作中擷取）、`inputs?`（一個 `{name: value}` 映射，會代入 `{name}` 參照）、`allowRepeat?`。它會**立即**回傳 `{runId, steps}`——這次執行是**非同步**進行的，因為多步驟的執行可能比單一請求存活得更久。輪詢 [`browser_read`](#browser-read) 的 `workflow_status` 以取得進度。

確定性步驟——該語法中的 `click` / `type` / `navigate`，以及 `extract`——會在 VMark 內執行，並且是**逐一經過核准**的，就像手動發出的 `act` 一樣：這次執行會各別為每一步授權，因此工作流程並不是繞過核准提示的途徑。`goal`、`confirm`、`api` 以及任何自由敘述的步驟會**暫停**執行，交由 AI 手動處理。除非設定了 `allowRepeat`，否則重新執行會**略過本工作階段中已經成功的寫入步驟**（已完成寫入的帳本）——因此在暫停之後重新執行不會重複送出。

`workflow_cancel {tabId?, runId}` 會停止一次執行。它**從不需要核准**——停止一律被允許——並且會撤回該次執行尚待處理的提示，把分頁交還給你。此外，只要你接手瀏覽器（任何對頁面或其外框的互動都會收回控制權），執行也會立即停止。

每次執行都有上限（≤ 25 步、≤ 120 秒、source ≤ 64 KiB），且每個分頁一次只能有一個。

### `workflow_record`

在 AI 擁有的分頁上，把**你自己的操作**記錄成可重播的工作流程。參數：`tabId?`、`recordOp`（`"start"` 或 `"stop"`），以及 `site?`（所記錄工作流程的 front-matter 網站 id；預設為 `recording`）。

`start` 受 `record` 權限的**同意把關**，而該權限——與 `execute_js` 和 `session` 一樣——**絕非常駐授權**：每一次記錄都會重新徵求你的同意，因此 AI 永遠無法在你不知情下記錄你。在你允許之前，`start` 會回傳 `needsApproval`；一旦你允許，VMark 就會啟用一段休眠的 page-world 擷取墊片，並開始記錄你執行的**點擊與欄位編輯**。`stop` 會回傳 `{source, inputs, eventCount}`——其中 `source` 是工作流程文字，你可以將它儲存，或直接交給 [`workflow_run`](#workflow-run)。

這份記錄**在設計上即不含任何值**，而且這並不是一道信任頁面的過濾器：你所輸入的任何內容都絕不會被擷取。每個文字欄位都會變成一個具名的 `{input}` 變數（其值在重播時才提供，絕不記錄）；而**密碼或一次性驗證碼欄位**則會變成一個 `confirm:` 步驟——一道你在重播時親手完成的人工關卡——因此祕密甚至不會被參數化；而且每個 URL 都會被削減到只剩 origin + path，讓查詢字串中的權杖無法留存。所記錄的是你所碰觸的**定位器**（ARIA role + accessible name），絕非它們的資料。記錄會跟著你跨越頁面導覽，並且有其上限（每頁 200 個事件、每個工作階段 1,000 個）。

### `open`

參數：`url` 與選用的 `timeoutMs`（1–12,000 毫秒）。會依目前的沙箱（Sandbox）或共用（Shared）姿態建立一個 AI 擁有的分頁，並在載入完成後回傳它的 `tabId`、`navigationId`、URL、標題與 generation。

### `navigate`

參數：`tabId?`、`url` 與選用的 `timeoutMs`。會導覽一個 AI 擁有的分頁，並回傳導覽票證的結果。逾時仍會回傳票證，好讓稍後的 `wait` 能取得最終結果。

**關卡偵測。**當抵達的頁面被判讀為**登入牆**、**同意插頁**、**人機驗證挑戰**或**速率限制**時，載入完成的 `open` / `navigate` / `wait` 結果可能會帶有 `gate: {kind, hint}`——好讓 AI 在讀取結果的當下就得知，它看到的並不是它所要求的內容。偵測以精確度優先（一個算繪出來的挑戰小工具，或在簡短頁面上至少兩個各自獨立的訊號——`$429` 這樣的價格、一段「Protected by Cloudflare」頁尾，或一篇*談論* CAPTCHA 的文章永遠不會被歸類），而且純屬提示性：它只改變告訴 AI 的內容，絕不改變授權的範圍，而每一個提示都指向讓你介入，而不是繞過關卡。

### `style`

參數：`tabId?`、一個目標（`ref` **或** `selector`），以及 `set: {prop: value}`、`addClasses`、`removeClasses` 或 `injectCss` 其中之一。可用來關掉阻擋畫面的覆蓋層、標示目標等。**屬於 act 類別**（需經核准，操作為 `style`）。在隔離的內容 world 中執行。

### `execute_js`

參數：`tabId?`、`script`（必須 `return` 一個可 JSON 序列化的值）。這是結構化動詞無法表達之事的逃生口。它在**隔離的內容 world** 中執行——共用 DOM（因此 `querySelector`、`element.style` 可用），但**無法**看到頁面本身的 JS 堆積/全域變數。它**僅逐次核准**（絕不是常駐授權，由 Rust 驅動程式強制執行），核准時會顯示該指令碼，而回傳值會被標記為**不受信任**，絕不會被自動餵入之後的 `act`。請先優先使用 `query`/`style`。

### `session_save` / `session_load`

參數：`tabId?`、`handle`（`[A-Za-z0-9._-]`，1–128 個字元）。`session_save` 會把分頁的工作階段快照存入一個以 `handle` 命名的**作業系統鑰匙圈（OS-keychain）**項目，並回傳不含任何值的摘要（計數）；`session_load` 會將它還原，並回傳 `{loaded: true, handle}`——一份確認外加 AI 提供的 handle，絕不含任何值。`session_load` 只適用於與工作階段儲存來源**相同來源**的頁面。這是**以參照方式**處理憑證（ADR-A7）：AI 只是指名一個已儲存的工作階段，絕不會收到 cookie/權杖的值，而這些值也絕不會被記錄。兩者都屬於 `session` 權限——**絕非常駐授權**（逐次核准），而且對某個 handle 的核准不能挪用到另一個 handle 上。*目前這涵蓋 `localStorage`；cookie 擷取是有待實機測試的後續工作。*

### `console_clear`

參數：`tabId?`。會回傳 `{entries: [{level, text}], url}`，與 [`browser_read`](#browser-read) 的 `console` 完全相同，**並且會清空緩衝區**，讓下一次讀取只看到新的輸出。它之所以放在這裡而不是與另一個 console 讀取放在一起，是因為清空會在頁面中執行 `element.textContent = "[]"`——這是一次 DOM 寫入。

共用姿態會為每個新來源要求目的地核准，除非已存在相符的 `navigate` 授權。由人建立的分頁在 AI 讀取／操作之前，需要一次短暫的附加核准。沙箱分頁使用一個獨立、不持久保存的 AI cookie 儲存區。

---

## `browser_read`

只做**唯讀**的那一半：觀察分頁而不改變它。標註為 `readOnlyHint: true`，因此 MCP 用戶端可以自動核准它——這正是拆分的用意。這些操作過去都放在 `browser` 上，而在那裡單一的工具層級標註也必須把 `execute_js` 一併描述進去，於是連拍一張 ARIA 快照都要付出一次人工核准的代價。

`openWorldHint` 維持為 `true`：唯讀描述的是這個工具*會改變*什麼，而不是這些位元組是否可信。回傳的一切都由頁面掌控，且**不受信任**——絕不要把結果直接餵回去當作 `browser` 的操作目標。

### `read`

會回傳聚焦中的瀏覽器分頁（或由 `tabId` 指名的分頁）的 `{url, snapshot}`。`snapshot` 是一份以 ARIA 為導向的 `{role, name, ref}` 清單——每個 `ref`（例如 `"e5"`）都是該元素的穩定控制代碼，在目前檢視的存續期間內有效。

### `screenshot`

參數：`tabId?`。會回傳分頁目前算繪畫面的一個**影像內容區塊**（base64 JPEG，品質受限），外加一行標明頁面的文字——這是一條通往版面配置與算繪狀態的視覺通道，是 ARIA 快照無法描述的。它以原生方式擷取（`takeSnapshot`），不讀取任何頁面 DOM 或 JavaScript。屬於 read 類別：授權方式與 `read` 完全相同（在 AI 擁有的分頁上允許；由人開的分頁需要一次附加，並在擷取時消耗掉）。

### `query`

參數：`tabId?`、`selector`（CSS），以及選用的 `fields: {attributes, box, styles:[...]}`。會回傳 `{count, elements: [{ref, tag, text, …}]}`——這是 ARIA 快照無法指名的結構化 DOM 資料（表格、計算後的值）。**屬於 read 類別。**在隔離的內容 world 中執行。

### `extract`

參數：`tabId?`。會回傳 `{title, byline, url, markdown, textLength, truncated}`——把頁面轉成**閱讀模式 Markdown**，供 AI 想要*閱讀*而非操作頁面時使用。一次有上限的擷取會匯出頁面的 HTML；擷取本身在 VMark 內執行，絕不在頁面中進行：為該來源註冊的**網站外掛**擁有優先權（內建的 Wikipedia 外掛會依名稱剝除維基外框——資訊框、導覽框、注釋帽、編輯連結），而通用的密度啟發式閱讀器則是其他所有網站的後備。`truncated: true` 代表頁面超過擷取上限，其尾端未被讀取。**屬於 read 類別。**回傳的一切都源自頁面且不受信任。

### `workflow_status`

參數：`tabId?`、`runId`（來自 `workflow_run`）。會回傳 `{status, completedSteps, stepCount, pausedAt?, reasonCode?, reason?, stepResults}`，其中 `status` 是 `running` / `paused` / `completed` / `failed` / `cancelled` 其中之一。`paused` 狀態會在 `pausedAt` 中指出需要你介入的步驟。**屬於 read 類別**——可自由輪詢。

### `console`

參數：`tabId?`。會回傳 `{entries: [{level, text}], url}`——頁面所擷取的 `console.*` 輸出，外加**未被攔截的錯誤與未處理的 promise rejection**（記錄為 `level: "error"` 項目，並以 `Uncaught` / `Unhandled rejection:` 為前綴——這是單靠修補 `console.*` 永遠看不到的訊號）。僅限沙箱分頁。擷取的做法是由一段 page-world 的墊片把內容寫入一個隱藏的 DOM 緩衝區，再由驅動程式從隔離的 world 讀取——因此**不會**開啟任何通回 VMark 的訊息通道（無橋接保證依然成立）。輸出由頁面掌控且**不受信任**——請把它當作 `read`，絕不要當成 `act` 目標。

這個緩衝區是一個有界的環形結構，因此連續多次讀取會有重疊。若想邊讀邊清空，請使用 [`browser`](#browser) 的 `console_clear`——清空會把 `[]` 寫入頁面的緩衝區元素，這是一次 DOM 寫入，因此不能歸在 `readOnlyHint: true` 之下。

### `wait`

參數：`tabId?`、選用的 `navigationId` 與選用的 `timeoutMs`。它絕不會啟動導覽。它會回傳一個已緩衝的載入／失敗結果、`NAVIGATION_SUPERSEDED`，或在票證未於上限時間內完成時回傳 `TIMEOUT`。

### `wait_for`

參數：`tabId?`、`ref`（來自一次讀取）、`role`（可再加選用的 `name`）、`text`（可見文字的子字串）或 `urlContains`（分頁 URL 必須包含的子字串——用來確認由點擊觸發的導覽已經抵達，直接由分頁狀態回答，不需與頁面往返）之中的恰好一個，以及選用的 `timeoutMs`（1–12,000 毫秒）。它會輪詢，直到條件成立或逾時，並回傳 `{matched: true|false}`（若為 ref/role 條件，還會附上相符元素的 `ref`）——這樣你就能分辨「找到了」與「逾時了」。屬於 read 類別。用它讓流程具有確定性：操作、`wait_for` 其結果，然後讀取。

---

## `coherence`

工作區一致性層的**唯讀**視圖——顯示哪些衍生文件相對於其生成時所依據的上游已經過期。沒有任何操作會修改文件或編輯器狀態。`status` 是純讀取；`edges` 會先做一次對帳，並可能向工作區帳本追加來源記錄，但絕不會改動文件內容。所有操作都完全由 Rust 後端從各工作區的核心直接回應，因此即使沒有任何編輯器視窗在前景也能運作。

另有兩個唯讀操作揭示語意層：

- `claims`——目前的正典設定：`{claim, entryId, statement, maturity, invalidAt, visible}`。只有 `established` 狀態的設定才會約束語意檢查；`visible` 反映的是 default 情境。
- `contexts`——情境集合（隱含的 `default` 始終存在）：`{id, name, parent, enforcement, visibleClaims, errors}`。

標註為 `readOnlyHint: true`。唯一會造成變更的操作 `resolve` 獨立成一個工具——見 [`coherence_resolve`](#coherence-resolve)——這正是讓這個工具能自動核准的原因。設定與情境的變更完全不對外揭露：正典始終由人類掌控。

所有操作都需要 `workspace_root`：要查詢的工作區的絕對路徑。可從 `session.get_state`（已開啟分頁的 `filePath`）或 workspace 工具取得。路徑缺失、不是絕對路徑或不是目錄時，會以純字串錯誤拒絕。

### `status`

單一工作區的核心狀態計數。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `workspace_root` | string | 是 | 要查詢的工作區的絕對路徑 |

**回傳：**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| 欄位 | 含義 |
|---|---|
| `initialized` | 工作區尚無一致性帳本（沒有 `.vmark/` 目錄）時為 `false`。此時除 `objects` 外的所有計數皆為 0。 |
| `objects` | 被追蹤的物件（具有一致性身份的檔案）。 |
| `open_items` | 現存的非新鮮依賴邊——即目前明細的筆數。 |
| `quarantined` | 上次讀取時被隔離的格式錯誤帳本行。 |
| `writer` | 此安裝的 writer id（UUID）。 |

### `edges`

明細本身：上游已變動的每一條現存依賴邊。會先執行一次掃描對帳，因此結果反映呼叫當下磁碟上的檔案。

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `workspace_root` | string | 是 | 要查詢的工作區的絕對路徑 |

**回傳**一個陣列——全部一致時為空：

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| 欄位 | 含義 |
|---|---|
| `txf` / `input` | 識別這條邊的轉換條目與輸入槽位（請將它們傳給應用程式內的裁決操作）。 |
| `upstream` / `upstream_path` | 下游所依賴的物件及其最後已知的路徑。 |
| `pinned` | 下游生成時所依據的上游版本。 |
| `downstream` / `downstream_path` / `downstream_rev` | 衍生物件、其路徑及其目前版本。 |
| `state` | `"version-stale"`、`"stale-valid"`、`"stale-contradicted"`、`"stale-unknown"`、`"waived"`、`"diverged"`、`"diverged-multi-head"` 或 `"unpinnable"`。 |

裁決一條邊（接受新版 / 豁免）通常是在 VMark 的明細檢視中由人執行的操作。AI 只能透過 [`coherence_resolve`](#coherence-resolve) 來做，而且只有在工作區擁有者已明確將此權限委任給它時才行。

---

## `coherence_resolve`

一致性層上**唯一會造成變更的操作**，獨立成一個工具，好讓 [`coherence`](#coherence) 能維持可自動核准——同時也讓某個無法復原的東西在工具清單中顯眼可見，而不是被埋沒為五個列舉值之一。標註為 `readOnlyHint: false, destructiveHint: true`。

### `resolve`

參數：`{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`。`txf` 與 `input` 來自 `coherence` → `edges` 的某一列。

以取得明確委任的智慧代理身分，解決一條活躍的過期邊。授權採用 **fail-closed** 策略：工作區擁有者必須已向**你通過身分驗證的橋接身分**授予一份涵蓋該解決類型的、有效且未過期的委任（在應用程式內、從「明細」授予），且該邊必須仍然活躍。每一次受委任的解決都會記入稽核紀錄、關聯至該授予，且該條目無法復原。

被拒絕代表授予不存在或已過期——請請使用者授予，而不是重試。把這個操作從 `coherence` 拆分出來並未改變任何安全性質：授權一向以通過身分驗證的橋接主體為依據，從不依據用戶端所宣稱的任何內容。

---

## 錯誤

錯誤有兩種形態：

**領域錯誤（Domain errors）**——將 `success` 設為 `false`，並在 `error` 欄位以 JSON 格式回傳結構化封包：

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**參數形態錯誤（Argument-shape errors）**——對於必要參數遺漏或型別不符（例如 `document.write` 沒帶 `content` 欄位），`error` 欄位是直接描述問題的純字串。結構化封包僅保留給領域層級的條件。

| 代碼 | 出現形式 | 含義 |
|---|---|---|
| `STALE` | 結構化封包 | `expected_revision` 不符；請重新讀取後重試 |
| `INVALID_PATCH` | 結構化封包 | `workflow.apply_patch` 收到格式錯誤的 `patches` 陣列 |
| `INVALID_TAB` | 結構化封包 | 無法解析 `tabId` |
| `INVALID_PATH` | 結構化封包 | 無法讀取某個 `filePath`，或它位於已開啟的工作區／文件範圍之外 |
| `APPROVAL_REQUIRED` | 結構化封包 | 在「自動核准編輯」關閉時，`save_as` 至新位置 |
| `NOT_WORKFLOW` | 結構化封包 | 在非 yaml-workflow 分頁上呼叫 `workflow.*` |
| `READ_ONLY` | 結構化封包 | 對唯讀文件嘗試進行變更操作 |
| `NO_EDITOR` | 結構化封包 | 呼叫了 `selection.*`，但聚焦中的分頁沒有實際運作的編輯器 |
| `INTERNAL` | 結構化封包 | 處理器發生非預期錯誤 |
| （純字串） | 字串 | 必要參數遺漏或型別錯誤 |
