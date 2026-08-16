# 下載 VMark

<script setup>
import DownloadButton from '../.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## 系統需求

- macOS 13.4（Ventura）或更新版本
- Apple Silicon（M1/M2/M3）或 Intel 處理器
- 200 MB 硬碟空間

::: info 為什麼需要 macOS 13.4？
VMark 使用 macOS 內建的 WebKit 引擎繪製介面，因此可用的網頁功能由 macOS 版本決定。macOS 13.4 是內建 WebKit 能夠執行目前版本的最早系統。

此頁面先前寫的是 10.15。那個數字從來就不正確——它只是一個沒有人查證過的預設值，而在更舊的系統上，VMark 不會拒絕啟動，而是開啟一個空白視窗。低於 13.4 時，macOS 自己會拒絕開啟 VMark 並說明原因，而不是留給你一個空白視窗。
:::

## 安裝方式

**Homebrew（推薦）**

```bash
brew install xiaolai/tap/vmark
```

這會安裝 VMark，並自動為你的 Mac（Apple Silicon 或 Intel）選擇正確的版本。

**升級**

```bash
brew update && brew upgrade vmark
```

**手動安裝**

1. 下載 `.dmg` 檔案
2. 開啟已下載的檔案
3. 將 VMark 拖曳至「應用程式」資料夾
4. 首次啟動時，右鍵點選應用程式並選擇「開啟」以繞過 Gatekeeper

## Windows 與 Linux

VMark 以 Tauri 構建，支援跨平台編譯。但 **目前開發與測試主要聚焦於 macOS**。由於資源限制，Windows 與 Linux 的支援在可預見的將來仍屬有限。

如需在 Windows 或 Linux 上執行 VMark：

- **預先編譯的二進位檔案** 可在 [GitHub Releases](https://github.com/xiaolai/vmark/releases) 取得（按現狀提供，不保證支援）
- **從原始碼構建**，請依照以下說明操作

## 驗證下載

所有版本均透過 GitHub Actions 自動構建。你可以在 [GitHub Releases 頁面](https://github.com/xiaolai/vmark/releases)查看發布記錄，以驗證真實性。

## 從原始碼構建

適合想要從原始碼構建 VMark 的開發者：

```bash
# 複製儲存庫
git clone https://github.com/xiaolai/vmark.git
cd vmark

# 安裝相依套件
pnpm install

# 為生產環境構建
pnpm tauri build
```

詳細的構建說明與先決條件請參閱 [README](https://github.com/xiaolai/vmark#readme)。
