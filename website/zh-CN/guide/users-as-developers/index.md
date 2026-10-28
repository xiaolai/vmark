# 用户即开发者

在 AI 编程工具的时代，"用户"和"开发者"之间的界限正在消失。如果你能描述一个 bug，你就能修复它。如果你能想象一个功能，你就能构建它——借助一个已经理解代码库的 AI 助手。

VMark 拥抱这一理念。代码库预装了供 AI 编程工具使用的项目规则、架构文档和约定。克隆仓库，打开你的 AI 助手，开始贡献——AI 已经知道 VMark 是如何工作的。

## 快速开始

1. **克隆仓库**——AI 配置已就位。
2. **安装你的 AI 工具**——[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex) 或 [Gemini CLI](https://github.com/google-gemini/gemini-cli)。
3. **打开会话**——工具会自动读取 `AGENTS.md` 和规则。
4. **开始编码**——AI 知道项目约定、测试要求和架构模式。

无需额外设置。直接让 AI 来帮你。

## 阅读指南

不熟悉 AI 辅助开发？这些页面相互关联：

1. **[我为什么要构建 VMark](/zh-CN/guide/users-as-developers/why-i-built-vmark)**——一个非程序员从脚本到桌面应用的旅程
2. **[五项让 AI 如虎添翼的基本人类技能](/zh-CN/guide/users-as-developers/what-are-indispensable)**——Git、TDD、终端素养、英语和品味——一切的基础
3. **[为什么贵的模型反而更便宜](/zh-CN/guide/users-as-developers/why-expensive-models-are-cheaper)**——每 token 的价格是虚荣指标；每任务成本才是关键
4. **[订阅制与按量计费的对比](/zh-CN/guide/users-as-developers/subscription-vs-api)**——为什么固定费率订阅在编程会话中胜过按 token 付费
5. **[英文提示词效果更好](/zh-CN/guide/users-as-developers/prompt-refinement)**——翻译、优化和 `::` 钩子
6. **[跨模型验证](/zh-CN/guide/users-as-developers/cross-model-verification)**——使用 Claude + Codex 相互审计，获得更好的代码
7. **[为什么是 Issue 而不是 PR](/zh-CN/guide/users-as-developers/why-issues-not-prs)**——为什么在 AI 维护的代码库中我们接受 Issue 而非 Pull Request
8. **[成本与工作量评估](/zh-CN/guide/users-as-developers/cost-evaluation)**——人工团队构建 VMark 的成本 vs. AI 辅助开发的实际花费

已经熟悉基础知识了？直接跳到[跨模型验证](/zh-CN/guide/users-as-developers/cross-model-verification)了解高级工作流，或继续阅读 VMark AI 设置的底层原理。

## 一个文件，所有工具

AI 编程工具各自读取自己的配置文件：

| 工具 | 配置文件 |
|------|---------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

在三处维护相同的说明容易出错。VMark 通过单一事实来源解决这个问题：

- **`AGENTS.md`**——包含所有项目规则、约定和架构说明。
- **`CLAUDE.md`**——只有一行：`@AGENTS.md`（Claude Code 指令，内联该文件）。
- **Codex CLI**——直接读取 `AGENTS.md`。
- **Gemini CLI**——在 `GEMINI.md` 中使用 `@AGENTS.md` 内联同一文件。

更新 `AGENTS.md` 一次，所有工具都会获取变更。

::: tip 什么是 `@AGENTS.md`？
`@` 前缀是 Claude Code 指令，用于内联另一个文件的内容。类似于 C 中的 `#include`——`AGENTS.md` 的内容会被插入到 `CLAUDE.md` 的该位置。了解更多请访问 [agents.md](https://agents.md/)。
:::

## 使用 Codex 作为第二意见

VMark 使用跨模型验证——Claude 编写代码，然后 Codex（OpenAI 的另一个 AI 模型）独立审计。这可以发现单一模型可能忽视的盲点。完整细节和设置说明请参见[跨模型验证](/zh-CN/guide/users-as-developers/cross-model-verification)。

## AI 知道什么

当 AI 编程工具打开 VMark 仓库时，它会自动获得：

### 项目规则（`.claude/rules/`）

这些文件会自动加载到每个 Claude Code 会话中，涵盖：

| 规则 | 执行内容 |
|------|---------|
| TDD 工作流 | 测试优先是强制要求；覆盖率阈值会阻止构建 |
| 设计 Token | 禁止硬编码颜色——包含完整的 CSS token 参考 |
| 组件模式 | 弹窗、工具栏、上下文菜单模式及代码示例 |
| 焦点指示器 | 无障碍性：键盘焦点必须始终可见 |
| 深色主题 | `.dark-theme` 选择器规则，token 对等要求 |
| 键盘快捷键 | 三文件同步程序（Rust、TypeScript、文档） |
| 版本升级 | 五文件更新程序 |
| 代码库约定 | Store、Hook、插件、测试和导入模式 |

### 自定义技能

斜杠命令赋予 AI 专项能力：

| 命令 | 功能 |
|------|------|
| `/fix` | 正确修复问题——根因分析、TDD、不打补丁 |
| `/fix-issue` | 端到端 GitHub Issue 解决器（获取、分支、修复、审计、PR） |
| `/codex-audit` | 完整 9 维代码审计（安全性、正确性、合规性等） |
| `/codex-audit-mini` | 针对小变更的快速 5 维检查 |
| `/codex-verify` | 验证上次审计的修复结果 |
| `/codex-commit` | 从变更分析生成智能提交消息 |
| `/audit-fix` | 审计、修复所有发现、验证——循环直至清洁 |
| `/feature-workflow` | 带专项 Agent 的端到端门控工作流 |
| `/merge-prs` | 依次审查并合并开放 PR |
| `/bump` | 在所有 5 个文件中升级版本、提交、打标签、推送 |

### 专项 Agent

对于复杂任务，Claude Code 可以委派给专注的子 Agent：

| Agent | 职责 |
|-------|------|
| 规划师 | 研究最佳实践，头脑风暴边界情况，生成模块化计划 |
| 实施者 | TDD 驱动的实现，附带预检调查 |
| 审计师 | 审查 diff 的正确性和规则违反情况 |
| 测试运行者 | 运行门控，通过 Tauri MCP 协调 E2E 测试 |
| 验证者 | 发布前的最终检查清单 |

## 私有覆盖

并非所有内容都属于共享配置。对于个人偏好：

| 文件 | 是否共享 | 用途 |
|------|---------|------|
| `AGENTS.md` | 是 | 所有 AI 工具的项目规则 |
| `CLAUDE.md` | 是 | Claude Code 入口点 |
| `.claude/settings.json` | 是 | 团队共享权限 |
| `CLAUDE.local.md` | **否** | 你的个人说明（已 gitignore） |
| `.claude/settings.local.json` | **否** | 你的个人设置（已 gitignore） |

在项目根目录创建 `CLAUDE.local.md`，用于只适用于你的说明——偏好语言、工作流习惯、工具偏好。
