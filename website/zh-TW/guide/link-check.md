# Link Check

VMark 會驗證 markdown 中本機連結與圖片的目標是否實際存在於磁碟上。它與 [markdown lint 引擎](/zh-TW/guide/lint) 一起，於 `Cmd-Shift-L` 或 **工具 → 檢查 Markdown** 時執行。

## 它檢查什麼

對文件中的每個本機連結與圖片：

- `[text](./other.md)` — 檔案 `./other.md` 可解析且存在
- `![alt](./image.png)` — 圖片檔案存在
- `[text](./other.md#section)` — 檔案存在（錨點檢查由 [`linkFragments` 規則](/zh-TW/guide/lint#規則參考)處理）

當目標遺失時，連結文字會以紅色波浪線標示，且 lint 徽章 / F2 導覽中會出現一筆項目。

## 它略過什麼

- **僅有片段的連結**（`#anchor`）— 由 `linkFragments` 規則對當前文件的標題進行檢查
- **外部 URL** — `http://`、`https://`、`ftp://`、`mailto:`、`tel:`、`data:`、`file:`
- **未命名文件** — 沒有已儲存的檔案路徑時，相對 URL 無法相對於任何目錄解析

## 路徑解析方式

Link Check 將路徑相對於來源檔案所在目錄解析：

| 在 `/repo/docs/intro.md` 中的連結 | 解析為 |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md`（相對於檔案目錄當作相對路徑處理） |

片段在檔案查找前會被去除 — `[a](./other.md#section)` 只檢查 `./other.md`。

## 效能

- **非同步** — 與同步規則並行執行；結果準備好時併入
- **去重** — 每個唯一解析路徑於每次執行只檢查一次，即使被多次連結
- **不於每次按鍵時觸發** — 對每次按鍵呼叫 `fs.exists` 會造成卡頓；只在明確的 lint 觸發時執行
- **操作錯誤容忍** — 若 `fs.exists` 拋出例外（權限不足、capability 範圍問題），結果為 `error`（略過），而非 `missing`。寧可靜默也不要誤報。

## 診斷代碼

| 代碼 | 嚴重程度 | 觸發條件 |
|---|---|---|
| **M001** | Error | 圖片檔案在解析後的本機路徑找不到 |
| **M002** | Error | 連結指向的檔案在解析後的本機路徑找不到 |

## 另請參閱

- [Markdown Lint](/zh-TW/guide/lint) — 完整規則參考
- [設定 → Markdown → Lint](/zh-TW/guide/settings#lint)
