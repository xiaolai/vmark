# Markmap 心智圖

VMark 支援 [Markmap](https://markmap.js.org/)，讓你直接在 Markdown 文件中建立互動式心智圖樹狀結構。與 Mermaid 靜態心智圖類型不同，Markmap 使用純 Markdown 標題作為輸入，並支援互動式平移/縮放/折疊。

## 插入心智圖

### 使用選單

**選單：** 插入 > 心智圖

**鍵盤快捷鍵：** `Alt + Shift + Cmd + K`（macOS）/ `Alt + Shift + Ctrl + K`（Windows/Linux）

### 使用程式碼區塊

輸入帶有 `markmap` 語言識別符的圍欄程式碼區塊：

````markdown
```markmap
# Mindmap

## Branch A
### Topic 1
### Topic 2

## Branch B
### Topic 3
### Topic 4
```text
````

### 使用 MCP 工具

使用 `media` MCP 工具，設定 `action: "markmap"` 並在 `code` 參數中填入 Markdown 標題內容。

## 編輯模式

### 富文字模式（所見即所得）

在所見即所得模式中，Markmap 心智圖以互動式 SVG 樹狀結構渲染。你可以：

- **平移**：滾動或點擊拖曳
- **縮放**：按住 `Cmd`/`Ctrl` 並滾動
- **折疊/展開** 節點：點擊每個分支點的圓圈
- **符合視窗**：使用適合按鈕（懸停時右上角）
- **雙擊** 心智圖以編輯原始碼

### 原始碼模式搭配即時預覽

在原始碼模式中，當游標位於 markmap 程式碼區塊內時，會顯示浮動預覽面板，並隨你的輸入即時更新。

## 輸入格式

Markmap 使用標準 Markdown 作為輸入。標題定義樹狀階層：

| Markdown | 角色 |
|----------|------|
| `# 標題 1` | 根節點 |
| `## 標題 2` | 第一層分支 |
| `### 標題 3` | 第二層分支 |
| `#### 標題 4+` | 更深層分支 |

### 節點中的富文字內容

節點可包含行內 Markdown：

````markdown
```markmap
# Project Plan

## Research
### Read **important** papers
### Review [existing tools](https://example.com)

## Implementation
### Write `core` module
### Add tests
- Unit tests
- Integration tests

## Documentation
### API reference
### User guide
```text
````

標題下的清單項目會成為該標題的子節點。

### 即時演示

以下是直接在本頁渲染的互動式心智圖——試試平移、縮放和摺疊節點：

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## 互動功能

| 操作 | 方式 |
|------|------|
| **平移** | 滾動或點擊拖曳 |
| **縮放** | `Cmd`/`Ctrl` + 滾動 |
| **折疊節點** | 點擊分支點的圓圈 |
| **展開節點** | 再次點擊圓圈 |
| **符合視窗** | 點擊符合按鈕（懸停時右上角） |

## 主題整合

Markmap 心智圖會自動適應 VMark 目前的主題（White、Paper、Mint、Sepia 或 Night）。分支顏色在每種主題下均調整為易讀的配色。

## 匯出為 PNG

在所見即所得模式中，懸停在渲染後的心智圖上可顯示 **匯出** 按鈕。點擊以選擇主題：

| 主題 | 背景 |
|------|------|
| **明亮** | 白色背景 |
| **深色** | 深色背景 |

心智圖以 2x 解析度 PNG 格式透過系統儲存對話框匯出。

## 技巧

### Markmap vs Mermaid 心智圖

VMark 同時支援 Markmap 和 Mermaid 的 `mindmap` 圖表類型：

| 功能 | Markmap | Mermaid 心智圖 |
|------|---------|----------------|
| 輸入格式 | 標準 Markdown | Mermaid DSL |
| 互動性 | 平移、縮放、折疊 | 靜態圖片 |
| 富文字內容 | 連結、粗體、程式碼、清單 | 僅文字 |
| 適合用於 | 大型互動樹 | 簡單靜態圖表 |

需要互動性，或已有 Markdown 內容時，請使用 **Markmap**。需要與其他 Mermaid 圖表搭配使用時，請使用 **Mermaid 心智圖**。

### 延伸學習

- **[Markmap 文件](https://markmap.js.org/)** — 官方參考資料
- **[Markmap 練習場](https://markmap.js.org/repl)** — 互動式測試場，可測試心智圖
