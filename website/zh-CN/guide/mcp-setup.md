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
- **启动时启动**——VMark 打开时自动启动
- **自动批准保存到新位置和精灵结果**——默认关闭。允许 AI 无需询问即可将文档保存到*新*路径，并允许精灵直接应用其结果，而不是作为建议呈现。普通的 AI 写入从不受它控制——它们的安全网是[编辑检查点历史](#编辑检查点)（参见[编辑如何生效](#编辑如何生效)）

### 2. 安装配置

为你的 AI 助手点击 **安装**：

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP 安装配置" />
</div>

支持的 AI 助手：
- **Claude Desktop**——Anthropic 的桌面应用
- **Claude Code**——面向开发者的 CLI
- **Codex CLI**——OpenAI 的编码助手
- **Antigravity CLI**——Google 的 `agy`，Gemini CLI 的继任者
- **Grok CLI**——xAI 的编码智能体
- **opencode**——开源、不绑定提供商的终端智能体

**安装会写入每个客户端专属的凭据。** 除了 VMark MCP 服务器的路径之外，安装还会把一个秘密令牌写入该客户端自己的配置文件，位于 `env.VMARK_MCP_TOKEN` 下（opencode 为 `environment.VMARK_MCP_TOKEN`）。每个客户端都有自己的令牌，且不会存储在其他任何地方。它让 VMark 知道是哪个客户端在连接，而不是轻信客户端自报的名称。目前只有委托操作需要它——即通过 `coherence_resolve` 代你回答一致性问题；其他所有工具无需令牌即可使用。安装和 **修复** 会保留仍然有效的令牌；如需签发新令牌，请先卸载再重新安装。执行任一操作后都要重启 AI 客户端。请像对待密码一样对待令牌：不要把配置文件粘贴到 issue 或聊天中。

::: info Gemini CLI 已停用
Google 已用 Antigravity 取代 Gemini CLI。如果早先的 VMark 安装在 `~/.gemini/settings.json` 中留下了 `vmark` 条目，集成面板会为它显示一行 **已停用**，并附带 **移除** 按钮；新的安装则以 Antigravity 为目标。
:::

::: info 其他 MCP 兼容客户端
其他 MCP 兼容客户端（如 Cursor、Windsurf 等类似工具）也可以连接到 VMark 的 MCP 服务器。通过指向 MCP 服务器二进制文件路径来手动配置它们（参见下方的[手动配置](#手动配置)）。
:::

#### CC-Switch

如果你使用 CC-Switch 管理 AI CLI，安装程序还会显示一行 **CC-Switch**。**添加到 CC-Switch** 会打开一个 `ccswitch://v1/import` 链接，把 VMark 的 MCP 服务器（即其二进制文件路径）交给 CC-Switch，再由 CC-Switch 把 `vmark` 条目写入你在其中管理的各个 CLI；如果你更愿意手动粘贴，复制按钮会给你链接本身。在 VMark 解析出自己的 MCP 二进制文件之前，这一行处于禁用状态。

#### 状态图标

每个提供商显示状态指示器：

| 图标 | 状态 | 含义 |
|------|------|------|
| ✓ 绿色 | 有效 | 配置正确且可用 |
| ⚠ 琥珀色 | 路径不匹配 | VMark 已移动——点击 **修复** |
| ✗ 红色 | 二进制文件缺失 | 找不到 MCP 二进制文件——重新安装 VMark |
| 🗎 红色 | 配置不可读 | VMark 无法读取或解析该配置文件，因此无法知道其中是否有 VMark 条目。消息会指出文件名和原因。修复或移走该文件，然后点击 **重新检查**——在它能被解析之前，安装和修复都不可用，因为向 VMark 无法读取的文件写入内容可能会毁掉其中的内容 |
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

### Antigravity CLI

编辑 `~/.gemini/config/mcp_config.json`：

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

编辑 `~/.grok/config.toml`：

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

编辑 `~/.config/opencode/opencode.json`。opencode 的结构与 `mcpServers` 那种不同：键名是 `mcp`，而 `command` 是一个同时包含程序及其参数的数组：

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

如果你自己的设置位于 `opencode.jsonc` 中，保留在那里即可——opencode 会合并这两个文件，因此 VMark 在 `opencode.json` 中的条目是叠加的。VMark 写入纯 JSON 文件，是因为它无法在读写 `.jsonc` 文件时完整保留其中的注释。

::: warning `opencode.jsonc` 中已有的 `vmark` 条目优先
opencode 依次合并 `config.json`、`opencode.json`、`opencode.jsonc`，最后读取的那个优先。因此，如果你之前在 `opencode.jsonc` 中手动添加过 `vmark` 条目，它会覆盖 VMark 管理的那一个——VMark 会报告该提供商有效，而 opencode 仍在使用你那个较旧的条目（及其过时的二进制路径）。请从 `opencode.jsonc` 中删除手写的 `mcp.vmark` 块，交给集成面板来管理。
:::

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
| `--health-check` | 对二进制文件执行自测并退出：它会针对内置的模拟桥接启动 MCP 服务器，以 JSON 格式打印版本号和工具数量，如果工具数量与该构建的预期不符则以非零状态退出。它**不会**联系运行中的 VMark——用它确认二进制文件能够运行；用 **设置 → 集成** 检查实时桥接。 |
| `--port <number>` | 手动指定端口。跳过自动发现握手，直接连接到指定端口。仅在桥接端口由外部固定的旧版配置中有用；通常应优先使用自动发现。 |

示例：

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # 旧版 / 手动配置
```

其他任何参数（拼错的标志、`--port=9223` 或多余的单词）都会被拒绝：程序会输出用法错误并以退出码 64 结束，而不会退回到自动发现。

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

连接后，你的 AI 助手拥有十个工具：

| 工具 | 涵盖范围 |
|------|----------|
| `session` | 窗口、标签页、活动文档和浏览器标签页（只读） |
| `workspace` | 新建、打开、保存、另存为、关闭、切换标签页、聚焦窗口、打开工作区 |
| `document` | 以 Markdown 读写整个文档；中日韩格式化转换 |
| `selection` | 读取并替换选中的文本 |
| `comments` | 列出文档的审阅评论、回复评论并将其标记为已处理（助手不能解决评论） |
| `workflow` | 针对 GitHub Actions YAML 的 CST 安全补丁与校验 |
| `browser` / `browser_read` | macOS 上的内置浏览器自动化——分别为会产生修改的一半和只读的一半 |
| `coherence` / `coherence_resolve` | 读取一致性层；在你授予的委托下处理过时的边 |

格式化不是一个单独的工具：助手编写 Markdown，因此标题、表格、数学公式和图表就是它所写的内容。

完整文档请参见 [MCP 工具参考](/zh-CN/guide/mcp-tools)。

## 检查 MCP 状态

VMark 提供多种方式检查 MCP 服务器状态：

### 状态栏指示器

状态栏右侧显示 **MCP** 指示器。当有需要你注意的情况时，卫星图标旁会出现一个简短的状态词；连接正常时只显示绿色图标。将鼠标悬停在指示器上，会按名称和版本列出当前已连接的 AI 客户端：

| 颜色 | 状态词 | 状态 |
|------|------|------|
| 绿色 | — | 已连接并运行 |
| 灰色 | `off` | 已断开或已停止 |
| 脉冲（动画） | `…` | 正在启动 |
| 红色 | `error` | 服务器出错——悬停可查看原因 |

启动通常在 1–2 秒内完成。

点击指示器可打开 **设置 → 集成**。

### 设置面板

**设置 → 集成** 是另一个状态界面——没有单独的状态对话框。桥接运行时，它会显示其监听的地址（`localhost:<port>`，带复制按钮）以及已连接的 AI 客户端数量，每隔几秒刷新一次。**测试连接** 按钮（桥接停止时标为 **检查 Sidecar**）会运行 sidecar 自身的 `--health-check`，并报告 sidecar 版本、其工具数量以及最后检查时间——它确认的是已安装的二进制文件能够工作，而不是有客户端已连接。

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

## 编辑如何生效

精简后的 MCP 接口遵循“读—写”主线：AI 助手调用 `document.read` 获取当前内容和一个修订令牌，据此推理，然后用新的完整内容调用 `document.write`。修订令牌可防止悄无声息的覆盖：如果在 AI 思考期间你在 VMark 中输入了内容，写入会返回 `STALE`，AI 会重新读取。

对于 GitHub Actions 工作流 YAML 文件，AI 改用 `workflow.apply_patch`——VMark 的 CST 感知修改器会保留注释、锚点和键的顺序，而这些在原始文本重写中会丢失。

`document.write`、`selection.set` 和 `workflow.apply_patch` 没有预览步骤——一旦修订检查通过，更改就会立即落入编辑器。安全网是下文的[编辑检查点历史](#编辑检查点)；如果你希望在任何更改落地前进行审查，请把文档置于 git 管理之下并审查差异。唯一的审批关卡是 **自动批准保存到新位置和精灵结果**：该选项关闭时（默认），AI 无法把文档保存到新路径——`workspace.save_as` 会返回 `APPROVAL_REQUIRED`，VMark 会显示一条指明该文件的提示。即使开启该选项，`save_as` 也拒绝覆盖另一个已存在的文件。

## 编辑检查点

AI 对文档的每一次修改 — `document.write`、`document.transform`、`selection.set` 和 `workflow.apply_patch` — 都会在改动任何内容之前记录到 VMark 的编辑历史中。状态栏中的 **历史** 按钮会为当前聚焦的文档打开一个面板。按钮上的计数表示该文档由 AI 产生的版本数；当修改没有被记录时，按钮会变为警告色。每当有新版本被记录，面板会在所有窗口中实时更新。

面板按从新到旧列出文档的版本。每一行显示发生时间、修改类型、工具以及修改者：AI 客户端的提供方（例如 `claude` 或 `codex`）、它的连接和会话标签。没有令牌的客户端显示为 **未识别的客户端**，未知令牌显示为 **无法识别的凭据**，被多个客户端共用的令牌显示为 **由多个提供方共用的凭据** — 无论客户端自称什么名字，都不会显示为某个提供方。**恢复此版本** 会恢复该版本的文本；**恢复到此更改之前** 会恢复修改之前的文本。恢复会推进文档的修订号，因此仍持有旧修订号的 AI 客户端在下一次写入时会收到 `STALE`，而不会覆盖你的恢复。恢复本身也会被记录：被替换的文本会先保存下来，而在恢复过程中被编辑过的文档不会被改动。如果 VMark 无法确认恢复的记录已写入磁盘，会在结果旁边提醒你。

版本列表上方的 **审阅 AI 修改** 按客户端和会话分组，列出你尚未审阅的 AI 修改；修改已全部审阅的版本只汇总为一个数量。每项修改提供 **保留** 或 **还原**（之后可 **撤销保留** 或 **撤销还原**）。会覆盖你之后编辑过的文字的还原不会执行：该修改被标记为冲突，你手动解决后，用 **标记为已处理** 记录下来。位置已无法确认的修改会说明原因，且不提供自动还原。**清除已审阅** 在确认后永久结束所有已审阅的修改，此操作无法撤销。一个文档最多容纳 500 项未审阅的 AI 修改：达到上限时会有横幅提示，在你审阅并清除之前，AI 对它的编辑会以 `REVIEW_BACKLOG_FULL` 被拒绝。从与上一版本不同的版本开始的保存 — 即文档在两个窗口中被编辑 — 会被如此标注，并提供两个恢复操作以撤销合并。点击**显示两处更改**可查看该次保存的两份差异：*与此次保存起始的版本相比*对比该次保存起始的版本，*与上一版本相比*对比历史中的上一版本。

其后的 **评论** 列出文档的评论串。**评论所选内容** 会引用编辑器中选中的文本（只有光标时为光标所在段落）并添加你的评论；未保存的文本会先被记录，因此评论绝不会指向旧版本。每个评论串显示其状态（待处理、已处理、已解决或已重新打开）、作者、引用的文本和回复。评论以纯文本显示：评论中的 HTML 只会被显示，绝不会被执行。引用的文本现在出现多次时，评论串会说明次数；文本消失时，评论串也会说明。你可以在任何状态下 **回复**，将待处理或已重新打开的评论串 **标记为已处理**、**解决**，并将已解决的评论串 **重新打开** 或 **删除**；删除前会先确认，且无法撤销。评论或回复正在发送时，即使关闭面板再重新打开，也无法编辑或取消；被拒绝的内容会保留下来，方便你修改后重新发送。只有你可以解决、重新打开或删除评论串。在原始修订版本已从历史中清除后重新打开的评论串会显示 *创建时的修订版本已不再保留*，并与当前文本进行匹配。

面板顶部会在修改没有被记录时给出提示：历史无法启动或处于只读状态；历史落后（记录在排队，尚未写入磁盘）；此文档上一次保存被拒绝，或历史未能及时响应；因窗口中打开的页面过多，AI 编辑被拒绝；或者某些 AI 修改已无法再自动撤销。面板还会统计因无法确认修改范围而被记录为整篇文档修改的 AI 编辑。无法再自动撤销的修改会显示为 **已阻止：原因（来源）**，位于其位置最后一次被确认的版本之下，该版本会被高亮；如果没有这样的版本，面板会说明位置不可用。已应用但从未被记录的写入列在 **未记录的写入** 下，每一项都可以恢复或丢弃。

要区分同一客户端的多个会话，请在客户端的 MCP 配置中、在 `VMARK_MCP_TOKEN` 旁边设置 `VMARK_SESSION_LABEL`：

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

标签最多 128 个 UTF-8 字节，且不能包含控制字符；违反规则的标签会被丢弃并给出警告，客户端会在没有标签的情况下连接。标签由客户端的配置决定，因此仅用于显示，不参与任何判断。

历史保存在 VMark 应用数据目录下的 `agent-journal` 文件夹中，因此重启后依然保留。该文件夹包含每次被记录的编辑之前的完整文本，并且只有所有者可以访问（在 macOS 和 Linux 上为 `0700`）。来自旧版 VMark 的检查点（一个 `mcp-checkpoints.jsonl`，在首次启动时导入，随后改名保留）列在 **较早的检查点** 下，这是一个涵盖所有文档和窗口的统一列表。恢复其中一项会打开它的文件；未命名的检查点，或文件已无法打开的检查点，会恢复到一个新文档中。该部分会显示保留的检查点文本大小，并可一次性清除全部内容 — 每个文件、每个窗口 — 同时从磁盘删除这些文本。

## 安全说明

- MCP 服务器只接受本地连接（localhost）
- 不向外部服务器发送数据
- AI 的文件操作被限制在打开的工作区根目录以及已打开文档所在的文件夹内——参见[隐私](/zh-CN/guide/privacy#ai-助手能触及的范围)
- 所有处理均在你的机器上完成
- WebSocket 桥接只能本地访问
- 每个已安装的客户端都携带自己的 `VMARK_MCP_TOKEN`。没有令牌、令牌未知或与其他客户端共用令牌的客户端仍然可以连接，但其委托操作会被拒绝，并提示你在 **设置 → 集成** 中为它运行安装并重启它

## 下一步

- 探索所有可用的 [MCP 工具](/zh-CN/guide/mcp-tools)
- 了解[键盘快捷键](/zh-CN/guide/shortcuts)
- 查看其他[功能特性](/zh-CN/guide/features)
