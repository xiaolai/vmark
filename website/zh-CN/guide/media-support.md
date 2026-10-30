# 媒体支持

VMark 支持在 Markdown 文档中使用标准 HTML5 标签嵌入视频、音频和 YouTube 内容。

## 支持的格式

### 视频

| 格式 | 扩展名 |
|------|--------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### 音频

| 格式 | 扩展名 |
|------|--------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## 语法

### 视频

使用标准 HTML5 视频标签：

```html
<video src="path/to/video.mp4" controls></video>
```

带可选属性：

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### 音频

使用标准 HTML5 音频标签：

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### YouTube 嵌入

使用隐私增强型 YouTube iframe：

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Vimeo 嵌入

使用 Vimeo 播放器 iframe：

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

你也可以直接粘贴 Vimeo URL（例如 `https://vimeo.com/123456789`），VMark 会自动将其转换为嵌入代码。

也支持不公开（unlisted）的 Vimeo 视频：粘贴不公开的分享链接（`https://vimeo.com/123456789/abcdef1234` 或带有 `?h=…` 的 URL），VMark 会保留嵌入播放所需的隐私哈希。

### Bilibili 嵌入

使用带有 BV 号的 Bilibili 播放器 iframe：

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

粘贴 Bilibili 视频 URL（例如 `https://bilibili.com/video/BV1xxxxxxxxx`），VMark 会自动将其转换为嵌入代码。请注意，短链接（`b23.tv`）不受支持，因为需要重定向解析。

### 图片语法回退

你也可以使用带有媒体文件扩展名的图片语法——VMark 会自动将其提升为正确的媒体类型：

```markdown
![](video.mp4)
![](audio.mp3)
```

## 插入媒体

### 工具栏

使用工具栏中的插入菜单：

- **视频**——打开视频文件选择器，将文件复制到 `.assets/`，并插入 `<video>` 标签
- **音频**——打开音频文件选择器，将文件复制到 `.assets/`，并插入 `<audio>` 标签
- **YouTube**——从剪贴板读取 YouTube URL 并插入隐私增强型嵌入代码
- **Vimeo** 和 **Bilibili**——直接在编辑器中粘贴视频 URL，VMark 会自动识别平台

### 拖放

将视频或音频文件从文件系统直接拖入编辑器。VMark 会：

1. 将文件复制到文档的 `.assets/` 文件夹
2. 插入带有相对路径的相应媒体节点

### 源码模式

在源码模式中，直接输入 HTML 标签。媒体标签会以彩色左边框高亮显示：

- **视频**——青色边框
- **音频**——靛蓝色边框
- **YouTube**——红色边框
- **Vimeo**——蓝色边框
- **Bilibili**——粉色边框

### 源码模式下的智能粘贴

在源码模式中粘贴时，VMark 会按 Markdown 的正确方式处理，而不是直接倒入原始文本：

- **图片路径**——或在访达、文件资源管理器中多选复制得到的多个路径——会经过验证，复制到文档的资源文件夹，并以 `![](relative-path)` 的形式插入。当粘贴内容存在歧义时，会先弹出一个小的确认提示进行询问
- **截图或复制的图片**（剪贴板中的二进制图片数据）会保存到资源文件夹，并以同样的方式插入
- **在选中文本上粘贴 URL** 会生成链接：`[selected text](https://…)`
- **从其他应用复制的 HTML 或 Markdown** 会在落地前被转换和清理——围栏代码块内部除外，粘贴的文本会原样保留
- **从访达或文件资源管理器拖入**源码编辑器的图片文件同样会被复制并插入

转换行为遵循**设置 → Markdown → 剪贴板粘贴处理**（默认为“智能”（`Smart`）；其他模式则不做转换），而在**设置 → 文件与图片 → 复制到资源文件夹**开启时（默认开启），文件会被复制到资源文件夹。

## 编辑媒体

在所见即所得模式中双击任意媒体元素，打开媒体弹窗：

- **来源路径**——编辑文件路径或 URL
- **标题**——可选的 title 属性
- **封面图**（仅视频）——缩略图路径
- **删除**——移除媒体元素

按 `Escape` 关闭弹窗并返回编辑器。

## 路径解析

VMark 支持三种媒体路径类型：

| 路径类型 | 示例 | 行为 |
|----------|------|------|
| 相对路径 | `./assets/video.mp4` | 相对于文档目录解析 |
| 上级相对路径 | `../images/photo.png` | 相对于文档目录解析，按路径要求向上回溯任意层级 |
| 绝对路径 | `/Users/me/video.mp4` | 通过 Tauri 资源协议直接使用 |
| 外部 URL | `https://example.com/video.mp4` | 直接从网络加载 |

推荐使用相对路径——它可以让你的文档在不同机器之间保持可移植性。

放在笔记旁边的共享资源文件夹可以按原样使用——`notes/report.md` 可以引用 `../images/photo.png`。（在 0.9.79 之前，这类路径会渲染为损坏的占位符。）

## 安全性

- 媒体路径不能带有 URI 协议（`javascript:`、`file:` 或自定义协议）；这类来源会被拒绝，而不会被加载
- 指向目录的相对路径（`.`、`..`、`assets/`）不会被加载。视频/音频块会直接拒绝它。行内图片则原样交还该路径，由 webview 相对于应用源（origin）解析，因此它永远不会触及磁盘。相对于主目录的路径（`~/…`）也按同样方式处理
- 绝对路径不受路径规则限制。资源范围内的任何绝对路径都会被显示：你的主文件夹、`/Volumes`、`/mnt` 和 `/media`（Windows 上还有 `C:`–`F:` 盘），以及运行时授权的文件夹。因此，文档只要写出完整路径，就能显示这些位置中任何可读的图片。在关闭**复制到资源文件夹**时粘贴图片，写入的就是这样的绝对路径。这也是相对路径可以使用 `..` 的原因：它能到达的地方，绝对路径本来就能到达
- 视频嵌入只从三个主机加载：`www.youtube-nocookie.com`（YouTube 的隐私增强播放器）、`player.vimeo.com` 和 `player.bilibili.com`。YouTube 链接，或用 `youtube.com` 写的 iframe，都会通过隐私增强主机嵌入。VMark 的内容安全策略只允许从这些主机加载框架，不允许任何其他网站
- 其他 iframe 来源会被净化器过滤掉
