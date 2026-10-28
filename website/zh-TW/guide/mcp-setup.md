# AI 整合（MCP）

VMark 內建 MCP（模型情境協定）伺服器，讓 Claude 等 AI 助理能夠直接與你的編輯器互動。

## 什麼是 MCP？

[模型情境協定](https://modelcontextprotocol.io/)是一個開放標準，讓 AI 助理能夠與外部工具和應用程式互動。VMark 的 MCP 伺服器將其編輯器功能以工具的形式公開，供 AI 助理用來：

- 讀取和寫入文件內容
- 套用格式和建立結構
- 導覽和管理文件
- 插入特殊內容（數學、圖表、Wiki 連結）

## 快速設定

VMark 讓你只需點擊一下即可連接 AI 助理。

### 1. 啟用 MCP 伺服器

開啟 **設定 → 整合** 並啟用 MCP 伺服器：

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP Server Settings" />
</div>

- **啟用 MCP 伺服器** - 開啟以允許 AI 連接
- **啟動時自動開始** - VMark 開啟時自動啟動
- **自動核准儲存至新位置與精靈結果** - 預設關閉。讓 AI 無需詢問即可將文件儲存到*新*路徑，並讓精靈直接套用其結果，而不是以建議的形式呈現。一般的 AI 寫入從不受此設定把關——它們的安全網是[編輯檢查點歷史](#編輯檢查點)（請參閱[編輯如何運作](#編輯如何運作)）

### 2. 安裝設定

為你的 AI 助理點擊 **安裝**：

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

支援的 AI 助理：
- **Claude Desktop** - Anthropic 的桌面應用程式
- **Claude Code** - 開發者 CLI
- **Codex CLI** - OpenAI 的程式設計助理
- **Antigravity CLI** - Google 的 `agy`，Gemini CLI 的後繼者
- **Grok CLI** - xAI 的程式設計代理
- **opencode** - 開放原始碼、不綁定供應商的終端機代理

**安裝會寫入每個用戶端專屬的憑證。** 除了 VMark MCP 伺服器的路徑之外，安裝還會在用戶端自己的設定檔中放入一個秘密權杖，位於 `env.VMARK_MCP_TOKEN` 之下（opencode 則為 `environment.VMARK_MCP_TOKEN`）。每個用戶端都有自己的權杖，而且它不會儲存在其他任何地方。它讓 VMark 知道是哪個用戶端在連線，而不是信任用戶端自行回報的名稱。目前只有委派動作需要它——也就是以 `coherence_resolve` 代你回答一致性問題；其他所有工具不需要它也能運作。安裝與**修復**會保留仍然有效的權杖；若要核發新的權杖，請先解除安裝再重新安裝。無論哪種操作之後，都請重新啟動 AI 用戶端。請像對待密碼一樣對待這個權杖：不要把設定檔貼到 issue 或聊天中。

::: info Gemini CLI 已停止支援
Google 已用 Antigravity 取代 Gemini CLI。若先前的 VMark 安裝在 `~/.gemini/settings.json` 中留下了 `vmark` 條目，整合面板會為它顯示一列**已停用**，並附有**移除**按鈕；新的安裝則改以 Antigravity 為目標。
:::

::: info 其他 MCP 相容用戶端
其他 MCP 相容用戶端（如 Cursor、Windsurf 等類似工具）也可以連接到 VMark 的 MCP 伺服器。透過指向 MCP 伺服器執行檔路徑來手動設定它們（請參閱下方的[手動設定](#手動設定)）。
:::

#### CC-Switch

如果你使用 CC-Switch 管理 AI CLI，安裝程式還會顯示一列 **CC-Switch**。**加入 CC-Switch** 會開啟一個 `ccswitch://v1/import` 連結，把 VMark 的 MCP 伺服器（其執行檔路徑）交給 CC-Switch，再由 CC-Switch 將 `vmark` 條目寫入你在其中管理的各個 CLI；若你偏好自行貼上，複製按鈕會直接提供該連結。在 VMark 解析出自身的 MCP 執行檔之前，此列會處於停用狀態。

#### 狀態圖示

每個供應商顯示狀態指示器：

| 圖示 | 狀態 | 意義 |
|------|------|------|
| ✓ 綠色 | 有效 | 設定正確且運作中 |
| ⚠ 琥珀色 | 路徑不符 | VMark 已移動——點擊 **修復** |
| ✗ 紅色 | 執行檔遺失 | 找不到 MCP 執行檔——重新安裝 VMark |
| 🗎 紅色 | 設定無法讀取 | VMark 無法讀取或解析設定檔，因此無法得知其中是否有 VMark 條目。訊息會指出該檔案與原因。修復或移走該檔案後，點擊**重新檢查**——在它能被解析之前，安裝與修復都會暫停，因為寫入 VMark 無法讀取的檔案可能會破壞其內容 |
| ○ 灰色 | 未設定 | 尚未安裝——點擊 **安裝** |

::: tip VMark 移動了？
若你將 VMark.app 移至其他位置，狀態會顯示琥珀色「路徑不符」。只需點擊 **修復** 按鈕，以新路徑更新設定即可。
:::

### 3. 重新啟動你的 AI 助理

安裝或修復後，請 **完全重新啟動你的 AI 助理**（退出並重新開啟）以載入新設定。每次設定變更後，VMark 都會顯示提醒。

### 4. 試用

在你的 AI 助理中，嘗試以下指令：
- *「我的 VMark 文件裡有什麼？」*
- *「把量子運算的摘要寫到 VMark」*
- *「為我的文件加入目錄」*

## 實際運作展示

向 Claude 提問，讓它直接將答案寫入你的 VMark 文件：

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop using VMark MCP" />
  <p class="screenshot-caption">Claude Desktop 呼叫 <code>document</code> → <code>set_content</code> 寫入 VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Content rendered in VMark" />
  <p class="screenshot-caption">內容立即出現在 VMark 中，格式完整</p>
</div>

<!-- Styles in style.css -->

## 手動設定

若你偏好手動設定，以下是設定檔位置：

### Claude Desktop

編輯 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

編輯 `~/.claude.json` 或專案的 `.mcp.json`：

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

編輯 `~/.codex/config.toml`：

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Antigravity CLI

編輯 `~/.gemini/config/mcp_config.json`：

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

編輯 `~/.grok/config.toml`：

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

編輯 `~/.config/opencode/opencode.json`。opencode 的結構描述與 `mcpServers` 那一種不同：鍵是 `mcp`，而 `command` 是一個同時包含程式及其參數的陣列：

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

如果你自己的設定位於 `opencode.jsonc`，請保留在那裡——opencode 會合併這兩個檔案，因此 VMark 在 `opencode.json` 中的條目是附加的。VMark 寫入純 JSON 檔案，是因為它無法在 `.jsonc` 檔案中完整保留註解。

::: warning `opencode.jsonc` 中既有的 `vmark` 條目會優先
opencode 會依序合併 `config.json`、`opencode.json`、`opencode.jsonc`，最後讀取的檔案優先。因此，如果你先前曾手動在 `opencode.jsonc` 中加入 `vmark` 條目，它會覆蓋 VMark 所管理的條目——VMark 會回報該供應商有效，而 opencode 卻繼續使用你較舊的條目（以及其過時的執行檔路徑）。請從 `opencode.jsonc` 中刪除手寫的 `mcp.vmark` 區塊，交由整合面板管理。
:::

::: tip 尋找執行檔路徑
在 macOS 上，MCP 伺服器執行檔位於 VMark.app 內：
- `VMark.app/Contents/MacOS/vmark-mcp-server`

在 Windows 上：
- `C:\Program Files\VMark\vmark-mcp-server.exe`

在 Linux 上：
- `/usr/bin/vmark-mcp-server`（或你安裝的位置）

連接埠自動探索——無需 `args`。
:::

### CLI 旗標（進階）

MCP 伺服器執行檔支援少量用於診斷與舊版設定的旗標：

| 旗標 | 功能 |
|---|---|
| `--version`（或 `-v`） | 印出版本號（必須與執行中的 VMark 相符）並退出。 |
| `--health-check` | 對執行檔本身進行自我測試並退出：它會以內建的模擬橋接啟動 MCP 伺服器，以 JSON 印出其版本與工具數量，若工具數量不是此版本預期的數值，則以非零值退出。它**不會**連線到執行中的 VMark——用它確認執行檔能夠執行；若要檢查即時橋接，請使用**設定 → 整合**。 |
| `--port <number>` | 手動連接埠覆蓋。略過自動探索握手，直接以指定連接埠連線。僅在橋接連接埠由外部固定的舊版設定中有用；一般情況下建議使用自動探索路徑。 |

範例：

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # 舊版 / 手動
```

其他任何參數（拼錯的旗標、`--port=9223` 或多餘的字詞）都會被拒絕：程式會輸出用法錯誤並以結束代碼 64 結束，而不會退回自動探索。

## 運作原理

```text
AI Assistant <--stdio--> MCP Server <--WebSocket--> VMark Editor
```

1. **VMark 在啟動時** 在可用連接埠上啟動 WebSocket 橋接
2. **MCP 伺服器** 從 VMark 的應用程式資料目錄讀取連接埠和驗證權杖
3. **MCP 伺服器** 透過 WebSocket 橋接連線並驗證
4. **AI 助理** 透過 stdio 與 MCP 伺服器通訊
5. **指令透過橋接** 轉發至 VMark 的編輯器

## 可用功能

連接後，你的 AI 助理擁有十個工具：

| 工具 | 涵蓋範圍 |
|------|------|
| `session` | 視窗、分頁、使用中的文件與瀏覽器分頁（唯讀） |
| `workspace` | 新增、開啟、儲存、另存新檔、關閉、切換分頁、聚焦視窗、開啟工作區 |
| `document` | 以 Markdown 讀寫整份文件；CJK 格式轉換 |
| `selection` | 讀取並取代選取的文字 |
| `comments` | 列出文件的審閱留言、回覆留言並將其標記為已處理（助理無法解決留言） |
| `workflow` | 針對 GitHub Actions YAML 的 CST 安全修補與驗證 |
| `browser` / `browser_read` | macOS 上的內嵌瀏覽器自動化——分別是會變更狀態與唯讀的兩半 |
| `coherence` / `coherence_resolve` | 讀取一致性層；在你授予的委派範圍內解決過時的關聯 |

格式並不是一個獨立的工具：助理寫的是 Markdown，所以標題、表格、數學式和圖表就是它所寫出的內容。

完整文件請參閱 [MCP 工具參考](/zh-TW/guide/mcp-tools)。

## 檢查 MCP 狀態

VMark 提供多種方式檢查 MCP 伺服器狀態：

### 狀態列指示器

狀態列右側顯示 **MCP** 指示器。有需要你注意的情況時，衛星圖示旁會出現一個簡短的狀態字樣；連線正常時只會顯示綠色圖示。將游標停在上面，會依名稱與版本列出目前已連線的 AI 用戶端：

| 顏色 | 字樣 | 狀態 |
|------|------|------|
| 綠色 | — | 已連接且正在執行 |
| 灰色 | `off` | 已斷開或已停止 |
| 閃爍（動態） | `…` | 正在啟動 |
| 紅色 | `error` | 伺服器失敗——將游標停在上面可查看原因 |

啟動通常在 1-2 秒內完成。

點擊指示器可開啟**設定 → 整合**。

### 設定面板

**設定 → 整合**是另一個狀態介面——沒有獨立的狀態對話框。橋接執行期間，它會顯示正在監聽的位址（`localhost:<port>`，附有複製按鈕）以及已連線的 AI 用戶端數量，每隔幾秒更新一次。**測試連線**按鈕（橋接停止時標示為**檢查附屬程序**）會執行附屬程序自己的 `--health-check`，並回報附屬程序的版本、工具數量以及上次檢查的時間——它確認的是已安裝的執行檔能夠運作，而不是有用戶端已連線。

## 疑難排解

### 「連接被拒絕」或「沒有活躍的編輯器」

- 確認 VMark 正在執行且有文件開啟
- 檢查 MCP 伺服器是否在設定 → 整合中啟用
- 確認 MCP 橋接顯示「執行中」狀態
- 若連接中斷，重新啟動 VMark

### 移動 VMark 後路徑不符

若你將 VMark.app 移至其他位置（例如從下載移至應用程式），設定將指向舊路徑：

1. 開啟 **設定 → 整合**
2. 尋找受影響供應商旁的琥珀色 ⚠ 警告圖示
3. 點擊 **修復** 以更新路徑
4. 重新啟動你的 AI 助理

### 工具未出現在 AI 助理中

- 安裝設定後重新啟動你的 AI 助理
- 確認設定已安裝（在設定中檢查綠色勾選標記）
- 查看 AI 助理的日誌以了解 MCP 連接錯誤

### 指令失敗顯示「沒有活躍的編輯器」

- 確保 VMark 中有活躍的文件分頁
- 點擊編輯器區域以使其取得焦點
- 某些指令需要先選取文字

## 編輯如何運作

精簡後的 MCP 介面遵循「讀取—寫入」主幹：AI 助理呼叫 `document.read` 取得目前內容與一個修訂權杖，推理之後，再以新的完整內容呼叫 `document.write`。修訂權杖可防止無聲的覆寫：如果 AI 思考期間你在 VMark 中輸入了內容，寫入會回傳 `STALE`，AI 會重新讀取。

對於 GitHub Actions 工作流程 YAML 檔案，AI 會改用 `workflow.apply_patch`——VMark 具 CST 感知能力的變更器會保留註解、錨點與鍵的順序，這些都是直接改寫原始文字時會遺失的。

`document.write`、`selection.set` 或 `workflow.apply_patch` 都沒有預覽步驟——只要修訂檢查通過，變更就會立即落入編輯器。安全網是下方的[編輯檢查點歷史](#編輯檢查點)；如果你希望在任何變更落地之前先審閱，請將文件納入 git 管理並審閱差異。唯一的核准關卡是**自動核准儲存至新位置與精靈結果**：關閉時（預設），AI 無法將文件儲存到新路徑——`workspace.save_as` 會回傳 `APPROVAL_REQUIRED`，VMark 會顯示一則指出該檔案的通知。即使開啟此設定，`save_as` 也會拒絕覆寫另一個既有的檔案。

## 編輯檢查點

AI 對文件的每一次修改 — `document.write`、`document.transform`、`selection.set` 和 `workflow.apply_patch` — 都會在變更任何內容之前記錄到 VMark 的編輯歷史中。狀態列中的 **歷史** 按鈕會為目前聚焦的文件開啟一個面板。按鈕上的計數表示該文件由 AI 產生的版本數；當修改沒有被記錄時，按鈕會變為警告色。每當有新版本被記錄，面板會在所有視窗中即時更新。

面板依從新到舊列出文件的版本。每一列顯示發生時間、修改類型、工具以及修改者：AI 用戶端的提供者（例如 `claude` 或 `codex`）、它的連線和工作階段標籤。沒有權杖的用戶端顯示為 **未識別的用戶端**，未知權杖顯示為 **無法辨識的憑證**，被多個用戶端共用的權杖顯示為 **由多個提供者共用的憑證** — 無論用戶端自稱什麼名字，都不會顯示為某個提供者。**還原此版本** 會還原該版本的文字；**還原到此變更之前** 會還原修改之前的文字。還原會推進文件的修訂號，因此仍持有舊修訂號的 AI 用戶端在下一次寫入時會收到 `STALE`，而不會覆寫你的還原。還原本身也會被記錄：被取代的文字會先保存下來，而在還原過程中被編輯過的文件不會被變動。如果 VMark 無法確認還原的記錄已寫入磁碟，會在結果旁邊提醒你。

版本列表上方的 **審閱 AI 修改** 依用戶端和工作階段分組，列出你尚未審閱的 AI 修改；修改已全部審閱的版本只彙總為一個數量。每項修改提供 **保留** 或 **還原**（之後可 **取消保留** 或 **取消還原**）。會覆寫你之後編輯過的文字的還原不會執行：該修改被標記為衝突，你手動解決後，以 **標記為已處理** 記錄下來。位置已無法確認的修改會說明原因，且不提供自動還原。**清除已審閱** 在確認後永久結束所有已審閱的修改，此操作無法復原。一份文件最多容納 500 項未審閱的 AI 修改：達到上限時會有橫幅提示，在你審閱並清除之前，AI 對它的編輯會以 `REVIEW_BACKLOG_FULL` 被拒絕。從與上一版本不同的版本開始的儲存 — 即文件在兩個視窗中被編輯 — 會被如此標示，並提供兩個還原操作以復原合併。點選**顯示兩處變更**可查看該次儲存的兩份差異：*與此次儲存起始的版本相比*對比該次儲存起始的版本，*與上一版本相比*對比歷史中的上一版本。

其後的 **評論** 列出文件的評論串。**評論所選內容** 會引用編輯器中選取的文字（只有游標時為游標所在段落）並新增你的評論；未儲存的文字會先被記錄，因此評論絕不會指向舊版本。每個評論串顯示其狀態（待處理、已處理、已解決或已重新開啟）、作者、引用的文字與回覆。評論以純文字顯示：評論中的 HTML 只會被顯示，絕不會被執行。引用的文字現在出現多次時，評論串會說明次數；文字消失時，評論串也會說明。你可以在任何狀態下 **回覆**，將待處理或已重新開啟的評論串 **標記為已處理**、**解決**，並將已解決的評論串 **重新開啟** 或 **刪除**；刪除前會先確認，且無法復原。評論或回覆正在傳送時，即使關閉面板再重新開啟，也無法編輯或取消；遭拒絕的內容會保留下來，方便你修改後重新傳送。只有你可以解決、重新開啟或刪除評論串。在原始修訂版本已從歷史中清除後重新開啟的評論串會顯示 *建立時的修訂版本已不再保留*，並與目前的文字進行比對。

面板頂部會在修改沒有被記錄時給出提示：歷史無法啟動或處於唯讀狀態；歷史落後（記錄在排隊，尚未寫入磁碟）；此文件上一次儲存被拒絕，或歷史未能及時回應；因視窗中開啟的頁面過多，AI 編輯遭拒絕；或者某些 AI 修改已無法再自動復原。面板也會統計因無法確認修改範圍而被記錄為整份文件修改的 AI 編輯。無法再自動復原的修改會顯示為 **已封鎖：原因（來源）**，位於其位置最後一次被確認的版本之下，該版本會被醒目標示；如果沒有這樣的版本，面板會說明位置無法取得。已套用但從未被記錄的寫入列在 **未記錄的寫入** 下，每一項都可以還原或捨棄。

要區分同一用戶端的多個工作階段，請在用戶端的 MCP 設定中、在 `VMARK_MCP_TOKEN` 旁邊設定 `VMARK_SESSION_LABEL`：

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

標籤最多 128 個 UTF-8 位元組，且不能包含控制字元；違反規則的標籤會被捨棄並給出警告，用戶端會在沒有標籤的情況下連線。標籤由用戶端的設定決定，因此僅用於顯示，不參與任何判斷。

歷史保存在 VMark 應用程式資料目錄下的 `agent-journal` 資料夾中，因此重新啟動後依然保留。該資料夾包含每次被記錄的編輯之前的完整文字，並且只有擁有者可以存取（在 macOS 和 Linux 上為 `0700`）。來自舊版 VMark 的檢查點（一個 `mcp-checkpoints.jsonl`，在首次啟動時匯入，隨後改名保留）列在 **較早的檢查點** 下，這是一個涵蓋所有文件和視窗的統一清單。還原其中一項會開啟它的檔案；未命名的檢查點，或檔案已無法開啟的檢查點，會還原到一個新文件中。該部分會顯示保留的檢查點文字大小，並可一次清除全部內容 — 每個檔案、每個視窗 — 同時從磁碟刪除這些文字。

## 安全注意事項

- MCP 伺服器只接受本地連接（localhost）
- 不向外部伺服器發送任何資料
- AI 的檔案操作僅限於已開啟的工作區根目錄以及已開啟文件所在的資料夾——請參閱[隱私](/zh-TW/guide/privacy#ai-助理可以觸及的範圍)
- 所有處理都在你的電腦上進行
- WebSocket 橋接只能在本地存取
- 每個已安裝的用戶端都帶有自己的 `VMARK_MCP_TOKEN`。沒有權杖、權杖不明，或與其他用戶端共用權杖的用戶端仍可連線，但其委派動作會被拒絕，並顯示一則訊息，請你在**設定 → 整合**中為它執行安裝並重新啟動它

## 下一步

- 探索所有可用的 [MCP 工具](/zh-TW/guide/mcp-tools)
- 了解[鍵盤快捷鍵](/zh-TW/guide/shortcuts)
- 查看其他[功能](/zh-TW/guide/features)
