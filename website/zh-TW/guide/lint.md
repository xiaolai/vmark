# Markdown Lint

VMark 內建一個 lint 引擎，用來抓出**正確性問題**，而非樣式偏好。Lint 為按需執行（Cmd-Shift-L 或 **工具 → 檢查 Markdown**），結果會以行內標示出現於行號槽（gutter）的波浪線、狀態列徽章，以及 F2 在發現項目間導覽。

## Lint 是什麼，又不是什麼

VMark 的 lint 是 **正確性** 檢查器：

- 損壞的交叉引用
- 未定義的連結 / 註腳引用
- 未關閉的程式碼圍欄
- 欄數不一致的表格
- 跳級的標題（h1 → h3）
- 缺少 alt 文字的圖片
- 連結文字為空或 `href` 為空

VMark 的 lint **不是** 樣式強制器，它不會標示：

- 行長度
- 清單標記樣式（`-` 與 `*`）
- 強調標記樣式（`_` 與 `*`）
- 標題樣式（`#` 與底線）
- 行尾空白

如需樣式強制，請在 VMark 之外使用 `prettier --check` 之類的獨立工具。

## 規則參考

| 規則 ID | 嚴重程度 | 描述 |
|---------|----------|------|
| **E01** | Error | 未定義的引用：`[link][missing]` 指向不存在的定義 |
| **E02** | Error | 表格列的欄數不對（與標題列不一致） |
| **E03** | Error | 反向連結 — 看起來像 `(text)[url]`，應為 `[text](url)` |
| **E04** | Error | ATX 標題在 `#` 之後缺少空格（例如 `##Heading` 應為 `## Heading`） |
| **E05** | Error | 強調標記內含空格 — `* word *` 不會渲染為斜體 |
| **E06** | Error | 未關閉的圍欄式程式碼區塊 — 檔案以未關閉的 ```` ``` ```` 圍欄結尾 |
| **E07** | Error | 重複的連結引用定義（同一個 `[label]:` 出現兩次） |
| **E08** | Error | 連結 `href` 為空 — `[text]()` |
| **W01** | Warning | 跳過了標題層級（預期 h2，發現 h3） |
| **W02** | Warning | 圖片缺少 alt 文字 — 無障礙議題 |
| **W03** | Warning | 未使用的連結引用定義（已定義但從未被連結） |
| **W04** | Warning | 錨點片段未對應到任何標題 — `#section` 指向不存在的章節 |
| **W05** | Warning | 連結文字為空 — `[](url)` |
| **M001** | Error | 圖片檔案在本機路徑找不到 |
| **M002** | Error | 連結指向的檔案在本機路徑找不到 |
| **Y001** | Error | YAML 解析錯誤（針對 YAML 檔案） |
| **Y002** | Warning | YAML 解析警告（針對 YAML 檔案） |

## 觸發 lint

| 觸發方式 | 動作 |
|---|---|
| `Cmd + Shift + L`（macOS）/ `Ctrl + Shift + L`（Win/Linux） | 對作用中文件執行 lint |
| **工具 → 檢查 Markdown** | 與快捷鍵相同 |
| `F2` | 跳至下一個診斷項目 |
| `Shift + F2` | 跳至上一個診斷項目 |

對含有檔案路徑的 markdown 檔案，連結存在性檢查會與同步規則一起自動執行 — 詳見 [Link Check](/zh-TW/guide/link-check)。

對 YAML 檔案，解析錯誤在你輸入時會即時顯示於行號槽，相同的 `Cmd-Shift-L` 快捷鍵會填入徽章與 F2 導覽。

## 設定

Lint 引擎只有一個面向使用者的開關：

- **設定 → Markdown → 啟用 markdown lint** — 完全開啟或關閉引擎

停用時，快捷鍵變為無動作，行號槽中也不會出現任何診斷。

## 另請參閱

- [Link Check](/zh-TW/guide/link-check) — 損壞的本機連結 / 圖片偵測
- [設定 → Markdown → Lint](/zh-TW/guide/settings#lint)
