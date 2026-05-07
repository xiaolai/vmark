# 支援的格式

VMark 可以直接開啟以下所有檔案格式。其差異化之處在於**結構感知預覽**：當檔案為已知產物時，VMark 會渲染*正確的*視圖，而非通用的 JSON 樹狀結構。

[[toc]]

## 啟用格式

Markdown、純文字和 YAML/YML 一律在完整編輯器中開啟 — 這是沉穩的預設值。以下所有其他格式**預設為關閉**，需在**設定 → 格式**中切換對應分類才能啟用：

| 切換項目 | 啟用 |
|---|---|
| **資料格式** | `.json`、`.jsonl`、`.toml`（分割面板：原始碼 + 樹狀結構，含 Cargo / package.json / pyproject 結構渲染器） |
| **圖表與 SVG** | `.mmd`、`.svg`（分割面板：原始碼 + 淨化後的即時渲染） |
| **HTML 預覽** | `.html`、`.htm`（沙盒 iframe — 請見[HTML 安全模型](#html-安全模型)） |
| **程式碼檢視器** | 12 個唯讀程式碼檢視器（`.ts`、`.tsx`、`.js`、`.jsx`、`.py`、`.rs`、`.go`、`.css`、`.sh`、`.bash`、`.rb`、`.lua`） |

當某個分類關閉時，對應的副檔名會退回至純文字模式，檔案仍可開啟，只是不會顯示預覽或結構視圖。切換後，格式登錄檔會即時重建；已開啟的分頁會以正確的轉接器重新掛載。

升級至多格式支援後首次啟動時，VMark 會顯示一次性的提示通知，引導你前往**設定 → 格式**。若你已關閉通知（或全新安裝），隨時可在**設定 → 格式**找到該面板。

## 快速一覽

| 類型 | 副檔名 | 預設 | 編輯器 | 預覽 |
|---|---|---|---|---|
| Markdown | `.md`、`.markdown`、`.mdown`、`.mkd`、`.mdx` | 一律開啟 | 所見即所得 + 原始碼模式 | 渲染後的內文 |
| 純文字 | `.txt` | 一律開啟 | 原始碼 | — |
| 資料 — YAML | `.yaml`、`.yml` | 一律開啟 | 原始碼 + 樹狀結構 | 可導覽的樹狀結構，結構感知（GitHub Actions） |
| 資料 — JSON | `.json`、`.jsonl` | 需啟用**資料格式** | 原始碼 + 樹狀結構 | 可導覽的 JSON 樹狀結構，結構感知（`package.json`） |
| 資料 — TOML | `.toml` | 需啟用**資料格式** | 原始碼 + 樹狀結構 | 可導覽的樹狀結構，結構感知（`Cargo.toml`、`pyproject.toml`） |
| 圖表 | `.mmd` | 需啟用**圖表與 SVG** | 原始碼 + 渲染 | 即時 Mermaid 圖表 |
| 向量圖形 | `.svg` | 需啟用**圖表與 SVG** | 原始碼 + 渲染 | 淨化後的行內渲染 |
| 網頁 | `.html`、`.htm` | 需啟用**HTML 預覽** | 原始碼 + 渲染 | 沙盒 iframe（空的 `sandbox=""`、DOMPurify、CSP） |
| 程式碼（唯讀） | `.ts`、`.tsx`、`.js`、`.jsx`、`.py`、`.rs`、`.go`、`.css`、`.sh`、`.bash`、`.rb`、`.lua` | 需啟用**程式碼檢視器** | 檢視器（可切換為編輯） | — |

程式碼檔案預設為唯讀，並顯示橫幅提供**啟用編輯**或**在外部編輯器中開啟**的選項。

## 結構感知預覽

當路徑或內容符合已知結構時，VMark 會以正確的視圖取代通用樹狀結構。

### GitHub Actions 工作流程（`.github/workflows/*.yml`）

以工作流程視覺化方式開啟（工作 DAG、觸發條件、權限）。

- **路徑偵測**：`.github/workflows/` 下的 `.yml` / `.yaml` 檔案會路由至工作流程渲染器 — 即使 YAML 格式有誤，你也會看到帶有診斷資訊的降級視圖，而非空白樹狀結構。（檔案須先通過 YAML 轉接器；這需要 `.yml`/`.yaml` 副檔名。）
- **內容偵測**：頂層的 `on:` 和 `jobs:` 鍵。

### `Cargo.toml`

以 Rust 相依性樹狀結構開啟 — 執行期、開發和建置相依性，含版本規格與功能旗標。

- **路徑偵測**：POSIX 或 Windows 路徑上的檔名 `Cargo.toml`（不分大小寫）。
- **內容偵測**：`[package]` 或 `[workspace]` 標頭。
- 不進行網路呼叫 — VMark 不會解析 crates.io。

### `package.json`

以 npm 相依性樹狀結構開啟 — `dependencies`、`devDependencies`、`peerDependencies`、`optionalDependencies`。

- **路徑偵測**：檔名 `package.json`。
- **內容偵測**：頂層的 `name` 加上 `dependencies` / `devDependencies` / `peerDependencies` 其中之一。

### `pyproject.toml`

以 Python 相依性樹狀結構開啟 — 同時支援 PEP 621（`[project]` + `[project.optional-dependencies]`）和 Poetry（`[tool.poetry.dependencies]`、`[tool.poetry.dev-dependencies]`、`[tool.poetry.group.<name>.dependencies]`）。

- **路徑偵測**：檔名 `pyproject.toml`。
- **內容偵測**：`[project]` 或 `[tool.poetry]` 標頭（以乾淨的 TOML 解析為前提）。

## 編輯規則

- **Markdown** 提供完整工具列、段落格式設定、CJK 規則、數學、Mermaid、腳注 — 所有現有 Markdown 功能。
- **資料格式**（JSON、YAML、TOML）在原始碼面板中顯示，帶有解析錯誤的側邊欄標記；樹狀預覽會隨輸入即時更新。僅適用於 Markdown 的選單操作已停用（CJK 格式化、插入區塊、段落格式設定）；與模式相關的控制項仍保持啟用。
- **視覺格式**（Mermaid、SVG、HTML）在原始碼面板中顯示，右側面板顯示渲染視圖（有防抖延遲）。
- **程式碼格式**以語法高亮的檢視器開啟；可切換為就地編輯，或在外部編輯器中開啟（見下方說明）。

## 尋找、儲存、內容搜尋

- **Cmd+O** 過濾器：一個涵蓋所有已登錄格式的「所有支援」預設集。另存新檔的過濾器和預設儲存副檔名，均源自當前分頁的格式轉接器，因此儲存 `.toml` 檔案時會建議以 `.toml` 作為副檔名。
- **拖放**接受任何已登錄的副檔名。
- **另存新檔**的過濾器和預設副檔名源自當前分頁的格式轉接器。
- **Cmd+Shift+H** 內容搜尋（「在檔案中尋找」）會索引所有類文字格式（Markdown、txt、json、yaml、toml、html、svg、mermaid）。程式碼檔案預設不納入索引 — 它們處於程式碼檢視器模式。

## HTML 安全模型

根據多格式計畫的 ADR-4，HTML 預覽建立在三個獨立的防禦層之上：

1. **`<iframe sandbox="">`** 使用空的允許清單 — 無腳本、無同源、無表單、無彈出視窗。沙盒僅由 iframe 屬性本身強制執行（根據 MDN，透過 `<meta>` 設定的 CSP 並非沙盒）。
2. **DOMPurify 淨化**優先執行 — 剝除 `<script>`、`javascript:` URL、行內事件處理器、base-href 技巧。
3. **CSP `<meta>` 注入** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — 限制 iframe 內的資源載入。

驗證器會將 script 標籤、`javascript:` URL 和行內事件處理器標示為警告，讓你了解哪些內容被封鎖。

## 在外部編輯器中開啟

對於程式碼檔案，唯讀橫幅上的**在外部編輯器中開啟**按鈕會啟動你選擇的編輯器。解析優先順序如下：

1. **設定 → 格式 → 外部編輯器**（圖形介面欄位 — 請見[設定](/zh-TW/guide/settings#格式)）。在 macOS 上選取 `.app` 套件，在 Linux/Windows 上選取可執行檔，或任何 shell 可以解析的路徑。
2. `$VMARK_EXTERNAL_EDITOR`（專案層級的環境變數覆蓋）
3. `$VISUAL`
4. `$EDITOR`
5. 平台預設（macOS 上的 `open -t`、Windows 上的 `notepad.exe`、Linux 上的 `xdg-open`）

圖形介面設定優先於環境變數 — 明確勝於隱含。將欄位留空可使用環境變數備用鏈。

VMark 透過登入 shell 的 PATH 進行路由，因此從 macOS GUI 應用程式啟動時，VS Code / Cursor / JetBrains 包裝器也能正確解析。

### 安全閘道

`open_in_external_editor` Tauri 指令會拒絕下列情況：

- 不存在的路徑
- 目錄及其他非一般檔案（socket、裝置）
- 標準化副檔名不在 VMark 已登錄格式集中的路徑
- 標準化目標不通過上述任何檢查的符號連結

被入侵的 webview 無法透過此按鈕對任意系統檔案（密碼、金鑰等）啟動外部編輯器 — 只能對 VMark 本身也可開啟的路徑使用。

## 不支援的功能

根據計畫的非目標：

- **不是程式碼編輯器。** 無 LSP、無自動完成、無重構、無除錯器、無 git 差異檢視。
- **不是「所有純文字格式」。** 範圍有限 — 請見上方表格。
- **不執行 HTML 腳本。** 僅提供沙盒渲染。
- **v1 不支援非 Markdown 格式的列印 / 匯出 / 複製為 HTML。**
- **尚未作為程式碼檢視器支援**：Zig、Swift、Kotlin、Java、Elixir、OCaml 及 12 個副檔名集之外的其他語言。決策原則是「我們自己使用的語言」 — 若你希望加入某種語言，請提交 Issue。

若你想要的格式未列出，且並非刻意排除在範圍之外，歡迎提交 Issue。
