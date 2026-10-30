# 媒體支援

VMark 支援在 Markdown 文件中嵌入影片、音訊和 YouTube，使用標準 HTML5 標籤。

## 支援的格式

### 影片

| 格式 | 副檔名 |
|------|--------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### 音訊

| 格式 | 副檔名 |
|------|--------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## 語法

### 影片

使用標準 HTML5 video 標籤：

```html
<video src="path/to/video.mp4" controls></video>
```

包含可選屬性：

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### 音訊

使用標準 HTML5 audio 標籤：

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### YouTube 嵌入

使用隱私增強的 YouTube iframe：

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Vimeo 嵌入

使用 Vimeo 播放器 iframe：

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

你也可以直接貼上 Vimeo URL（例如 `https://vimeo.com/123456789`），VMark 會自動將其轉換為嵌入代碼。

也支援未公開的 Vimeo 影片：貼上未公開的分享連結（`https://vimeo.com/123456789/abcdef1234` 或帶有 `?h=…` 的 URL），VMark 會保留嵌入播放所需的隱私雜湊。

### Bilibili 嵌入

使用帶有 BV 號的 Bilibili 播放器 iframe：

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

貼上 Bilibili 影片 URL（例如 `https://bilibili.com/video/BV1xxxxxxxxx`），VMark 會自動將其轉換為嵌入代碼。請注意，短網址（`b23.tv`）不受支援，因為需要重新導向解析。

### 圖片語法後備

你也可以使用帶有媒體副檔名的圖片語法——VMark 會自動將其升級為對應的媒體類型：

```markdown
![](video.mp4)
![](audio.mp3)
```

## 插入媒體

### 工具列

使用工具列中的插入選單：

- **影片**——開啟影片檔案選擇器，複製至 `.assets/`，插入 `<video>` 標籤
- **音訊**——開啟音訊檔案選擇器，複製至 `.assets/`，插入 `<audio>` 標籤
- **YouTube**——從剪貼簿讀取 YouTube URL 並插入隱私增強的嵌入代碼
- **Vimeo** 和 **Bilibili**——直接在編輯器中貼上影片 URL，VMark 會自動辨識平台

### 拖放

直接從檔案系統將影片或音訊檔案拖入編輯器。VMark 將：

1. 將檔案複製至文件的 `.assets/` 資料夾
2. 插入帶有相對路徑的對應媒體節點

### 原始碼模式

在原始碼模式中，直接輸入 HTML 標籤。媒體標籤會以彩色左邊框高亮顯示：

- **影片**——藍綠色邊框
- **音訊**——靛藍色邊框
- **YouTube**——紅色邊框
- **Vimeo**——藍色邊框
- **Bilibili**——粉色邊框

### 原始碼模式中的智慧貼上

在原始碼模式中貼上時，VMark 會依 Markdown 的正確方式處理，而不是直接塞入原始文字：

- **圖片路徑**——或從 Finder 或檔案總管複製多個檔案而得到的多個路徑——會經過驗證、複製到文件的資源資料夾，並以 `![](relative-path)` 插入。當貼上內容有歧義時，會先以一則小型確認提示訊息詢問你
- **螢幕截圖或複製的圖片**（剪貼簿上的二進位圖片資料）會儲存到資源資料夾，並以相同方式插入
- **貼在選取文字上的 URL** 會變成連結：`[selected text](https://…)`
- **從其他應用程式複製的 HTML 或 Markdown** 會在貼入前先轉換並清理——但在圍欄程式碼區塊內除外，貼上的文字會原樣保留
- **從 Finder 或檔案總管拖入**原始碼編輯器的**圖片檔案**也會被複製並插入

轉換方式依循**設定 → Markdown → 剪貼簿貼上處理**（預設為 `Smart`，即「智慧」；其他模式則不做轉換），而在**設定 → 檔案與圖片 → 複製至資源資料夾**開啟時（預設開啟），檔案會被複製到資源資料夾。

## 編輯媒體

在所見即所得模式中雙擊任何媒體元素，即可開啟媒體彈出視窗：

- **來源路徑**——編輯檔案路徑或 URL
- **標題**——可選的 title 屬性
- **封面圖**（僅限影片）——縮圖圖片路徑
- **移除**——刪除媒體元素

按 `Escape` 關閉彈出視窗並返回編輯器。

## 路徑解析

VMark 支援三種媒體路徑類型：

| 路徑類型 | 範例 | 行為 |
|----------|------|------|
| 相對路徑 | `./assets/video.mp4` | 相對於文件所在目錄解析 |
| 上層相對路徑 | `../images/photo.png` | 相對於文件所在目錄解析，並依路徑要求向上走訪任意層數 |
| 絕對路徑 | `/Users/me/video.mp4` | 透過 Tauri 資產協定直接使用 |
| 外部 URL | `https://example.com/video.mp4` | 直接從網路載入 |

建議使用相對路徑——這讓你的文件在不同電腦之間保持可攜性。

放在筆記旁的共用資源資料夾可以直接使用——`notes/report.md` 可以引用 `../images/photo.png`。（在 0.9.79 之前，這類路徑會顯示為損壞的預留位置。）

## 安全性

- 媒體路徑不得帶有 URI 配置（`javascript:`、`file:` 或自訂配置）；這類來源會被拒絕，而不會載入
- 指向目錄的相對路徑（`.`、`..`、`assets/`）不會被載入。影片／音訊區塊會直接拒絕它。行內圖片則原樣交還該路徑，由 webview 相對於應用程式的來源（origin）解析，因此它永遠不會觸及磁碟。相對於家目錄的路徑（`~/…`）也以相同方式處理
- 絕對路徑不受路徑規則限制。資源範圍內的任何絕對路徑都會顯示：你的主資料夾、`/Volumes`、`/mnt` 與 `/media`（Windows 上還有 `C:`–`F:` 磁碟機），以及執行期間授權的資料夾。因此，文件只要寫出完整路徑，就能顯示這些位置中任何可讀取的圖片。在關閉**複製至資源資料夾**時貼上圖片，寫入的就是這樣的絕對路徑。這也是相對路徑可以使用 `..` 的原因：它能到達的地方，絕對路徑本來就到得了
- 影片嵌入只從三個主機載入：`www.youtube-nocookie.com`（YouTube 的隱私強化播放器）、`player.vimeo.com` 和 `player.bilibili.com`。YouTube 連結，或用 `youtube.com` 寫的 iframe，都會透過隱私強化主機嵌入。VMark 的內容安全政策只允許從這些主機載入框架，不允許任何其他網站
- 其他 iframe 來源會被清理程式移除
