# GitHub Actions 工作流程檢視器

VMark 會把 GitHub Actions 工作流程 YAML 渲染成可互動的有向無環圖(DAG)，並讓你透過結構化表單編輯 jobs、steps 與 triggers —— 整個過程不會丟失底層檔案中的任何註解、錨點或格式。

這項功能在兩種介面上運作：

1. **獨立的 `.yml` 檔案**(位於 `.github/workflows/` 之下，或任何頂層結構符合工作流程形態的檔案)：分割檢視，左側為原始碼，右側為互動式畫布加結構化表單編輯器。
2. **Markdown 程式碼圍欄：** 當三個反引號 `yaml` 或 `yml` 圍欄中包含可辨識的工作流程時，VMark 會以類似 Mermaid 圖的方式行內渲染為 DAG —— 與 `mermaid` 區塊的呈現方式一致。

## 獨立工作流程檔案

在 VMark 中開啟任何 `.github/workflows/*.yml` 檔案。右側面板會自動展開並顯示：

- 整份工作流程的互動式 React Flow 畫布(jobs 為節點，`needs:` 依賴為邊)。
- 畫布下方的結構化編輯器面板。
- 編輯器頂部的儲存/捨棄控制項。

在畫布中點選一個 job 即可編輯該 job；點選 job 內部的某個 step 即可編輯該 step。

### Job 編輯

可編輯的欄位：

| 欄位 | Patch 種類 |
|------|------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

唯讀摘要：step 數量、`needs:`，以及 `uses:`(用於可重用工作流程的 job)。

### Step 編輯

可編輯的欄位：

| 欄位 | Patch 種類 |
|------|------------|
| `name` | `step.set` |
| `run`(用於 run 類型的 step) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:` 鍵值 | `with.set` / `with.remove` |

`with:` 區塊以可新增/編輯/移除的鍵值列方式呈現。重新命名一個鍵時，會先針對舊鍵發出 `with.remove`，再針對新鍵發出 `with.set`。

對於 `uses:` 類型的 step，該 action 的引用本身為唯讀 —— 若想換用不同的 action，請直接在原始碼中修改。

### 觸發器

觸發器摘要(event、branches、tags、paths、cron、types)在這個版本中為唯讀。觸發器的密集巢狀結構，若以單行輸入框編輯太容易丟失資訊；在專屬挑選器尚未推出之前，請直接在原始碼中編輯觸發器。

## 儲存編輯

當你修改欄位時，變動會先被排入記憶體中的 patch 佇列。儲存按鈕會顯示目前的數量(例如 **3 unsaved**)。

點選儲存後，VMark 會：

1. 從編輯器讀取當前的 YAML。
2. 將佇列中的每一筆 patch 套用到該 YAML 的 CST(具體語法樹)—— 完整保留註解、錨點與既有的格式。
3. 將結果寫回編輯器，就像你親手敲進去一樣。

完成後檔案會進入一般意義上的「未儲存」狀態；按 **Cmd+S** 即可寫入磁碟。

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

VMark 偵測到工作流程的形態(頂層 `jobs:`，且每個 job 都有 `runs-on`)後，會行內渲染為對應的圖。圖本身為唯讀 —— 想修改工作流程，請編輯原始碼。

## 診斷

VMark 會在原始碼旁顯示解析與 lint 的診斷：

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

安裝 `actionlint` 並在「設定 → 進階」開啟 **可用時使用 actionlint**，即可取得更豐富的運算式診斷。

## Action metadata

對於引用了公開 GitHub Action 的 `uses:` 步驟，VMark 可以抓取每個 action 的 `action.yml`，以便在結構化編輯器中填入輸入欄位的描述。此功能為選擇性啟用，並會在本機磁碟上快取 24 小時。

於「設定 → 進階」中切換 **抓取 action 中繼資料**。停用後，所有 action 引用都會維持純文字 —— 不會發出任何網路請求。

## 匯出

工作流程側邊面板的標題選單中提供三種匯出選項：

| 格式 | 適合用途 |
|------|----------|
| **Mermaid** | 嵌入 README 與其他 Markdown 文件。屬於有損匯出：會省略執行狀態、action 圖示、自訂徽章與矩陣展開細節。 |
| **SVG** | 嵌入需要向量圖形的文件。HTML 內容透過 `foreignObject` 表現。 |
| **PNG** | 在聊天工具或不支援 SVG 的場合分享。會以畫布目前的縮放比例渲染。 |

## 這項功能不是什麼

VMark 不會執行 GitHub Actions 工作流程。它只是一個檢視與編輯器 —— 執行的部分依舊歸 GitHub 處理。整個功能純粹用於閱讀、檢閱與編寫工作流程 YAML。
