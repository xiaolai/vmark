# 隱私政策

VMark 是本機優先的編輯器：你的文件就是磁碟上的檔案，渲染在你的電腦上進行，沒有帳戶、沒有遙測，也沒有當機回報。本頁列出 VMark 接觸網路的每一種方式、各自傳送什麼內容，以及如何關閉——還有 VMark 能讀取你磁碟上的哪些內容。

## VMark 建立的每一個網路連線

| 時機 | 連往何處 | 傳送內容 | 如何停止 |
|------|----------|----------|----------|
| 更新檢查——預設於啟動時 | `log.vmark.app`，無法連線時改用 GitHub Releases | 平台、架構、應用程式版本與匿名機器雜湊——[詳見下文](#更新檢查詳解) | **設定 → 關於 → 檢查頻率 → 僅手動**，或封鎖 `log.vmark.app` |
| 以 **REST 供應商**執行 AI 精靈 | 你設定的端點——Anthropic、OpenAI、OpenAI 相容主機、Google AI 或你的 Ollama 主機 | 填好的提示詞：選取的文字、區塊或文件，加上精靈要求的周邊上下文，以及你的 API 金鑰。**測試**與重新整理模型的按鈕也會連線到該端點 | 不設定任何供應商，或使用本機 Ollama |
| 以 **CLI 供應商**執行 AI 精靈 | VMark 本身不連線——由你安裝的 `claude`、`codex` 或 `gemini` CLI 以它自己的帳戶連線到它自己的供應商 | VMark 將提示詞透過管道傳給你電腦上的 CLI | 同上 |
| 匯出 HTML | jsDelivr（備援為 cdnjs）與 Google Fonts | 不傳送任何內容——只下載：文件含數學公式時的 KaTeX 數學字型，以及你在設定中選擇的網頁字型，以便嵌入 | 在沒有網路連線時匯出；匯出會改用系統字型 |
| 開啟匯出的 `index.html` | jsDelivr | 不傳送任何內容——為含數學公式的文件下載 KaTeX 樣式表 | 改用已內嵌樣式表的 `standalone.html` |
| 編輯 GitHub Actions 工作流程 | `raw.githubusercontent.com` | 每個 `uses:` 步驟的 `owner/repo@ref`，用以取得其 `action.yml`（快取 24 小時） | 關閉**設定 → 進階 → 取得 Action 中繼資料** |
| 內嵌瀏覽器 | 你——或在你核准下由 AI 助理——開啟的任何網站 | 它就是一個網頁瀏覽器；AI 的權限設計、沙盒工作階段與目的地政策請參閱[瀏覽器指南](/zh-TW/guide/browser) | 關閉**設定 → 進階 → 內嵌瀏覽器** |
| 引用網路資源的文件 | 文件中所列的主機 | 遠端圖片與 YouTube／Vimeo／Bilibili 嵌入內容在編輯器或匯出的 HTML 中渲染時，會從各自的主機載入 | 將圖片保留在本機 |

有兩項看似網路服務的功能其實只使用迴路介面（loopback），永遠不會離開你的電腦：

- **MCP 伺服器**——AI 助理透過綁定在 `127.0.0.1` 的 WebSocket 橋接連線，並以 VMark 存放在其應用程式資料目錄中的權杖驗證。助理本身（Claude Desktop、Claude Code、Codex CLI……）會與它自己的供應商通訊；VMark 只回應它的工具呼叫。請參閱 [AI 整合](/zh-TW/guide/mcp-setup)。
- **知識庫與 Slidev 預覽**——綁定在 `127.0.0.1` 的本機伺服器，每個工作階段使用一個權杖；[知識庫指南](/zh-TW/guide/knowledge-base#隱私與安全)說明了它的隔離方式。

整合終端機執行的是你自己的 shell——它連線到的任何地方都是你的指令，而非 VMark 的行為。

## VMark 不發送的資料

- 你的文件或其內容（執行精靈時傳給你所設定的 AI 供應商者除外）
- 檔案名稱或路徑
- 使用模式或功能分析
- 任何形式的個人資訊
- 當機報告
- 按鍵或編輯資料
- 可逆的硬體識別符或指紋

## 更新檢查詳解

VMark 的**自動更新檢查器**會聯絡我們的伺服器，確認是否有新版本可用。每次檢查只發送以下欄位——不多不少：

| 資料 | 範例 | 用途 |
|------|------|------|
| IP 位址 | `203.0.113.42` | 任何 HTTP 請求固有的——我們無法不接收 |
| 作業系統 | `darwin`、`windows`、`linux` | 提供正確的更新套件 |
| 架構 | `aarch64`、`x86_64` | 提供正確的更新套件 |
| 應用程式版本 | `0.5.10` | 判斷是否有可用更新 |
| 機器雜湊 | `a3f8c2...`（64 個十六進位字元） | 匿名裝置計數器——主機名稱 + 作業系統 + 架構的 SHA-256；不可逆 |

完整的 URL 如下所示：

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

若無法連上該伺服器，更新程式會改從 GitHub Releases 取得同一份清單（`github.com/xiaolai/vmark/releases/latest/download/latest.json`）。更新本身在安裝前會以 minisign 簽章驗證。

你可以自行驗證——端點位於 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)（搜尋 `"endpoints"`），雜湊位於 [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs)（搜尋 `machine_id_hash`）。

### 我們如何使用這些資料

我們彙總更新檢查日誌，以產生顯示在我們[首頁](/)的即時統計數據：

| 指標 | 計算方式 |
|------|---------|
| **唯一裝置** | 每天／週／月不同機器雜湊的數量 |
| **唯一 IP** | 每天／週／月不同 IP 位址的數量 |
| **請求次數** | 更新檢查請求的總數 |
| **平台** | 每個作業系統 + 架構組合的請求數量 |
| **版本** | 每個應用程式版本的請求數量 |

這些數字公開發布在 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats)。沒有任何隱藏。

**重要注意事項：**

- 唯一 IP 低估了實際使用者——同一路由器／VPN 後面的多人會被計算為一個
- 唯一裝置提供更準確的計數，但主機名稱變更或全新安裝作業系統會產生新的雜湊
- 請求次數高估了實際使用者——一個人每天可能檢查多次

### 資料保留

- 日誌以標準存取日誌格式儲存在我們的伺服器上
- 日誌檔案達到 1 MB 時輪換，僅保留最近 3 個檔案
- 日誌不與任何人分享
- 沒有帳戶系統——VMark 不知道你是誰
- 機器雜湊不與任何帳戶、電子郵件或 IP 位址關聯——它僅是一個假名化的裝置計數器
- 我們不使用追蹤 Cookie、指紋識別或任何分析 SDK

### 停用更新檢查

將**設定 → 關於 → 檢查頻率**設為**僅手動**，VMark 就不會自行聯絡更新伺服器；需要時，**立即檢查**仍然可用。若要在網路層面確保無連線，可以封鎖 `log.vmark.app`（防火牆、`/etc/hosts` 或 DNS）——VMark 在沒有它的情況下仍能正常運作，你只是不會收到更新通知。

## API 金鑰的存放位置

REST AI 供應商的 API 金鑰存放在作業系統的憑證存放區——macOS 鑰匙圈、Windows 認證管理員或 Linux Secret Service——服務名稱為 `app.vmark.secrets`。它們永遠不會寫入 VMark 的設定檔或 `localStorage`，應用程式保存的供應商設定也不含金鑰。只有在你執行精靈或按下**測試**時，金鑰才會傳送到你所設定的供應商端點。詳見 [AI 供應商](/zh-TW/guide/ai-providers#api-金鑰的存放位置)。

## AI 助理可以觸及的範圍

透過 MCP 連線的助理只能在你已開啟的範圍內行動：它的檔案操作被限制在已開啟的工作區根目錄，以及 VMark 中已開啟文件所在的資料夾，超出此邊界的請求都會被拒絕。將文件儲存到**新**路徑需要開啟**自動核准儲存至新位置與精靈結果**設定（預設關閉）——否則呼叫會被拒絕，VMark 會顯示一則指出該檔案的提示訊息；即使開啟此設定，助理也永遠無法以這種方式覆寫另一個既有檔案。開啟它指定的工作區之前會先詢問你。AI 對文件的每一次寫入都會先記入編輯歷史，讓你可以還原原本的內容（[編輯檢查點](/zh-TW/guide/mcp-setup#編輯檢查點)）。內嵌瀏覽器有它自己的核准模型，說明請見[瀏覽器指南](/zh-TW/guide/browser)。

## VMark 能讀取磁碟上的哪些內容

VMark 的檔案存取是一個嚴格限定的權限範圍，而不是整個磁碟：

- **靜態範圍**：你的個人資料夾（`$HOME/**`）以及已掛載的磁碟區——macOS 上的 `/Volumes/**`，Linux 上的 `/mnt/**` 和 `/media/**`。在 Windows 上，它還涵蓋 `C:\` 到 `F:\` 磁碟機，因此只有 `G:\` 之後的磁碟機以及網路共用資料夾需要執行時授權。在 macOS 和 Linux 上，隱藏資料夾（名稱以 `.` 開頭）中的任何內容都在靜態範圍之外。
- **執行時授權**：你明確開啟的檔案——來自 Finder 或檔案總管、`vmark` 命令列或檔案對話框——只會取得該檔案的授權。只有當 VMark 能確認是你選擇了某個**資料夾**時，才會授權該資料夾：你在 VMark 的資料夾對話框中選擇了它，或從 Finder 開啟了它。VMark 會保存這些資料夾的清單（應用程式資料資料夾中的 `workspace-grants.json`），並在每次啟動時重新授權，因此還原的工作階段和**開啟最近項目**都能繼續正常運作。若最近使用的工作區不在該清單中，也不在靜態範圍內，開啟時會在該資料夾處顯示資料夾對話框——選擇它即可確認。當 AI 助理要求開啟這樣的資料夾時，在你核准請求後，VMark 也會這樣做。
- **圖片與媒體**：本機圖片、影片和音訊透過 VMark 的資源協定顯示，其可及範圍相同——靜態範圍加上上述執行時授權。媒體檢視器只為它顯示的那一個檔案新增授權，且僅限具有媒體副檔名的檔案；對其他任何路徑的請求都會被拒絕，而不會擴大範圍。位於這些範圍之外的圖片——例如你從靜態範圍外單獨開啟的文件旁邊的圖片——在你將其所在資料夾作為工作區開啟之前不會顯示。

這裡的一切都不會被傳送到任何地方；該範圍只決定應用程式本身可以讀取什麼。

## 開放原始碼透明度

VMark 完全開放原始碼。你可以驗證此處描述的一切：

- 更新端點設定：[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 機器雜湊產生：[`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs)——搜尋 `machine_id_hash`
- 檔案系統與資源範圍：[`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json)、[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) 中的 `assetProtocol` 項目、[`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) 和 [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- 鑰匙圈儲存：[`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- 伺服器端統計彙總：[`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json)——在我們伺服器上執行以產生[公開統計數據](https://log.vmark.app/api/stats)的確切腳本
- 網路呼叫的位置就是上方列出的那些——在程式碼庫中搜尋 `reqwest`（Rust）與 `fetch(`（TypeScript）即可自行確認

## 回報安全性問題

如果你在 VMark 中發現了安全性漏洞，例如 MCP 橋接、內嵌瀏覽器、更新程式或檔案處理方面的問題，請透過 [GitHub 的私密漏洞回報](https://github.com/xiaolai/vmark/security/advisories/new)私下提交，不要建立公開的 issue。[安全性政策](https://github.com/xiaolai/vmark/blob/main/SECURITY.md)說明了受理範圍以及提交後的處理方式。
