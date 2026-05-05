# 隱私政策

VMark 尊重你的隱私。以下是確切發生的事情 — 以及不會發生的事情。

## VMark 發送的資料

VMark 包含一個 **自動更新檢查器**，會定期聯絡我們的伺服器以確認是否有新版本可用。這是 VMark **唯一** 的網路請求。

每次檢查只發送以下欄位 — 不多不少：

| 資料 | 範例 | 用途 |
|------|------|------|
| IP 位址 | `203.0.113.42` | 任何 HTTP 請求固有的 — 我們無法不接收 |
| 作業系統 | `darwin`、`windows`、`linux` | 提供正確的更新套件 |
| 架構 | `aarch64`、`x86_64` | 提供正確的更新套件 |
| 應用程式版本 | `0.5.10` | 判斷是否有可用更新 |
| 機器雜湊 | `a3f8c2...`（64 個十六進位字元） | 匿名裝置計數器 — 主機名稱 + 作業系統 + 架構的 SHA-256；不可逆 |

完整的 URL 如下所示：

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

你可以自行驗證 — 端點位於 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)（搜尋 `"endpoints"`），雜湊位於 [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs)（搜尋 `machine_id_hash`）。

## VMark 不發送的資料

- 你的文件或其內容
- 檔案名稱或路徑
- 使用模式或功能分析
- 任何形式的個人資訊
- 當機報告
- 按鍵或編輯資料
- 可逆的硬體識別符或指紋
- 機器雜湊是單向 SHA-256 摘要 — 無法還原以恢復你的主機名稱或任何其他輸入

## 我們如何使用這些資料

我們彙總更新檢查日誌以生成顯示在我們[首頁](/)的即時統計數據：

| 指標 | 計算方式 |
|------|---------|
| **唯一裝置** | 每天/週/月不同機器雜湊的數量 |
| **唯一 IP** | 每天/週/月不同 IP 位址的數量 |
| **請求次數** | 更新檢查請求的總數 |
| **平台** | 每個作業系統 + 架構組合的請求數量 |
| **版本** | 每個應用程式版本的請求數量 |

這些數字公開發布在 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats)。沒有任何隱藏。

**重要注意事項：**
- 唯一 IP 低估了實際使用者 — 同一路由器/VPN 後面的多人計算為一個
- 唯一裝置提供更準確的計數，但主機名稱變更或全新作業系統安裝會生成新的雜湊
- 請求次數高估了實際使用者 — 一個人每天可能檢查多次

## 資料保留

- 日誌以標準存取日誌格式儲存在我們的伺服器上
- 日誌檔案達到 1 MB 時輪換，僅保留最近 3 個檔案
- 日誌不與任何人分享
- 沒有帳戶系統 — VMark 不知道你是誰
- 機器雜湊不與任何帳戶、電子郵件或 IP 位址關聯 — 它僅是一個匿名裝置計數器
- 我們不使用追蹤 Cookie、指紋識別或任何分析 SDK

## 開放原始碼透明度

VMark 完全開放原始碼。你可以驗證此處描述的一切：

- 更新端點設定：[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 機器雜湊生成：[`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — 搜尋 `machine_id_hash`
- 伺服器端統計彙總：[`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — 在我們伺服器上執行以生成[公開統計數據](https://log.vmark.app/api/stats)的確切腳本
- 程式碼庫中沒有其他網路呼叫 — 自行搜尋 `fetch`、`http` 或 `reqwest`

## 停用更新檢查

若你偏好完全停用自動更新檢查，可以在網路層面封鎖 `log.vmark.app`（防火牆、`/etc/hosts` 或 DNS）。VMark 在沒有它的情況下仍然可以正常運作 — 你只是不會收到更新通知。
