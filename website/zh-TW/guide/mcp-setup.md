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
- **自動核准編輯** - 直接套用 AI 變更，無需預覽（見下文）

### 2. 安裝設定

為你的 AI 助理點擊 **安裝**：

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

支援的 AI 助理：
- **Claude Desktop** - Anthropic 的桌面應用程式
- **Claude Code** - 開發者 CLI
- **Codex CLI** - OpenAI 的程式設計助理
- **Gemini CLI** - Google 的 AI 助理

::: info 其他 MCP 相容用戶端
其他 MCP 相容用戶端（如 Cursor、Windsurf 等類似工具）也可以連接到 VMark 的 MCP 伺服器。透過指向 MCP 伺服器執行檔路徑來手動設定它們（請參閱下方的[手動設定](#手動設定)）。
:::

#### 狀態圖示

每個供應商顯示狀態指示器：

| 圖示 | 狀態 | 意義 |
|------|------|------|
| ✓ 綠色 | 有效 | 設定正確且運作中 |
| ⚠ 琥珀色 | 路徑不符 | VMark 已移動 — 點擊 **修復** |
| ✗ 紅色 | 執行檔遺失 | 找不到 MCP 執行檔 — 重新安裝 VMark |
| ○ 灰色 | 未設定 | 尚未安裝 — 點擊 **安裝** |

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

### Gemini CLI

編輯 `~/.gemini/settings.json`：

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip 尋找執行檔路徑
在 macOS 上，MCP 伺服器執行檔位於 VMark.app 內：
- `VMark.app/Contents/MacOS/vmark-mcp-server`

在 Windows 上：
- `C:\Program Files\VMark\vmark-mcp-server.exe`

在 Linux 上：
- `/usr/bin/vmark-mcp-server`（或你安裝的位置）

連接埠自動探索 — 無需 `args`。
:::

### CLI 旗標（進階）

MCP 伺服器執行檔支援少量用於診斷與舊版設定的旗標：

| 旗標 | 功能 |
|---|---|
| `--version`（或 `-v`） | 印出版本號（必須與執行中的 VMark 相符）並退出。 |
| `--health-check` | 對執行中的 VMark 橋接執行自我測試並退出。在接入 AI 助理之前，可用此指令驗證安裝是否正確。 |
| `--port <數字>` | 手動連接埠覆蓋。略過自動探索握手，直接以指定連接埠連線。僅在橋接連接埠由外部固定的舊版設定中有用；一般情況下建議使用自動探索路徑。 |

範例：

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # 舊版 / 手動
```

## 運作原理

```text
AI 助理 <--stdio--> MCP 伺服器 <--WebSocket--> VMark 編輯器
```

1. **VMark 在啟動時** 在可用連接埠上啟動 WebSocket 橋接
2. **MCP 伺服器** 從 VMark 的應用程式資料目錄讀取連接埠和驗證權杖
3. **MCP 伺服器** 透過 WebSocket 橋接連線並驗證
4. **AI 助理** 透過 stdio 與 MCP 伺服器通訊
5. **指令透過橋接** 轉發至 VMark 的編輯器

## 可用功能

連接後，你的 AI 助理可以：

| 分類 | 功能 |
|------|------|
| **文件** | 讀取/寫入內容、搜尋、取代 |
| **選取** | 取得/設定選取、取代選取的文字 |
| **格式** | 粗體、斜體、程式碼、連結等 |
| **區塊** | 標題、段落、程式碼區塊、引言 |
| **清單** | 項目符號、有序和任務清單 |
| **表格** | 插入、修改列/欄 |
| **特殊** | 數學方程式、Mermaid 圖表、Wiki 連結 |
| **工作區** | 開啟/儲存文件、管理視窗 |

完整文件請參閱 [MCP 工具參考](/zh-TW/guide/mcp-tools)。

## 檢查 MCP 狀態

VMark 提供多種方式檢查 MCP 伺服器狀態：

### 狀態列指示器

狀態列右側顯示 **MCP** 指示器：

| 顏色 | 狀態 |
|------|------|
| 綠色 | 已連接且正在執行 |
| 灰色 | 已斷開或已停止 |
| 閃爍（動態） | 正在啟動 |

啟動通常在 1-2 秒內完成。

點擊指示器可開啟詳細狀態對話框。

### 狀態對話框

透過 **說明 → MCP 伺服器狀態** 存取，或點擊狀態列指示器。

對話框顯示：
- 連接健康狀況（健康 / 錯誤 / 已停止）
- 橋接執行狀態和連接埠
- 伺服器版本
- 可用工具（12 個）和資源（4 個）
- 最後健康檢查時間
- 完整的可用工具清單，附有複製按鈕

### 設定面板

在 **設定 → 整合** 中，伺服器執行時你會看到：
- 版本號
- 工具和資源數量
- **測試連接** 按鈕 — 執行健康檢查
- **檢視詳情** 按鈕 — 開啟狀態對話框

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

## 建議系統與自動核准

預設情況下，當 AI 助理修改你的文件（插入、取代或刪除內容）時，VMark 會建立需要你核准的 **建議**：

- **插入** - 新文字以幽靈文字預覽顯示
- **取代** - 原始文字帶刪除線，新文字以幽靈文字顯示
- **刪除** - 要移除的文字帶刪除線顯示

按 **Enter** 接受或 **Escape** 拒絕。這會保留你的還原/重做歷史並讓你完全掌控。

### 自動核准模式

::: warning 謹慎使用
啟用 **自動核准編輯** 會略過建議預覽，立即套用 AI 變更。只有在你信任你的 AI 助理且希望加快編輯速度時才啟用。
:::

啟用自動核准時：
- 變更直接套用，無需預覽
- 還原（Mod+Z）仍然有效，可撤銷變更
- 回應訊息包含「（已自動核准）」以確保透明

此設定適用於：
- 快速 AI 輔助寫作工作流程
- 具有明確定義任務的受信任 AI 助理
- 逐一預覽每個變更不切實際的批次操作

## 安全注意事項

- MCP 伺服器只接受本地連接（localhost）
- 不向外部伺服器發送任何資料
- 所有處理都在你的電腦上進行
- WebSocket 橋接只能在本地存取
- 自動核准預設停用，以防止意外變更

## 下一步

- 探索所有可用的 [MCP 工具](/zh-TW/guide/mcp-tools)
- 了解[鍵盤快捷鍵](/zh-TW/guide/shortcuts)
- 查看其他[功能](/zh-TW/guide/features)
