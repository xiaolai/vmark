# GitHub Actions 工作流程檢視器

VMark 會把 GitHub Actions 工作流程 YAML 渲染成可互動的有向無環圖(DAG)，並讓你透過結構化表單編輯 jobs、steps、triggers、permissions 與 concurrency —— 整個過程不會丟失底層檔案中的任何註解、錨點或格式。

這項功能在兩種介面上運作：

1. **獨立的 `.yml` 檔案**(位於 `.github/workflows/` 之下，或任何具有頂層 `on:` 與 `jobs:` 鍵的 YAML 檔案)：分割檢視，左側為原始碼，右側為互動式畫布加結構化表單編輯器。
2. **Markdown 程式碼圍欄：** 當三個反引號 `yaml` 或 `yml` 圍欄中包含可辨識的工作流程時，VMark 會把同一張 job 圖以圖片形式行內渲染 —— 與 `mermaid` 區塊的呈現方式一致。

::: tip 與 VMark 自己的工作流程不同
若 YAML 檔案的頂層 `steps:` 使用 `genie/…` 或 `action/…`，它就是 [Genie 工作流程](/zh-TW/guide/workflows) —— VMark 自有的管線格式，可由 VMark 執行。GitHub Actions 工作流程在這裡只能檢視與編輯；請參閱[這項功能不是什麼](#這項功能不是什麼)。
:::

## 獨立工作流程檔案

在 VMark 中開啟任何 `.github/workflows/*.yml` 檔案。檔案會以分割檢視開啟 —— 左側為 YAML 原始碼，右側為工作流程工作台(原始碼 / 分割 / 預覽切換鈕可切換版面)。工作台會顯示：

- 整份工作流程的互動式 React Flow 畫布(jobs 為節點，`needs:` 依賴為邊)。畫布的控制列可以縮放、讓整張圖符合窗格大小，並在由上至下與由左至右兩種版面之間切換 —— 在寬窗格中檢視很長的 `needs:` 鏈時特別方便。
- 畫布右上角的匯出控制項(請參閱[匯出](#匯出))。
- 畫布下方的結構化編輯器面板：[診斷](#診斷)橫幅、儲存/捨棄控制項、工作流程層級的表單，以及目前所選 job 或 step 的表單。

在畫布中點選一個 job 即可編輯該 job；點選 job 內部的某個 step 即可編輯該 step。按 Escape 會清除選取，並將焦點移回原始碼。

當你編輯原始碼時，VMark 會讓兩個窗格保持同步：把游標移入某個 job 的程式碼行，會在畫布上醒目標示它的節點；`${{ }}` 運算式會依據解析後的工作流程上下文自動補全；Cmd 點按本機的 `uses:` 引用則會開啟目標檔案。

### Job 編輯

可編輯的欄位：

| 欄位 | Patch 種類 |
|------|------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

唯讀摘要：step 數量、`needs:`，以及 `uses:`(用於可重用工作流程的 job)。

**新增作業**(位於表單上方)會以你輸入的 ID 建立一個 job —— ID 必須以字母或底線開頭，且不能與既有 job 重複 —— 在你修改之前，它會在 `ubuntu-latest` 上執行。Job 表單的刪除按鈕會在你確認後移除所選的 job。

Job 表單也會列出該 job 的 steps。每一列都可以上移、下移或刪除(刪除前需先確認)，**新增步驟**(Add step)則會以 `run: echo TODO` 附加一個新的 step，方便你接著編輯。

### Step 編輯

可編輯的欄位：

| 欄位 | Patch 種類 |
|------|------------|
| `name` | `step.set` |
| `run`(用於 run 類型的 step) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:` 鍵值 | `with.set` / `with.remove` |

`with:` 區塊以可新增/編輯/移除的鍵值列方式呈現。重新命名一個鍵時，會先針對舊鍵發出 `with.remove`，再針對新鍵發出 `with.set`。若某個鍵已被其他列使用，會直接在該列上拒絕。

對於 `uses:` 類型的 step，該 action 的引用本身為唯讀 —— 若想換用不同的 action，請直接在原始碼中修改。

在 step 表單中，**Alt + Left** / **Alt + Right** 可移至上一個／下一個 step。此快捷鍵在視窗內任何位置都有效，但在文字欄位、下拉選單或程式碼編輯器中除外——在那裡 Alt + 方向鍵保有其以單字為單位移動的一般用途。

### 觸發器

以對映(mapping)形式撰寫的觸發器(`on: { push: { branches: [main] } }`)具有可編輯的篩選欄位 —— branches、branches-ignore、tags、tags-ignore、paths、paths-ignore 與 types —— 每個欄位都是以逗號分隔的清單。`schedule` 的 cron 會以介面語言的語句呈現（星期與月份名稱仍保留為英文三字母縮寫，如 `Mon`、`Jan`），當執行頻率高於每 5 分鐘一次時會顯示警告(GitHub 會限制這類排程)，且為唯讀。以單一事件名稱或名稱清單撰寫的觸發器同樣為唯讀；請在原始碼中編輯它們。

### 權限與並行

兩個工作流程層級的表單位於 job 表單上方：

- **權限**(Permissions) —— GitHub 的預設值(沒有 `permissions:` 鍵)、`read-all`、`write-all`、`none`，或是逐一範圍設定的表格(`contents`、`pull-requests`、…)，每個範圍可設為 read / write / none。
- **並行**(Concurrency) —— `group`，以及是否要 `cancel-in-progress`。以運算式撰寫的 `cancel-in-progress` 會顯示出來，但無法在這裡編輯。

## 儲存編輯

當你修改欄位時，變動會先被排入記憶體中的 patch 佇列。儲存按鈕會顯示目前的數量(例如 **3 項未儲存**)，而新增的 jobs 與 steps 在儲存之前就已經會出現在畫布與表單中。

點選儲存後，VMark 會：

1. 從編輯器讀取當前的 YAML。
2. 將佇列中的每一筆 patch 套用到該 YAML 的 CST(具體語法樹)—— 完整保留註解、錨點與既有的格式。
3. 若是磁碟上的檔案，會把結果寫入檔案，再更新編輯器使其一致 —— 除非你在此期間於原始碼中輸入了內容，那樣會保留你輸入的內容。

如果寫入失敗，不會遺失任何東西：編輯仍會留在佇列中，你可以再次儲存。未命名的文件沒有可寫入的檔案，因此儲存只會更新編輯器；請按 **Cmd+Shift+S** 將它存檔。**捨棄** 會丟棄佇列中的編輯。

### 保留格式

預設的儲存路徑會把每一筆 patch 都送進 `yaml` 套件的 CST API —— 註解、錨點節點、自訂縮排，以及既有的「flow vs block」風格選擇都會被保留。

如果你偏好標準化的重新排版輸出，可以在「設定 → 進階」中關閉 **儲存時保留 YAML 格式**。重新排版的路徑會丟掉註解，因此預設不啟用。

## Markdown 中的程式碼圍欄

把工作流程寫進 YAML 程式碼圍欄裡：

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```
````

VMark 偵測到工作流程的形態(頂層 `on:` 與 `jobs:` 鍵)後，會行內渲染其 job 圖的圖片 —— 與獨立檢視使用同一個畫布，擷取為影像。這張圖片為唯讀；按兩下即可編輯原始碼。

## 診斷

VMark 會在表單面板頂部的橫幅中顯示解析與 lint 的診斷。點選某一列會讓原始碼跳到出問題的那一行；若無法取得該行(例如在預覽模式中)，則會選取出問題的 job：

| 代碼前綴 | 含義 |
|----------|------|
| `GHA-PARSE-*` | YAML 格式錯誤或缺少必要鍵 |
| `GHA-JOB-*` | Job 層級的問題(重複 id、`uses:` 與 `steps:` 衝突) |
| `GHA-NEEDS-*` | 依賴問題(未知參考、循環依賴) |
| `GHA-STEP-*` | Step 層級的問題 |
| `GHA-EXPR-*` | 未知的上下文引用 |
| `GHA-MATRIX-*` | 矩陣展開問題 |
| `GHA-SEC-*` | 安全性警告(例如 `pull_request_target` 配 checkout 的危險樣式) |
| `GHA-ACTIONLINT-*` | 從 `actionlint` 轉發過來的訊息(若已安裝) |

安裝 `actionlint` 即可取得更豐富的運算式診斷。當 **可用時使用 actionlint** 開啟時(位於「設定 → 進階」的「工作流程檔案」中，預設開啟)，每當工作流程檔案的原始碼變更，VMark 就會從你登入 shell 的 PATH 執行該程式，並把它的結果附加到工作台的診斷橫幅中，標記為 `GHA-ACTIONLINT-<rule>`；上方的內建檢查從不等待它。如果開關已開啟但未安裝該程式，VMark 每個工作階段只會提示一次，其餘時候保持安靜；如果程式存在但無法執行，則會以 actionlint 自己的訊息回報一次失敗。關閉開關即可完全略過 actionlint。MCP 的 `workflow.validate` 操作可隨時執行同樣的檢查。

## Action metadata

對於引用了公開 GitHub Action 的 `uses:` 步驟，VMark 會抓取每個 action 的 `action.yml`，以便在結構化編輯器中填入輸入欄位的描述。結果會在磁碟上快取 24 小時。工作區內的本機 action(`./…`)一律從磁碟讀取，絕不經由網路。

若要讓工作流程編輯器完全離線，請在「設定 → 進階」的「工作流程檔案」中關閉 **抓取 action 中繼資料** —— 關閉後不會發出任何網路請求，`with:` 表單也會退回為自由格式的鍵值列。

## 匯出

畫布右上角的匯出控制項提供三種格式：

| 格式 | 適合用途 |
|------|----------|
| **Mermaid** | 嵌入 README 與其他 Markdown 文件。會複製到剪貼簿。屬於有損匯出：會省略執行狀態、action 圖示、自訂徽章與矩陣展開細節。 |
| **SVG** | 嵌入需要向量圖形的文件。HTML 內容透過 `foreignObject` 表現。 |
| **PNG** | 在聊天工具或不支援 SVG 的場合分享。會以畫布目前的縮放比例渲染。 |

## 這項功能不是什麼

VMark 不會執行 GitHub Actions 工作流程。它只是一個檢視與編輯器 —— 執行的部分依舊歸 GitHub 處理。整個功能純粹用於閱讀、檢閱與編寫工作流程 YAML。VMark 自己可執行的管線是另一種格式：請參閱 [Genie 工作流程](/zh-TW/guide/workflows)。
