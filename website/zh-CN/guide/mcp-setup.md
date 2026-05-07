# AI 集成（MCP）

VMark 内置了 MCP（模型上下文协议）服务器，允许 Claude 等 AI 助手直接与你的编辑器交互。

## 什么是 MCP？

[模型上下文协议](https://modelcontextprotocol.io/)是一个开放标准，使 AI 助手能够与外部工具和应用程序交互。VMark 的 MCP 服务器将其编辑器功能作为工具暴露给 AI 助手，用于：

- 读取和写入文档内容
- 应用格式化和创建结构
- 导航和管理文档
- 插入特殊内容（数学公式、图表、wiki 链接）

## 快速设置

VMark 通过一键安装轻松连接 AI 助手。

### 1. 启用 MCP 服务器

打开 **设置 → 集成** 并启用 MCP 服务器：

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP 服务器设置" />
</div>

- **启用 MCP 服务器**——开启以允许 AI 连接
- **启动时自动运行**——VMark 打开时自动启动
- **自动批准编辑**——直接应用 AI 更改，无需预览（见下文）

### 2. 安装配置

为你的 AI 助手点击 **安装**：

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP 安装配置" />
</div>

支持的 AI 助手：
- **Claude Desktop**——Anthropic 的桌面应用
- **Claude Code**——面向开发者的 CLI
- **Codex CLI**——OpenAI 的编码助手
- **Gemini CLI**——Google 的 AI 助手

::: info 其他 MCP 兼容客户端
其他 MCP 兼容客户端（如 Cursor、Windsurf 等类似工具）也可以连接到 VMark 的 MCP 服务器。通过指向 MCP 服务器二进制文件路径来手动配置它们（参见下方的[手动配置](#手动配置)）。
:::

#### 状态图标

每个提供商显示状态指示器：

| 图标 | 状态 | 含义 |
|------|------|------|
| ✓ 绿色 | 有效 | 配置正确且可用 |
| ⚠ 琥珀色 | 路径不匹配 | VMark 已移动——点击 **修复** |
| ✗ 红色 | 二进制文件缺失 | 找不到 MCP 二进制文件——重新安装 VMark |
| ○ 灰色 | 未配置 | 未安装——点击 **安装** |

::: tip VMark 被移动了？
如果你将 VMark.app 移动到了不同位置，状态会显示琥珀色"路径不匹配"。只需点击 **修复** 按钮更新配置中的新路径即可。
:::

### 3. 重启你的 AI 助手

安装或修复后，**完全重启你的 AI 助手**（退出并重新打开）以加载新配置。每次配置更改后，VMark 都会显示提醒。

### 4. 试用

在你的 AI 助手中，尝试如下命令：
- *"我的 VMark 文档里有什么？"*
- *"帮我把量子计算的摘要写到 VMark"*
- *"给我的文档添加目录"*

## 实际演示

向 Claude 提问，让它直接将答案写入你的 VMark 文档：

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop 使用 VMark MCP" />
  <p class="screenshot-caption">Claude Desktop 调用 <code>document</code> → <code>set_content</code> 写入 VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="内容在 VMark 中渲染" />
  <p class="screenshot-caption">内容即时出现在 VMark 中，格式完整</p>
</div>

<!-- Styles in style.css -->

## 手动配置

如果你偏好手动配置，以下是配置文件位置：

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

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

编辑 `~/.claude.json` 或项目 `.mcp.json`：

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

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Gemini CLI

编辑 `~/.gemini/settings.json`：

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip 查找二进制文件路径
在 macOS 上，MCP 服务器二进制文件位于 VMark.app 内部：
- `VMark.app/Contents/MacOS/vmark-mcp-server`

在 Windows 上：
- `C:\Program Files\VMark\vmark-mcp-server.exe`

在 Linux 上：
- `/usr/bin/vmark-mcp-server`（或你安装的位置）

端口自动发现——不需要 `args`。
:::

### CLI 标志（高级）

MCP 服务器二进制文件支持少量用于诊断和兼容旧版配置的标志：

| 标志 | 作用 |
|---|---|
| `--version`（或 `-v`） | 打印版本号（须与运行中的 VMark 匹配）后退出。 |
| `--health-check` | 对运行中的 VMark 桥接执行自测并退出。在接入 AI 助手前，可用此标志验证安装是否正常。 |
| `--port <number>` | 手动指定端口。跳过自动发现握手，直接连接到指定端口。仅在桥接端口由外部固定的旧版配置中有用；通常应优先使用自动发现。 |

示例：

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # 旧版 / 手动配置
```

## 工作原理

```text
AI 助手 <--stdio--> MCP 服务器 <--WebSocket--> VMark 编辑器
```

1. **VMark 在启动时** 在可用端口上启动 WebSocket 桥接
2. **MCP 服务器** 从 VMark 的应用数据目录读取端口和认证令牌
3. **MCP 服务器** 通过 WebSocket 桥接连接并认证
4. **AI 助手** 通过 stdio 与 MCP 服务器通信
5. **命令通过桥接** 转发到 VMark 的编辑器

## 可用功能

连接后，你的 AI 助手可以：

| 类别 | 功能 |
|------|------|
| **文档** | 读取/写入内容，搜索，替换 |
| **选区** | 获取/设置选区，替换选中文本 |
| **格式化** | 粗体、斜体、代码、链接等 |
| **块** | 标题、段落、代码块、引用 |
| **列表** | 无序、有序和任务列表 |
| **表格** | 插入，修改行/列 |
| **特殊** | 数学公式、Mermaid 图表、wiki 链接 |
| **工作区** | 打开/保存文档，管理窗口 |

完整文档请参见 [MCP 工具参考](/zh-CN/guide/mcp-tools)。

## 检查 MCP 状态

VMark 提供多种方式检查 MCP 服务器状态：

### 状态栏指示器

状态栏右侧显示 **MCP** 指示器：

| 颜色 | 状态 |
|------|------|
| 绿色 | 已连接并运行 |
| 灰色 | 已断开或已停止 |
| 脉冲（动画） | 正在启动 |

启动通常在 1–2 秒内完成。

点击指示器可打开详细状态对话框。

### 状态对话框

通过 **帮助 → MCP 服务器状态** 访问，或点击状态栏指示器。

对话框显示：
- 连接健康状态（健康/错误/已停止）
- 桥接运行状态和端口
- 服务器版本
- 可用工具（12 个）和资源（4 个）
- 最后健康检查时间
- 完整的可用工具列表及复制按钮

### 设置面板

在 **设置 → 集成** 中，服务器运行时你会看到：
- 版本号
- 工具和资源数量
- **测试连接** 按钮——运行健康检查
- **查看详情** 按钮——打开状态对话框

## 故障排除

### "连接被拒绝"或"无活跃编辑器"

- 确保 VMark 正在运行且已打开文档
- 检查设置 → 集成中 MCP 服务器是否已启用
- 验证 MCP 桥接显示"运行中"状态
- 如果连接中断，重启 VMark

### 移动 VMark 后路径不匹配

如果你将 VMark.app 移动到了不同位置（例如从下载目录移到应用程序目录），配置会指向旧路径：

1. 打开 **设置 → 集成**
2. 查找受影响提供商旁边的琥珀色 ⚠ 警告图标
3. 点击 **修复** 更新路径
4. 重启你的 AI 助手

### AI 助手中没有出现工具

- 安装配置后重启你的 AI 助手
- 验证配置已安装（检查设置中是否有绿色对勾）
- 检查你的 AI 助手日志中的 MCP 连接错误

### 命令因"无活跃编辑器"而失败

- 确保 VMark 中有活跃的文档标签页
- 点击编辑器区域使其获得焦点
- 某些命令需要先选中文本

## 建议系统与自动批准

默认情况下，当 AI 助手修改你的文档（插入、替换或删除内容）时，VMark 会创建需要你批准的 **建议**：

- **插入**——新文本以幽灵文字预览形式出现
- **替换**——原文加删除线，新文本以幽灵文字显示
- **删除**——要删除的文本显示删除线

按 **Enter** 接受，按 **Escape** 拒绝。这保留了你的撤销/重做历史，并给你完全的控制权。

### 自动批准模式

::: warning 谨慎使用
启用 **自动批准编辑** 会绕过建议预览，直接应用 AI 更改。只有在你信任你的 AI 助手并希望更快编辑时才启用此选项。
:::

启用自动批准时：
- 更改直接应用，无需预览
- 撤销（Mod+Z）仍然有效
- 响应消息包含"（已自动批准）"以提高透明度

此设置适用于：
- 快速的 AI 辅助写作工作流
- 任务明确的可信 AI 助手
- 逐一预览每次更改不切实际的批量操作

## 安全说明

- MCP 服务器只接受本地连接（localhost）
- 不向外部服务器发送数据
- 所有处理均在你的机器上完成
- WebSocket 桥接只能本地访问
- 自动批准默认禁用，以防止意外更改

## 下一步

- 探索所有可用的 [MCP 工具](/zh-CN/guide/mcp-tools)
- 了解[键盘快捷键](/zh-CN/guide/shortcuts)
- 查看其他[功能特性](/zh-CN/guide/features)
