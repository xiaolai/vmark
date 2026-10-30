# 隐私

VMark 是一款本地优先的编辑器：你的文档就是磁盘上的文件，渲染在你的机器上完成，没有账户、没有遥测、也没有崩溃报告。本页列出 VMark 接触网络的每一种方式、每种方式发送什么、如何关闭它——以及 VMark 被允许读取磁盘上的哪些内容。

## VMark 发起的每一个网络连接

| 时机 | 目标 | 发送的内容 | 如何停止 |
|------|------|------------|----------|
| 更新检查——默认在启动时 | `log.vmark.app`，后备为 GitHub Releases | 平台、架构、应用版本和一个匿名机器哈希——[详见下文](#更新检查详解) | **设置 → 关于 → 检查频率 → 仅手动**，或屏蔽 `log.vmark.app` |
| 使用 **REST 提供商**运行 AI 精灵 | 你配置的端点——Anthropic、OpenAI、OpenAI 兼容主机、Google AI 或你的 Ollama 主机 | 填充后的提示词：选中的文本、块或文档，以及精灵请求的任何上下文，还有你的 API 密钥。**测试**按钮和刷新模型按钮也会联系该端点 | 不配置任何提供商，或使用本地 Ollama |
| 使用 **CLI 提供商**运行 AI 精灵 | VMark 本身不发送任何内容——你安装的 `claude`、`codex` 或 `gemini` CLI 以它自己的账户与其厂商通信 | VMark 在你的机器上把提示词通过管道传给 CLI | 同上 |
| 导出 HTML | jsDelivr（后备为 cdnjs）和 Google Fonts | 不发送任何内容——仅下载：文档含数学公式时下载 KaTeX 数学字体，以及你在设置中选择的网络字体，以便嵌入 | 断网导出；导出会回退到系统字体 |
| 打开导出的 `index.html` | jsDelivr | 不发送任何内容——为含数学公式的文档下载 KaTeX 样式表 | 使用 `standalone.html`，它会内联该样式表 |
| 编辑 GitHub Actions 工作流 | `raw.githubusercontent.com` | 每个 `uses:` 步骤的 `owner/repo@ref`，用于获取其 `action.yml`（缓存 24 小时） | 关闭**设置 → 高级 → 获取 Action 元数据** |
| 内嵌浏览器 | 你——或经你批准的 AI 助手——打开的任何网站 | 它就是一个网页浏览器；AI 权限姿态、沙盒会话和目标策略请参阅[浏览器指南](/zh-CN/guide/browser) | 关闭**设置 → 高级 → 内嵌浏览器** |
| 引用网络资源的文档 | 文档中指定的主机 | 在编辑器或导出的 HTML 中渲染时，远程图片以及 YouTube / Vimeo / Bilibili 嵌入内容会从各自的主机加载 | 让图片保留在本地 |

有两样东西看起来像网络服务，但只走回环地址，绝不会离开你的机器：

- **MCP 服务器**——AI 助手通过绑定到 `127.0.0.1` 的 WebSocket 桥接连接，并使用 VMark 保存在其应用数据目录中的令牌进行认证。助手本身（Claude Desktop、Claude Code、Codex CLI……）与它自己的厂商通信；VMark 只响应它的工具调用。请参阅 [AI 集成](/zh-CN/guide/mcp-setup)。
- **知识库与 Slidev 预览**——一个绑定到 `127.0.0.1`、带有每会话令牌的本地服务器；[知识库指南](/zh-CN/guide/knowledge-base#隐私与安全)介绍了它的隔离方式。

集成终端运行的是你自己的 shell——它连接的任何地方都是你的命令，而不是 VMark 的。

## VMark 不会发送的内容

- 你的文档或其内容（除了在你运行精灵时发给你配置的 AI 提供商）
- 文件名或路径
- 使用模式或功能分析
- 任何形式的个人信息
- 崩溃报告
- 按键或编辑数据
- 可逆的硬件标识符或指纹

## 更新检查详解

VMark 的**自动更新检查器**会联系我们的服务器，查看是否有新版本可用。每次检查只发送以下字段——仅此而已：

| 数据 | 示例 | 用途 |
|------|------|------|
| IP 地址 | `203.0.113.42` | 任何 HTTP 请求都会固有地包含——我们无法不接收它 |
| 操作系统 | `darwin`、`windows`、`linux` | 用于提供正确的更新包 |
| 架构 | `aarch64`、`x86_64` | 用于提供正确的更新包 |
| 应用版本 | `0.5.10` | 用于判断是否有可用更新 |
| 机器哈希 | `a3f8c2...`（64 位十六进制） | 匿名设备计数——由主机名 + 操作系统 + 架构的 SHA-256 生成；不可逆 |

完整 URL 如下：

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

如果无法连接该服务器，更新程序会从 GitHub Releases 获取同一份清单（`github.com/xiaolai/vmark/releases/latest/download/latest.json`）。更新包本身在安装前会通过 minisign 签名进行校验。

你可以自行验证——端点在 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) 中（搜索 `"endpoints"`），哈希生成逻辑在 [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) 中（搜索 `machine_id_hash`）。

### 我们如何使用数据

我们汇总更新检查日志，生成显示在我们[首页](/)上的实时统计数据：

| 指标 | 计算方式 |
|------|---------|
| **唯一设备** | 每日/每周/每月不同机器哈希的数量 |
| **唯一 IP** | 每日/每周/每月不同 IP 地址的数量 |
| **请求次数** | 更新检查请求的总次数 |
| **平台** | 每种操作系统 + 架构组合的请求数量 |
| **版本** | 每个应用版本的请求数量 |

这些数字在 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats) 公开发布。没有任何隐藏。

**重要说明：**

- 唯一 IP 数量低估了真实用户——同一路由器/VPN 后面的多人只计为一个
- 唯一设备提供更准确的计数，但主机名更改或全新操作系统安装会生成新的哈希
- 请求次数高估了真实用户——同一人每天可能检查多次

### 数据保留

- 日志以标准访问日志格式存储在我们的服务器上
- 日志文件在 1 MB 时轮换，只保留最近 3 个文件
- 日志不与任何人共享
- 没有账户系统——VMark 不知道你是谁
- 机器哈希不与任何账户、电子邮件或 IP 地址关联——它只是一个假名设备计数器
- 我们不使用跟踪 Cookie、指纹识别或任何分析 SDK

### 禁用更新检查

把**设置 → 关于 → 检查频率**设为**仅手动**，VMark 就永远不会主动联系更新服务器；需要时，**立即检查**仍然可用。如果想在网络层面确保这一点，可以屏蔽 `log.vmark.app`（防火墙、`/etc/hosts` 或 DNS）——VMark 在没有它的情况下也能正常工作，你只是不会收到更新通知。

## API 密钥的存储位置

REST AI 提供商的 API 密钥保存在操作系统的凭据存储中——macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service——服务名为 `app.vmark.secrets`。它们永远不会写入 VMark 的设置文件或 `localStorage`，应用持久化的提供商设置在保存时也不含密钥。只有在你运行精灵或按下**测试**时，密钥才会发送到你配置的提供商端点。详见 [AI 提供商](/zh-CN/guide/ai-providers#api-密钥的存放位置)。

## AI 助手能触及的范围

通过 MCP 连接的助手只能在你已经打开的内容范围内行动：它的文件操作被限制在当前打开的工作区根目录以及 VMark 中已打开文档所在的文件夹内，超出该边界的请求会被拒绝。把文档保存到**新**路径需要开启**自动批准保存到新位置和精灵结果**设置（默认关闭）——否则该调用会被拒绝，VMark 会显示一条指明该文件的提示；即使开启了它，助手也永远无法以这种方式覆盖另一个已存在的文件。打开它指定的工作区之前会先询问你。AI 对文档的每一次写入都会先记入编辑历史，因此你可以恢复原来的内容（[编辑检查点](/zh-CN/guide/mcp-setup#编辑检查点)）。内嵌浏览器有自己的批准模型，详见[浏览器指南](/zh-CN/guide/browser)。

## VMark 能读取磁盘上的哪些内容

VMark 的文件访问是一个严格限定的权限范围，而不是整个磁盘：

- **静态范围**：你的主文件夹（`$HOME/**`）以及已挂载的卷——macOS 上的 `/Volumes/**`，Linux 上的 `/mnt/**` 和 `/media/**`。在 Windows 上，它还涵盖 `C:\` 到 `F:\` 驱动器，因此只有 `G:\` 及之后的驱动器和网络共享需要运行时授权。在 macOS 和 Linux 上，隐藏文件夹（名称以 `.` 开头）中的任何内容都在静态范围之外。
- **运行时授权**：你明确打开的文件——来自访达或文件资源管理器、`vmark` 命令行或文件对话框——只会获得针对该文件的授权。只有当 VMark 能确认是你选择了某个**文件夹**时，才会授权该文件夹：你在 VMark 的文件夹对话框中选择了它，或从访达打开了它。VMark 会保存这些文件夹的列表（应用数据文件夹中的 `workspace-grants.json`），并在每次启动时重新授权，因此恢复的会话和**打开最近文件**都能继续正常使用。如果最近的工作区不在该列表中，也不在静态范围内，打开它时会在该文件夹处弹出文件夹对话框——选择它即可确认。当 AI 助手请求打开这样的文件夹时，在你批准请求后，VMark 也会这样做。
- **图片与媒体**：本地图片、视频和音频通过 VMark 的资源协议显示，其可达范围相同——静态范围加上上述运行时授权。媒体查看器只为它显示的那一个文件添加授权，且仅限带有媒体扩展名的文件；对任何其他路径的请求都会被拒绝，而不会扩大范围。位于这些范围之外的图片——例如你从静态范围外单独打开的文档旁边的图片——在你将其所在文件夹作为工作区打开之前不会显示。

这里的一切都不会被发送到任何地方；该范围只决定应用本身可以读取什么。

## 开源透明度

VMark 完全开源。你可以验证这里描述的一切：

- 更新端点配置：[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 机器哈希生成：[`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs)——搜索 `machine_id_hash`
- 文件系统与资源范围：[`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json)、[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) 中的 `assetProtocol` 条目、[`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) 和 [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- 钥匙串存储：[`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- 服务端统计聚合：[`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json)——在我们服务器上运行以生成[公开统计数据](https://log.vmark.app/api/stats)的确切脚本
- 网络调用点就是上面列出的那些——在代码库中搜索 `reqwest`（Rust）和 `fetch(`（TypeScript）即可自行核实

## 报告安全问题

如果你在 VMark 中发现了安全漏洞，例如 MCP 桥接、内嵌浏览器、更新程序或文件处理方面的问题，请通过 [GitHub 的私密漏洞报告](https://github.com/xiaolai/vmark/security/advisories/new)私下提交，不要创建公开的 issue。[安全策略](https://github.com/xiaolai/vmark/blob/main/SECURITY.md)说明了受理范围以及提交后的处理方式。
