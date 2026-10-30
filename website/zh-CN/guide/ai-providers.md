# AI 提供商

VMark 的 [AI 精灵](/zh-CN/guide/ai-genies)需要 AI 提供商来生成建议。你可以使用本地安装的 CLI 工具，或直接连接到 REST API。

## 快速设置

最快的上手方式：

1. 打开 **设置 > 集成**
2. 点击 **检测** 扫描已安装的 CLI 工具
3. 如果找到 CLI（例如 Claude、Gemini），选择它——完成
4. 如果没有可用的 CLI，选择 REST 提供商，输入 API 密钥，然后选择模型

每次只能激活一个提供商。

## CLI 提供商

CLI 提供商使用本地安装的 AI 工具。VMark 将它们作为子进程运行，并将输出流式传输回编辑器。

| 提供商 | CLI 命令 | 安装方式 |
|--------|---------|---------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### CLI 检测工作原理

在设置 > 集成中点击 **检测**。VMark 在你的 `$PATH` 中搜索每个 CLI 命令并报告可用性。如果找到 CLI，其单选按钮变为可选。每次点击 **检测** 都会重新扫描；自动检测（应用启动时、打开设置时，以及精灵选择器中的提供商切换器）则沿用上一次的扫描结果。扫描使用的是 VMark 启动时从登录 shell 读取的 `$PATH`，因此如果 CLI 安装在新加入 `$PATH` 的目录中，需要重启 VMark，**检测** 才能找到它。

### 优势

- **无需 API 密钥**——CLI 使用你现有的登录凭据处理认证
- **大幅降低成本**——CLI 工具使用你的订阅计划（例如 Claude Max、ChatGPT Plus/Pro、Google One AI Premium），这是固定的月费。REST API 提供商按 token 计费，大量使用时可能贵 10–30 倍
- **使用你的 CLI 配置**——模型偏好、系统提示词和计费均由 CLI 自身管理

::: tip 面向开发者的订阅与 API 对比
如果你同时使用这些工具进行代码生成（Claude Code、Codex CLI、Gemini CLI），同一订阅涵盖 VMark 的 AI 精灵和你的编码会话——无额外费用。
:::

### 设置：Claude CLI

1. 安装 Claude Code：`npm install -g @anthropic-ai/claude-code`
2. 在终端运行一次 `claude` 进行认证
3. 在 VMark 中点击 **检测**，然后选择 **Claude**

### 设置：Gemini CLI

1. 安装 Gemini CLI：`npm install -g @google/gemini-cli`（或通过[官方仓库](https://github.com/google-gemini/gemini-cli)）
2. 运行一次 `gemini`，用 Google 账号认证
3. 在 VMark 中点击 **检测**，然后选择 **Gemini**

## REST API 提供商

REST 提供商直接连接到云端（或本地）API。每个提供商需要端点、API 密钥和模型名称。响应会在请求完成时一次性返回——REST 提供商不会流式输出 token；CLI 提供商会。

| 提供商 | 默认端点 | 环境变量 |
|--------|---------|---------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| OpenAI 兼容 | *（由你设置）* | — |
| Google AI | *（内置）* | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### 配置字段

选择 REST 提供商后，会出现三个字段：

- **API 端点**——基础 URL（Google AI 使用固定端点，该字段隐藏）。末尾带 `/v1` 也没问题——VMark 会对其进行规范化，避免路径重复（例如 `https://host/v1` 和 `https://host` 都可以）
- **API 密钥**——你的密钥。它保存在操作系统的凭据存储中，绝不会存放在 `localStorage` 或明文设置文件里——参见 [API 密钥的存放位置](#api-密钥的存放位置)
- **模型**——模型标识符（例如 `claude-sonnet-4-5-20250929`、`gpt-4o`、`gemini-2.0-flash`）

### 环境变量自动填充

VMark 从它自身的进程环境中读取标准环境变量。如果设置了 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`，或 `GOOGLE_API_KEY` / `GEMINI_API_KEY`（按此顺序检查），选择该提供商时 API 密钥字段会自动填充。

VMark 能看到哪些变量，取决于它是如何启动的。在 `~/.zshrc` 或 `~/.bashrc` 等 Shell 配置文件中导出的密钥：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

只有当你从该 Shell 启动应用时才会传递给 VMark。如果从程序坞、访达、聚焦搜索或桌面启动器启动，VMark 不会读取你的 Shell 配置文件，该字段会保持为空——请直接粘贴密钥。在 Windows 上，无论 VMark 以何种方式启动，用户或系统环境变量都有效。

### 设置：Anthropic（REST）

1. 从 [console.anthropic.com](https://console.anthropic.com) 获取 API 密钥
2. 在 VMark 设置 > 集成中选择 **Anthropic**
3. 粘贴你的 API 密钥
4. 选择模型（默认：`claude-sonnet-4-5-20250929`）

### 设置：OpenAI（REST）

1. 从 [platform.openai.com](https://platform.openai.com) 获取 API 密钥
2. 在 VMark 设置 > 集成中选择 **OpenAI**
3. 粘贴你的 API 密钥
4. 选择模型（默认：`gpt-4o`）

### 设置：OpenAI 兼容（DeepSeek、Groq、OpenRouter……）

许多提供商使用与 OpenAI 相同的通信协议（`/v1/chat/completions`、`Bearer` 认证）。**OpenAI 兼容**槽位可以连接其中任意一家——DeepSeek、Groq、OpenRouter、Together、Moonshot、自托管网关等——无需为每个厂商单独设立条目。

与其他 REST 提供商相比，它多了一个字段：可编辑的**服务商名称**，这样该行会显示为“DeepSeek”（或你设置的任何名称），而不是通用标签。

示例——DeepSeek：

1. 从 [platform.deepseek.com](https://platform.deepseek.com) 获取 API 密钥
2. 在 VMark 设置 > 集成中选择 **OpenAI 兼容**
3. 将**服务商名称**设为 `DeepSeek`（可选，仅影响显示）
4. 将 **API 端点**设为 `https://api.deepseek.com`（末尾带 `/v1` 也没问题——VMark 会对其进行规范化）
5. 粘贴你的 API 密钥
6. 将**模型**设为 `deepseek-chat`（或 `deepseek-reasoner`）。可以直接输入，也可以点击刷新获取该端点的模型列表

端点为必填项——此槽位没有默认主机。运行精灵之前，请使用**测试**（⚡）和**测试模型**（🧪）按钮确认连通性。

### 设置：Google AI（REST）

1. 从 [aistudio.google.com](https://aistudio.google.com) 获取 API 密钥
2. 在 VMark 设置 > 集成中选择 **Google AI**
3. 粘贴你的 API 密钥
4. 选择模型（默认：`gemini-2.0-flash`）

### 设置：Ollama API（REST）

当你想以 REST 方式访问本地 Ollama 实例，或 Ollama 运行在网络中的另一台机器上时使用。

1. 确保 Ollama 正在运行：`ollama serve`
2. 在 VMark 设置 > 集成中选择 **Ollama (API)**
3. 将端点设置为 `http://localhost:11434`（或你的 Ollama 主机地址）
4. 留空 API 密钥
5. 将模型设置为你已拉取的模型名称（例如 `llama3.2`）

## 选择提供商

| 情况 | 推荐 |
|------|------|
| 已安装 Claude Code | **Claude（CLI）**——零配置，使用你的订阅 |
| 已安装 Codex 或 Gemini | **Codex / Gemini（CLI）**——使用你的订阅 |
| 需要隐私/离线 | 安装 Ollama → 在 `http://localhost:11434` 使用 **Ollama（API）** |
| 自定义或自托管模型 | 使用你的端点的 **Ollama（API）** |
| DeepSeek / Groq / OpenRouter / 任何 OpenAI 兼容 API | **OpenAI 兼容**——设置端点、密钥和模型 |
| 想要最便宜的云服务 | **任意 CLI 提供商**——订阅费比 API 便宜得多 |
| 无订阅，仅轻量使用 | 设置 API 密钥环境变量 → **REST 提供商**（按 token 付费） |
| 需要最高质量输出 | **Claude（CLI）** 或 **Anthropic（REST）**，使用 `claude-sonnet-4-5-20250929` |

## 单个精灵模型覆盖

单个精灵可以使用 `model` 前置内容字段覆盖提供商的默认模型：

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

这对于将简单任务路由到更快/更便宜的模型同时保持强大的默认值非常有用。

## 可靠性与超时

VMark 对每次提供商调用都设有保护机制，确保 CLI 挂起或 API 响应格式异常时不会阻塞编辑器：

- **CLI 子进程超时**：每次 CLI 提供商调用都有执行超时限制。如果 CLI 无响应，VMark 会取消调用，将错误返回给精灵，并释放工作线程——失控的子进程无法耗尽线程池。
- **REST JSON 解析安全**：如果 REST 提供商返回意外的响应格式（HTML 错误页面、截断的 JSON、上游变更后的架构漂移），VMark 会向前端返回类型化错误，而不是让 AI 监听器永久等待。你会在精灵的状态横幅中看到错误，并可选择重试。
- **取消令牌**：长时间运行的精灵或工作流步骤随时可以取消——在精灵选择器中点击“取消”或关闭面板，即可干净地中止正在进行的请求。
- **共享 HTTP 客户端**：REST 提供商共享一个带连接池的 `reqwest` 客户端，因此连续运行精灵时无需每次都进行 TCP/TLS 握手。
- **Windows 路径发现**：在 Windows 上，VMark 读取用户的完整 `PATH`（包括仅限 PowerShell 的条目）来检测 CLI，因此在终端中正常工作的用户安装工具在 VMark 内部同样可用。

## API 密钥的存放位置

API 密钥保存在操作系统的凭据存储中——macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service——服务名为 `app.vmark.secrets`，每个提供商一个条目。VMark 只在当前运行的会话中于内存里保留一份副本；持久化的提供商设置从不包含密钥，也不会向 `localStorage` 写入任何内容。旧版 VMark 保存在明文设置文件中的密钥，会在新版首次加载时迁移到钥匙串中，而且只有在成功读回钥匙串中写入的内容之后，才会删除明文副本。

如果钥匙串拒绝写入，VMark 会显示错误提示，而不是悄悄把密钥留在内存中。在 macOS 上，使用临时签名（ad-hoc）的开发构建每次重新签名后都可能再次请求钥匙串访问权限；正式发布的构建只会询问一次。

## 安全说明

- **API 密钥保存在操作系统钥匙串中**——见上文；它们永远不会写入 VMark 的设置文件或 `localStorage`
- **环境变量** 在你选择提供商时读取，并且只会填充空的密钥字段
- **CLI 提供商** 使用你现有的 CLI 认证——VMark 从不接触你的凭据
- **所有请求** 直接从你的机器发送到提供商——中间没有 VMark 服务器

## 故障排除

**“没有可用的 AI 提供程序”**——点击 **检测** 扫描 CLI，或用 API 密钥配置 REST 提供商。

**CLI 显示“未找到”**——CLI 不在你的 `$PATH` 中。安装它或检查你的 Shell 配置文件。在 macOS 上，GUI 应用可能不继承终端的 `$PATH`——尝试将路径添加到 `/etc/paths.d/`。

**CLI 挂起/无响应**——VMark 的执行超时会自动取消调用；你会在精灵状态横幅中看到错误。如果某个 CLI 持续触发超时，请先在终端中直接运行它，确认能正常工作，然后检查是否需要交互式认证。

**REST 提供商返回 401**——你的 API 密钥无效或已过期。从提供商的控制台生成新密钥。

**REST 提供商返回 429**——你已触及速率限制。稍等片刻后重试，或切换到其他提供商。

**REST 提供商返回乱码或意外 JSON**——VMark 会显示类型化的解析错误（例如“list_models returned an unexpected response shape”）。检查端点 URL，以及所选提供商类型是否与 API 合约匹配；某些自托管网关声称兼容 OpenAI URL，但实际使用不同的架构。

**响应缓慢**——CLI 提供商会产生子进程开销。要获得更快的响应，请使用直接连接的 REST 提供商。本地最快的选项是使用小型模型的 Ollama。

**模型未找到错误**——模型标识符与提供商提供的不匹配。查阅提供商文档获取有效模型名称。

## 另请参阅

- [AI 精灵](/zh-CN/guide/ai-genies)——如何使用 AI 写作辅助
- [MCP 设置](/zh-CN/guide/mcp-setup)——通过模型上下文协议进行外部 AI 集成
