# AI 精灵

AI 精灵是使用 AI 转换文本的提示词模板。选中文本，调用精灵，然后审查建议的更改——全程无需离开编辑器。

## 快速开始

1. 在 **设置 > 集成** 中配置 AI 提供商（参见 [AI 提供商](/zh-CN/guide/ai-providers)）
2. 在编辑器中选中一些文本
3. 按 `Mod + Y` 打开精灵选择器
4. 选择一个精灵或输入自由格式提示词
5. 审查内联建议——接受或拒绝

## 精灵选择器

按 `Mod + Y`（或菜单 **工具 > AI 精灵**）打开一个类似聚焦搜索的覆盖层，包含一个统一输入框。

**搜索与自由格式**——开始输入以按名称、描述或分类筛选精灵。如果没有匹配的精灵，输入框变为自由格式提示词字段。

**快捷按钮**——当范围为"选区"且输入框为空时，会显示常用操作的一键按钮（润色、精简、语法、改写）。

**两步自由格式**——当没有匹配的精灵时，按一次 `Enter` 查看确认提示，再按一次 `Enter` 作为 AI 提示词提交。这可以防止意外提交。

**范围切换**——按 `Tab` 循环切换范围：选区 → 块 → 文档 → 全部。

**提示词历史**——在自由格式模式（无匹配精灵）下，按 `ArrowUp` / `ArrowDown` 循环浏览之前的提示词。按 `Ctrl + R` 打开可搜索的历史下拉列表。幽灵文字会以灰色显示最近匹配的提示词作为提示——按 `Tab` 接受。

### 处理反馈

选择精灵或提交自由格式提示词后，选择器会显示内联反馈：

- **处理中**——带有已用时间计数器的思考指示器。按 `Escape` 取消。
- **预览**——AI 响应实时流式传输。使用"接受"应用或"拒绝"放弃。
- **错误**——如果出现问题，错误信息会显示并附带"重试"按钮。

状态栏也会显示 AI 进度——运行时显示旋转图标和已用时间，成功时短暂闪现"完成"，出错时显示带有重试/关闭按钮的错误指示器。当 AI 有活跃状态时，状态栏会自动显示，即使你之前用 `F7` 隐藏了它。

## 内置精灵

VMark 内置 13 个精灵，分为四个分类：

### 编辑

| 精灵 | 描述 | 范围 |
|------|------|------|
| 润色 | 提升清晰度和流畅性 | 选区 |
| 精简 | 使文本更简洁 | 选区 |
| 语法修复 | 修复语法和拼写 | 选区 |
| 简化 | 使用更简单的语言 | 选区 |

### 创意

| 精灵 | 描述 | 范围 |
|------|------|------|
| 扩展 | 将想法发展为完整文章 | 选区 |
| 改写 | 用不同方式表达相同内容 | 选区 |
| 生动化 | 添加感官细节和意象 | 选区 |
| 续写 | 从当前位置继续写作 | 块 |

### 结构

| 精灵 | 描述 | 范围 |
|------|------|------|
| 摘要 | 总结文档 | 文档 |
| 大纲 | 生成大纲 | 文档 |
| 标题 | 建议标题选项 | 文档 |

### 工具

| 精灵 | 描述 | 范围 |
|------|------|------|
| 翻译 | 翻译为英文 | 选区 |
| 用英文改写 | 用英文重写文本 | 选区 |

## 范围

每个精灵在以下三种范围之一中工作：

- **选区**——高亮的文本。如果没有选中内容，则回退到当前块。
- **块**——光标位置处的段落或块元素。
- **文档**——整个文档内容。

范围决定了提取哪些文本并作为 `{{content}}` 传递给 AI。

::: tip
如果范围是 **选区** 但没有选中内容，精灵会对当前段落进行操作。
:::

## 审查建议

精灵运行后，建议会以内联方式显示：

- **替换**——原文加删除线，新文本以绿色显示
- **插入**——新文本以绿色显示在源块之后
- **删除**——原文加删除线

每条建议都有接受（对勾）和拒绝（X）按钮。

### 键盘快捷键

| 操作 | 快捷键 |
|------|--------|
| 接受建议 | `Enter` |
| 拒绝建议 | `Escape` |
| 下一个建议 | `Tab` |
| 上一个建议 | `Shift + Tab` |
| 接受所有 | `Mod + Shift + Enter` |
| 拒绝所有 | `Mod + Shift + Escape` |

## 状态栏指示器

AI 生成时，状态栏显示旋转的星光图标和已用时间计数器（"思考中... 3 秒"）。取消按钮（×）可以停止请求。

完成后，"完成"对勾会短暂闪现 3 秒。如果发生错误，状态栏显示错误信息以及重试和关闭按钮。

当 AI 有活跃状态（运行中、出错或成功）时，状态栏会自动显示，即使你用 `F7` 隐藏了它。

---

## 编写自定义精灵

你可以创建自己的精灵。每个精灵是一个带有 YAML 前置内容和提示词模板的单个 Markdown 文件。

### 精灵存储位置

精灵存储在你的应用数据目录中：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/app.vmark/genies/` |
| Windows | `%APPDATA%\app.vmark\genies\` |
| Linux | `~/.local/share/app.vmark/genies/` |

从菜单 **工具 > 打开精灵文件夹** 打开此文件夹。

### 目录结构

子目录在选择器中成为 **分类**。你可以按自己喜欢的方式组织精灵：

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← 你的自定义分类
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← 另一个自定义分类
    └── blog-intro.md
```

### 文件格式

每个精灵文件有两部分：**前置内容**（元数据）和 **模板**（提示词）。

```markdown
---
description: Improve clarity and flow
scope: selection
category: editing
---

You are an expert editor. Improve the clarity, flow, and conciseness
of the following text while preserving the author's voice and intent.

Return only the improved text — no explanations.

{{content}}
```---
description: Improve clarity and flow
scope: selection
category: editing
---

You are an expert editor. Improve the clarity, flow, and conciseness
of the following text while preserving the author's voice and intent.

Return only the improved text — no explanations.

{{content}}
```

文件名 `polish.md` 在选择器中显示为"Polish"。

### 前置内容字段

| 字段 | 是否必需 | 值 | 默认值 |
|------|----------|-----|--------|
| `description` | 否 | 选择器中显示的简短描述 | 空 |
| `scope` | 否 | `selection`、`block`、`document` | `selection` |
| `category` | 否 | 分组用的分类名称 | 子目录名称 |
| `action` | 否 | `replace`、`insert` | `replace` |
| `context` | 否 | `1`、`2` | `0`（无） |
| `model` | 否 | 覆盖提供商默认值的模型标识符 | 提供商默认值 |

**精灵名称**——显示名称始终来自 **文件名**（不含 `.md`）。例如，`fix-grammar.md` 在选择器中显示为"Fix Grammar"。重命名文件即可更改显示名称。

### `{{content}}` 占位符

`{{content}}` 占位符是每个精灵的核心。精灵运行时，VMark 会：

1. 根据范围 **提取文本**（选中文本、当前块或完整文档）
2. **替换** 模板中的每个 `{{content}}` 为提取的文本
3. 将填充后的提示词 **发送** 给活跃的 AI 提供商
4. 将响应以 **流式** 方式作为内联建议返回

例如，使用以下模板：

```markdown
Translate the following text into French.

{{content}}
```

如果用户选中了"Hello, how are you?"，AI 收到的是：

```
Translate the following text into French.

Hello, how are you?
```

AI 响应"Bonjour, comment allez-vous ?"，并以内联建议的形式替换选中文本。

### `{{context}}` 占位符

`{{context}}` 占位符为 AI 提供只读的周边文本——让它能在不修改周边块的情况下，匹配附近内容的语气、风格和结构。

**工作原理：**

1. 在前置内容中设置 `context: 1` 或 `context: 2`，以包含 ±1 或 ±2 个相邻块
2. 在模板中使用 `{{context}}` 指定注入周边文本的位置
3. AI 可以看到上下文，但建议只替换 `{{content}}`

**复合块是原子的**——如果相邻块是列表、表格、引用块或折叠块，整个结构算作一个块。

**范围限制**——上下文只适用于 `selection` 和 `block` 范围。对于 `document` 范围，内容本身已经是完整文档。

**自由格式提示词**——当你在选择器中输入自由格式指令时，VMark 自动包含 ±1 个周边块作为 `selection` 和 `block` 范围的上下文，无需配置。

**向后兼容**——没有 `{{context}}` 的精灵与以前完全相同。如果模板不包含 `{{context}}`，则不提取周边文本。

**示例——AI 收到的内容：**

设置 `context: 1`，光标位于三段文档的第二段：

```
[Before]
First paragraph content here.

[After]
Third paragraph content here.
```

当该方向没有相邻内容时（例如内容在文档开头或结尾），`[Before]` 和 `[After]` 部分会被省略。

### `action` 字段

默认情况下，精灵 **替换** 源文本为 AI 输出。设置 `action: insert` 可将输出 **追加** 到源块之后。

使用 `replace` 的场景：编辑、改写、翻译、语法修复——任何转换原文的操作。

使用 `insert` 的场景：续写、在内容下方生成摘要、添加注释——任何添加新文本而不删除原文的操作。

**示例——insert 操作：**

```markdown
---
description: Continue writing from here
scope: block
action: insert
---

Continue writing naturally from where the following text leaves off.
Match the author's voice, style, and tone. Write 2-3 paragraphs.

Do not repeat or summarize the existing text — just continue it.

{{content}}
```---
description: Continue writing from here
scope: block
action: insert
---

Continue writing naturally from where the following text leaves off.
Match the author's voice, style, and tone. Write 2-3 paragraphs.

Do not repeat or summarize the existing text — just continue it.

{{content}}
```

### `model` 字段

为特定精灵覆盖默认模型。当你希望简单任务使用更便宜的模型，或复杂任务使用更强大的模型时很有用。

```markdown
---
description: Quick grammar fix (uses fast model)
scope: selection
model: claude-haiku-4-5-20251001
---

Fix grammar and spelling errors. Return only the corrected text.

{{content}}
```---
description: Quick grammar fix (uses fast model)
scope: selection
model: claude-haiku-4-5-20251001
---

Fix grammar and spelling errors. Return only the corrected text.

{{content}}
```

模型标识符必须与你的活跃提供商接受的格式一致。

## 编写有效的提示词

### 明确输出格式

告诉 AI 确切需要返回什么。否则，模型倾向于添加解释、标题或注释。

```markdown
<!-- 好 -->
Return only the improved text — no explanations.

<!-- 不好——AI 可能用引号包裹输出，添加"以下是改进版本："等内容 -->
Improve this text.
```

### 设定角色

给 AI 一个角色以锚定其行为。

```markdown
<!-- 好 -->
You are an expert technical editor who specializes in API documentation.

<!-- 一般，但不够聚焦 -->
Edit the following text.
```

### 限制范围

告诉 AI 什么 **不** 应该改变。这可以防止过度编辑。

```markdown
<!-- 好 -->
Fix grammar and spelling errors only.
Do not change the meaning, style, or tone.
Do not restructure sentences.

<!-- 不好——给了 AI 太多自由 -->
Fix this text.
```

### 在提示词中使用 Markdown

你可以在提示词模板中使用 Markdown 格式。这在你想让 AI 生成结构化输出时很有帮助。

```markdown
---
description: Generate a pros/cons analysis
scope: selection
action: insert
---

Analyze the following text and produce a brief pros/cons list.

Format as:

**Pros:**
- point 1
- point 2

**Cons:**
- point 1
- point 2

{{content}}
```---
description: Generate a pros/cons analysis
scope: selection
action: insert
---

Analyze the following text and produce a brief pros/cons list.

Format as:

**Pros:**
- point 1
- point 2

**Cons:**
- point 1
- point 2

{{content}}
```

### 保持提示词聚焦

一个精灵，一项任务。不要把多个任务组合到一个精灵中——而是创建独立的精灵。

```markdown
<!-- 好——一项明确的任务 -->
---
description: Convert to active voice
scope: selection
---

Rewrite the following text using active voice.
Do not change the meaning.
Return only the rewritten text.

{{content}}
```---
description: Convert to active voice
scope: selection
---

Rewrite the following text using active voice.
Do not change the meaning.
Return only the rewritten text.

{{content}}
```

## 自定义精灵示例

### 学术——撰写摘要

```markdown
---
description: Generate an academic abstract
scope: document
action: insert
---

Read the following paper and write a concise academic abstract
(150-250 words). Follow standard structure: background, methods,
results, conclusion.

{{content}}
```---
description: Generate an academic abstract
scope: document
action: insert
---

Read the following paper and write a concise academic abstract
(150-250 words). Follow standard structure: background, methods,
results, conclusion.

{{content}}
```

### 博客——生成引子

```markdown
---
description: Write an engaging opening paragraph
scope: document
action: insert
---

Read the following draft and write a compelling opening paragraph
that hooks the reader. Use a question, surprising fact, or vivid
scene. Keep it under 3 sentences.

{{content}}
```---
description: Write an engaging opening paragraph
scope: document
action: insert
---

Read the following draft and write a compelling opening paragraph
that hooks the reader. Use a question, surprising fact, or vivid
scene. Keep it under 3 sentences.

{{content}}
```

### 代码——解释代码块

```markdown
---
description: Add a plain-English explanation above code
scope: selection
action: insert
---

Read the following code and write a brief plain-English explanation
of what it does. Use 1-2 sentences. Do not include the code itself
in your response.

{{content}}
```---
description: Add a plain-English explanation above code
scope: selection
action: insert
---

Read the following code and write a brief plain-English explanation
of what it does. Use 1-2 sentences. Do not include the code itself
in your response.

{{content}}
```

### 邮件——使用专业语气

```markdown
---
description: Rewrite in professional tone
scope: selection
---

Rewrite the following text in a professional, business-appropriate tone.
Keep the same meaning and key points. Remove casual language,
slang, and filler words.

Return only the rewritten text — no explanations.

{{content}}
```---
description: Rewrite in professional tone
scope: selection
---

Rewrite the following text in a professional, business-appropriate tone.
Keep the same meaning and key points. Remove casual language,
slang, and filler words.

Return only the rewritten text — no explanations.

{{content}}
```

### 翻译——译为简体中文

```markdown
---
description: Translate to Simplified Chinese
scope: selection
---

Translate the following text into Simplified Chinese.
Preserve the original meaning, tone, and formatting.
Use natural, idiomatic Chinese — not word-for-word translation.

Return only the translated text — no explanations.

{{content}}
```---
description: Translate to Simplified Chinese
scope: selection
---

Translate the following text into Simplified Chinese.
Preserve the original meaning, tone, and formatting.
Use natural, idiomatic Chinese — not word-for-word translation.

Return only the translated text — no explanations.

{{content}}
```

### 上下文感知——适应周边风格

```markdown
---
description: Rewrite to match surrounding tone and style
scope: selection
context: 1
---

Rewrite the following content to fit naturally with its surrounding context.
Match the tone, style, and level of detail.

Return only the rewritten text — no explanations.

## Surrounding context (do not include in output):
{{context}}

## Content to rewrite:
{{content}}
```---
description: Rewrite to match surrounding tone and style
scope: selection
context: 1
---

Rewrite the following content to fit naturally with its surrounding context.
Match the tone, style, and level of detail.

Return only the rewritten text — no explanations.

## Surrounding context (do not include in output):
{{context}}

## Content to rewrite:
{{content}}
```

### 审查——事实核查

```markdown
---
description: Flag claims that need verification
scope: selection
action: insert
---

Read the following text and list any factual claims that should be
verified. For each claim, note why it might need checking (e.g.,
specific numbers, dates, statistics, or strong assertions).

Format as a bullet list. If everything looks solid, say
"No claims flagged for verification."

{{content}}
```---
description: Flag claims that need verification
scope: selection
action: insert
---

Read the following text and list any factual claims that should be
verified. For each claim, note why it might need checking (e.g.,
specific numbers, dates, statistics, or strong assertions).

Format as a bullet list. If everything looks solid, say
"No claims flagged for verification."

{{content}}
```

## AI 建议

当 Genie 返回的文本意图作为选区的替换（而非自由格式的对话回复）时，VMark 会以 **建议** 的形式展示它，附带内联差异：原文红色删除线，提议文本绿色下划线。在任何更改持久化之前，你都需要审核并批准。

| 操作 | 快捷键 |
|---|---|
| 接受聚焦的建议 | `Tab` |
| 拒绝聚焦的建议 | `Esc` |
| 接受文档中的所有建议 | `Mod + Shift + Enter` _（上下文感知 —— 在表格内时也是"在上方添加行"）_ |
| 切换到下一个建议 | 从未聚焦位置按 `Tab` |

当一个 Genie 重写多个段落时，每个替换都是独立可导航的建议。接受其中一个不会自动接受其他建议。

建议 UI 也有 MCP 接口 —— 通过 [MCP 服务器](/zh-CN/guide/mcp-tools)连接的外部 AI 代理可以发出 `suggestion.accept` / `suggestion.reject` 操作来操控同一状态。

## 限制

- 精灵只在 **所见即所得模式** 中有效。在源码模式中，会弹出提示说明。
- 每次只能运行一个精灵。如果 AI 已在生成，选择器不会启动另一个。
- `{{content}}` 占位符是字面替换——不支持条件语句或循环。
- 使用 `scope: document` 时，非常大的文档可能超出提供商的 token 限制。

## 故障排除

**"无可用 AI 提供商"**——打开设置 > 集成并配置提供商。参见 [AI 提供商](/zh-CN/guide/ai-providers)。

**精灵未出现在选择器中**——检查文件是否有 `.md` 扩展名，是否有用 `---` 围住的有效前置内容，以及是否在精灵目录中（不能超过一级子目录）。

**AI 返回乱码或错误**——验证 API 密钥是否正确，模型名称是否对你的提供商有效。在终端/控制台中查看错误详情。

**建议不符合预期**——优化你的提示词。添加约束（"只返回文本"、"不要解释"），设定角色，或缩小范围。

## 另请参阅

- [AI 提供商](/zh-CN/guide/ai-providers)——配置 CLI 或 REST API 提供商
- [键盘快捷键](/zh-CN/guide/shortcuts)——完整快捷键参考
- [MCP 工具](/zh-CN/guide/mcp-tools)——通过 MCP 进行外部 AI 集成
