# AI 供應商

VMark 的 [AI 精靈](/zh-TW/guide/ai-genies)需要 AI 供應商來生成建議。你可以使用本地安裝的 CLI 工具，或直接連接至 REST API。

## 快速設定

最快的入門方式：

1. 開啟 **設定 > 整合**
2. 點擊 **偵測** 以掃描已安裝的 CLI 工具
3. 若找到 CLI（例如 Claude、Gemini），選取它即可完成設定
4. 若無可用的 CLI，選擇 REST 供應商，輸入 API 金鑰，然後選取模型

每次只能有一個活躍的供應商。

## CLI 供應商

CLI 供應商使用本地安裝的 AI 工具。VMark 以子程序方式執行它們，並將輸出串流回編輯器。

| 供應商 | CLI 指令 | 安裝 |
|--------|---------|------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### CLI 偵測的運作原理

點擊設定 > 整合中的 **偵測**。VMark 在你的 `$PATH` 中搜尋每個 CLI 指令並回報可用性。若找到 CLI，其選鈕即可選取。每次點擊 **偵測** 都會重新掃描；自動偵測（應用程式啟動時、開啟設定時，以及精靈選取器中的供應商切換器）則沿用上一次的掃描結果。掃描使用的是 VMark 啟動時從登入 shell 讀取的 `$PATH`，因此若 CLI 安裝在新加入 `$PATH` 的目錄中，須重新啟動 VMark，**偵測** 才能找到它。

### 優點

- **無需 API 金鑰**——CLI 使用你現有的登入憑證進行身份驗證
- **大幅降低費用**——CLI 工具使用你的訂閱方案（例如 Claude Max、ChatGPT Plus/Pro、Google One AI Premium），收取固定月費。REST API 供應商按 Token 計費，大量使用時費用可能是 10–30 倍
- **使用你的 CLI 設定**——模型偏好設定、系統提示和帳單均由 CLI 本身管理

::: tip 開發者的訂閱 vs API 費用比較
若你也將這些工具用於 vibe 編程（Claude Code、Codex CLI、Gemini CLI），同一個訂閱同時涵蓋 VMark 的 AI 精靈和你的編程工作階段——無需額外費用。
:::

### 設定：Claude CLI

1. 安裝 Claude Code：`npm install -g @anthropic-ai/claude-code`
2. 在終端機中執行一次 `claude` 進行身份驗證
3. 在 VMark 中點擊 **偵測**，然後選取 **Claude**

### 設定：Gemini CLI

1. 安裝 Gemini CLI：`npm install -g @google/gemini-cli`（或透過[官方倉庫](https://github.com/google-gemini/gemini-cli)）
2. 執行一次 `gemini` 以使用 Google 帳戶進行身份驗證
3. 在 VMark 中點擊 **偵測**，然後選取 **Gemini**

## REST API 供應商

REST 供應商直接連接至雲端（或本機）API。每個供應商需要端點、API 金鑰和模型名稱。回應會在請求完成時一次送達——REST 供應商不會串流 Token；CLI 供應商則會。

| 供應商 | 預設端點 | 環境變數 |
|--------|---------|---------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| OpenAI 相容 | *（由你設定）* | — |
| Google AI | *（內建）* | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` |
| Ollama（API） | `http://localhost:11434` | — |

### 設定欄位

選取 REST 供應商時，會出現三個欄位：

- **API 端點**——基礎 URL（Google AI 使用固定端點，因此會隱藏此欄位）。結尾帶有 `/v1` 也沒關係——VMark 會將其正規化，避免路徑重複（例如 `https://host/v1` 與 `https://host` 都可以使用）
- **API 金鑰**——你的秘密金鑰。它存放在作業系統的憑證存放區，永遠不會存放在 `localStorage` 或純文字設定檔中——請參閱 [API 金鑰的存放位置](#api-金鑰的存放位置)
- **模型**——模型識別符（例如 `claude-sonnet-4-5-20250929`、`gpt-4o`、`gemini-2.0-flash`）

### 環境變數自動填入

VMark 從它自身的行程環境中讀取標準環境變數。若已設定 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`，或 `GOOGLE_API_KEY` / `GEMINI_API_KEY`（依此順序檢查），選取該供應商時 API 金鑰欄位會自動填入。

VMark 能看到哪些變數，取決於它是如何啟動的。在 `~/.zshrc` 或 `~/.bashrc` 等 shell 設定檔中匯出的金鑰：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

只有當你從該 shell 啟動應用程式時，才會傳遞給 VMark。若從 Dock、Finder、Spotlight 或桌面啟動器啟動，VMark 不會讀取你的 shell 設定檔，因此欄位會保持空白——請改為直接貼上金鑰。在 Windows 上，無論以何種方式啟動 VMark，使用者或系統環境變數都能生效。

### 設定：Anthropic（REST）

1. 從 [console.anthropic.com](https://console.anthropic.com) 取得 API 金鑰
2. 在 VMark 設定 > 整合中，選取 **Anthropic**
3. 貼上你的 API 金鑰
4. 選擇模型（預設：`claude-sonnet-4-5-20250929`）

### 設定：OpenAI（REST）

1. 從 [platform.openai.com](https://platform.openai.com) 取得 API 金鑰
2. 在 VMark 設定 > 整合中，選取 **OpenAI**
3. 貼上你的 API 金鑰
4. 選擇模型（預設：`gpt-4o`）

### 設定：OpenAI 相容（DeepSeek、Groq、OpenRouter……）

許多供應商使用與 OpenAI 相同的通訊協定（`/v1/chat/completions`、`Bearer` 驗證）。**OpenAI 相容**欄位可以連接其中任何一個——DeepSeek、Groq、OpenRouter、Together、Moonshot、自架閘道等等——不需要為每個廠商各設一個項目。

與其他 REST 供應商相比，它多了一個欄位：可編輯的**服務商名稱**，讓該列顯示「DeepSeek」（或你設定的任何名稱），而不是通用標籤。

範例——DeepSeek：

1. 從 [platform.deepseek.com](https://platform.deepseek.com) 取得 API 金鑰
2. 在 VMark 設定 > 整合中，選取 **OpenAI 相容**
3. 將**服務商名稱**設為 `DeepSeek`（選填，僅影響顯示）
4. 將 **API 端點**設為 `https://api.deepseek.com`（結尾帶有 `/v1` 也沒關係——VMark 會將其正規化）
5. 貼上你的 API 金鑰
6. 將**模型**設為 `deepseek-chat`（或 `deepseek-reasoner`）。可以直接輸入，或點擊重新整理以取得該端點的模型清單

端點為必填——此欄位沒有預設主機。執行精靈前，請先使用**測試**（⚡）與**測試模型**（🧪）按鈕確認連線正常。

### 設定：Google AI（REST）

1. 從 [aistudio.google.com](https://aistudio.google.com) 取得 API 金鑰
2. 在 VMark 設定 > 整合中，選取 **Google AI**
3. 貼上你的 API 金鑰
4. 選擇模型（預設：`gemini-2.0-flash`）

### 設定：Ollama API（REST）

當你希望以 REST 方式存取本地 Ollama 實例，或 Ollama 在網路中的其他電腦上執行時，使用此方式。

1. 確認 Ollama 正在執行：`ollama serve`
2. 在 VMark 設定 > 整合中，選取 **Ollama (API)**
3. 將端點設為 `http://localhost:11434`（或你的 Ollama 主機）
4. 將 API 金鑰留空
5. 將模型設為你已下載的模型名稱（例如 `llama3.2`）

## 選擇供應商

| 情境 | 建議 |
|------|------|
| 已安裝 Claude Code | **Claude (CLI)**——零設定，使用你的訂閱 |
| 已安裝 Codex 或 Gemini | **Codex / Gemini (CLI)**——使用你的訂閱 |
| 需要隱私/離線使用 | 安裝 Ollama → 在 `http://localhost:11434` 使用 **Ollama (API)** |
| 自訂或自架模型 | **Ollama (API)**，使用你的端點 |
| DeepSeek／Groq／OpenRouter／任何 OpenAI 相容 API | **OpenAI 相容**——設定端點、金鑰與模型 |
| 想要最便宜的雲端選項 | **任何 CLI 供應商**——訂閱比 API 便宜得多 |
| 無訂閱，僅輕度使用 | 設定 API 金鑰環境變數 → **REST 供應商**（按 Token 計費） |
| 需要最高品質輸出 | **Claude (CLI)** 或 **Anthropic (REST)**，使用 `claude-sonnet-4-5-20250929` |

## 每個精靈的模型覆蓋

個別精靈可使用 `model` 前置資料欄位覆蓋供應商的預設模型：

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

這適合將簡單任務路由至更快/更便宜的模型，同時保留強大的預設值。

## 可靠性與逾時機制

VMark 對每個供應商的呼叫都設有防護機制，確保 CLI 卡住或 API 回應格式錯誤時，不會封鎖編輯器：

- **CLI 子程序逾時**：每次 CLI 供應商的呼叫都會在執行逾時限制下運行。若 CLI 未回應，VMark 會取消呼叫，將錯誤回傳給精靈，並釋放工作執行緒——執行緒池不會被失控的子程序卡住。
- **REST JSON 解析安全**：若 REST 供應商回傳非預期的回應格式（HTML 錯誤頁面、截斷的 JSON、上游變更後的結構偏移），VMark 會向前端回傳型別化錯誤，而非讓 AI 監聽器永久等待。你會在精靈的狀態橫幅中看到錯誤，並可選擇重試。
- **取消權杖**：長時間執行的精靈或工作流程步驟可隨時取消——在精靈選取器中點擊取消，或關閉面板，即可乾淨地中止進行中的請求。
- **共用 HTTP 用戶端**：REST 供應商共用單一具連線池的 `reqwest` 用戶端，因此連續的精靈執行不需要每次都重新進行 TCP/TLS 握手。
- **Windows 路徑探索**：在 Windows 上，VMark 在偵測 CLI 時會讀取使用者的完整 `PATH`（包含僅限 PowerShell 的項目），因此在終端機中可用的使用者安裝工具，在 VMark 內也能正常使用。

## API 金鑰的存放位置

API 金鑰保存在作業系統的憑證存放區——macOS 鑰匙圈、Windows 認證管理員或 Linux Secret Service——服務名稱為 `app.vmark.secrets`，每個供應商一個項目。VMark 只在執行中的工作階段於記憶體中保留一份副本；保存的供應商設定永遠不含金鑰，也不會寫入任何內容到 `localStorage`。舊版 VMark 存放在純文字設定檔中的金鑰，會在新版第一次載入時移入鑰匙圈，且只有在成功讀回鑰匙圈寫入的內容後，才會刪除純文字副本。

若鑰匙圈拒絕寫入，VMark 會顯示錯誤提示訊息，而不是默默地把金鑰留在記憶體中。在 macOS 上，以 ad-hoc 簽署的開發版本可能會在每次重新簽署後再次要求鑰匙圈存取權限；正式版本只會詢問一次。

## 安全注意事項

- **API 金鑰存放在作業系統鑰匙圈中**——見上文；它們永遠不會寫入 VMark 的設定檔或 `localStorage`
- **環境變數**會在你選取供應商時讀取，且只會填入空白的金鑰欄位
- **CLI 供應商** 使用你現有的 CLI 身份驗證——VMark 永遠看不到你的憑證
- **所有請求直接** 從你的電腦發送至供應商——中間沒有 VMark 伺服器

## 疑難排解

**「沒有可用的 AI 提供者」**——點擊 **偵測** 掃描 CLI，或設定帶有 API 金鑰的 REST 供應商。

**CLI 顯示「找不到」**——CLI 不在你的 `$PATH` 中。安裝它或檢查你的 shell 設定檔。在 macOS 上，GUI 應用程式可能無法繼承終端機的 `$PATH`——嘗試將路徑加入 `/etc/paths.d/`。

**CLI 卡住 / 無回應**——VMark 的執行逾時會自動取消呼叫；你會在精靈狀態橫幅中看到錯誤。若特定 CLI 持續觸發逾時，請先在終端機中直接執行該 CLI 確認可正常運作，再確認是否需要互動式驗證。

**REST 供應商返回 401**——你的 API 金鑰無效或已過期。從供應商控制台生成新的金鑰。

**REST 供應商返回 429**——你已達到速率上限。稍等後重試，或切換至其他供應商。

**REST 供應商回傳亂碼 / 非預期的 JSON**——VMark 會顯示型別化解析錯誤（例如「list_models 回傳非預期的回應格式」）。請確認端點 URL 正確，且所選供應商類型的 API 合約相符；某些自架閘道雖宣稱相容於 OpenAI 的 URL，但實際上使用不同結構。

**回應緩慢**——CLI 供應商會增加子程序開銷。如需更快的回應，請使用直接連接的 REST 供應商。最快的本地選項是使用小型模型的 Ollama。

**找不到模型錯誤**——模型識別符與供應商提供的不符。查閱供應商文件以取得有效的模型名稱。

## 延伸閱讀

- [AI 精靈](/zh-TW/guide/ai-genies)——如何使用 AI 寫作輔助
- [MCP 設定](/zh-TW/guide/mcp-setup)——透過模型情境協定進行外部 AI 整合
